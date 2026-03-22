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
const { isValidDate } = require('../utils/validation');
const { parseFullNameIntoParts } = require('../utils/name-parser');
const {
    notifyLeaveSubmitted, notifyLeaveApproved, notifyLeaveReturned,
    notifyLeaveRejected, notifyNextApprover
} = require('../services/email');
const {
    usersFile, employeesFile, applicationsFile, leavecardsFile,
    ctoRecordsFile,
    isAoDivisionLevel, isEmployeeInAoSchool, getEmployeeOffice,
    logActivity, getClientIp,
    findApplicationById, findApplicationIndexById, lookupUserName,
    isSelfOrAdmin, isAoAccessAllowed,
    isSchoolBased, generateApplicationId,
} = require('../utils/helpers');
const { ADMIN_ROLES } = require('../config/constants');

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
            soFileData: null,  // No longer stored inline — saved to disk below
            soFileName: applicationData.soFileName || '',
            soFilePath: null,  // Will be set if SO file was uploaded
            isSchoolBased: schoolBased,
            status: 'pending',
            currentApprover: 'AO',
            approvalHistory: [],
            submittedAt: new Date().toISOString()
        };

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

        // Send email notifications (fire-and-forget)
        notifyLeaveSubmitted(newApplication);
        notifyNextApprover(newApplication, 'AO');

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
router.get('/api/pending-applications/:portal', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
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
router.get('/api/approved-applications/:portal', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
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
router.get('/api/hr-approved-applications', requireAuth('hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const applications = readJSONArray(applicationsFile);

        // Get applications where HR has approved them (hrApprovedAt exists and currentApprover is not HR)
        let hrApprovedApps = applications.filter(a => {
            return a.hrApprovedAt && a.currentApprover !== 'HR';
        });

        res.json({ success: true, applications: hrApprovedApps });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// ---------------------------------------------------------------------------
// GET /api/all-users — All users for demographics
// ---------------------------------------------------------------------------
router.get('/api/all-users', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        const users = readJSON(usersFile);
        // SECURITY: Strip password hashes before sending to client
        let safeUsers = users.map(({ password, ...rest }) => rest);

        // AO school-based filtering: AO can only see users from their school
        if (req.session.role === 'ao' && req.session.office && !isAoDivisionLevel(req.session.office)) {
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
router.get('/api/all-applications', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
    try {
        let applications = readJSONArray(applicationsFile);

        // AO school-based filtering: AO can only see applications from their school's employees
        // S2 fix: Pre-load user/employee data once, pass as cache to avoid O(N*2) disk reads
        if (req.session.role === 'ao' && req.session.office && !isAoDivisionLevel(req.session.office)) {
            const aoOffice = req.session.office;
            const usersCache = readJSON(usersFile);
            const employeesCache = readJSON(employeesFile);
            applications = applications.filter(app => {
                const empOffice = getEmployeeOffice(app.employeeEmail || app.email, usersCache, employeesCache);
                return isEmployeeInAoSchool(empOffice, aoOffice);
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
router.get('/api/leave-calendar', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
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
        if (req.session.role === 'ao' && req.session.office && !isAoDivisionLevel(req.session.office)) {
            const aoOffice = req.session.office;
            const usersCache = readJSON(usersFile);
            const employeesCache = readJSON(employeesFile);
            relevantApps = relevantApps.filter(a => {
                const empOffice = getEmployeeOffice(a.employeeEmail || a.email, usersCache, employeesCache);
                return isEmployeeInAoSchool(empOffice, aoOffice);
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
router.get('/api/all-employees', requireAuth('ao', 'hr', 'it'), (req, res) => {
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
        if (req.session.role === 'ao' && req.session.office) {
            const aoOffice = req.session.office;
            if (!isAoDivisionLevel(aoOffice)) {
                employees = employees.filter(emp => isEmployeeInAoSchool(emp.office, aoOffice));
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
router.get('/api/portal-applications/:portal', requireAuth('ao', 'hr', 'asds', 'sds', 'it'), (req, res) => {
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
        if (req.session.role === 'ao' && req.session.office && !isAoDivisionLevel(req.session.office)) {
            const aoOffice = req.session.office;
            const usersCache = readJSON(usersFile);
            const employeesCache = readJSON(employeesFile);
            portalApps = portalApps.filter(app => {
                const empOffice = getEmployeeOffice(app.employeeEmail || app.email, usersCache, employeesCache);
                return isEmployeeInAoSchool(empOffice, aoOffice);
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

        // Update application with only allowed fields from resubmission (prevent mass assignment)
        if (updatedData) {
            const allowedResubmitFields = ['complianceDocuments', 'supportingDocuments', 'soFileData', 'soFileName', 'remarks'];
            for (const field of allowedResubmitFields) {
                if (updatedData[field] !== undefined) {
                    app[field] = updatedData[field];
                }
            }
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
        app.currentApprover = 'AO';
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
router.post('/api/approve-leave', requireAuth('hr', 'ao', 'asds', 'sds'), (req, res) => {
    try {
        const { applicationId, action, approverPortal, approverName, remarks, authorizedOfficerName, authorizedOfficerSignature, asdsOfficerName, asdsOfficerSignature, sdsOfficerName, sdsOfficerSignature, vlEarned, vlLess, vlBalance, slEarned, slLess, slBalance, splEarned, splLess, splBalance, flEarned, flLess, flBalance, ctoEarned, ctoLess, ctoBalance } = req.body;
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
        if (!isAoAccessAllowed(req, app.employeeEmail || app.email)) {
            return res.status(403).json({ success: false, error: 'Access denied. This employee is not from your school.' });
        }

        // SECURITY: Use session role instead of trusting client-provided portal
        // Map session role to portal name (prevents portal spoofing attack)
        const roleToPortal = { 'ao': 'AO', 'hr': 'HR', 'asds': 'ASDS', 'sds': 'SDS' };
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
            const returnTo = req.body.returnTo; // Optional: 'EMPLOYEE', 'AO', 'HR', 'ASDS'
            let returnedTo = null;

            // Define the workflow hierarchy (lower index = lower in chain)
            const workflowOrder = ['EMPLOYEE', 'AO', 'HR', 'ASDS', 'SDS'];
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
                if (currentApprover === 'AO') {
                    app.status = 'returned';
                    app.currentApprover = 'EMPLOYEE';
                    returnedTo = 'Employee';
                } else if (currentApprover === 'HR') {
                    app.status = 'pending';
                    app.currentApprover = 'AO';
                    returnedTo = 'AO';
                } else if (currentApprover === 'ASDS') {
                    app.status = 'pending';
                    app.currentApprover = 'HR';
                    returnedTo = 'HR';
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
            notifyLeaveReturned(app, currentApprover, remarks);

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
            notifyLeaveRejected(app, currentApprover, remarks);

        } else if (action === 'approved') {
            // Determine next approver based on workflow
            if (currentApprover === 'AO') {
                // AO approved -> goes to HR
                app.currentApprover = 'HR';
                app.aoApprovedAt = new Date().toISOString();
                console.log(`[WORKFLOW] AO approved - Moving to HR`);
            } else if (currentApprover === 'HR') {
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

            // Email notification for approval (fire-and-forget)
            notifyLeaveApproved(app, currentApprover, app.currentApprover);
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
 * Update employee leave balance after SDS final approval.
 * YAGNI/S8 fix: Removed dead `leaveCredits` field from employees.json.
 * The single source of truth for balances is leavecards.json (vl/sl fields).
 */
function updateEmployeeLeaveBalance(application) {
    try {
        const leaveType = application.typeOfLeave || application.leaveType || '';
        console.log(`[LEAVE] Auto leave-card update skipped for ${application.employeeEmail} (${leaveType}). AO manual encoding is required.`);
    } catch (error) {
        console.error('Error updating leave balance:', error);
    }
}

function updateLeaveCardWithUsage(application, vlUsed, slUsed) {
    try {
        const leavecards = readJSON(leavecardsFile);
        let leavecard = leavecards.find(lc => lc.email === application.employeeEmail || lc.employeeId === application.employeeEmail);
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
            leavecards.push(leavecard);
        }

        // Initialize earned values if not present (for existing cards without these fields)
        if (leavecard.vacationLeaveEarned === undefined) leavecard.vacationLeaveEarned = 0;
        if (leavecard.sickLeaveEarned === undefined) leavecard.sickLeaveEarned = 0;

        // Initialize year tracking if not present
        if (!leavecard.forceLeaveYear) leavecard.forceLeaveYear = currentYear;
        if (!leavecard.splYear) leavecard.splYear = currentYear;

        // Reset Force Leave balance if year has changed
        if (leavecard.forceLeaveYear !== currentYear) {
            leavecard.forceLeaveSpent = 0;
            leavecard.forceLeaveYear = currentYear;
        }

        // Reset Special Privilege Leave balance if year has changed
        if (leavecard.splYear !== currentYear) {
            leavecard.splSpent = 0;
            leavecard.splYear = currentYear;
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

        if (application.typeOfLeave || application.leaveType) {
            const lType = application.typeOfLeave || application.leaveType;
            if (lType === 'leave_mfl' || String(lType).toLowerCase().includes('force')) {
                leaveType = 'Force Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.forceLeaveCount) || parseFloat(application.daysApplied) || 1;
                forceLeaveUsed = daysUsed;
            } else if (lType === 'leave_spl' || String(lType).toLowerCase().includes('special')) {
                leaveType = 'Special Privilege Leave';
                daysUsed = parseFloat(application.numDays) || parseFloat(application.splCount) || parseFloat(application.daysApplied) || 1;
                splUsed = daysUsed;
            }
        }

        // If no specific leave type matched, use VL/SL
        if (!forceLeaveUsed && !splUsed) {
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
            // Force Leave is a separate 5-day yearly allocation — NOT charged against VL
            leavecard.forceLeaveSpent = (leavecard.forceLeaveSpent || 0) + forceLeaveUsed;
            // Do NOT deduct from leavecard.vl or vacationLeaveSpent
        } else if (splUsed > 0) {
            leavecard.splSpent = (leavecard.splSpent || 0) + splUsed;
        } else if (application.leaveType === 'leave_others' || String(application.leaveType || '').toLowerCase().includes('others')) {
            // CTO/Others leave - deduct from CTO records
            const ctoUsed = parseFloat(application.numDays) || parseFloat(application.daysApplied) || 1;
            leaveType = 'CTO';
            daysUsed = ctoUsed;
            try {
                ensureFile(ctoRecordsFile);
                const ctoRecords = readJSON(ctoRecordsFile);
                const empCtoRecords = ctoRecords.filter(r => r.employeeId === application.employeeEmail);
                if (empCtoRecords.length > 0) {
                    // Find the most recent CTO record with remaining balance
                    let remaining = ctoUsed;
                    for (let i = empCtoRecords.length - 1; i >= 0 && remaining > 0; i--) {
                        const rec = empCtoRecords[i];
                        const recIndex = ctoRecords.indexOf(rec);
                        const granted = parseFloat(rec.daysGranted) || 0;
                        const used = parseFloat(rec.daysUsed) || 0;
                        const available = granted - used;
                        if (available > 0) {
                            const deduct = Math.min(remaining, available);
                            ctoRecords[recIndex].daysUsed = (used + deduct);
                            remaining -= deduct;
                        }
                    }
                    writeJSON(ctoRecordsFile, ctoRecords);
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

        // Find and update the leavecard entry
        const lcIndex = leavecards.findIndex(lc => lc.email === application.employeeEmail || lc.employeeId === application.employeeEmail);
        if (lcIndex !== -1) {
            leavecards[lcIndex] = leavecard;
        }

        writeJSON(leavecardsFile, leavecards);
        console.log(`[LEAVECARD] Updated leave card for ${application.employeeEmail}: VL Balance=${leavecard.vl}, SL Balance=${leavecard.sl}, Force Spent=${leavecard.forceLeaveSpent}, SPL Spent=${leavecard.splSpent}, Year=${currentYear}`);
    } catch (error) {
        console.error('Error updating leave card:', error);
    }
}

module.exports = router;
