/**
 * ASDS Dashboard — Assistant Schools Division Superintendent portal.
 *
 * ASDS recommends leave applications and forwards them to SDS for final decision.
 */

import {
    fetchUser, setupApprovalSidebar, createApprovalTabs,
    showApprovalModal, showDetailModal, renderActivityBarChart,
    renderTypesDoughnut, renderReportCharts, destroyChart,
    toast, esc, fmtDate, fmtDateRange, fmt, fmtDays, toNum, setText, statusBadge,
    createDataTable, renderEmptyState,
} from './dashboard-approval-shared.js';
import { initLeaveCalendar } from './leave-calendar-shared.js';

const PORTAL = 'ASDS';
const ROLE_COLOR = '#DC2626';

let user = null;
let sidebar = null;
let tabs = null;
let allApps = [];
let pendingTable = null;
let recommendedTable = null;
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
        user = await fetchUser({ allowedRoles: ['asds', 'it'], loginUrl: '/asds-login' });
        if (!user) return;

        initLogoutSystem({ storage: 'local', redirectUrl: '/asds-login' });

        tabs = createApprovalTabs({
            tabs: [
                { id: 'overview', label: 'Overview' },
                { id: 'pending', label: 'Pending', badge: 0 },
                { id: 'recommended', label: 'Recommended' },
                { id: 'calendar', label: 'Calendar' },
                { id: 'reports', label: 'Reports' },
            ],
            onTabChange,
        });

        sidebar = setupApprovalSidebar({
            userName: user.name || user.fullName || 'ASDS',
            userEmail: user.email || '',
            roleLabel: 'Asst. Schools Division Superintendent',
            roleColor: ROLE_COLOR,
            pendingTabId: 'pending',
            pendingLabel: 'Pending Review',
            processedTabId: 'recommended',
            processedLabel: 'Recommended',
            tabs,
        });

        const firstName = user.firstName || user.first_name || (user.name || '').split(' ')[0] || 'ASDS';
        const title = document.getElementById('topbar-title');
        if (title) title.textContent = `ASDS Dashboard — ${firstName}`;

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
        console.error('[ASDS] Init failed:', err);
        toast.error('Failed to load dashboard.');
    }
}

function onTabChange(tabId) {
    switch (tabId) {
        case 'pending': if (!pendingTable) renderPendingTable(); break;
        case 'recommended': if (!recommendedTable) renderRecommendedTable(); break;
        case 'calendar':
            if (!leaveCalendar) {
                leaveCalendar = initLeaveCalendar({ el: '#calendar-content', role: 'asds', email: user.email });
            }
            leaveCalendar.load();
            break;
        case 'reports':
            if (!top5Loaded) { loadReportsTrendChart(allApps); top5Loaded = true; }
            destroyChart(reportCharts.status);
            destroyChart(reportCharts.office);
            reportCharts = renderReportCharts(allApps, '#chart-status', '#chart-office');
            break;
    }
}

async function refreshAll() {
    toast.info('Refreshing...');
    pendingTable = null; recommendedTable = null;
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
        const d = new Date(a.asdsApprovedAt || a.asds_approved_at || a.updatedAt || '');
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear() && a.status !== 'pending';
    });

    const approved = allApps.filter(a => a.status === 'approved');
    const totalDays = approved.reduce((s, a) => s + (parseFloat(a.numDays || a.num_days) || 0), 0);
    const approvalRate = allApps.length ? ((approved.length / allApps.length) * 100).toFixed(1) : '0';
    const avgDays = approved.length ? (totalDays / approved.length).toFixed(1) : '0';

    // KPI strip
    setText('kpi-pending', pending.length);
    setText('kpi-recommended', thisMonth.length);
    setText('kpi-total', allApps.length);
    setText('kpi-approval-rate', approvalRate + '%');
    setText('kpi-total-days', totalDays.toFixed(1));
    setText('kpi-avg-days', avgDays);

    // Hero metric
    setText('hero-metric', pending.length);

    tabs.updateBadge('pending', pending.length);
    sidebar.updateBadge('pending', pending.length);

    // Row 2: Charts
    destroyChart(activityChart);
    activityChart = renderActivityBarChart('#chart-activity', allApps, 'asdsApprovedAt', 'Processed', ROLE_COLOR);

    renderPipeline(allApps);

    // Row 3: Doughnut + Top 5
    destroyChart(typesChart);
    typesChart = renderTypesDoughnut('#chart-types', 'chart-types-total', allApps);

    loadTop5Overview();

    // Row 4: Office breakdown + Recent pending
    renderOfficeBreakdown(allApps);
    renderRecentPending(pending.slice(0, 5));
}

// ---------------------------------------------------------------------------
// Approval Pipeline (funnel visualization)
// ---------------------------------------------------------------------------
function renderPipeline(apps) {
    const el = document.getElementById('pipeline-chart');
    if (!el) return;

    const statusMap = [
        { key: 'total', label: 'Total', color: '#1565c0' },
        { key: 'pending', label: 'Pending', color: '#ff8f00' },
        { key: 'approved', label: 'Approved', color: '#2e7d32' },
        { key: 'returned', label: 'Returned', color: '#f9a825' },
        { key: 'rejected', label: 'Rejected', color: '#c62828' },
    ];

    const counts = {
        total: apps.length,
        pending: apps.filter(a => a.status === 'pending').length,
        approved: apps.filter(a => a.status === 'approved').length,
        returned: apps.filter(a => a.status === 'returned').length,
        rejected: apps.filter(a => a.status === 'rejected' || a.status === 'disapproved').length,
    };

    const max = counts.total || 1;
    let html = '<div class="pipeline-header">Application flow across all statuses</div>';
    for (const s of statusMap) {
        const pct = ((counts[s.key] / max) * 100).toFixed(0);
        const pctOfTotal = counts.total ? ((counts[s.key] / counts.total) * 100).toFixed(0) : 0;
        html += `<div class="pipeline-bar-row">
            <span class="pipeline-label">${s.label}: ${counts[s.key]}</span>
            <div class="pipeline-track">
                <div class="pipeline-fill" style="width:${pct}%;background:${s.color}">${pct > 15 ? pctOfTotal + '%' : ''}</div>
            </div>
            <span class="pipeline-count">${pctOfTotal}%</span>
        </div>`;
    }
    el.innerHTML = html;
}

// ---------------------------------------------------------------------------
// Top 5 Leave Utilization (overview section)
// ---------------------------------------------------------------------------
async function loadTop5Overview() {
    const el = document.getElementById('top5-overview');
    if (!el) return;
    try {
        const year = new Date().getFullYear();
        const res = await fetch(`/api/leave-utilization/top5?year=${year}`);
        if (!res.ok) { el.innerHTML = '<p style="padding:var(--space-4);color:var(--color-text-muted)">Unable to load.</p>'; return; }
        const data = await res.json();
        const top5 = data.top5 || [];
        if (top5.length === 0) {
            renderEmptyState(el, { icon: 'document', title: 'No Data', description: 'No approved leaves this year.' });
            return;
        }
        const rankClass = ['', 'gold', 'silver', 'bronze'];
        let html = '<ul class="top5-list">';
        for (const e of top5) {
            const cls = rankClass[e.rank] || 'other';
            html += `<li class="top5-item">
                <div class="top5-rank ${cls}">${e.rank}</div>
                <div class="top5-info">
                    <div class="top5-name">${esc(e.name)}</div>
                    <div class="top5-office">${esc(e.office)}${e.position ? ' · ' + esc(e.position) : ''}</div>
                </div>
                <div style="text-align:right">
                    <div class="top5-days">${e.totalDays}</div>
                    <div class="top5-days-label">${e.count} app${e.count > 1 ? 's' : ''}</div>
                </div>
            </li>`;
        }
        html += '</ul>';
        el.innerHTML = html;
    } catch { el.innerHTML = '<p style="padding:var(--space-4);color:var(--color-text-muted)">Failed to load.</p>'; }
}

// ---------------------------------------------------------------------------
// Office Breakdown (horizontal bar chart)
// ---------------------------------------------------------------------------
function renderOfficeBreakdown(apps) {
    const el = document.getElementById('office-breakdown');
    if (!el) return;

    const byOffice = {};
    for (const a of apps) {
        const office = a.office || 'Unknown';
        byOffice[office] = (byOffice[office] || 0) + 1;
    }

    const sorted = Object.entries(byOffice).sort((a, b) => b[1] - a[1]).slice(0, 10);
    if (sorted.length === 0) {
        renderEmptyState(el, { icon: 'document', title: 'No Data', description: 'No applications yet.' });
        return;
    }

    const max = sorted[0][1];
    let html = '<ul class="hbar-list">';
    for (const [office, count] of sorted) {
        const pct = ((count / max) * 100).toFixed(0);
        html += `<li class="hbar-item">
            <span class="hbar-label">${esc(office)}</span>
            <div class="hbar-bar-wrap">
                <div class="hbar-bar" style="width:${pct}%;min-width:8px;background:${ROLE_COLOR}"></div>
                <span class="hbar-value">${count}</span>
            </div>
        </li>`;
    }
    html += '</ul>';
    el.innerHTML = html;
}

function renderRecentPending(apps) {
    const container = document.getElementById('recent-pending-list');
    if (!container) return;

    if (apps.length === 0) {
        renderEmptyState(container, { icon: 'inbox', title: 'No Pending Reviews', description: 'All applications have been processed.' });
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
                <button class="btn btn-success btn-sm btn-approve" data-id="${esc(app.id)}">Recommend</button>
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
                <button class="btn btn-success btn-sm btn-approve" data-id="${esc(r.id)}">Recommend</button>
                <button class="btn btn-warning btn-sm btn-return" data-id="${esc(r.id)}">Return</button>
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
        emptyTitle: 'No Pending Reviews', emptyMessage: 'All caught up!',
    });

    bindTableActions('#pending-table');
}

function renderRecommendedTable() {
    const processed = allApps.filter(a =>
        a.status !== 'pending' || (a.currentApprover || a.current_approver || '').toUpperCase() !== PORTAL
    );

    recommendedTable = createDataTable({
        el: '#recommended-table',
        columns: [
            { key: 'employee', label: 'Employee', sortable: true },
            { key: 'leaveType', label: 'Leave Type', sortable: true },
            { key: 'dates', label: 'Period' },
            { key: 'numDays', label: 'Days', sortable: true, type: 'number' },
            { key: 'status', label: 'Status', sortable: true, render: (v, r) => statusBadge(v, r.currentApprover) },
            { key: 'actions', label: '', render: (v, r) => `<button class="btn btn-ghost btn-sm btn-view" data-id="${esc(r.id)}">View</button>` },
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
        emptyTitle: 'No Processed Applications', emptyMessage: 'No applications have been processed yet.',
        onRowClick: (row) => { const a = allApps.find(x => x.id === row.id); if (a) showDetailModal(a); },
    });

    bindTableActions('#recommended-table');
}

// ---------------------------------------------------------------------------
// Leave Trend by Type (Reports)
// ---------------------------------------------------------------------------
async function loadReportsTrendChart(apps) {
    const select = document.getElementById('reports-trend-period-select');
    const container = document.getElementById('chart-reports-trend');
    if (!container) return;

    function renderTrend(period) {
        const typeMap = {};
        const now = new Date();
        const currentYear = now.getFullYear();
        const currentMonth = now.getMonth();

        // Filter and aggregate data based on period
        apps.forEach(app => {
            if (app.status !== 'approved') return;
            const approvalDate = new Date(app.asdsApprovedAt || app.asds_approved_at || app.updatedAt || '');
            if (isNaN(approvalDate.getTime())) return;

            let include = false;
            let label = '';

            if (period === 'weekly') {
                const weekAgo = new Date(now);
                weekAgo.setDate(weekAgo.getDate() - 7);
                if (approvalDate >= weekAgo) {
                    const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][approvalDate.getDay()];
                    label = dayOfWeek + ' ' + (approvalDate.getMonth() + 1) + '/' + approvalDate.getDate();
                    include = true;
                }
            } else if (period === 'monthly') {
                if (approvalDate.getFullYear() === currentYear && approvalDate.getMonth() === currentMonth) {
                    label = (approvalDate.getMonth() + 1) + '/' + approvalDate.getFullYear();
                    include = true;
                }
            } else if (period === 'yearly') {
                label = String(approvalDate.getFullYear());
                include = true;
            }

            if (include) {
                const leaveType = (app.leaveType || 'Others').replace('leave_', '').toUpperCase();
                const days = parseFloat(app.numDays || app.num_days) || 0;
                if (!typeMap[leaveType]) typeMap[leaveType] = 0;
                typeMap[leaveType] += days;
            }
        });

        const types = Object.keys(typeMap);
        if (types.length === 0) {
            container.innerHTML = '<p style="padding:var(--space-4);text-align:center;color:var(--color-text-muted)">No data for selected period</p>';
            return;
        }

        const colors = ['#FF9800', '#FF6B6B', '#4ECDC4', '#45B7D1', '#FFA07A', '#98D8C8', '#F7DC6F'];
        const datasets = [{
            label: 'Approved Leave Days',
            data: types.map(t => typeMap[t]),
            backgroundColor: types.map((_, i) => colors[i % colors.length]),
            borderColor: '#fff',
            borderWidth: 2,
        }];

        destroyChart(reportCharts.trend);
        reportCharts.trend = renderTypesDoughnut(container, null, {
            labels: types,
            datasets,
            options: { responsive: true, maintainAspectRatio: true }
        });
    }

    if (select) {
        select.addEventListener('change', () => renderTrend(select.value));
    }
    renderTrend(select?.value || 'monthly');
}

function bindTableActions(selector) {
    document.querySelector(selector)?.addEventListener('click', (e) => {
        const aBtn = e.target.closest('.btn-approve');
        if (aBtn) { e.stopPropagation(); const a = allApps.find(x => x.id === aBtn.dataset.id); if (a) showApprovalModal(a, PORTAL, user, refreshAll); return; }
        const rBtn = e.target.closest('.btn-return');
        if (rBtn) { e.stopPropagation(); const a = allApps.find(x => x.id === rBtn.dataset.id); if (a) showApprovalModal(a, PORTAL, user, refreshAll); return; }
        const vBtn = e.target.closest('.btn-view');
        if (vBtn) { e.stopPropagation(); const a = allApps.find(x => x.id === vBtn.dataset.id); if (a) showDetailModal(a); }
    });
}
