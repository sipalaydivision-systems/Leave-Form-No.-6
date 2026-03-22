/**
 * Employee routes — registration, profile update, user details.
 *
 * Extracted from server.js:
 *   - POST /api/register          (lines 2585-2672)
 *   - POST /api/update-employee-profile (line 3046)
 *   - GET  /api/user-details      (lines 2819-2855)
 */

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const router = express.Router();

const { dataDir } = require('../config');
const { readJSON, writeJSON } = require('../data/json-store');
const { requireAuth } = require('../middleware/auth');
const { apiRateLimiter } = require('../middleware/rate-limit');
const { hashPasswordWithSalt } = require('../utils/password');
const { validateDepEdEmail, validatePortalPassword } = require('../utils/validation');

// Reuse shared helpers from auth routes
const { logActivity, getClientIp, createProfileUpdateHandler } = require('./auth');

// ---------------------------------------------------------------------------
// Data file paths
// ---------------------------------------------------------------------------

const usersFile                = path.join(dataDir, 'users.json');
const pendingRegistrationsFile = path.join(dataDir, 'pending-registrations.json');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ADMIN_ROLES = ['ao', 'hr', 'asds', 'sds', 'it'];

/**
 * SECURITY: Allow access to own data or if caller is an admin.
 */
function isSelfOrAdmin(req, targetEmail) {
    return ADMIN_ROLES.includes(req.session.role) || req.session.email === targetEmail;
}

// =========================================================================
// POST /api/register — Employee registration (pending IT approval)
// =========================================================================

router.post('/api/register', apiRateLimiter, (req, res) => {
    try {
        const { fullName, firstName, lastName, middleName, suffix, email, password,
                office, position, salaryGrade, step, salary, employeeNo } = req.body || {};

        if (!fullName || !fullName.trim()) {
            return res.status(400).json({ success: false, error: 'Full Name is required' });
        }
        if (!email || !validateDepEdEmail(email)) {
            return res.status(400).json({ success: false, error: 'Please use a valid DepEd email (@deped.gov.ph)' });
        }

        const passwordValidation = validatePortalPassword(password);
        if (!passwordValidation.valid) {
            return res.status(400).json({ success: false, error: passwordValidation.error });
        }

        if (!office || !office.trim()) {
            return res.status(400).json({ success: false, error: 'Office is required' });
        }
        if (!position || !position.trim()) {
            return res.status(400).json({ success: false, error: 'Position is required' });
        }
        if (!employeeNo || !employeeNo.trim()) {
            return res.status(400).json({ success: false, error: 'Employee Number is required' });
        }
        if (!salaryGrade) {
            return res.status(400).json({ success: false, error: 'Salary Grade is required' });
        }
        if (!step) {
            return res.status(400).json({ success: false, error: 'Step Increment is required' });
        }
        if (!salary || salary === 0) {
            return res.status(400).json({ success: false, error: 'Please select a valid position and step increment' });
        }

        let users = readJSON(usersFile);
        let pendingRegs = readJSON(pendingRegistrationsFile);

        if (users.find(u => u.email === email)) {
            return res.status(400).json({ success: false, error: 'Email already registered' });
        }

        // NOTE: Cross-portal check removed — all 6 portals were excluded, making it a no-op.
        // Employee-duplicate check above is sufficient. Admins ARE employees per policy.

        if (pendingRegs.find(r => r.email === email && r.status === 'pending')) {
            return res.status(400).json({ success: false, error: 'Registration already pending IT approval' });
        }

        const pendingRegistration = {
            id: crypto.randomUUID(),
            portal: 'employee',
            fullName: fullName || '',
            name: fullName || '',
            firstName: firstName || '',
            lastName: lastName || '',
            middleName: middleName || '',
            suffix: suffix || '',
            email,
            password: hashPasswordWithSalt(password),
            office,
            position,
            employeeNo: employeeNo || '',
            salaryGrade,
            step,
            salary,
            status: 'pending',
            createdAt: new Date().toISOString()
        };

        pendingRegs.push(pendingRegistration);
        writeJSON(pendingRegistrationsFile, pendingRegs);

        // Log registration submission
        logActivity('REGISTRATION_SUBMITTED', 'employee', {
            userEmail: email,
            fullName: fullName,
            portal: 'employee',
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({ success: true, message: 'Registration submitted! Please wait for IT department approval.' });
    } catch (error) {
        console.error('Register error:', error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// =========================================================================
// POST /api/update-employee-profile — Self-service profile editing
// =========================================================================

router.post('/api/update-employee-profile', requireAuth('user'), createProfileUpdateHandler({
    portalName: 'employee', portalLabel: 'Employee', userFile: usersFile,
    updatableFields: ['office', 'position', 'employeeNo', 'salaryGrade', 'step', 'salary'],
    syncToEmployees: true, syncToLeaveCards: true,
    responseFields: ['id', 'email', 'name', 'office', 'position', 'employeeNo', 'salaryGrade', 'step', 'salary']
}));

// =========================================================================
// GET /api/user-details — Fetch employee details by email
// =========================================================================

router.get('/api/user-details', requireAuth(), (req, res) => {
    try {
        const email = req.query.email;
        if (!email) {
            return res.status(400).json({ success: false, error: 'Email is required' });
        }

        // SECURITY: Only allow access to own data unless admin role
        if (!isSelfOrAdmin(req, email)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        let users = readJSON(usersFile);
        const user = users.find(u => u.email === email);

        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        res.json({
            success: true,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                office: user.office,
                position: user.position,
                employeeNo: user.employeeNo,
                salary: user.salary,
                salaryGrade: user.salaryGrade,
                step: user.step
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
