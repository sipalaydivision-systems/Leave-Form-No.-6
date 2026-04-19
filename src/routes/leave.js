/**
 * Leave application routes — extracted from server.js lines ~4120-5710.
 *
 * Handles the full leave application lifecycle: submission, tracking,
 * approval workflow (AO -> HR -> ASDS -> SDS), returns, rejections,
 * resubmissions, and the leave calendar.
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { requireAuth } = require('../middleware/auth');
const { readJSON, readJSONArray, writeJSON, ensureFile } = require('../data/json-store');
const { dataDir } = require('../config');
const { validateLeaveBalance, getLatestLeaveCard, normalizeLeaveCardTransactions } = require('../services/leave-balance');
const { repos } = require('../data/repositories');
const { isValidDate } = require('../utils/validation');
const { parseFullNameIntoParts } = require('../utils/name-parser');
const {
    notifyLeaveSubmitted, notifyLeaveApproved, notifyLeaveReturned,
    notifyLeaveRejected, notifyNextApprover
} = require('../services/email');
const {
    usersFile, employeesFile, applicationsFile, leavecardsFile,
    ctoRecordsFile,
    isHrDivisionLevel, isEmployeeInAoSchool, getEmployeeOffice,
    logActivity, getClientIp,
    findApplicationById, findApplicationIndexById, lookupUserName,
    isSelfOrAdmin, isHrAccessAllowed,
    isSchoolBased, generateApplicationId,
} = require('../utils/helpers');
const { ADMIN_ROLES } = require('../config/constants');

const HOURS_PER_DAY = 8;
const soPdfsDir = path.join(dataDir, 'uploads', 'so-pdfs');

// ---------------------------------------------------------------------------
// POST /api/submit-leave — Submit a new leave application
// ---------------------------------------------------------------------------
router.post('/api/submit-leave', requireAuth(), (req, res) => {
    try {
        const applicationData = req.body;
        const applications = readJSONArray(applicationsFile);
        const ip = getClientIp(req);

        // SECURITY: Use session email instead of trusting client-provided employeeEmail
        const employeeEmail = req.session.email;
        if (!employeeEmail) {
            return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
        }
        // Override client-provided email with session email
        applicationData.employeeEmail = employeeEmail;

        // ===== STRUCTURAL VALIDATION: Required fields =====
        const requiredFields = ['leaveType', 'dateFrom', 'dateTo', 'numDays', 'employeeName'];
        for (const field of requiredFields) {
            if (!applicationData[field] || !String(applicationData[field]).trim()) {
                return res.status(400).json({ success: false, error: `Missing required field: ${field}`, message: `Please fill in the ${field} field before submitting.` });
            }
        }

        const leaveType = applicationData.leaveType;
        const numDays = parseFloat(applicationData.numDays) || 0;

        if (numDays <= 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid number of days',
                message: 'Number of leave days must be greater than zero.'
            });
        }

        // leave_others requires both a specification text and an SO PDF file
        if (leaveType === 'leave_others') {
            if (!applicationData.otherLeaveSpecify || !String(applicationData.otherLeaveSpecify).trim()) {
                return res.status(400).json({ success: false, error: 'Leave type specification is required for Others leave type (e.g., CTO - SO #12345).' });
            }
            if (!applicationData.soFileData) {
                return res.status(400).json({ success: false, error: 'Special Order PDF is required for Others leave type. Please attach the PDF copy of the Special Order.' });
            }
        }

        // SECURITY: Validate date fields
        if (!isValidDate(applicationData.dateFrom)) {
            return res.status(400).json({ success: false, error: 'Invalid start date format', message: 'Date From must be in YYYY-MM-DD format.' });
        }
        if (!isValidDate(applicationData.dateTo)) {
            return res.status(400).json({ success: false, error: 'Invalid end date format', message: 'Date To must be in YYYY-MM-DD format.' });
        }

        // ===== DATE RANGE VALIDATION: dateTo must be >= dateFrom =====
        if (new Date(applicationData.dateTo) < new Date(applicationData.dateFrom)) {
            return res.status(400).json({ success: false, error: 'Invalid date range', message: 'End date must be on or after start date.' });
        }

        // ===== DATE BOUNDARY VALIDATION =====
        // Reject applications dated more than 30 days in the past (allows backdating for legitimate needs)
        // or more than 365 days in the future.
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const pastLimit = new Date(today);
        pastLimit.setDate(pastLimit.getDate() - 30);
        const futureLimit = new Date(today);
        futureLimit.setFullYear(futureLimit.getFullYear() + 1);
        const dateFromParsed = new Date(applicationData.dateFrom);
        const dateToParsed = new Date(applicationData.dateTo);
        if (dateFromParsed < pastLimit) {
            return res.status(400).json({
                success: false,
                error: 'Invalid leave start date',
                message: 'Leave applications cannot be submitted for dates more than 30 days in the past.'
            });
        }
        if (dateToParsed > futureLimit) {
            return res.status(400).json({
                success: false,
                error: 'Invalid leave end date',
                message: 'Leave applications cannot be submitted for dates more than 1 year in the future.'
            });
        }

        // ===== PARTIAL-DAY (HOUR-BASED) VALIDATION =====
        if (applicationData.leaveHours != null) {
            const hrs = Number(applicationData.leaveHours);
            if (!Number.isInteger(hrs) || hrs < 1 || hrs > 7) {
                return res.status(400).json({ success: false, error: 'leaveHours must be an integer between 1 and 7' });
            }
            // Server-side recomputation overrides any client-provided numDays
            applicationData.numDays = String((hrs / HOURS_PER_DAY).toFixed(3));
        } else {
            // Full-day leave: numDays must be a positive number; reject obviously manipulated values.
            // Client may compute working days differently, but server caps at a reasonable ceiling.
            const clientDays = parseFloat(applicationData.numDays);
            if (!isFinite(clientDays) || clientDays <= 0) {
                return res.status(400).json({ success: false, error: 'Invalid numDays', message: 'Number of leave days must be a positive number.' });
            }
            // Guard: no single application should span more than 90 calendar days
            const spanMs = new Date(applicationData.dateTo) - new Date(applicationData.dateFrom);
            const spanCalendarDays = spanMs / (1000 * 60 * 60 * 24) + 1;
            if (clientDays > spanCalendarDays + 1) {
                return res.status(400).json({
                    success: false,
                    error: 'numDays exceeds date range',
                    message: 'The number of leave days cannot exceed the number of calendar days in the selected range.'
                });
            }
        }

        // ===== SIGNATURE VALIDATION =====
        // A blank canvas produces a fixed-size PNG with no drawn pixels.
        // We reject submissions that have no signature data at all.
        const sigData = applicationData.employeeSignature || '';
        if (!sigData || !sigData.startsWith('data:image/png;base64,')) {
            return res.status(400).json({
                success: false,
                error: 'Signature required',
                message: 'You must provide your signature before submitting the application.'
            });
        }
        // Reject trivially small base64 (an empty/blank canvas PNG is ~1–3 KB)
        const sigBase64 = sigData.replace(/^data:image\/png;base64,/, '');
        if (sigBase64.length < 1000) {
            return res.status(400).json({
                success: false,
                error: 'Signature appears blank',
                message: 'Your signature appears to be empty. Please draw or upload your signature before submitting.'
            });
        }

        // ===== DUPLICATE SUBMISSION DETECTION =====
        // Reject if the same employee already has a pending/approved leave overlapping the same dates
        const dupApp = applications.find(a => {
            if (a.employeeEmail !== employeeEmail) return false;
            if (a.status === 'rejected' || a.status === 'returned') return false;
            if (a.leaveType !== leaveType) return false;
            // Check date overlap: A.start <= B.end && A.end >= B.start
            const existStart = new Date(a.dateFrom);
            const existEnd = new Date(a.dateTo);
            const newStart = new Date(applicationData.dateFrom);
            const newEnd = new Date(applicationData.dateTo);
            return existStart <= newEnd && existEnd >= newStart;
        });
        if (dupApp) {
            return res.status(409).json({ success: false, error: 'Duplicate leave application', message: `You already have a ${dupApp.status} ${leaveType.replace('leave_', '').toUpperCase()} leave application (${dupApp.id}) covering overlapping dates. Please check your existing applications.` });
        }

        // ===== LEAVE BALANCE VALIDATION =====
        // Validate the employee has sufficient balance BEFORE creating the application.
        // Uses the legacy (disk-read) path so we don't need to pre-load all data here.
        const balanceCheck = validateLeaveBalance(leaveType, numDays, employeeEmail);
        if (!balanceCheck.valid) {
            return res.status(400).json({
                success: false,
                error: balanceCheck.error || 'Insufficient leave balance',
                message: balanceCheck.message || 'You do not have enough leave balance for this request.'
            });
        }

        // Determine initial status and current approver based on office
        const office = applicationData.office || '';
        const schoolBased = isSchoolBased(office);

        // Generate sequential Application ID (SDO Sipalay-01, SDO Sipalay-02, etc.)
        const applicationId = generateApplicationId(applications);

        // ALL applications go to AO first, regardless of whether they're school-based or not
        // Unified workflow: AO -> HR -> ASDS -> SDS
        const newApplication = {
            id: applicationId,
            // SECURITY: Whitelist only expected fields (prevent mass assignment attack)
            employeeEmail: applicationData.employeeEmail || '',
            employeeName: applicationData.employeeName || '',
            office: applicationData.office || '',
            position: applicationData.position || '',
            salary: applicationData.salary || '',
            dateOfFiling: applicationData.dateOfFiling || '',
            leaveType: applicationData.leaveType || '',
            dateFrom: applicationData.dateFrom || '',
            dateTo: applicationData.dateTo || '',
            numDays: applicationData.numDays || '',
            vlEarned: applicationData.vlEarned || '',
            slEarned: applicationData.slEarned || '',
            vlLess: applicationData.vlLess || '',
            slLess: applicationData.slLess || '',
            vlBalance: applicationData.vlBalance || '',
            slBalance: applicationData.slBalance || '',
            commutation: applicationData.commutation || '',
            employeeSignature: applicationData.employeeSignature || '',
            locationPH: applicationData.locationPH || false,
            locationAbroad: applicationData.locationAbroad || false,
            abroadSpecify: applicationData.abroadSpecify || '',
            sickHospital: applicationData.sickHospital || false,
            sickOutpatient: applicationData.sickOutpatient || false,
            hospitalIllness: applicationData.hospitalIllness || '',
            outpatientIllness: applicationData.outpatientIllness || '',
            studyMasters: applicationData.studyMasters || false,
            studyBar: applicationData.studyBar || false,
            womenIllness: applicationData.womenIllness || '',
            otherLeaveSpecify: applicationData.otherLeaveSpecify || '',
            leaveHours: applicationData.leaveHours != null ? Number(applicationData.leaveHours) : null,
            isHalfDay: applicationData.isHalfDay || false,       // deprecated — kept for backward compat
            halfDayPeriod: applicationData.isHalfDay ? (applicationData.halfDayPeriod || null) : null, // deprecated
            soFileData: null,  // No longer stored inline — saved to disk below
            soFileName: applicationData.soFileName || '',
            soFilePath: null,  // Will be set if SO file was uploaded
            isSchoolBased: schoolBased,
            status: 'pending',
            currentApprover: 'HR',
            approvalHistory: [],
            submittedAt: new Date().toISOString()
        };

        // ===== SO FILE PRE-VALIDATION =====
        // Validate before pushing the application so we can reject cleanly.
        const SO_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
        if (applicationData.soFileData && applicationData.soFileName) {
            const base64PreCheck = applicationData.soFileData.match(/^data:[^;]+;base64,(.+)$/);
            if (!base64PreCheck) {
                return res.status(400).json({ success: false, error: 'Invalid SO file format', message: 'Special Order file must be a valid base64-encoded PDF.' });
            }
            const soBytes = Math.floor(base64PreCheck[1].length * 0.75);
            if (soBytes > SO_MAX_BYTES) {
                return res.status(400).json({ success: false, error: 'SO file too large', message: 'Special Order PDF must be smaller than 5 MB.' });
            }
            const soPreview = Buffer.from(base64PreCheck[1].slice(0, 8), 'base64');
            if (soPreview.toString('ascii', 0, 4) !== '%PDF') {
                return res.status(400).json({ success: false, error: 'Invalid SO file type', message: 'Only PDF files are accepted for Special Order uploads.' });
            }
        }

        applications.push(newApplication);

        // Save SO PDF file to disk if provided (instead of keeping base64 in JSON)
        if (applicationData.soFileData && applicationData.soFileName) {
            try {
                const base64Match = applicationData.soFileData.match(/^data:[^;]+;base64,(.+)$/);
                if (base64Match) {
                    const pdfBuffer = Buffer.from(base64Match[1], 'base64');
                    // SECURITY: Validate PDF magic bytes before writing to disk
                    if (pdfBuffer.length < 4 || pdfBuffer.toString('ascii', 0, 4) !== '%PDF') {
                        console.warn('[UPLOAD] Rejected non-PDF file upload for application', applicationId);
                    } else {
                        const ext = path.extname(applicationData.soFileName) || '.pdf';
                        const safeId = applicationId.replace(/[^a-zA-Z0-9_-]/g, '_');
                        const soFilename = `${safeId}_SO${ext}`;
                        const soFilePath = path.join(soPdfsDir, soFilename);
                        fs.writeFileSync(soFilePath, pdfBuffer);
                        newApplication.soFilePath = `/api/uploads/so-pdfs/${soFilename}`;
                        console.log(`[UPLOAD] Saved SO PDF to disk: ${soFilename}`);
                    }
                }
            } catch (soErr) {
                console.error('[UPLOAD] Error saving SO PDF to disk:', soErr);
                // Non-fatal: application is still saved, just without disk file
            }
        }

        writeJSON(applicationsFile, applications);

        // Log activity
        logActivity('LEAVE_APPLICATION_SUBMITTED', 'employee', {
            userEmail: applicationData.employeeEmail,
            ip,
            userAgent: req.get('user-agent'),
            applicationId: newApplication.id,
            leaveType,
            numDays,
            officeType: schoolBased ? 'School-based' : 'Division Office'
        });

        const officeType = schoolBased ? 'School-based' : 'Division Office';
        console.log(`[LEAVE] New application submitted by ${applicationData.employeeName} - ${officeType} (AO first)`);

        // Send email notifications — log failures so they appear in Railway logs
        Promise.resolve()
            .then(() => notifyLeaveSubmitted(newApplication))
            .catch(err => console.error('[EMAIL] Failed to notify employee of submission:', err.message));
        Promise.resolve()
            .then(() => notifyNextApprover(newApplication, 'HR'))
            .catch(err => console.error('[EMAIL] Failed to notify HR of new application:', err.message));

        res.json({
            success: true,
            message: 'Application submitted successfully',
            applicationId: newApplication.id,
            currentApprover: newApplication.currentApprover,
            isSchoolBased: schoolBased
        });
    } catch (error) {
        console.error('Error submitting leave application:', error);
        res.status(500).json({ success: false, error: 'An error occurred while submitting your leave application. Please try again.' });
    }
});

// ---------------------------------------------------------------------------
// GET /api/application-status/:id — Get application status for tracker
// ---------------------------------------------------------------------------
router.get('/api/application-status/:id', requireAuth(), (req, res) => {
    try {
        const idParam = req.params.id;

        const applications = readJSONArray(applicationsFile);
        const app = findApplicationById(applications, idParam);

        if (!app) {
            console.error('Application not found:', { idParam, totalApps: applications.length });
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        // SECURITY: Only allow access to own application unless admin role
        if (!isSelfOrAdmin(req, app.employeeEmail)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        res.json({ success: true, application: app });
    } catch (error) {
        console.error('Error in application-status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/my-applications/:email — Get applications by email (employee tracking)
// ---------------------------------------------------------------------------
router.get('/api/my-applications/:email', requireAuth(), (req, res) => {
    try {
        const email = req.params.email;
        // SECURITY: Only allow access to own applications unless admin role
        if (!isSelfOrAdmin(req, email)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const applications = readJSONArray(applicationsFile);
        const myApps = applications.filter(a => a.employeeEmail === email);

        res.json({ success: true, applications: myApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/application-details/:id — Get application details by ID
// ---------------------------------------------------------------------------
router.get('/api/application-details/:id', requireAuth(), (req, res) => {
    try {
        const idParam = req.params.id;
        const applications = readJSONArray(applicationsFile);
        const application = findApplicationById(applications, idParam);

        if (!application) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        // SECURITY: Only allow access to own application unless admin role
        if (!isSelfOrAdmin(req, application.employeeEmail)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }

        res.json({ success: true, application: application });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/pending-applications/:portal — Pending applications for a portal
// ---------------------------------------------------------------------------
router.get('/api/pending-applications/:portal', requireAuth('hr', 'aov', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const portal = req.params.portal.toUpperCase();
        const applications = readJSONArray(applicationsFile);

        let pendingApps = applications.filter(a =>
            (a.status === 'pending' || a.status === 'returned') && a.currentApprover === portal
        );

        res.json({ success: true, applications: pendingApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/approved-applications/:portal — Approved applications for a portal
// ---------------------------------------------------------------------------
router.get('/api/approved-applications/:portal', requireAuth('hr', 'aov', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const portal = req.params.portal.toUpperCase();
        const applications = readJSONArray(applicationsFile);

        // Get applications approved by this portal
        let approvedApps = applications.filter(a => {
            if (portal === 'SDS') {
                return a.status === 'approved' && a.sdsApprovedAt;
            } else if (portal === 'ASDS') {
                return a.status === 'approved' && a.asdsApprovedAt;
            }
            return false;
        });

        res.json({ success: true, applications: approvedApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/hr-approved-applications — HR-processed applications
// ---------------------------------------------------------------------------
router.get('/api/hr-approved-applications', requireAuth('aov', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const applications = readJSONArray(applicationsFile);

        // Get applications where HR has approved them (hrApprovedAt exists and currentApprover is not HR)
        let hrApprovedApps = applications.filter(a => {
            return a.hrApprovedAt && a.currentApprover !== 'AOV';
        });

        res.json({ success: true, applications: hrApprovedApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/all-users — All users for demographics
// ---------------------------------------------------------------------------
router.get('/api/all-users', requireAuth('hr', 'aov', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const users = readJSON(usersFile);
        // SECURITY: Strip password hashes before sending to client
        let safeUsers = users.map(({ password, ...rest }) => rest);

        // AO school-based filtering: AO can only see users from their school
        if (req.session.role === 'hr' && req.session.office && !isHrDivisionLevel(req.session.office)) {
            safeUsers = safeUsers.filter(u => isEmployeeInAoSchool(u.office || u.school, req.session.office));
        }

        res.json({ success: true, users: safeUsers });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/all-applications — All applications for demographics
// ---------------------------------------------------------------------------
router.get('/api/all-applications', requireAuth('hr', 'aov', 'asds', 'sds', 'it'), (req, res) => {
    try {
        let applications = readJSONArray(applicationsFile);

        // AO school-based filtering: AO can only see applications from their school's employees
        // S2 fix: Pre-load user/employee data once, pass as cache to avoid O(N*2) disk reads
        if (req.session.role === 'hr' && req.session.office && !isHrDivisionLevel(req.session.office)) {
            const hrOffice = req.session.office;
            const usersCache = readJSON(usersFile);
            const employeesCache = readJSON(employeesFile);
            applications = applications.filter(app => {
                const empOffice = getEmployeeOffice(app.employeeEmail || app.email, usersCache, employeesCache);
                return isEmployeeInAoSchool(empOffice, hrOffice);
            });
        }

        res.json({ success: true, applications: applications });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/leave-calendar — Leave calendar data
// ---------------------------------------------------------------------------
router.get('/api/leave-calendar', requireAuth('hr', 'aov', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const { month, year } = req.query;
        const applications = readJSONArray(applicationsFile);

        // Filter to approved or pending leaves
        let relevantApps = applications.filter(a => a.status === 'approved' || a.status === 'pending');

        // If month/year provided, filter to apps that overlap that month
        if (month && year) {
            const m = parseInt(month), y = parseInt(year);
            const monthStart = new Date(y, m - 1, 1);
            const monthEnd = new Date(y, m, 0); // last day of month
            relevantApps = relevantApps.filter(a => {
                const start = new Date(a.dateFrom);
                const end = new Date(a.dateTo);
                return start <= monthEnd && end >= monthStart;
            });
        }

        // AO school-based filtering
        if (req.session.role === 'hr' && req.session.office && !isHrDivisionLevel(req.session.office)) {
            const hrOffice = req.session.office;
            const usersCache = readJSON(usersFile);
            const employeesCache = readJSON(employeesFile);
            relevantApps = relevantApps.filter(a => {
                const empOffice = getEmployeeOffice(a.employeeEmail || a.email, usersCache, employeesCache);
                return isEmployeeInAoSchool(empOffice, hrOffice);
            });
        }

        // Return minimal data for calendar rendering
        const calendarData = relevantApps.map(a => ({
            id: a.id,
            employeeName: a.employeeName || a.employeeEmail,
            office: a.office || '',
            leaveType: a.leaveType || '',
            dateFrom: a.dateFrom,
            dateTo: a.dateTo,
            numDays: a.numDays,
            status: a.status,
            currentApprover: a.currentApprover
        }));

        res.json({ success: true, leaves: calendarData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/all-employees — All registered employees (for AO card management)
// ---------------------------------------------------------------------------
router.get('/api/all-employees', requireAuth('hr', 'aov', 'it'), (req, res) => {
    try {
        const users = readJSON(usersFile);
        const leavecards = readJSON(leavecardsFile);

        // Start with registered users
        const employeeMap = new Map();
        users.forEach(user => {
            const email = (user.email || '').toLowerCase();
            employeeMap.set(email, {
                id: user.id,
                email: user.email,
                name: user.name || user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim(),
                fullName: user.fullName || user.name,
                position: user.position || 'N/A',
                office: user.office || user.school || 'N/A',
                employeeNo: user.employeeNo || 'N/A',
                source: 'registered'
            });
        });

        // Add leave card holders that aren't already in the map
        leavecards.forEach(lc => {
            const email = (lc.email || '').toLowerCase();
            const key = email || `leavecard-${lc.name}`;
            if (!employeeMap.has(key)) {
                employeeMap.set(key, {
                    id: lc.employeeId || lc.email || lc.name,
                    email: lc.email || '',
                    name: lc.name || `${lc.firstName || ''} ${lc.lastName || ''}`.trim() || 'Unknown',
                    fullName: lc.name || `${lc.firstName || ''} ${lc.lastName || ''}`.trim(),
                    position: 'N/A',
                    office: 'N/A',
                    employeeNo: lc.employeeNo || 'N/A',
                    source: lc.email ? 'leavecard' : 'leavecard-unlinked'
                });
            }
        });

        let employees = Array.from(employeeMap.values());

        // AO school-based filtering: AO can only see employees from their own school
        if (req.session.role === 'hr' && req.session.office) {
            const hrOffice = req.session.office;
            if (!isHrDivisionLevel(hrOffice)) {
                employees = employees.filter(emp => isEmployeeInAoSchool(emp.office, hrOffice));
            }
        }

        res.json({ success: true, employees: employees });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/portal-applications/:portal — All applications for a portal
// ---------------------------------------------------------------------------
router.get('/api/portal-applications/:portal', requireAuth('hr', 'aov', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const portal = req.params.portal.toUpperCase();
        const applications = readJSONArray(applicationsFile);

        let portalApps = applications.filter(a => {
            const approvalKey = portal.toLowerCase() + 'ApprovedAt';
            const isCurrentApprover = a.currentApprover === portal;
            const hasApprovedByPortal = a[approvalKey] !== undefined;
            const isRejectedByPortal = (a.status === 'disapproved' || a.status === 'rejected') &&
                                     (a.disapprovedBy === portal || a.rejectedBy === portal);

            return isCurrentApprover || hasApprovedByPortal || isRejectedByPortal;
        });

        // AO school-based filtering: AO can only see applications from their school's employees
        // S2 fix: Pre-load data once for filter loop
        if (req.session.role === 'hr' && req.session.office && !isHrDivisionLevel(req.session.office)) {
            const hrOffice = req.session.office;
            const usersCache = readJSON(usersFile);
            const employeesCache = readJSON(employeesFile);
            portalApps = portalApps.filter(app => {
                const empOffice = getEmployeeOffice(app.employeeEmail || app.email, usersCache, employeesCache);
                return isEmployeeInAoSchool(empOffice, hrOffice);
            });
        }

        res.json({ success: true, applications: portalApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/returned-applications/:email — Returned applications for resubmission
// ---------------------------------------------------------------------------
router.get('/api/returned-applications/:email', requireAuth(), (req, res) => {
    try {
        const email = req.params.email;
        // SECURITY: Only allow access to own returned applications unless admin role
        if (!isSelfOrAdmin(req, email)) {
            return res.status(403).json({ success: false, error: 'Access denied' });
        }
        const applications = readJSONArray(applicationsFile);

        let returnedApps = applications.filter(a =>
            a.employeeEmail === email &&
            a.status === 'returned' &&
            a.currentApprover === 'EMPLOYEE'
        );

        res.json({ success: true, applications: returnedApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/resubmit-leave — Resubmit application after compliance
// ---------------------------------------------------------------------------
router.post('/api/resubmit-leave', requireAuth(), (req, res) => {
    try {
        const { applicationId, updatedData } = req.body;
        // SECURITY: Use session email instead of trusting client-provided employeeEmail
        const employeeEmail = req.session.email;
        if (!employeeEmail) {
            return res.status(401).json({ success: false, error: 'Session expired. Please log in again.' });
        }
        const applications = readJSONArray(applicationsFile);
        const appIndex = applications.findIndex(a => a.id === applicationId);

        if (appIndex === -1) {
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const app = applications[appIndex];

        // Verify the employee owns this application (using session email)
        if (app.employeeEmail !== employeeEmail) {
            return res.status(403).json({ success: false, error: 'Unauthorized to resubmit this application' });
        }

        // Verify application is in returned status
        if (app.status !== 'returned' || app.currentApprover !== 'EMPLOYEE') {
            return res.status(400).json({ success: false, error: 'Application is not awaiting resubmission' });
        }

        // Update application with allowed fields from resubmission (prevent mass assignment)
        if (updatedData) {
            const allowedResubmitFields = [
                // Core leave fields (editable on resubmit)
                'leaveType', 'dateFrom', 'dateTo', 'numDays',
                'leaveHours', 'isHalfDay',
                // Conditional fields
                'locationPH', 'locationAbroad', 'abroadSpecify',
                'sickHospital', 'sickOutpatient', 'hospitalIllness', 'outpatientIllness',
                'studyMasters', 'studyBar',
                'womenIllness',
                'otherLeaveSpecify',
                // Documents and signature
                'soFileData', 'soFileName',
                'employeeSignature',
                'complianceDocuments', 'supportingDocuments',
                // Commutation and remarks
                'commutation', 'remarks',
            ];
            for (const field of allowedResubmitFields) {
                if (updatedData[field] !== undefined) {
                    app[field] = updatedData[field];
                }
            }

            // Save SO PDF file to disk if provided on resubmit (same as initial submit)
            if (updatedData.soFileData && updatedData.soFileName) {
                try {
                    const base64Match = updatedData.soFileData.match(/^data:[^;]+;base64,(.+)$/);
                    if (base64Match) {
                        const pdfBuffer = Buffer.from(base64Match[1], 'base64');
                        if (pdfBuffer.length >= 4 && pdfBuffer.toString('ascii', 0, 4) === '%PDF') {
                            const ext = path.extname(updatedData.soFileName) || '.pdf';
                            const safeId = applicationId.replace(/[^a-zA-Z0-9_-]/g, '_');
                            const soFilename = `${safeId}_SO${ext}`;
                            const soFilePath = path.join(soPdfsDir, soFilename);
                            fs.writeFileSync(soFilePath, pdfBuffer);
                            app.soFilePath = `/api/uploads/so-pdfs/${soFilename}`;
                            app.soFileData = null; // Don't store base64 inline
                            console.log(`[UPLOAD] Saved resubmit SO PDF to disk: ${soFilename}`);
                        } else {
                            console.warn('[UPLOAD] Rejected non-PDF file on resubmit for', applicationId);
                        }
                    }
                } catch (err) {
                    console.error('[UPLOAD] Failed to save resubmit SO PDF:', err.message);
                }
            }

            // Update dateOfFiling to resubmission date
            app.dateOfFiling = new Date().toISOString().split('T')[0];
        }

        // Clear stale approval data from previous round to prevent scrambled formulas
        // These will be re-set by HR when the application is re-processed
        const staleApprovalFields = [
            'vlEarned', 'vlLess', 'vlBalance',
            'slEarned', 'slLess', 'slBalance',
            'splEarned', 'splLess', 'splBalance',
            'flEarned', 'flLess', 'flBalance',
            'ctoEarned', 'ctoLess', 'ctoBalance',
            'authorizedOfficerName', 'authorizedOfficerSignature',
            'asdsOfficerName', 'asdsOfficerSignature',
            'sdsOfficerName', 'sdsOfficerSignature',
            'aoApprovedAt', 'hrApprovedAt', 'asdsApprovedAt', 'sdsApprovedAt',
            'finalApprovalAt', 'rejectedAt', 'rejectedBy', 'rejectedByName', 'rejectionReason'
        ];
        for (const field of staleApprovalFields) {
            delete app[field];
        }

        // Add to approval history
        app.approvalHistory.push({
            portal: 'EMPLOYEE',
            action: 'resubmitted',
            approverName: app.employeeName,
            remarks: updatedData?.remarks || 'Application resubmitted after compliance review',
            timestamp: new Date().toISOString()
        });

        // Reset status and send back to AO
        app.status = 'pending';
        app.currentApprover = 'HR';
        app.resubmittedAt = new Date().toISOString();

        applications[appIndex] = app;
        writeJSON(applicationsFile, applications);

        console.log(`[LEAVE] Application ${applicationId} resubmitted by ${app.employeeName}`);

        // Log activity for employee resubmission
        logActivity('LEAVE_APPLICATION_RESUBMITTED', 'employee', {
            userEmail: employeeEmail,
            applicationId: applicationId,
            leaveType: app.leaveType,
            returnedBy: app.returnedBy,
            remarks: updatedData?.remarks || 'Resubmitted after compliance review',
            ip: getClientIp(req),
            userAgent: req.get('user-agent')
        });

        res.json({
            success: true,
            message: 'Application resubmitted successfully',
            application: app
        });
    } catch (error) {
        console.error('Error resubmitting application:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// POST /api/approve-leave — Approve, return, or reject application (~445 lines)
// ---------------------------------------------------------------------------
router.post('/api/approve-leave', requireAuth('aov', 'hr', 'asds', 'sds'), (req, res) => {
    try {
        const { applicationId, action, approverPortal: _approverPortal, portal, approverName, remarks, authorizedOfficerName, authorizedOfficerSignature, asdsOfficerName, asdsOfficerSignature, sdsOfficerName, sdsOfficerSignature, vlEarned, vlLess, vlBalance, slEarned, slLess, slBalance, splEarned, splLess, splBalance, flEarned, flLess, flBalance, wlEarned, wlLess, wlBalance, ctoEarned, ctoLess, ctoBalance, daysApproved } = req.body;
        const approverPortal = _approverPortal || portal;
        const ip = getClientIp(req);

        // Validate action against whitelist
        const VALID_ACTIONS = ['approved', 'returned', 'rejected'];
        if (!action || !VALID_ACTIONS.includes(action)) {
            return res.status(400).json({ success: false, error: `Invalid action. Must be one of: ${VALID_ACTIONS.join(', ')}` });
        }

        const applications = readJSONArray(applicationsFile);
        // Handle both string and number applicationId
        const appIndex = applications.findIndex(a => a.id === applicationId || a.id === parseInt(applicationId));

        if (appIndex === -1) {
            console.error('[APPROVE-LEAVE] Application not found:', applicationId);
            return res.status(404).json({ success: false, error: 'Application not found' });
        }

        const app = applications[appIndex];

        // AO school-based filtering
        if (!isHrAccessAllowed(req, app.employeeEmail || app.email)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }

        // SECURITY: Use session role instead of trusting client-provided portal
        // Map session role to portal name (prevents portal spoofing attack)
        const roleToPortal = { 'hr': 'HR', 'aov': 'AOV', 'asds': 'ASDS', 'sds': 'SDS' };
        const sessionRole = req.session?.role;
        const currentApprover = roleToPortal[sessionRole] || (approverPortal || '').toUpperCase();

        // Block action on already-finalized applications
        if (app.status === 'approved' || app.status === 'rejected') {
            return res.status(403).json({
                success: false,
                error: `This application has already been ${app.status}. No further action can be taken.`
            });
        }

        // Validate that the session role matches what the application expects
        if (currentApprover !== app.currentApprover) {
            console.log(`[APPROVE-LEAVE] Portal mismatch: session role=${sessionRole} (${currentApprover}), app expects=${app.currentApprover}`);
            return res.status(403).json({
                success: false,
                error: `This application is currently waiting for ${app.currentApprover || 'unknown'} approval. You cannot act on it as ${currentApprover}.`
            });
        }

        // Validate that reason is provided for return or reject actions
        if ((action === 'returned' || action === 'rejected') && (!remarks || !remarks.trim())) {
            return res.status(400).json({
                success: false,
                error: 'Please provide a reason for ' + (action === 'returned' ? 'returning' : 'rejecting') + ' this application'
            });
        }

        // Add to approval history — use session-derived portal for audit integrity
        // Resolve the approver's full name from user records (not just email)
        const resolvedApproverName = lookupUserName(req.session.email) || approverName;

        app.approvalHistory.push({
            portal: currentApprover,
            action: action,
            approverName: resolvedApproverName,
            remarks: remarks || '',
            timestamp: new Date().toISOString()
        });

        if (action === 'returned') {
            // Return application to a specific step or previous step for compliance
            // Workflow: Employee <- AO <- HR <- ASDS <- SDS
            // With returnTo parameter, approver can send directly to any lower step
            const returnTo = req.body.returnTo; // Optional: 'EMPLOYEE', 'HR', 'AOV', 'ASDS'
            let returnedTo = null;

            // Define the workflow hierarchy (lower index = lower in chain)
            const workflowOrder = ['EMPLOYEE', 'HR', 'AOV', 'ASDS', 'SDS'];
            const currentIndex = workflowOrder.indexOf(currentApprover);

            if (returnTo && workflowOrder.indexOf(returnTo) < currentIndex) {
                // Return to specific target (must be below current approver in hierarchy)
                if (returnTo === 'EMPLOYEE') {
                    app.status = 'returned';
                    app.currentApprover = 'EMPLOYEE';
                } else {
                    app.status = 'pending';
                    app.currentApprover = returnTo;
                }
                returnedTo = returnTo === 'EMPLOYEE' ? 'Employee' : returnTo;
            } else {
                // Default: return to previous step
                if (currentApprover === 'HR') {
                    app.status = 'returned';
                    app.currentApprover = 'EMPLOYEE';
                    returnedTo = 'Employee';
                } else if (currentApprover === 'AOV') {
                    app.status = 'pending';
                    app.currentApprover = 'HR';
                    returnedTo = 'HR';
                } else if (currentApprover === 'ASDS') {
                    app.status = 'pending';
                    app.currentApprover = 'AOV';
                    returnedTo = 'AOV';
                } else if (currentApprover === 'SDS') {
                    app.status = 'pending';
                    app.currentApprover = 'ASDS';
                    returnedTo = 'ASDS';
                }
            }

            app.returnedAt = new Date().toISOString();
            app.returnedBy = currentApprover;
            app.returnRemarks = remarks;

            console.log(`[LEAVE] Application ${applicationId} returned by ${approverPortal} to ${returnedTo} - Reason: ${remarks}`);

            // Email notification for return
            Promise.resolve()
                .then(() => notifyLeaveReturned(app, currentApprover, remarks))
                .catch(err => console.error(`[EMAIL] Failed to send return notification for ${applicationId}:`, err.message));

        } else if (action === 'rejected') {
            // Final rejection - application is permanently rejected
            app.status = 'rejected';
            app.currentApprover = null;
            app.rejectedAt = new Date().toISOString();
            app.rejectedBy = currentApprover;
            app.rejectedByName = resolvedApproverName;
            app.rejectionReason = remarks;

            console.log(`[LEAVE] Application ${applicationId} REJECTED by ${approverPortal} - Reason: ${remarks}`);

            // Email notification for rejection
            Promise.resolve()
                .then(() => notifyLeaveRejected(app, currentApprover, remarks))
                .catch(err => console.error(`[EMAIL] Failed to send rejection notification for ${applicationId}:`, err.message));

        } else if (action === 'approved') {
            // Determine next approver based on workflow
            if (currentApprover === 'HR') {
                // AO approved -> goes to HR
                app.currentApprover = 'AOV';
                app.aoApprovedAt = new Date().toISOString();
                console.log(`[WORKFLOW] AO approved - Moving to HR`);
            } else if (currentApprover === 'AOV') {
                // HR approved -> goes to ASDS
                app.currentApprover = 'ASDS';
                app.hrApprovedAt = new Date().toISOString();

                // Store authorized officer info for Section 7.A of the final form
                if (authorizedOfficerName) {
                    app.authorizedOfficerName = authorizedOfficerName;
                }
                if (authorizedOfficerSignature) {
                    app.authorizedOfficerSignature = authorizedOfficerSignature;
                }

                // Store leave credits certified by HR
                if (vlEarned !== undefined) app.vlEarned = vlEarned;
                if (vlLess !== undefined) app.vlLess = vlLess;
                if (vlBalance !== undefined) app.vlBalance = vlBalance;
                if (slEarned !== undefined) app.slEarned = slEarned;
                if (slLess !== undefined) app.slLess = slLess;
                if (slBalance !== undefined) app.slBalance = slBalance;
                if (splEarned !== undefined) app.splEarned = splEarned;
                if (splLess !== undefined) app.splLess = splLess;
                if (splBalance !== undefined) app.splBalance = splBalance;
                if (flEarned !== undefined) app.flEarned = flEarned;
                if (flLess !== undefined) app.flLess = flLess;
                if (flBalance !== undefined) app.flBalance = flBalance;
                if (ctoEarned !== undefined) app.ctoEarned = ctoEarned;
                if (ctoLess !== undefined) app.ctoLess = ctoLess;
                if (ctoBalance !== undefined) app.ctoBalance = ctoBalance;
                if (wlEarned !== undefined) app.wlEarned = wlEarned;
                if (wlLess !== undefined) app.wlLess = wlLess;
                if (wlBalance !== undefined) app.wlBalance = wlBalance;
                if (daysApproved !== undefined) app.daysApproved = daysApproved;

                console.log(`[WORKFLOW] HR approved - Moving to ASDS. Authorized Officer: ${authorizedOfficerName || 'Not specified'}`);
            } else if (currentApprover === 'ASDS') {
                // ASDS approved -> goes to SDS
                app.currentApprover = 'SDS';
                app.asdsApprovedAt = new Date().toISOString();

                // Store ASDS/OIC-ASDS officer info for Section 7.B of the final form
                if (asdsOfficerName) {
                    app.asdsOfficerName = asdsOfficerName;
                }
                if (asdsOfficerSignature) {
                    app.asdsOfficerSignature = asdsOfficerSignature;
                }

                console.log(`[WORKFLOW] ASDS approved - Moving to SDS. OIC-ASDS: ${asdsOfficerName || 'Not specified'}`);
            } else if (currentApprover === 'SDS') {
                // SDS approved -> FINAL APPROVAL
                app.status = 'approved';
                app.currentApprover = null;
                app.sdsApprovedAt = new Date().toISOString();
                app.finalApprovalAt = new Date().toISOString();

                // Store SDS officer info
                if (sdsOfficerName) {
                    app.sdsOfficerName = sdsOfficerName;
                }
                if (sdsOfficerSignature) {
                    app.sdsOfficerSignature = sdsOfficerSignature;
                }

                console.log(`[WORKFLOW] SDS approved - FINAL APPROVAL. OIC-SDS: ${sdsOfficerName || 'Not specified'}`);

                // Update employee's leave balance
                updateEmployeeLeaveBalance(app);
            }

            console.log(`[LEAVE] Application ${applicationId} approved by ${approverPortal}, new currentApprover: ${app.currentApprover}`);

            // Email notification for approval
            Promise.resolve()
                .then(() => notifyLeaveApproved(app, currentApprover, app.currentApprover))
                .catch(err => console.error(`[EMAIL] Failed to send approval notification for ${applicationId}:`, err.message));
        }

        applications[appIndex] = app;
        writeJSON(applicationsFile, applications);

        res.json({
            success: true,
            message: `Application ${action} successfully`,
            application: app
        });

        // Log activity after successful action — use session-derived values
        logActivity(`LEAVE_APPLICATION_${action.toUpperCase()}`, currentApprover.toLowerCase(), {
            userEmail: req.session.email || approverName,
            ip,
            userAgent: req.get('user-agent'),
            applicationId: app.id,
            employeeEmail: app.employeeEmail,
            remarks,
            action
        });
    } catch (error) {
        console.error('Error processing approval:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// Internal: Update employee leave balance after SDS final approval
// ---------------------------------------------------------------------------

/**
 * Auto-deduct leave balance from leavecards.json after SDS final approval.
 * Determines VL/SL used from the application leaveType and numDays, then
 * delegates to updateLeaveCardWithUsage() for all leave types.
 */
function updateEmployeeLeaveBalance(application) {
    try {
        const lt = (application.typeOfLeave || application.leaveType || '').toLowerCase();
        const days = parseFloat(application.numDays) || 0;

        // Route VL/SL days into the correct parameter slots;
        // force/SPL/wellness/others are detected by leaveType inside updateLeaveCardWithUsage
        let vlUsed = 0;
        let slUsed = 0;
        if (lt === 'leave_vl' || lt === 'vacation') vlUsed = days;
        else if (lt === 'leave_sl' || lt === 'sick') slUsed = days;
        // Force / SPL / Wellness / Others — updateLeaveCardWithUsage handles these internally

        updateLeaveCardWithUsage(application, vlUsed, slUsed);
    } catch (error) {
        console.error('Error auto-updating leave balance on SDS approval:', error);
    }
}

function updateLeaveCardWithUsage(application, vlUsed, slUsed) {
    try {
        const { leavecards: lcRepo, cto: ctoRepo } = repos();
        let leavecard = lcRepo.findByEmail(application.employeeEmail);
        const currentYear = new Date().getFullYear();

        if (!leavecard) {
            // Create new leave card if not found (VL/SL start at 0, earned via monthly accrual)
            leavecard = {
                email: application.employeeEmail,
                employeeId: application.employeeEmail,
                vacationLeaveEarned: 0,
                sickLeaveEarned: 0,
                forceLeaveEarned: 5,
                splEarned: 3,
                vacationLeaveSpent: 0,
                sickLeaveSpent: 0,
                forceLeaveSpent: 0,
                splSpent: 0,
                forceLeaveYear: currentYear,
                splYear: currentYear,
                vl: 0,
                sl: 0,
                spl: 3,
                others: 0,
                leaveUsageHistory: [],
                createdAt: new Date().toISOString()
            };
            // new card — repo.save() will insert it
        }

        // Initialize earned values if not present (for existing cards without these fields)
        if (leavecard.vacationLeaveEarned === undefined) leavecard.vacationLeaveEarned = 0;
        if (leavecard.sickLeaveEarned === undefined) leavecard.sickLeaveEarned = 0;

        // Annual reset: fires if year stamp is missing (Excel import) OR is from a prior year
        if (!leavecard.forceLeaveYear || leavecard.forceLeaveYear !== currentYear) {
            leavecard.forceLeaveSpent = 0;
            leavecard.forceLeaveYear  = currentYear;
        }
        if (!leavecard.splYear || leavecard.splYear !== currentYear) {
            leavecard.splSpent = 0;
            leavecard.splYear  = currentYear;
        }
        if (!leavecard.wellnessYear || leavecard.wellnessYear !== currentYear) {
            leavecard.wellnessSpent = 0;
            leavecard.wellnessYear  = currentYear;
        }

        // Initialize balance if not set (use earned values)
        if (leavecard.vl === undefined || leavecard.vl === null) {
            leavecard.vl = leavecard.vacationLeaveEarned - (leavecard.vacationLeaveSpent || 0);
        }
        if (leavecard.sl === undefined || leavecard.sl === null) {
            leavecard.sl = leavecard.sickLeaveEarned - (leavecard.sickLeaveSpent || 0);
        }

        // Initialize usage history if not present
        if (!leavecard.leaveUsageHistory) {
            leavecard.leaveUsageHistory = [];
        }

        // Determine leave type from application
        let leaveType = 'Leave';
        let daysUsed = 0;
        let forceLeaveUsed = 0;
        let splUsed = 0;
        let wellnessUsed = 0;

        if (application.typeOfLeave || application.leaveType) {
            const lType = String(application.typeOfLeave || application.leaveType).toLowerCase();
            if (lType === 'leave_mfl' || lType.includes('force')) {
                leaveType = 'Force Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.forceLeaveCount) || parseFloat(application.daysApplied) || 1;
                forceLeaveUsed = daysUsed;
            } else if (lType === 'leave_spl' || lType.includes('special privilege')) {
                leaveType = 'Special Privilege Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.splCount) || parseFloat(application.daysApplied) || 1;
                splUsed = daysUsed;
            } else if (lType === 'leave_wl' || lType === 'leave_wellness' || lType === 'wellness') {
                leaveType = 'Wellness Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.daysApplied) || 1;
                wellnessUsed = daysUsed;
            }
        }

        // If no specific leave type matched, use VL/SL
        if (!forceLeaveUsed && !splUsed && !wellnessUsed) {
            if (vlUsed > 0) {
                leaveType = 'Vacation Leave';
                daysUsed = vlUsed;
            } else if (slUsed > 0) {
                leaveType = 'Sick Leave';
                daysUsed = slUsed;
            }
        }

        // Deduct from balance based on leave type
        if (forceLeaveUsed > 0) {
            // Force Leave is charged against VL credits (per CSC rules) and also
            // counts toward the 5-day annual FL quota tracked by forceLeaveSpent.
            leavecard.forceLeaveSpent = (leavecard.forceLeaveSpent || 0) + forceLeaveUsed;
            const currentVlForFL = leavecard.vl || 0;
            const actualFlVlDeduction = Math.min(forceLeaveUsed, currentVlForFL);
            leavecard.vl = Math.max(0, currentVlForFL - actualFlVlDeduction);
            leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + actualFlVlDeduction;
            if (forceLeaveUsed > currentVlForFL) {
                console.log(`[LEAVECARD] FL VL capped: requested ${forceLeaveUsed} but only ${currentVlForFL} VL available for ${application.employeeEmail}`);
            }
        } else if (splUsed > 0) {
            leavecard.splSpent = (leavecard.splSpent || 0) + splUsed;
        } else if (wellnessUsed > 0) {
            if (!leavecard.wellnessYear) leavecard.wellnessYear = currentYear;
            if (leavecard.wellnessYear !== currentYear) {
                leavecard.wellnessSpent = 0;
                leavecard.wellnessYear = currentYear;
            }
            leavecard.wellnessSpent = (leavecard.wellnessSpent || 0) + wellnessUsed;
        } else if (application.leaveType === 'leave_others' || String(application.leaveType || '').toLowerCase().includes('others')) {
            // CTO/Others leave - deduct from CTO records
            const ctoUsed = parseFloat(application.numDays) || parseFloat(application.daysApplied) || 1;
            leaveType = 'CTO';
            daysUsed = ctoUsed;
            try {
                const empCtoRecords = ctoRepo.findByEmployee(application.employeeEmail);
                if (empCtoRecords.length > 0) {
                    // Deduct from most-recent records first, working backwards
                    let remaining = ctoUsed;
                    for (let i = empCtoRecords.length - 1; i >= 0 && remaining > 0; i--) {
                        const rec = empCtoRecords[i];
                        const granted = parseFloat(rec.daysGranted) || 0;
                        const used = parseFloat(rec.daysUsed) || 0;
                        const available = granted - used;
                        if (available > 0) {
                            const deduct = Math.min(remaining, available);
                            rec.daysUsed = used + deduct;
                            remaining -= deduct;
                            ctoRepo.save(rec);  // repo handles write per updated record
                        }
                    }
                    console.log(`[LEAVECARD] Deducted ${ctoUsed} CTO days from records for ${application.employeeEmail}`);
                }
            } catch (ctoErr) {
                console.error('Error deducting CTO:', ctoErr);
            }
        } else {
            // VL/SL deduction — negative balances are NOT allowed and NOT charged to other leave types
            if (slUsed > 0) {
                const currentSl = leavecard.sl || 0;
                // Only deduct what SL can cover — do NOT charge remainder to VL
                const actualSlDeduction = Math.min(slUsed, currentSl);
                leavecard.sl = Math.max(0, currentSl - actualSlDeduction);
                leavecard.sickLeaveSpent = (leavecard.sickLeaveSpent || 0) + actualSlDeduction;
                if (slUsed > currentSl) {
                    console.log(`[LEAVECARD] SL capped: requested ${slUsed} but only ${currentSl} available. NOT charging VL for ${application.employeeEmail}`);
                }
            }
            if (vlUsed > 0) {
                const currentVl = leavecard.vl || 0;
                const actualVlDeduction = Math.min(vlUsed, currentVl);
                leavecard.vl = Math.max(0, currentVl - actualVlDeduction);
                leavecard.vacationLeaveSpent = (leavecard.vacationLeaveSpent || 0) + actualVlDeduction;
                if (vlUsed > currentVl) {
                    console.log(`[LEAVECARD] VL capped: requested ${vlUsed} but only ${currentVl} available for ${application.employeeEmail}`);
                }
            }
        }

        // Record usage with period covered
        const dateFrom = application.dateFrom || application.date_from || application.inclusiveDatesFrom || '';
        const dateTo = application.dateTo || application.date_to || application.inclusiveDatesTo || '';

        // balanceAfterVL/SL should always reflect the current VL/SL balance, regardless of leave type
        const balanceAfterVL = leavecard.vl;
        const balanceAfterSL = leavecard.sl;

        leavecard.leaveUsageHistory.push({
            applicationId: application.id,
            leaveType: leaveType,
            daysUsed: daysUsed,
            periodFrom: dateFrom,
            periodTo: dateTo,
            dateApproved: new Date().toISOString(),
            approvedBy: 'SDS',
            remarks: application.remarks || '',
            balanceAfterVL: balanceAfterVL,
            balanceAfterSL: balanceAfterSL
        });

        leavecard.updatedAt = new Date().toISOString();

        lcRepo.save(leavecard);
        console.log(`[LEAVECARD] Updated leave card for ${application.employeeEmail}: VL Balance=${leavecard.vl}, SL Balance=${leavecard.sl}, Force Spent=${leavecard.forceLeaveSpent}, SPL Spent=${leavecard.splSpent}, Year=${currentYear}`);
    } catch (error) {
        console.error('Error updating leave card:', error);
    }
}

module.exports = router;
