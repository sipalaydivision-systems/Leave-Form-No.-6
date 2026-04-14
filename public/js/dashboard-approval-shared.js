/**
 * Shared utilities for approval portal dashboards (ASDS, SDS).
 *
 * Provides common: sidebar setup, approval modal, detail modal,
 * table rendering, chart rendering, and helpers.
 */

import { initSidebar, ICONS } from '../components/sidebar.js';
import { createTabs } from '../components/tabs.js';
import { createDataTable } from '../components/table.js';
import { createBarChart, createDoughnutChart, destroyChart } from '../components/chart-wrapper.js';
import { toast } from '../components/toast.js';
import { openModal, closeModal } from '../components/modal.js';
import { renderEmptyState } from '../components/empty-state.js';

export { ICONS, toast, openModal, closeModal, createDataTable, createBarChart, createDoughnutChart, destroyChart, renderEmptyState };

// ---------------------------------------------------------------------------
// Common helpers
// ---------------------------------------------------------------------------
export function toNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
export function fmt(v) { const n = toNum(v); return n % 1 === 0 ? String(n) : n.toFixed(3); }
export function fmtDays(app) {
    const d = toNum(app.numDays || app.num_days);
    if (app.leaveHours != null && app.leaveHours > 0 && app.leaveHours < 8) {
        return `${fmt(d)} (${app.leaveHours} hr${app.leaveHours > 1 ? 's' : ''})`;
    }
    if (app.isHalfDay) return '0.5 (4 hrs)';
    return fmt(d);
}
export function esc(s) { return escapeHtml(s); }
export function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

export function fmtDate(s) {
    if (!s) return '--';
    const d = new Date(s);
    return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDateRange(f, t) {
    const a = fmtDate(f), b = fmtDate(t);
    return a === b || b === '--' ? a : `${a} - ${b}`;
}

export function statusBadge(status, approver) {
    const s = (status || '').toLowerCase();
    let cls = 'badge-neutral', label = status;
    switch (s) {
        case 'pending': cls = 'badge-pending'; label = approver ? `Pending ${approver}` : 'Pending'; break;
        case 'approved': cls = 'badge-approved'; label = 'Approved'; break;
        case 'returned': cls = 'badge-returned'; label = 'Returned'; break;
        case 'rejected': case 'disapproved': cls = 'badge-rejected'; label = 'Rejected'; break;
        case 'cancelled': cls = 'badge-neutral'; label = 'Cancelled'; break;
    }
    return `<span class="badge ${cls}">${esc(label)}</span>`;
}

// ---------------------------------------------------------------------------
// Fetch user
// ---------------------------------------------------------------------------
export async function fetchUser(opts) {
    const res = await fetch('/api/me');
    if (!res.ok) {
        if (opts?.loginUrl) window.location.href = opts.loginUrl;
        return null;
    }
    const data = await res.json();
    const u = data.user || data;
    if (opts?.allowedRoles) {
        const role = (u.role || u.portal || '').toLowerCase();
        if (!opts.allowedRoles.includes(role)) {
            if (opts.loginUrl) window.location.href = opts.loginUrl;
            return null;
        }
    }
    if (u.mustChangePassword) { window.location.href = '/change-password.html'; return null; }
    return u;
}

// ---------------------------------------------------------------------------
// Setup sidebar for an approval portal
// ---------------------------------------------------------------------------
export function setupApprovalSidebar(config) {
    const sidebar = initSidebar({
        el: '#sidebar',
        profile: { name: config.userName, role: config.roleLabel },
        roleColor: config.roleColor,
        activeId: 'overview',
        sections: [
            {
                title: 'Dashboard',
                links: [
                    { id: 'overview', label: 'Overview', icon: ICONS.home },
                    { id: config.pendingTabId, label: config.pendingLabel, icon: ICONS.clipboardList, badge: 0 },
                    { id: config.processedTabId, label: config.processedLabel, icon: ICONS.checkCircle },
                ],
            },
            {
                title: 'Analytics',
                links: [
                    { id: 'calendar', label: 'Leave Calendar', icon: ICONS.calendar },
                    { id: 'reports', label: 'Reports', icon: ICONS.barChart },
                ],
            },
        ],
        footerLinks: [
            { id: 'help', label: 'Help Center', icon: ICONS.helpCircle, href: '/help' },
            { id: 'logout', label: 'Logout', icon: ICONS.logout },
        ],
        onNavigate: (linkId) => {
            if (linkId === 'logout') { window.logout(); return; }
            if (linkId === 'help') return;
            if (config.tabs) config.tabs.setActive(linkId);
        },
        onProfileClick: () => {
            openModal({
                title: 'My Profile',
                content: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                    <div><label class="form-label">Name</label><div>${esc(config.userName)}</div></div>
                    <div><label class="form-label">Email</label><div>${esc(config.userEmail)}</div></div>
                    <div><label class="form-label">Role</label><div>${config.roleLabel}</div></div>
                </div>`,
                size: 'md',
            });
        },
    });

    document.getElementById('hamburger-btn')?.addEventListener('click', () => sidebar.toggleMobile());
    document.querySelector('.sidebar-overlay')?.addEventListener('click', () => sidebar.toggleMobile(false));

    return sidebar;
}

// ---------------------------------------------------------------------------
// Approval/return/reject modal
// ---------------------------------------------------------------------------
export async function showApprovalModal(app, portal, user, onDone) {
    const appId = app.id;
    const employee = app.employeeName || app.employee_name || '';
    const type = getLeaveTypeLabel(app.leaveType || app.leave_type);
    const days = fmtDays(app);
    const email = app.employeeEmail || app.employee_email || '';

    // Fetch leave balances for the applicant
    let balanceHtml = '';
    if (email) {
        toast.info('Loading leave credits...');
        const [creditsRes, ctoRes] = await Promise.all([
            fetch(`/api/leave-credits?employeeId=${encodeURIComponent(email)}`).then(r => r.ok ? r.json() : null).catch(() => null),
            fetch(`/api/cto-records?employeeId=${encodeURIComponent(email)}`).then(r => r.ok ? r.json() : null).catch(() => null),
        ]);

        const credits = creditsRes?.credits || {};
        const ctoRecords = ctoRes?.records || [];
        const ctoBalance = ctoRecords.reduce((s, r) => s + toNum(r.balance || (toNum(r.daysGranted || r.days_granted) - toNum(r.daysUsed || r.days_used))), 0);

        // Use Admin Officer V-certified values when available; fall back to live credits
        const hasCertified = app.vlEarned !== undefined || app.vlLess !== undefined;
        const vlEarned  = hasCertified && app.vlEarned !== undefined ? toNum(app.vlEarned)  : toNum(credits.vacationLeaveEarned || credits.vacation_leave_earned);
        const vlSpent   = hasCertified && app.vlLess   !== undefined ? toNum(app.vlLess)    : toNum(credits.vacationLeaveSpent || credits.vacation_leave_spent);
        const slEarned  = hasCertified && app.slEarned !== undefined ? toNum(app.slEarned)  : toNum(credits.sickLeaveEarned || credits.sick_leave_earned);
        const slSpent   = hasCertified && app.slLess   !== undefined ? toNum(app.slLess)    : toNum(credits.sickLeaveSpent || credits.sick_leave_spent);
        const splEarned = hasCertified && app.splEarned !== undefined ? toNum(app.splEarned) : toNum(credits.splEarned || credits.spl || 3);
        const splSpent  = hasCertified && app.splLess  !== undefined ? toNum(app.splLess)   : toNum(credits.splSpent);
        const flEarned  = hasCertified && app.flEarned !== undefined ? toNum(app.flEarned)  : toNum(credits.forceLeaveEarned || credits.mandatoryForced || 5);
        const flSpent   = hasCertified && app.flLess   !== undefined ? toNum(app.flLess)    : toNum(credits.forceLeaveSpent);
        const wlEarned  = hasCertified && app.wlEarned !== undefined ? toNum(app.wlEarned)  : toNum(credits.wellnessEarned || credits.wellness_earned || 5);
        const wlSpent   = hasCertified && app.wlLess   !== undefined ? toNum(app.wlLess)    : toNum(credits.wellnessSpent || credits.wellness_spent);

        if (!creditsRes) {
            balanceHtml = '<div style="margin-bottom:var(--space-3);padding:var(--space-2);background:var(--color-warning-bg);border-radius:var(--radius-sm);font-size:var(--text-xs)">Could not load leave credits.</div>';
        } else {
            balanceHtml = `
            <div class="card" style="margin-bottom:var(--space-4)">
                <div class="card-header"><h4 class="card-title" style="font-size:var(--text-sm)">Leave Credits Summary</h4></div>
                <div class="card-body">
                    <div class="cert-grid">
                        <div class="cert-grid-header"></div>
                        <div class="cert-grid-header">Earned</div>
                        <div class="cert-grid-header">Less</div>
                        <div class="cert-grid-header">Balance</div>
                        <div class="cert-grid-label">Vacation Leave</div>
                        <div class="cert-grid-val">${fmt(vlEarned)}</div>
                        <div class="cert-grid-val">${fmt(vlSpent)}</div>
                        <div class="cert-grid-val" style="font-weight:var(--font-semibold);color:var(--color-primary-600,#1565c0)">${fmt(vlEarned - vlSpent)}</div>
                        <div class="cert-grid-label">Sick Leave</div>
                        <div class="cert-grid-val">${fmt(slEarned)}</div>
                        <div class="cert-grid-val">${fmt(slSpent)}</div>
                        <div class="cert-grid-val" style="font-weight:var(--font-semibold);color:var(--color-primary-600,#1565c0)">${fmt(slEarned - slSpent)}</div>
                        <div class="cert-grid-label">Special Privilege</div>
                        <div class="cert-grid-val">${fmt(splEarned)}</div>
                        <div class="cert-grid-val">${fmt(splSpent)}</div>
                        <div class="cert-grid-val" style="font-weight:var(--font-semibold);color:var(--color-primary-600,#1565c0)">${fmt(splEarned - splSpent)}</div>
                        <div class="cert-grid-label">Force Leave</div>
                        <div class="cert-grid-val">${fmt(flEarned)}</div>
                        <div class="cert-grid-val">${fmt(flSpent)}</div>
                        <div class="cert-grid-val" style="font-weight:var(--font-semibold);color:var(--color-primary-600,#1565c0)">${fmt(flEarned - flSpent)}</div>
                        <div class="cert-grid-label">Wellness Leave</div>
                        <div class="cert-grid-val">${fmt(wlEarned)}</div>
                        <div class="cert-grid-val">${fmt(wlSpent)}</div>
                        <div class="cert-grid-val" style="font-weight:var(--font-semibold);color:var(--color-primary-600,#1565c0)">${fmt(wlEarned - wlSpent)}</div>
                        <div class="cert-grid-label">CTO</div>
                        <div class="cert-grid-val">${fmt(ctoBalance)}</div>
                        <div class="cert-grid-val">0</div>
                        <div class="cert-grid-val" style="font-weight:var(--font-semibold);color:var(--color-primary-600,#1565c0)">${fmt(ctoBalance)}</div>
                    </div>
                </div>
            </div>`;
        }
    }

    // Portal-specific labels
    const portalUpper = (portal || '').toUpperCase();
    const forwardLabel = portalUpper === 'ASDS' ? 'Recommend & Forward to SDS' : 'Approve';
    const sigLabel = portalUpper === 'ASDS' ? 'OIC-ASDS Signature' : 'OIC-SDS Signature';

    const content = `
        <div style="margin-bottom:var(--space-4)">
            <p><strong>Employee:</strong> ${esc(employee)}</p>
            <p><strong>Leave Type:</strong> ${esc(type)}</p>
            <p><strong>Period:</strong> ${esc(fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to))}</p>
            <p><strong>Days:</strong> ${days}</p>
        </div>
        ${balanceHtml}
        <div class="form-group">
            <label class="form-label">Remarks (optional)</label>
            <textarea id="approval-remarks" class="form-textarea" rows="2" placeholder="Add remarks..."></textarea>
        </div>
        <div class="card" style="margin-top:var(--space-4)">
            <div class="card-header"><h4 class="card-title" style="font-size:var(--text-sm)">${sigLabel}</h4></div>
            <div class="card-body">
                <canvas id="shared-sig-canvas" class="signature-canvas" width="500" height="120"></canvas>
                <div style="margin-top:var(--space-2);display:flex;gap:var(--space-2)">
                    <button class="btn btn-ghost btn-sm" id="shared-sig-clear">Clear</button>
                    <label class="btn btn-ghost btn-sm" style="cursor:pointer">
                        Upload Image
                        <input type="file" accept="image/*" id="shared-sig-upload" style="display:none">
                    </label>
                </div>
            </div>
        </div>
    `;

    const modal = openModal({
        title: `Review Application — ${appId}`,
        content,
        size: 'lg',
        footer: `
            <button class="btn btn-ghost btn-sm" id="modal-cancel">Cancel</button>
            <button class="btn btn-warning btn-sm" id="modal-return">Return</button>
            <button class="btn btn-danger btn-sm" id="modal-reject">Reject</button>
            <button class="btn btn-success btn-sm" id="modal-approve">${forwardLabel}</button>
        `,
    });

    // Initialize signature canvas
    initSharedSignatureCanvas('shared-sig-canvas', 'shared-sig-clear', 'shared-sig-upload');

    async function doAction(action) {
        const remarks = document.getElementById('approval-remarks')?.value || '';
        const approverName = user.name || user.fullName || '';

        const payload = {
            applicationId: appId,
            action,
            remarks,
            portal,
            approverName,
        };

        // Capture signature for approve action
        if (action === 'approved') {
            const canvas = document.getElementById('shared-sig-canvas');
            const sigData = canvas ? canvas.toDataURL('image/png') : '';

            if (portalUpper === 'ASDS') {
                payload.asdsOfficerName = approverName;
                if (sigData) payload.asdsOfficerSignature = sigData;
            } else if (portalUpper === 'SDS') {
                payload.sdsOfficerName = approverName;
                if (sigData) payload.sdsOfficerSignature = sigData;
            }
        }

        modal.close();
        try {
            const res = await fetch('/api/approve-leave', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            if (res.ok) {
                const label = action === 'approved'
                    ? (portalUpper === 'ASDS' ? 'recommended and forwarded to SDS' : 'approved')
                    : action === 'returned' ? 'returned' : 'rejected';
                toast.success(`Application ${label} successfully.`);
                if (onDone) onDone();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.error?.message || data.message || 'Failed to process.');
            }
        } catch { toast.error('Network error.'); }
    }

    document.getElementById('modal-cancel')?.addEventListener('click', () => modal.close());
    document.getElementById('modal-approve')?.addEventListener('click', () => doAction('approved'));
    document.getElementById('modal-return')?.addEventListener('click', () => doAction('returned'));
    document.getElementById('modal-reject')?.addEventListener('click', () => doAction('rejected'));
}

// ---------------------------------------------------------------------------
// Signature canvas (shared between ASDS/SDS)
// ---------------------------------------------------------------------------
function initSharedSignatureCanvas(canvasId, clearBtnId, uploadInputId) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let isDrawing = false;

    function getPos(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    }

    function startDraw(e) { e.preventDefault(); isDrawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
    function draw(e) { if (!isDrawing) return; e.preventDefault(); const p = getPos(e); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000'; ctx.lineTo(p.x, p.y); ctx.stroke(); canvas.classList.add('has-signature'); }
    function stopDraw() { isDrawing = false; }

    canvas.addEventListener('mousedown', startDraw);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDraw);
    canvas.addEventListener('mouseleave', stopDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove', draw, { passive: false });
    canvas.addEventListener('touchend', stopDraw);

    document.getElementById(clearBtnId)?.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.classList.remove('has-signature');
    });

    document.getElementById(uploadInputId)?.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const img = new Image();
        img.onload = () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
            const w = img.width * scale;
            const h = img.height * scale;
            ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
            canvas.classList.add('has-signature');
        };
        img.src = URL.createObjectURL(file);
    });
}

// ---------------------------------------------------------------------------
// Application detail modal
// ---------------------------------------------------------------------------
export function showDetailModal(app) {
    const history = app.approvalHistory || app.approval_history || [];
    let timeline = '';
    if (history.length > 0) {
        timeline = '<div style="margin-top:var(--space-4)"><strong>Approval History</strong>';
        for (const h of history) {
            const color = h.action === 'approved' ? 'var(--color-success)' : h.action === 'returned' ? 'var(--color-warning)' : 'var(--color-danger)';
            timeline += `<div style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-border)">
                <span style="color:${color};font-weight:bold">${esc(h.portal || '')} — ${esc(h.action || '')}</span>
                <div style="font-size:var(--text-xs);color:var(--color-text-muted)">${esc(h.approverName || '')} &middot; ${fmtDate(h.timestamp)}</div>
                ${h.remarks ? `<div style="font-size:var(--text-sm);margin-top:2px">${esc(h.remarks)}</div>` : ''}
            </div>`;
        }
        timeline += '</div>';
    }

    // Conditional leave-type details
    let leaveDetails = '';
    const lt = (app.leaveType || app.leave_type || '').toLowerCase();
    if (lt === 'leave_others' || lt === 'others') {
        const specify = app.otherLeaveSpecify || app.other_leave_specify || '';
        if (specify) leaveDetails += `<div style="grid-column:1/-1"><label class="form-label">Specify (Others)</label><div>${esc(specify)}</div></div>`;
    }

    // SO file attachment
    let soSection = '';
    const soPath = app.soFilePath || app.so_file_path || '';
    const soName = app.soFileName || app.so_file_name || '';
    if (soPath || soName) {
        const href = soPath || '#';
        const displayName = soName || 'Special Order (PDF)';
        soSection = `
            <div style="margin-top:var(--space-4);padding:var(--space-3);background:var(--color-gray-50);border-radius:var(--radius-md);border:1px solid var(--color-border)">
                <label class="form-label" style="margin-bottom:var(--space-2)">Attached Document (Special Order)</label>
                <div style="display:flex;align-items:center;gap:var(--space-2)">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" stroke-width="2"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <a href="${esc(href)}" target="_blank" rel="noopener" style="color:var(--color-primary);font-weight:var(--font-medium);text-decoration:underline">${esc(displayName)}</a>
                </div>
            </div>`;
    }

    openModal({
        title: `Application — ${app.id}`,
        content: `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                <div><label class="form-label">Application ID</label><div>${esc(app.id)}</div></div>
                <div><label class="form-label">Status</label><div>${statusBadge(app.status, app.currentApprover || app.current_approver)}</div></div>
                <div><label class="form-label">Employee</label><div>${esc(app.employeeName || app.employee_name || '')}</div></div>
                <div><label class="form-label">Leave Type</label><div>${esc(getLeaveTypeLabel(app.leaveType || app.leave_type))}</div></div>
                <div><label class="form-label">Period</label><div>${esc(fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to))}</div></div>
                <div><label class="form-label">Days</label><div>${fmtDays(app)}</div></div>
                <div><label class="form-label">Office</label><div>${esc(app.office || '')}</div></div>
                <div><label class="form-label">Filed</label><div>${esc(fmtDate(app.submittedAt || app.created_at))}</div></div>
                ${leaveDetails}
            </div>
            ${soSection}
            ${timeline}`,
        size: 'lg',
    });
}

// ---------------------------------------------------------------------------
// Render charts (reusable)
// ---------------------------------------------------------------------------
export function renderActivityBarChart(elId, apps, dateField, label, color) {
    const now = new Date();
    const months = [];
    const counts = [];
    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toLocaleString('en-US', { month: 'short' }));
        const m = d.getMonth(), y = d.getFullYear();
        counts.push(apps.filter(a => {
            const dt = new Date(a[dateField] || a.updatedAt || a.updated_at || '');
            return dt.getMonth() === m && dt.getFullYear() === y;
        }).length);
    }
    return createBarChart({ el: elId, labels: months, datasets: [{ label, data: counts, color }] });
}

export function renderTypesDoughnut(elId, totalElId, apps) {
    const typeCounts = {};
    for (const app of apps) {
        const type = getLeaveTypeLabel(app.leaveType || app.leave_type);
        typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
    const total = Object.values(typeCounts).reduce((a, b) => a + b, 0);
    setText(totalElId, total);
    return createDoughnutChart({
        el: elId,
        labels: Object.keys(typeCounts),
        data: Object.values(typeCounts),
        colors: ['#1565c0', '#c62828', '#e65100', '#6a1b9a', '#2e7d32', '#ff8f00', '#283593', '#00838f'],
    });
}

export function renderReportCharts(apps, statusElId, officeElId) {
    const charts = {};

    // Status
    const statusCounts = {};
    for (const a of apps) { const s = a.status || 'pending'; statusCounts[s] = (statusCounts[s] || 0) + 1; }
    charts.status = createBarChart({
        el: statusElId,
        labels: Object.keys(statusCounts),
        datasets: [{ label: 'Count', data: Object.values(statusCounts), colors: Object.keys(statusCounts).map(s => {
            if (s === 'approved') return '#2e7d32';
            if (s === 'pending') return '#ff8f00';
            if (s === 'returned') return '#e65100';
            return '#c62828';
        }) }],
        dimOnHover: true,
    });

    // Office
    const officeCounts = {};
    for (const a of apps) { const o = a.office || 'Unknown'; officeCounts[o] = (officeCounts[o] || 0) + 1; }
    const sorted = Object.entries(officeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    charts.office = createBarChart({
        el: officeElId,
        labels: sorted.map(e => e[0].length > 25 ? e[0].substring(0, 25) + '...' : e[0]),
        datasets: [{ label: 'Applications', data: sorted.map(e => e[1]), color: '#546e7a' }],
        horizontal: true,
    });

    return charts;
}

// ---------------------------------------------------------------------------
// Create tabs for approval portal
// ---------------------------------------------------------------------------
export function createApprovalTabs(config) {
    return createTabs({
        el: '#dashboard-tabs',
        tabs: config.tabs,
        activeTab: 'overview',
        onChange: (tabId) => {
            if (config.sidebar) config.sidebar.setActive(tabId);
            if (config.onTabChange) config.onTabChange(tabId);
        },
    });
}
