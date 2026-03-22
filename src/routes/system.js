/**
 * System routes — maintenance mode, system state, reconciliation,
 * backup/restore, export/import, and diagnostics.
 *
 * Extracted from server.js:
 *   - POST   /api/system-maintenance        (line 1743)
 *   - GET    /api/system-state              (line 1767)
 *   - POST   /api/run-reconciliation        (line 1784)
 *   - POST   /api/cleanup-accrual-duplicates (line 1794)
 *   - GET    /api/system-status             (line 7270)
 *   - POST   /api/data/backup               (line 6005)
 *   - GET    /api/data/backups              (line 6040)
 *   - DELETE /api/data/backup/:backupId     (line 6064)
 *   - POST   /api/data/restore              (line 6094)
 *   - GET    /api/data/export               (line 6149)
 *   - POST   /api/data/import               (line 6179)
 */

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const { requireAuth, activeSessions } = require('../middleware/auth');
const { rateLimitStore } = require('../middleware/rate-limit');
const { readJSON, readJSONArray, writeJSON } = require('../data/json-store');
const { dataDir } = require('../config');
const { dedupeMonthlyAccrualEntries } = require('../services/leave-balance');
const {
    usersFile, employeesFile, applicationsFile, leavecardsFile,
    aoUsersFile, hrUsersFile, asdsUsersFile, sdsUsersFile, itUsersFile,
    systemStateFile, activityLogsFile,
    logActivity, getClientIp,
} = require('../utils/helpers');

// ---------------------------------------------------------------------------
// Maintenance mode state (module-level so it persists across requests)
// ---------------------------------------------------------------------------
let maintenanceMode = false;
let maintenanceMessage = 'The system is currently undergoing maintenance. Please try again later.';

// Restore maintenance state from disk on module load
try {
    const savedState = readJSON(systemStateFile);
    if (savedState && savedState.maintenanceMode) {
        maintenanceMode = true;
        if (savedState.maintenanceMessage) maintenanceMessage = savedState.maintenanceMessage;
    }
} catch (e) { /* ignore — file may not exist yet */ }

// ---------------------------------------------------------------------------
// Backup/restore configuration
// ---------------------------------------------------------------------------
const backupDir = path.join(dataDir, 'backups');
if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
}

// List of all data files to backup/restore
const DATA_FILES = [
    'users.json', 'employees.json', 'applications.json', 'leavecards.json',
    'ao-users.json', 'hr-users.json', 'asds-users.json', 'sds-users.json',
    'it-users.json', 'pending-registrations.json',
    'cto-records.json', 'schools.json', 'initial-credits.json',
    'activity-logs.json', 'system-state.json'
    // NOTE: so-records.json removed — dead file never referenced by any endpoint (D1)
    // NOTE: applications.backup.json removed — not a real data file
];

// ---------------------------------------------------------------------------
// Balance reconciliation (inline — not yet extracted to a service)
// ---------------------------------------------------------------------------
function runBalanceReconciliation() {
    try {
        console.log('[RECONCILIATION] Starting weekly balance reconciliation...');
        const leavecards = readJSON(leavecardsFile);
        const applications = readJSONArray(applicationsFile);
        const discrepancies = [];

        for (const card of leavecards) {
            const email = card.email || card.employeeId;
            if (!email) continue;

            // Sum up all approved VL/SL usage from applications for this employee
            const approvedApps = applications.filter(a =>
                a.employeeEmail === email && a.status === 'approved'
            );

            let totalVlUsed = 0, totalSlUsed = 0;
            approvedApps.forEach(a => {
                totalVlUsed += parseFloat(a.vlLess) || 0;
                totalSlUsed += parseFloat(a.slLess) || 0;
            });

            // Compare with leave card spent values
            const cardVlSpent = parseFloat(card.vacationLeaveSpent) || 0;
            const cardSlSpent = parseFloat(card.sickLeaveSpent) || 0;

            const vlDrift = Math.abs(cardVlSpent - totalVlUsed);
            const slDrift = Math.abs(cardSlSpent - totalSlUsed);

            if (vlDrift > 0.01 || slDrift > 0.01) {
                discrepancies.push({
                    email,
                    vlCardSpent: cardVlSpent,
                    vlAppSum: totalVlUsed,
                    vlDrift: vlDrift.toFixed(3),
                    slCardSpent: cardSlSpent,
                    slAppSum: totalSlUsed,
                    slDrift: slDrift.toFixed(3)
                });
            }
        }

        if (discrepancies.length > 0) {
            console.warn(`[RECONCILIATION] Found ${discrepancies.length} balance discrepancies:`);
            discrepancies.forEach(d => {
                console.warn(`  - ${d.email}: VL drift=${d.vlDrift}, SL drift=${d.slDrift}`);
            });
            logActivity('BALANCE_RECONCILIATION', 'system', {
                discrepancyCount: discrepancies.length,
                discrepancies: discrepancies.slice(0, 20) // Log first 20
            });
        } else {
            console.log('[RECONCILIATION] All balances consistent. No discrepancies found.');
        }

        // Update system state
        const systemState = readJSON(systemStateFile);
        systemState.lastReconciliation = new Date().toISOString();
        systemState.lastReconciliationResult = discrepancies.length === 0 ? 'clean' : `${discrepancies.length} discrepancies`;
        fs.writeFileSync(systemStateFile, JSON.stringify(systemState, null, 2));

        return discrepancies;
    } catch (error) {
        console.error('[RECONCILIATION] Error:', error.message);
        return [];
    }
}

// ---------------------------------------------------------------------------
// POST /api/system-maintenance — Toggle maintenance mode (IT only)
// ---------------------------------------------------------------------------
router.post('/api/system-maintenance', requireAuth('it'), (req, res) => {
    const { enabled, message } = req.body;
    maintenanceMode = !!enabled;
    if (message) maintenanceMessage = message;

    // Persist to system-state.json
    const systemState = readJSON(systemStateFile);
    systemState.maintenanceMode = maintenanceMode;
    systemState.maintenanceMessage = maintenanceMode ? maintenanceMessage : undefined;
    systemState.maintenanceToggledAt = new Date().toISOString();
    systemState.maintenanceToggledBy = req.session.email;
    fs.writeFileSync(systemStateFile, JSON.stringify(systemState, null, 2));

    logActivity(maintenanceMode ? 'MAINTENANCE_ENABLED' : 'MAINTENANCE_DISABLED', 'it', {
        userEmail: req.session.email,
        message: maintenanceMode ? maintenanceMessage : 'Maintenance mode disabled',
        ip: getClientIp(req)
    });

    console.log(`[MAINTENANCE] ${maintenanceMode ? 'ENABLED' : 'DISABLED'} by ${req.session.email}`);
    res.json({ success: true, maintenanceMode, message: maintenanceMode ? maintenanceMessage : 'System is operational' });
});

// ---------------------------------------------------------------------------
// GET /api/system-state — Get system health & state (IT only)
// ---------------------------------------------------------------------------
router.get('/api/system-state', requireAuth('it'), (req, res) => {
    const systemState = readJSON(systemStateFile);
    res.json({
        success: true,
        state: {
            ...systemState,
            maintenanceMode,
            activeSessions: activeSessions.size,
            rateLimitEntries: rateLimitStore.size,
            uptime: process.uptime(),
            memoryUsage: process.memoryUsage(),
            nodeVersion: process.version
        }
    });
});

// ---------------------------------------------------------------------------
// POST /api/run-reconciliation — Trigger manual reconciliation (IT only)
// ---------------------------------------------------------------------------
router.post('/api/run-reconciliation', requireAuth('it'), (req, res) => {
    const discrepancies = runBalanceReconciliation();
    res.json({
        success: true,
        message: discrepancies.length === 0 ? 'All balances are consistent.' : `Found ${discrepancies.length} discrepancies.`,
        discrepancies
    });
});

// ---------------------------------------------------------------------------
// POST /api/cleanup-accrual-duplicates — Dedupe monthly accrual rows (IT only)
// ---------------------------------------------------------------------------
router.post('/api/cleanup-accrual-duplicates', requireAuth('it'), (req, res) => {
    try {
        const dryRun = req.query.dryRun !== 'false';
        const result = dedupeMonthlyAccrualEntries(dryRun);

        logActivity('ACCRUAL_DUPLICATES_CLEANUP', 'it', {
            userEmail: req.session.email,
            dryRun: result.dryRun,
            cardsChanged: result.cardsChanged,
            duplicatesRemoved: result.duplicatesRemoved,
            ip: getClientIp(req)
        });

        return res.json({
            success: true,
            message: result.cardsChanged > 0
                ? `${result.duplicatesRemoved} duplicate monthly accrual entr${result.duplicatesRemoved === 1 ? 'y' : 'ies'} ${result.dryRun ? 'would be removed' : 'removed'} across ${result.cardsChanged} leave card(s).`
                : `No duplicate monthly accrual entries ${result.dryRun ? 'found' : 'remaining'}.`,
            result
        });
    } catch (error) {
        console.error('[CLEANUP ACCRUAL DUPLICATES] Error:', error);
        return res.status(500).json({ success: false, error: error.message || 'Failed to cleanup duplicates' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/system-status — Diagnostic endpoint for data persistence (IT only)
// ---------------------------------------------------------------------------
router.get('/api/system-status', requireAuth('it'), (req, res) => {
    try {
        const itUsers = readJSON(itUsersFile);
        const users = readJSON(usersFile);
        const aoUsers = readJSON(aoUsersFile);
        const hrUsers = readJSON(hrUsersFile);
        const leavecards = readJSON(leavecardsFile);
        const ctoRecords = readJSON(path.join(dataDir, 'cto-records.json'));
        res.json({
            success: true,
            volumeMounted: !!process.env.RAILWAY_VOLUME_MOUNT_PATH,
            volumePath: process.env.RAILWAY_VOLUME_MOUNT_PATH || 'NOT SET',
            dataDir: dataDir,
            dataDirExists: fs.existsSync(dataDir),
            fileCounts: {
                itUsers: itUsers.length,
                users: users.length,
                aoUsers: aoUsers.length,
                hrUsers: hrUsers.length,
                leavecards: leavecards.length,
                ctoRecords: ctoRecords.length
            },
            itUserEmails: itUsers.map(u => u.email),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ========== DATA BACKUP & RESTORE SYSTEM ==========

// ---------------------------------------------------------------------------
// POST /api/data/backup — Create a timestamped backup of all data (IT only)
// ---------------------------------------------------------------------------
router.post('/api/data/backup', requireAuth('it'), (req, res) => {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupFolder = path.join(backupDir, `backup-${timestamp}`);
        fs.mkdirSync(backupFolder, { recursive: true });

        const backedUp = [];
        for (const file of DATA_FILES) {
            const src = path.join(dataDir, file);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(backupFolder, file));
                backedUp.push(file);
            }
        }

        logActivity('data_backup', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { backupFolder: `backup-${timestamp}`, filesCount: backedUp.length }
        });

        res.json({
            success: true,
            message: `Backup created successfully with ${backedUp.length} files`,
            backupId: `backup-${timestamp}`,
            files: backedUp
        });
    } catch (error) {
        console.error('Backup error:', error);
        res.status(500).json({ success: false, error: 'Failed to create backup: ' + error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/data/backups — List available backups (IT only)
// ---------------------------------------------------------------------------
router.get('/api/data/backups', requireAuth('it'), (req, res) => {
    try {
        if (!fs.existsSync(backupDir)) {
            return res.json({ success: true, backups: [] });
        }
        const backups = fs.readdirSync(backupDir)
            .filter(f => f.startsWith('backup-'))
            .map(name => {
                const backupPath = path.join(backupDir, name);
                const stat = fs.statSync(backupPath);
                const files = fs.readdirSync(backupPath);
                return { id: name, createdAt: stat.mtime.toISOString(), filesCount: files.length, files };
            })
            .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

        res.json({ success: true, backups });
    } catch (error) {
        console.error('List backups error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// DELETE /api/data/backup/:backupId — Delete a specific backup (IT only)
// ---------------------------------------------------------------------------
router.delete('/api/data/backup/:backupId', requireAuth('it'), (req, res) => {
    try {
        const { backupId } = req.params;
        const validPrefixes = ['backup-', 'auto-startup-', 'pre-restore-', 'pre-import-'];
        if (!validPrefixes.some(p => backupId.startsWith(p))) {
            return res.status(400).json({ success: false, error: 'Invalid backup ID format' });
        }
        // SECURITY: Sanitize backupId to prevent path traversal
        const safeName = path.basename(backupId);
        if (safeName !== backupId || /[\/\\]/.test(backupId)) {
            return res.status(400).json({ success: false, error: 'Invalid backup ID' });
        }
        const backupPath = path.join(backupDir, safeName);
        if (!fs.existsSync(backupPath)) {
            return res.status(404).json({ success: false, error: 'Backup not found' });
        }
        fs.rmSync(backupPath, { recursive: true, force: true });
        logActivity('data_backup_delete', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { backupId, deletedAt: new Date().toISOString() }
        });
        res.json({ success: true, message: 'Backup deleted successfully' });
    } catch (error) {
        console.error('Delete backup error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete backup: ' + error.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/data/restore — Restore data from a specific backup (IT only)
// ---------------------------------------------------------------------------
router.post('/api/data/restore', requireAuth('it'), (req, res) => {
    try {
        const { backupId } = req.body;
        if (!backupId) {
            return res.status(400).json({ success: false, error: 'backupId is required' });
        }

        // Prevent path traversal
        const safeName = path.basename(backupId);
        const backupFolder = path.join(backupDir, safeName);
        if (!fs.existsSync(backupFolder)) {
            return res.status(404).json({ success: false, error: 'Backup not found' });
        }

        // Create a pre-restore backup first (safety net)
        const preRestoreTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const preRestoreFolder = path.join(backupDir, `pre-restore-${preRestoreTimestamp}`);
        fs.mkdirSync(preRestoreFolder, { recursive: true });
        for (const file of DATA_FILES) {
            const src = path.join(dataDir, file);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(preRestoreFolder, file));
            }
        }

        // Restore files from backup
        const restored = [];
        const backupFiles = fs.readdirSync(backupFolder);
        for (const file of backupFiles) {
            if (file.endsWith('.json')) {
                fs.copyFileSync(path.join(backupFolder, file), path.join(dataDir, file));
                restored.push(file);
            }
        }

        logActivity('data_restore', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { backupId: safeName, filesRestored: restored.length }
        });

        res.json({
            success: true,
            message: `Restored ${restored.length} files from ${safeName}`,
            preRestoreBackup: `pre-restore-${preRestoreTimestamp}`,
            files: restored
        });
    } catch (error) {
        console.error('Restore error:', error);
        res.status(500).json({ success: false, error: 'Failed to restore: ' + error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/data/export — Download all data as a single JSON bundle (IT only)
// ---------------------------------------------------------------------------
router.get('/api/data/export', requireAuth('it'), (req, res) => {
    try {
        const bundle = {};
        // Files that contain user authentication data (passwords must be stripped)
        const sensitiveFiles = ['users.json', 'ao-users.json', 'hr-users.json', 'asds-users.json', 'sds-users.json', 'it-users.json'];
        for (const file of DATA_FILES) {
            const filePath = path.join(dataDir, file);
            if (fs.existsSync(filePath)) {
                let data = readJSON(filePath);
                // SECURITY: Strip password hashes from exported user data
                if (sensitiveFiles.includes(file) && Array.isArray(data)) {
                    data = data.map(record => {
                        const { password, ...safe } = record;
                        return safe;
                    });
                }
                bundle[file] = data;
            }
        }
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="data-export-${timestamp}.json"`);
        res.json({ exportDate: new Date().toISOString(), data: bundle });
    } catch (error) {
        console.error('Export error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/data/import — Import data from a previously exported JSON bundle (IT only)
// ---------------------------------------------------------------------------
router.post('/api/data/import', requireAuth('it'), (req, res) => {
    try {
        const { data } = req.body;
        if (!data || typeof data !== 'object') {
            return res.status(400).json({ success: false, error: 'Invalid import data. Expected { data: { "filename.json": [...], ... } }' });
        }

        // Create safety backup before import
        const safetyTimestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const safetyFolder = path.join(backupDir, `pre-import-${safetyTimestamp}`);
        fs.mkdirSync(safetyFolder, { recursive: true });
        for (const file of DATA_FILES) {
            const src = path.join(dataDir, file);
            if (fs.existsSync(src)) {
                fs.copyFileSync(src, path.join(safetyFolder, file));
            }
        }

        const imported = [];
        for (const [filename, content] of Object.entries(data)) {
            // Only allow known data files (prevent writing to arbitrary paths)
            if (DATA_FILES.includes(filename)) {
                writeJSON(path.join(dataDir, filename), content);
                imported.push(filename);
            }
        }

        logActivity('data_import', 'it', {
            userEmail: req.session.email,
            userId: req.session.userId,
            ip: getClientIp(req),
            details: { filesImported: imported.length, safetyBackup: `pre-import-${safetyTimestamp}` }
        });

        res.json({
            success: true,
            message: `Imported ${imported.length} data files`,
            safetyBackup: `pre-import-${safetyTimestamp}`,
            files: imported
        });
    } catch (error) {
        console.error('Import error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
// Expose maintenance state getters so server.js middleware can check them
router.getMaintenanceMode = () => maintenanceMode;
router.getMaintenanceMessage = () => maintenanceMessage;
router.runBalanceReconciliation = runBalanceReconciliation;

module.exports = router;
