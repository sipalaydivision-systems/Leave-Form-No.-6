/**
 * SDS Dashboard — Schools Division Superintendent portal.
 *
 * SDS is the final approver in the chain. Approved applications trigger
 * leave card deductions. SDS can also save Form No. 6 as PDF.
 */

import {
    fetchUser, setupApprovalSidebar, createApprovalTabs,
    showApprovalModal, showDetailModal, renderActivityBarChart,
    renderTypesDoughnut, renderReportCharts, destroyChart,
    toast, esc, fmtDate, fmtDateRange, fmt, fmtDays, toNum, setText, statusBadge,
    createDataTable, renderEmptyState, openModal,
} from './dashboard-approval-shared.js';
import { initLeaveCalendar } from './leave-calendar-shared.js';

const PORTAL = 'SDS';
const ROLE_COLOR = '#6a1b9a';

let user = null;
let sidebar = null;
let tabs = null;
let allApps = [];
let pendingTable = null;
let decidedTable = null;
let activityChart = null;
let typesChart = null;
let reportCharts = {};
let leaveCalendar = null;
let top5Loaded = false;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        user = await fetchUser({ allowedRoles: ['sds', 'it'], loginUrl: '/sds-login' });
        if (!user) return;

        initLogoutSystem({ storage: 'local', redirectUrl: '/sds-login' });

        tabs = createApprovalTabs({
            tabs: [
                { id: 'overview', label: 'Overview' },
                { id: 'pending', label: 'Pending', badge: 0 },
                { id: 'decided', label: 'Decided' },
                { id: 'calendar', label: 'Calendar' },
                { id: 'reports', label: 'Reports' },
            ],
            onTabChange,
        });

        sidebar = setupApprovalSidebar({
            userName: user.name || user.fullName || 'SDS',
            userEmail: user.email || '',
            roleLabel: 'Schools Division Superintendent',
            roleColor: ROLE_COLOR,
            pendingTabId: 'pending',
            pendingLabel: 'Pending Decision',
            processedTabId: 'decided',
            processedLabel: 'Decided',
            tabs,
        });

        const firstName = user.firstName || user.first_name || (user.name || '').split(' ')[0] || 'SDS';
        const title = document.getElementById('topbar-title');
        if (title) title.textContent = `SDS Dashboard — ${firstName}`;

        // Hero
        const h = new Date().getHours();
        const greeting = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
        setText('hero-greeting', `${greeting}, ${firstName}`);
        const dateParts = [user.office, new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })];
        setText('hero-date', dateParts.filter(Boolean).join(' · '));

        document.getElementById('btn-refresh')?.addEventListener('click', refreshAll);
        document.getElementById('btn-view-all-pending')?.addEventListener('click', () => {
            tabs.setActive('pending'); sidebar.setActive('pending');
        });

        await loadOverviewData();
    } catch (err) {
        console.error('[SDS] Init failed:', err);
        toast.error('Failed to load dashboard.');
    }
}

function onTabChange(tabId) {
    switch (tabId) {
        case 'pending': if (!pendingTable) renderPendingTable(); break;
        case 'decided': if (!decidedTable) renderDecidedTable(); break;
        case 'calendar':
            if (!leaveCalendar) {
                leaveCalendar = initLeaveCalendar({ el: '#calendar-content', role: 'sds', email: user.email });
            }
            leaveCalendar.load();
            break;
        case 'reports':
            if (!top5Loaded) { loadTop5Utilization(); top5Loaded = true; }
            destroyChart(reportCharts.status);
            destroyChart(reportCharts.office);
            reportCharts = renderReportCharts(allApps, '#chart-status', '#chart-office');
            break;
    }
}

async function refreshAll() {
    toast.info('Refreshing...');
    pendingTable = null; decidedTable = null;
    await loadOverviewData();
    toast.success('Data refreshed.');
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
async function loadOverviewData() {
    const res = await fetch(`/api/portal-applications/${PORTAL}?t=${Date.now()}`);
    if (!res.ok) { toast.error('Failed to load applications.'); return; }
    const data = await res.json();
    allApps = data.applications || data || [];

    const pending = allApps.filter(a =>
        a.status === 'pending' && (a.currentApprover || a.current_approver || '').toUpperCase() === PORTAL
    );
    const now = new Date();
    const thisMonth = allApps.filter(a => {
        const d = new Date(a.sdsApprovedAt || a.sds_approved_at || a.updatedAt || '');
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && a.status === 'approved';
    });
    const disapproved = allApps.filter(a => a.status === 'rejected' || a.status === 'disapproved').length;

    setText('stat-pending', pending.length);
    setText('stat-approved', thisMonth.length);
    setText('stat-disapproved', disapproved);
    setText('stat-total', allApps.length);

    // Hero metric
    setText('hero-metric', pending.length);

    tabs.updateBadge('pending', pending.length);
    sidebar.updateBadge('pending', pending.length);

    renderRecentPending(pending.slice(0, 5));

    destroyChart(activityChart);
    activityChart = renderActivityBarChart('#chart-activity', allApps, 'sdsApprovedAt', 'Decided', ROLE_COLOR);

    destroyChart(typesChart);
    typesChart = renderTypesDoughnut('#chart-types', 'chart-types-total', allApps);
}

function renderRecentPending(apps) {
    const container = document.getElementById('recent-pending-list');
    if (!container) return;

    if (apps.length === 0) {
        renderEmptyState(container, { icon: 'inbox', title: 'No Pending Decisions', description: 'All applications have been decided.' });
        return;
    }

    let html = '<div class="table-container"><table class="data-table"><thead><tr>';
    html += '<th>Employee</th><th>Leave Type</th><th>Period</th><th>Days</th><th>Actions</th>';
    html += '</tr></thead><tbody>';
    for (const app of apps) {
        html += `<tr>
            <td>${esc(app.employeeName || app.employee_name || '')}</td>
            <td>${esc(getLeaveTypeLabel(app.leaveType || app.leave_type))}</td>
            <td>${esc(fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to))}</td>
            <td>${fmtDays(app)}</td>
            <td><div class="cell-actions">
                <button class="btn btn-success btn-sm btn-approve" data-id="${esc(app.id)}">Approve</button>
                <button class="btn btn-ghost btn-sm btn-view" data-id="${esc(app.id)}">View</button>
            </div></td></tr>`;
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.addEventListener('click', (e) => {
        const aBtn = e.target.closest('.btn-approve');
        if (aBtn) { const a = allApps.find(x => x.id === aBtn.dataset.id); if (a) showApprovalModal(a, PORTAL, user, refreshAll); return; }
        const vBtn = e.target.closest('.btn-view');
        if (vBtn) { const a = allApps.find(x => x.id === vBtn.dataset.id); if (a) showDetailModal(a); }
    });
}

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------
function renderPendingTable() {
    const pending = allApps.filter(a =>
        a.status === 'pending' && (a.currentApprover || a.current_approver || '').toUpperCase() === PORTAL
    );

    pendingTable = createDataTable({
        el: '#pending-table',
        columns: [
            { key: 'employee', label: 'Employee', sortable: true },
            { key: 'leaveType', label: 'Leave Type', sortable: true },
            { key: 'dates', label: 'Period' },
            { key: 'numDays', label: 'Days', sortable: true, type: 'number' },
            { key: 'office', label: 'Office', sortable: true },
            { key: 'actions', label: 'Actions', render: (v, r) => `<div class="cell-actions">
                <button class="btn btn-success btn-sm btn-approve" data-id="${esc(r.id)}">Approve</button>
                <button class="btn btn-danger btn-sm btn-reject" data-id="${esc(r.id)}">Disapprove</button>
                <button class="btn btn-ghost btn-sm btn-view" data-id="${esc(r.id)}">View</button>
            </div>` },
        ],
        data: pending.map(a => ({
            id: a.id, employee: a.employeeName || a.employee_name || '',
            leaveType: getLeaveTypeLabel(a.leaveType || a.leave_type),
            dates: fmtDateRange(a.dateFrom || a.date_from, a.dateTo || a.date_to),
            numDays: toNum(a.numDays || a.num_days), office: a.office || '', _raw: a,
        })),
        searchable: true, searchKeys: ['employee', 'leaveType', 'office'], pageSize: 15,
        emptyTitle: 'No Pending Decisions', emptyMessage: 'All caught up!',
    });

    bindTableActions('#pending-table');
}

function renderDecidedTable() {
    const processed = allApps.filter(a =>
        a.status !== 'pending' || (a.currentApprover || a.current_approver || '').toUpperCase() !== PORTAL
    );

    decidedTable = createDataTable({
        el: '#decided-table',
        columns: [
            { key: 'employee', label: 'Employee', sortable: true },
            { key: 'leaveType', label: 'Leave Type', sortable: true },
            { key: 'dates', label: 'Period' },
            { key: 'numDays', label: 'Days', sortable: true, type: 'number' },
            { key: 'status', label: 'Status', sortable: true, render: (v, r) => statusBadge(v, r.currentApprover) },
            { key: 'actions', label: '', render: (v, r) => {
                let btns = `<button class="btn btn-ghost btn-sm btn-view" data-id="${esc(r.id)}">View</button>`;
                if (r.status === 'approved') {
                    btns += ` <button class="btn btn-primary btn-sm btn-download" data-id="${esc(r.id)}">Download PDF</button>`;
                }
                return `<div class="cell-actions">${btns}</div>`;
            }},
        ],
        data: processed.map(a => ({
            id: a.id, employee: a.employeeName || a.employee_name || '',
            leaveType: getLeaveTypeLabel(a.leaveType || a.leave_type),
            dates: fmtDateRange(a.dateFrom || a.date_from, a.dateTo || a.date_to),
            numDays: toNum(a.numDays || a.num_days),
            status: a.status || 'pending', currentApprover: a.currentApprover || a.current_approver || '', _raw: a,
        })),
        searchable: true, searchKeys: ['employee', 'leaveType'], pageSize: 15,
        filters: [{ key: 'status', label: 'Status', options: ['All', 'pending', 'approved', 'returned', 'rejected'] }],
        emptyTitle: 'No Decided Applications', emptyMessage: 'No applications have been decided yet.',
        onRowClick: (row) => { const a = allApps.find(x => x.id === row.id); if (a) showDetailModal(a); },
    });

    bindTableActions('#decided-table');
}

// ---------------------------------------------------------------------------
// Top 5 Leave Utilization
// ---------------------------------------------------------------------------
async function loadTop5Utilization() {
    const container = document.getElementById('top5-utilization');
    if (!container) return;
    try {
        const res = await fetch('/api/leave-utilization/top5');
        if (!res.ok) { container.innerHTML = '<p style="padding:var(--space-4);color:var(--color-text-muted)">Unable to load data.</p>'; return; }
        const data = await res.json();
        const top5 = data.top5 || [];
        if (top5.length === 0) {
            renderEmptyState(container, { icon: 'document', title: 'No Data', description: 'No approved leave applications yet.' });
            return;
        }
        let html = '<div class="table-container"><table class="data-table"><thead><tr>';
        html += '<th>Rank</th><th>Employee</th><th>Office</th><th>Applications</th><th>Total Days</th>';
        html += '</tr></thead><tbody>';
        const medals = ['', '#FFD700', '#C0C0C0', '#CD7F32'];
        for (const e of top5) {
            const medal = e.rank <= 3 ? `<span style="color:${medals[e.rank]};font-weight:bold">#${e.rank}</span>` : `#${e.rank}`;
            html += `<tr>
                <td>${medal}</td>
                <td>${esc(e.name)}</td>
                <td>${esc(e.office)}</td>
                <td>${e.count}</td>
                <td><strong>${e.totalDays}</strong></td>
            </tr>`;
        }
        html += '</tbody></table></div>';
        container.innerHTML = html;
    } catch { container.innerHTML = '<p style="padding:var(--space-4);color:var(--color-text-muted)">Failed to load utilization data.</p>'; }
}

function bindTableActions(selector) {
    document.querySelector(selector)?.addEventListener('click', (e) => {
        const aBtn = e.target.closest('.btn-approve');
        if (aBtn) { e.stopPropagation(); const a = allApps.find(x => x.id === aBtn.dataset.id); if (a) showApprovalModal(a, PORTAL, user, refreshAll); return; }
        const rBtn = e.target.closest('.btn-reject');
        if (rBtn) { e.stopPropagation(); const a = allApps.find(x => x.id === rBtn.dataset.id); if (a) showApprovalModal(a, PORTAL, user, refreshAll); return; }
        const vBtn = e.target.closest('.btn-view');
        if (vBtn) { e.stopPropagation(); const a = allApps.find(x => x.id === vBtn.dataset.id); if (a) showDetailModal(a); return; }
        const dBtn = e.target.closest('.btn-download');
        if (dBtn) { e.stopPropagation(); window.open(`/api/form-no6/${encodeURIComponent(dBtn.dataset.id)}`, '_blank'); }
    });
}
