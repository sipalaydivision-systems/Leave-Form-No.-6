/**
 * Email service — MailerSend integration and template generation.
 *
 * Provides the low-level `sendEmail` transport (raw HTTPS to
 * MailerSend), registration-approval email templates, and fire-and-forget
 * notification helpers for the leave-application workflow.
 *
 * Extracted from server.js lines ~1956-2295.
 */

const https = require('https');
const path = require('path');
const { readJSON } = require('../data/json-store');

// ---------------------------------------------------------------------------
// Configuration — pulled from environment
// ---------------------------------------------------------------------------

const MAILERSEND_API_KEY      = process.env.MAILERSEND_API_KEY || '';
const MAILERSEND_SENDER_EMAIL = process.env.MAILERSEND_SENDER_EMAIL || '';
const PRODUCTION_DOMAIN       = process.env.PRODUCTION_DOMAIN || 'http://localhost:3000';

// Data paths — needed by notifyNextApprover to look up approver emails
const dataDir = process.env.RAILWAY_VOLUME_MOUNT_PATH
    ? path.join(process.env.RAILWAY_VOLUME_MOUNT_PATH, 'data')
    : path.join(__dirname, '..', '..', 'data');

const hrUsersFile   = path.join(dataDir, 'hr-users.json');
const aovUsersFile   = path.join(dataDir, 'aov-users.json');
const asdsUsersFile = path.join(dataDir, 'asds-users.json');
const sdsUsersFile  = path.join(dataDir, 'sds-users.json');

// ---------------------------------------------------------------------------
// Low-level transport
// ---------------------------------------------------------------------------

/**
 * Send an email via the MailerSend API over HTTPS.
 *
 * @param {string} recipientEmail - Recipient email address.
 * @param {string} recipientName  - Recipient display name.
 * @param {string} subject        - Email subject line.
 * @param {string} htmlContent    - Full HTML body.
 * @returns {Promise<boolean>} Resolves `true` on success.
 */
function sendEmail(recipientEmail, recipientName, subject, htmlContent) {
    return new Promise((resolve, reject) => {
        const mailersendData = {
            from: {
                email: MAILERSEND_SENDER_EMAIL,
                name: 'DepEd Sipalay Leave Form',
            },
            to: [
                {
                    email: recipientEmail,
                    name: recipientName,
                },
            ],
            subject: subject,
            html: htmlContent,
        };

        const jsonData = JSON.stringify(mailersendData);

        const options = {
            hostname: 'api.mailersend.com',
            port: 443,
            path: '/v1/email',
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${MAILERSEND_API_KEY}`,
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(jsonData),
            },
        };

        const req = https.request(options, (res) => {
            let data = '';

            res.on('data', (chunk) => {
                data += chunk;
            });

            res.on('end', () => {
                if (res.statusCode === 202 || res.statusCode === 200) {
                    console.log('Email sent successfully to:', recipientEmail);
                    resolve(true);
                } else {
                    console.error('MailerSend Error:', res.statusCode, data);
                    reject(new Error(`Email sending failed with status ${res.statusCode}`));
                }
            });
        });

        req.on('error', (error) => {
            console.error('Email sending error:', error);
            reject(error);
        });

        req.write(jsonData);
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

/**
 * Generate the "Registration Approved" HTML email.
 *
 * @param {string}      userEmail         - User's email address.
 * @param {string}      userName          - User's full name.
 * @param {string}      portal            - Portal type (`'employee'`, `'hr'`, `'aov'`, `'asds'`, `'sds'`).
 * @param {string|null} [temporaryPassword=null] - Temporary password (shown when set).
 * @returns {string} Complete HTML document.
 */
function generateLoginFormEmail(userEmail, userName, portal, temporaryPassword = null) {
    const loginUrl = `${PRODUCTION_DOMAIN}/${portal === 'employee' ? 'login' : `${portal}-login`}`;

    let portalDisplayName = '';
    switch (portal) {
        case 'employee': portalDisplayName = 'Employee'; break;
        case 'hr':       portalDisplayName = 'Administrative Officer'; break;
        case 'aov':       portalDisplayName = 'Human Resource'; break;
        case 'asds':     portalDisplayName = 'ASDS'; break;
        case 'sds':      portalDisplayName = 'Schools Division Superintendent'; break;
        default:         portalDisplayName = 'Leave Form Portal';
    }

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
            .email-wrapper { background-color: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .header { background: linear-gradient(135deg, #003366 0%, #004080 100%); color: white; padding: 20px; border-radius: 8px 8px 0 0; text-align: center; }
            .header h1 { margin: 0; font-size: 24px; }
            .content { padding: 20px 0; }
            .login-section { background-color: #f9f9f9; padding: 15px; border-left: 4px solid #003366; margin: 15px 0; }
            .button { display: inline-block; background-color: #003366; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 15px 0; font-weight: bold; }
            .credentials { background-color: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 15px 0; }
            .credentials p { margin: 8px 0; }
            .credentials strong { color: #003366; }
            .footer { text-align: center; padding-top: 20px; border-top: 1px solid #ddd; margin-top: 20px; font-size: 12px; color: #666; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="email-wrapper">
                <div class="header">
                    <h1>Registration Approved</h1>
                    <p>CS Form No. 6 - Application for Leave System</p>
                </div>

                <div class="content">
                    <p>Dear <strong>${userName}</strong>,</p>

                    <p>Congratulations! Your registration for the <strong>${portalDisplayName} Portal</strong> has been approved by the IT Department.</p>

                    <p>You can now access the Leave Form System using your credentials:</p>

                    <div class="credentials">
                        <p><strong>Email:</strong> ${userEmail}</p>
                        ${temporaryPassword ? `<p><strong>Temporary Password:</strong> ${temporaryPassword}</p><p style="color: #d9534f; margin-top: 10px;"><em>Warning: Please change this password on your first login for security reasons.</em></p>` : '<p><strong>Password:</strong> Use the password you registered with</p>'}
                    </div>

                    <p>To access the system, click the button below:</p>

                    <center>
                        <a href="${loginUrl}" class="button">Access Leave Form Portal</a>
                    </center>

                    <div class="login-section">
                        <p><strong>Login Information:</strong></p>
                        <p>Portal: ${portalDisplayName} Portal</p>
                        <p>Direct Link: <a href="${loginUrl}">${loginUrl}</a></p>
                    </div>

                    <p><strong>Important Security Reminders:</strong></p>
                    <ul>
                        <li>Never share your password with anyone</li>
                        <li>Log out after each session, especially on shared computers</li>
                        <li>If you forgot your password, use the "Forgot Password" option on the login page</li>
                        <li>Report any suspicious activity to the IT Department immediately</li>
                    </ul>

                    <p>If you have any questions or technical issues accessing the portal, please contact the IT Department.</p>

                    <p>Best regards,<br>
                    <strong>DepEd Sipalay Division</strong><br>
                    Information Technology Department</p>
                </div>

                <div class="footer">
                    <p>This is an automated email from the Leave Form System. Please do not reply to this email.</p>
                    <p>&copy; 2026 DepEd Sipalay Division. All rights reserved.</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
}

/**
 * Reusable workflow email template.  Used by all notification helpers
 * (submitted, approved, returned, rejected, next-approver).
 *
 * @param {string} heading       - Banner heading text.
 * @param {string} recipientName - Display name of the recipient.
 * @param {string} mainMessage   - Primary HTML paragraph.
 * @param {string} nextSteps     - HTML for the "Next Steps" info box.
 * @param {string} accentColor   - CSS colour for the header bar and accent border.
 * @returns {string} Complete HTML document.
 */
function generateWorkflowEmail(heading, recipientName, mainMessage, nextSteps, accentColor) {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; background-color: #f5f5f5; }
            .email-wrapper { background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
            .header { background: ${accentColor}; color: white; padding: 20px; text-align: center; }
            .header h1 { margin: 0; font-size: 22px; }
            .header p { margin: 5px 0 0; opacity: 0.9; font-size: 13px; }
            .content { padding: 25px; }
            .info-box { background: #f9f9f9; border-left: 4px solid ${accentColor}; padding: 12px 15px; margin: 15px 0; border-radius: 0 4px 4px 0; }
            .footer { text-align: center; padding: 15px 25px; border-top: 1px solid #eee; font-size: 12px; color: #999; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="email-wrapper">
                <div class="header">
                    <h1>${heading}</h1>
                    <p>CS Form No. 6 — Leave Application System</p>
                </div>
                <div class="content">
                    <p>Dear <strong>${recipientName}</strong>,</p>
                    <p>${mainMessage}</p>
                    <div class="info-box">
                        <p style="margin:0;"><strong>Next Steps:</strong></p>
                        <p style="margin:5px 0 0;">${nextSteps}</p>
                    </div>
                    <p style="font-size:13px; color:#666;">If you have questions, contact your immediate supervisor or the IT Department.</p>
                    <p>Best regards,<br><strong>DepEd Sipalay Division</strong></p>
                </div>
                <div class="footer">
                    <p>This is an automated notification. Please do not reply to this email.<br>&copy; 2026 DepEd Sipalay Division</p>
                </div>
            </div>
        </div>
    </body>
    </html>
    `;
}

// ---------------------------------------------------------------------------
// Human-readable leave-type labels
// ---------------------------------------------------------------------------

/** Map a leave-type code to a friendly display name. */
function formatLeaveType(leaveType) {
    const map = {
        'leave_vacation': 'Vacation Leave',
        'leave_mandatory': 'Mandatory/Forced Leave',
        'leave_sick': 'Sick Leave',
        'leave_maternity': 'Maternity Leave',
        'leave_paternity': 'Paternity Leave',
        'leave_spl': 'Special Privilege Leave',
        'leave_solo_parent': 'Solo Parent Leave',
        'leave_study': 'Study Leave',
        'leave_vawc': '10-Day VAWC Leave',
        'leave_rehab': 'Rehabilitation Leave',
        'leave_women': 'Special Leave Benefits for Women',
        'leave_calamity': 'Calamity Leave',
        'leave_adoption': 'Adoption Leave',
        'leave_others': 'Others (CTO)',
        'leave_mfl': 'Mandatory/Forced Leave',
    };
    return map[leaveType] || leaveType || 'Leave';
}

// ---------------------------------------------------------------------------
// Fire-and-forget workflow notification helpers
// ---------------------------------------------------------------------------
// If MAILERSEND_API_KEY is not set these silently no-op.

/**
 * Notify the employee that their leave application has been submitted.
 *
 * @param {object} app - The leave application object.
 */
function notifyLeaveSubmitted(app) {
    if (!MAILERSEND_API_KEY) return;
    const empEmail = app.employeeEmail;
    if (!empEmail) return;
    const subject = `Leave Application Submitted \u2014 ${app.id}`;
    const html = generateWorkflowEmail(
        'Application Submitted',
        app.employeeName || empEmail,
        `Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) for ${app.numDays} day(s) from ${app.dateFrom} to ${app.dateTo} has been submitted successfully.`,
        'Your application is now with the <strong>HR Portal</strong> for initial review.',
        '#28a745'
    );
    sendEmail(empEmail, app.employeeName || '', subject, html).catch(e => console.error('[EMAIL] Submit notification failed:', e.message));
}

/**
 * Notify the employee (and optionally the next approver) when an
 * application is approved at a stage.
 *
 * @param {object}      app             - The leave application object.
 * @param {string}      approverPortal  - Display name of the approving portal.
 * @param {string|null} nextApprover    - Role tag of the next approver, or null for final.
 */
function notifyLeaveApproved(app, approverPortal, nextApprover) {
    if (!MAILERSEND_API_KEY) return;
    const empEmail = app.employeeEmail;
    if (!empEmail) return;

    const isFinal = !nextApprover;
    const subject = isFinal
        ? `Leave Application APPROVED \u2014 ${app.id}`
        : `Leave Application Approved by ${approverPortal} \u2014 ${app.id}`;

    const message = isFinal
        ? `Great news! Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) has received <strong>final approval</strong> from the Schools Division Superintendent.`
        : `Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) has been approved by <strong>${approverPortal}</strong>.`;

    const nextSteps = isFinal
        ? 'Your leave is now officially approved. You may view and print the final form from your dashboard.'
        : `Your application is now with <strong>${nextApprover}</strong> for the next review step.`;

    const color = isFinal ? '#28a745' : '#1976D2';
    const html = generateWorkflowEmail(isFinal ? 'Final Approval' : `Approved by ${approverPortal}`, app.employeeName || empEmail, message, nextSteps, color);
    sendEmail(empEmail, app.employeeName || '', subject, html).catch(e => console.error('[EMAIL] Approval notification failed:', e.message));

    // Notify next approver if applicable
    if (nextApprover) {
        notifyNextApprover(app, nextApprover);
    }
}

/**
 * Notify the employee when their application is returned.
 *
 * @param {object} app        - The leave application object.
 * @param {string} returnedBy - Who returned it (display label).
 * @param {string} remarks    - Reason / comments.
 */
function notifyLeaveReturned(app, returnedBy, remarks) {
    if (!MAILERSEND_API_KEY) return;
    const empEmail = app.employeeEmail;
    if (!empEmail) return;
    const subject = `Leave Application Returned \u2014 ${app.id}`;
    const html = generateWorkflowEmail(
        'Application Returned',
        app.employeeName || empEmail,
        `Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) has been returned by <strong>${returnedBy}</strong>.`,
        `<strong>Reason:</strong> ${remarks || 'Please review and resubmit.'}<br><br>Please log in to your dashboard to view details and resubmit.`,
        '#F57C00'
    );
    sendEmail(empEmail, app.employeeName || '', subject, html).catch(e => console.error('[EMAIL] Return notification failed:', e.message));
}

/**
 * Notify the employee when their application is rejected.
 *
 * @param {object} app        - The leave application object.
 * @param {string} rejectedBy - Who rejected it (display label).
 * @param {string} reason     - Rejection reason.
 */
function notifyLeaveRejected(app, rejectedBy, reason) {
    if (!MAILERSEND_API_KEY) return;
    const empEmail = app.employeeEmail;
    if (!empEmail) return;
    const subject = `Leave Application Rejected \u2014 ${app.id}`;
    const html = generateWorkflowEmail(
        'Application Rejected',
        app.employeeName || empEmail,
        `Your leave application <strong>${app.id}</strong> (${formatLeaveType(app.leaveType)}) has been <strong>rejected</strong> by <strong>${rejectedBy}</strong>.`,
        `<strong>Reason:</strong> ${reason || 'No specific reason provided.'}<br><br>If you believe this was in error, please contact the ${rejectedBy} office or submit a new application.`,
        '#d32f2f'
    );
    sendEmail(empEmail, app.employeeName || '', subject, html).catch(e => console.error('[EMAIL] Rejection notification failed:', e.message));
}

/**
 * Notify all users in the next approver portal that an application is
 * waiting for their review.
 *
 * @param {object} app          - The leave application object.
 * @param {string} approverRole - Role tag (`'AOV'`, `'HR'`, `'ASDS'`, `'SDS'`).
 */
function notifyNextApprover(app, approverRole) {
    if (!MAILERSEND_API_KEY) return;
    const portalToFile = { 'AOV': aovUsersFile, 'HR': hrUsersFile, 'ASDS': asdsUsersFile, 'SDS': sdsUsersFile };
    const file = portalToFile[approverRole];
    if (!file) return;

    const approvers = readJSON(file);
    // Notify all users in that portal (they share responsibility)
    approvers.forEach(user => {
        if (!user.email) return;
        const subject = `New Leave Application Pending Your Review \u2014 ${app.id}`;
        const html = generateWorkflowEmail(
            'Action Required',
            user.name || user.email,
            `A leave application from <strong>${app.employeeName || app.employeeEmail}</strong> (${formatLeaveType(app.leaveType)}, ${app.numDays} days) is now waiting for your review.`,
            `Please log in to your <strong>${approverRole}</strong> dashboard to review and take action on application <strong>${app.id}</strong>.`,
            '#003366'
        );
        sendEmail(user.email, user.name || '', subject, html).catch(e => console.error(`[EMAIL] Next-approver notification to ${user.email} failed:`, e.message));
    });
}

// ---------------------------------------------------------------------------

module.exports = {
    sendEmail,
    generateLoginFormEmail,
    generateWorkflowEmail,
    formatLeaveType,
    notifyLeaveSubmitted,
    notifyLeaveApproved,
    notifyLeaveReturned,
    notifyLeaveRejected,
    notifyNextApprover,
};
