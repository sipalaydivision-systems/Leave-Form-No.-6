/**
 * Employee Dashboard — Main application module.
 *
 * Powers the employee portal: leave balances, charts, applications table,
 * leave card history, sidebar navigation, and file-leave actions.
 */

import { initSidebar, ICONS } from '../components/sidebar.js';
import { createTabs } from '../components/tabs.js';
import { createDataTable } from '../components/table.js';
import { createLineChart, createDoughnutChart, destroyChart } from '../components/chart-wrapper.js';
import { toast } from '../components/toast.js';
import { openModal, confirmModal } from '../components/modal.js';
import { renderEmptyState } from '../components/empty-state.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let user = null;
let sidebar = null;
let tabs = null;
let applicationsTable = null;
let transactionsTable = null;
let usageTable = null;
let usageChart = null;
let balanceChart = null;
let applications = [];
let leaveCredits = null;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        user = await fetchUser();
        if (!user) return;

        initLogoutSystem({ storage: 'session', redirectUrl: '/login' });

        setupSidebar();
        setupTabs();
        setupTopbar();

        // Load overview data immediately
        await loadOverviewData();
    } catch (err) {
        console.error('[Dashboard] Init failed:', err);
        toast.error('Failed to load dashboard. Please refresh.');
    }
}

// ---------------------------------------------------------------------------
// Auth — Fetch current user via /api/me
// ---------------------------------------------------------------------------
async function fetchUser() {
    const res = await fetch('/api/me');
    if (!res.ok) return null;
    const data = await res.json();
    return data.user || data;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------
function setupSidebar() {
    sidebar = initSidebar({
        el: '#sidebar',
        profile: {
            name: user.name || user.fullName || 'Employee',
            role: 'Employee',
        },
        roleColor: '#003366',
        activeId: 'overview',
        sections: [
            {
                title: 'Dashboard',
                links: [
                    { id: 'overview', label: 'Overview', icon: ICONS.home },
                    { id: 'applications', label: 'My Applications', icon: ICONS.clipboardList, badge: 0 },
                    { id: 'leavecard', label: 'Leave Card', icon: ICONS.creditCard },
                    { id: 'calendar', label: 'Leave Calendar', icon: ICONS.calendar },
                ],
            },
        ],
        footerLinks: [
            { id: 'help', label: 'Help Center', icon: ICONS.helpCircle, href: '/help' },
            { id: 'logout', label: 'Logout', icon: ICONS.logout },
        ],
        onNavigate: (linkId) => {
            if (linkId === 'logout') {
                window.logout();
                return;
            }
            if (linkId === 'help') return; // href handles it
            tabs.setActive(linkId);
        },
        onProfileClick: () => showProfileModal(),
    });

    // Hamburger toggle
    const hamburger = document.getElementById('hamburger-btn');
    if (hamburger) {
        hamburger.addEventListener('click', () => sidebar.toggleMobile());
    }

    // Overlay close
    const overlay = document.querySelector('.sidebar-overlay');
    if (overlay) {
        overlay.addEventListener('click', () => sidebar.toggleMobile(false));
    }
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function setupTabs() {
    tabs = createTabs({
        el: '#dashboard-tabs',
        tabs: [
            { id: 'overview', label: 'Overview' },
            { id: 'applications', label: 'My Applications', badge: 0 },
            { id: 'leavecard', label: 'Leave Card' },
            { id: 'calendar', label: 'Calendar' },
        ],
        activeTab: 'overview',
        onChange: (tabId) => {
            sidebar.setActive(tabId);
            onTabChange(tabId);
        },
    });
}

function onTabChange(tabId) {
    switch (tabId) {
        case 'applications':
            if (!applicationsTable) loadApplications();
            break;
        case 'leavecard':
            if (!transactionsTable) loadLeaveCard();
            break;
    }
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------
function getGreeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function populateHero() {
    const firstName = user.firstName || user.first_name || (user.name || '').split(' ')[0] || '';
    const el = id => document.getElementById(id);
    const g = el('hero-greeting');
    if (g) g.textContent = `${getGreeting()}, ${firstName}`;
    const ctx = el('hero-date');
    if (ctx) {
        const parts = [user.office, new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })];
        ctx.textContent = parts.filter(Boolean).join(' · ');
    }
}

function setupTopbar() {
    // Update title with user name
    const title = document.getElementById('topbar-title');
    if (title) {
        const firstName = user.firstName || user.first_name || (user.name || '').split(' ')[0] || 'Dashboard';
        title.textContent = `Welcome, ${firstName}`;
    }

    populateHero();

    // File Leave button
    const btn = document.getElementById('btn-file-leave');
    if (btn) {
        btn.addEventListener('click', () => {
            window.location.href = '/leave-form';
        });
    }

    // View All applications button
    const viewAllBtn = document.getElementById('btn-view-all-apps');
    if (viewAllBtn) {
        viewAllBtn.addEventListener('click', () => {
            tabs.setActive('applications');
            sidebar.setActive('applications');
        });
    }
}

// ---------------------------------------------------------------------------
// Overview Data
// ---------------------------------------------------------------------------
async function loadOverviewData() {
    const email = user.email;

    // Fetch balances and applications in parallel
    const [creditsRes, appsRes] = await Promise.all([
        fetch(`/api/leave-credits?employeeId=${encodeURIComponent(email)}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/my-applications/${encodeURIComponent(email)}`).then(r => r.ok ? r.json() : null),
    ]);

    // Leave credits
    if (creditsRes?.success && creditsRes.credits) {
        leaveCredits = creditsRes.credits;
        renderBalanceCards(leaveCredits);
        renderBalanceChart(leaveCredits);
    }

    // Applications
    if (appsRes?.success && appsRes.applications) {
        applications = appsRes.applications;
        renderRecentApps(applications);
        renderUsageChart(applications);

        // Update badge counts
        const pendingCount = applications.filter(a =>
            a.status === 'pending' || a.status === 'returned'
        ).length;
        tabs.updateBadge('applications', pendingCount);
        sidebar.updateBadge('applications', pendingCount);
    }
}

// ---------------------------------------------------------------------------
// Balance Cards
// ---------------------------------------------------------------------------
function renderBalanceCards(credits) {
    const vlEarned = toNum(credits.vacationLeaveEarned || credits.vacation_leave_earned);
    const vlSpent = toNum(credits.vacationLeaveSpent || credits.vacation_leave_spent);
    const slEarned = toNum(credits.sickLeaveEarned || credits.sick_leave_earned);
    const slSpent = toNum(credits.sickLeaveSpent || credits.sick_leave_spent);
    const flEarned = toNum(credits.forceLeaveEarned || credits.force_leave_earned || 5);
    const flSpent = toNum(credits.forceLeaveSpent || credits.force_leave_spent);
    const splEarned = toNum(credits.splEarned || credits.spl_earned || 3);
    const splSpent = toNum(credits.splSpent || credits.spl_spent);
    const wlEarned = toNum(credits.wellnessEarned || credits.wellness_earned || 3);
    const wlSpent = toNum(credits.wellnessSpent || credits.wellness_spent);

    const vl = vlEarned - vlSpent;
    const sl = slEarned - slSpent;
    const fl = flEarned - flSpent;
    const spl = splEarned - splSpent;
    const wl = wlEarned - wlSpent;

    setBalanceCard('vl', vl, `${fmt(vlEarned)} earned / ${fmt(vlSpent)} used`);
    setBalanceCard('sl', sl, `${fmt(slEarned)} earned / ${fmt(slSpent)} used`);
    setBalanceCard('fl', fl, `${fmt(flEarned)} allotted / ${fmt(flSpent)} used`);
    setBalanceCard('spl', spl, `${fmt(splEarned)} allotted / ${fmt(splSpent)} used`);
    setBalanceCard('wl', wl, `${fmt(wlEarned)} allotted / ${fmt(wlSpent)} used`);

    // Hero metric — total balance
    const totalBal = vl + sl + fl + spl + wl;
    const heroMetric = document.getElementById('hero-metric');
    if (heroMetric) heroMetric.textContent = fmt(totalBal);

    // As-of date
    const asOf = document.getElementById('balance-as-of');
    if (asOf) {
        asOf.textContent = `As of ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
    }
}

function setBalanceCard(type, value, detail) {
    const valEl = document.getElementById(`${type}-balance`);
    const detEl = document.getElementById(`${type}-detail`);
    if (valEl) valEl.textContent = fmt(value);
    if (detEl) detEl.textContent = detail;
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
function renderUsageChart(apps) {
    const container = document.getElementById('chart-usage');
    if (!container) return;

    destroyChart(usageChart);

    const currentYear = new Date().getFullYear();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Count approved leaves per month
    const vlByMonth = new Array(12).fill(0);
    const slByMonth = new Array(12).fill(0);

    const approvedApps = apps.filter(a => a.status === 'approved');
    for (const app of approvedApps) {
        const from = app.dateFrom || app.date_from;
        if (!from) continue;
        const d = new Date(from);
        if (d.getFullYear() !== currentYear) continue;
        const month = d.getMonth();
        const days = toNum(app.numDays || app.num_days || 1);
        const type = (app.leaveType || app.leave_type || '').toLowerCase();

        if (type.includes('vl') || type.includes('vacation') || type.includes('mandatory') || type.includes('mfl') || type.includes('force')) {
            vlByMonth[month] += days;
        } else if (type.includes('sl') || type.includes('sick')) {
            slByMonth[month] += days;
        } else {
            vlByMonth[month] += days; // Default to VL bucket
        }
    }

    usageChart = createLineChart({
        el: '#chart-usage',
        labels: months,
        datasets: [
            { label: 'VL/FL Used', data: vlByMonth, color: '#1565c0' },
            { label: 'SL Used', data: slByMonth, color: '#c62828' },
        ],
    });
}

function renderBalanceChart(credits) {
    const container = document.getElementById('chart-balance');
    if (!container) return;

    destroyChart(balanceChart);

    const vlBal = toNum(credits.vacationLeaveEarned || credits.vacation_leave_earned) -
                  toNum(credits.vacationLeaveSpent || credits.vacation_leave_spent);
    const slBal = toNum(credits.sickLeaveEarned || credits.sick_leave_earned) -
                  toNum(credits.sickLeaveSpent || credits.sick_leave_spent);
    const flBal = toNum(credits.forceLeaveEarned || credits.force_leave_earned || 5) -
                  toNum(credits.forceLeaveSpent || credits.force_leave_spent);
    const splBal = toNum(credits.splEarned || credits.spl_earned || 3) -
                   toNum(credits.splSpent || credits.spl_spent);
    const wlBal = toNum(credits.wellnessEarned || credits.wellness_earned || 3) -
                  toNum(credits.wellnessSpent || credits.wellness_spent);

    const total = Math.max(0, vlBal) + Math.max(0, slBal) + Math.max(0, flBal) + Math.max(0, splBal) + Math.max(0, wlBal);

    balanceChart = createDoughnutChart({
        el: '#chart-balance',
        labels: ['Vacation', 'Sick', 'Force', 'Special Privilege', 'Wellness'],
        data: [Math.max(0, vlBal), Math.max(0, slBal), Math.max(0, flBal), Math.max(0, splBal), Math.max(0, wlBal)],
        colors: ['#1565c0', '#c62828', '#e65100', '#6a1b9a', '#00838f'],
    });

    const totalEl = document.getElementById('total-balance');
    if (totalEl) totalEl.textContent = fmt(total);
}

// ---------------------------------------------------------------------------
// Recent Applications (Overview Tab)
// ---------------------------------------------------------------------------
function renderRecentApps(apps) {
    const container = document.getElementById('recent-apps-list');
    if (!container) return;

    const recent = apps.slice(0, 5);

    if (recent.length === 0) {
        renderEmptyState(container, {
            icon: 'document',
            title: 'No Applications Yet',
            description: 'File your first leave application to get started.',
        });
        return;
    }

    let html = '<div class="table-container"><table class="data-table"><thead><tr>';
    html += '<th>Leave Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Filed</th>';
    html += '</tr></thead><tbody>';

    for (const app of recent) {
        const type = getLeaveTypeLabel(app.leaveType || app.leave_type);
        const from = formatDate(app.dateFrom || app.date_from);
        const to = formatDate(app.dateTo || app.date_to);
        const days = toNum(app.numDays || app.num_days);
        const status = app.status || 'pending';
        const filed = formatDate(app.submittedAt || app.created_at || app.createdAt);

        html += `<tr data-app-id="${escapeHtml(app.id)}" style="cursor:pointer">`;
        html += `<td>${escapeHtml(type)}</td>`;
        html += `<td>${escapeHtml(from)}${to !== from ? ' - ' + escapeHtml(to) : ''}</td>`;
        html += `<td>${fmt(days)}</td>`;
        html += `<td>${statusBadge(status, app.currentApprover || app.current_approver)}</td>`;
        html += `<td>${escapeHtml(filed)}</td>`;
        html += '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Click to view details
    container.querySelectorAll('tr[data-app-id]').forEach(tr => {
        tr.addEventListener('click', () => showApplicationDetail(tr.dataset.appId));
    });
}

// ---------------------------------------------------------------------------
// My Applications Tab (Full Table)
// ---------------------------------------------------------------------------
async function loadApplications() {
    if (!user) return;

    const email = user.email;
    let apps = applications;

    if (apps.length === 0) {
        const res = await fetch(`/api/my-applications/${encodeURIComponent(email)}`);
        if (res.ok) {
            const data = await res.json();
            if (data.success) apps = data.applications || [];
            applications = apps;
        }
    }

    const tableData = apps.map(app => ({
        id: app.id,
        leaveType: getLeaveTypeLabel(app.leaveType || app.leave_type),
        dates: formatDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to),
        numDays: toNum(app.numDays || app.num_days),
        status: app.status || 'pending',
        currentApprover: app.currentApprover || app.current_approver || '',
        filed: formatDate(app.submittedAt || app.created_at || app.createdAt),
        _raw: app,
    }));

    applicationsTable = createDataTable({
        el: '#applications-table',
        columns: [
            { key: 'leaveType', label: 'Leave Type', sortable: true },
            { key: 'dates', label: 'Period', sortable: false },
            { key: 'numDays', label: 'Days', sortable: true, type: 'number' },
            {
                key: 'status', label: 'Status', sortable: true,
                render: (val, row) => statusBadge(val, row.currentApprover),
            },
            { key: 'filed', label: 'Date Filed', sortable: true, type: 'date' },
            {
                key: 'actions', label: '',
                render: (val, row) => {
                    let btns = `<button class="btn btn-ghost btn-sm btn-view-app" data-id="${escapeHtml(row.id)}">View</button>`;
                    if (row.status === 'pending' && (row.currentApprover === 'AO' || row.currentApprover === 'EMPLOYEE')) {
                        btns += ` <button class="btn btn-ghost btn-sm btn-cancel-app" data-id="${escapeHtml(row.id)}" style="color:var(--color-danger)">Cancel</button>`;
                    }
                    return `<div class="cell-actions">${btns}</div>`;
                },
            },
        ],
        data: tableData,
        searchable: true,
        searchKeys: ['leaveType', 'status', 'dates'],
        searchPlaceholder: 'Search applications...',
        pageSize: 10,
        filters: [
            {
                key: 'status',
                label: 'Status',
                options: ['All', 'pending', 'approved', 'returned', 'rejected', 'cancelled'],
            },
        ],
        emptyTitle: 'No Applications',
        emptyMessage: 'You haven\'t filed any leave applications yet.',
        onRowClick: (row) => showApplicationDetail(row.id),
    });

    // Bind action buttons via delegation
    const tableEl = document.getElementById('applications-table');
    if (tableEl) {
        tableEl.addEventListener('click', (e) => {
            const viewBtn = e.target.closest('.btn-view-app');
            if (viewBtn) {
                e.stopPropagation();
                showApplicationDetail(viewBtn.dataset.id);
                return;
            }
            const cancelBtn = e.target.closest('.btn-cancel-app');
            if (cancelBtn) {
                e.stopPropagation();
                cancelApplication(cancelBtn.dataset.id);
            }
        });
    }
}

// ---------------------------------------------------------------------------
// Leave Card Tab
// ---------------------------------------------------------------------------
async function loadLeaveCard() {
    if (!user) return;

    const email = user.email;
    const res = await fetch(`/api/employee-leavecard?employeeId=${encodeURIComponent(email)}`);

    if (!res.ok) {
        renderEmptyState(document.getElementById('transactions-table'), {
            icon: 'document',
            title: 'No Leave Card',
            description: 'Your leave card has not been created yet. Contact your Administrative Officer.',
        });
        return;
    }

    const data = await res.json();
    if (!data.success || !data.leavecard) return;

    const card = data.leavecard;

    // Transactions table
    const txns = card.transactions || [];
    const txnData = txns.map((t, idx) => ({
        id: idx,
        period: t.periodCovered || t.period_covered || '--',
        type: t.type || 'ADD',
        vlEarned: toNum(t.vlEarned || t.vl_earned),
        slEarned: toNum(t.slEarned || t.sl_earned),
        vlSpent: toNum(t.vlSpent || t.vl_spent),
        slSpent: toNum(t.slSpent || t.sl_spent),
        vlBalance: t.vlBalance !== undefined ? fmt(t.vlBalance) : (t.vl_balance !== undefined ? fmt(t.vl_balance) : '--'),
        slBalance: t.slBalance !== undefined ? fmt(t.slBalance) : (t.sl_balance !== undefined ? fmt(t.sl_balance) : '--'),
        date: formatDate(t.dateRecorded || t.date_recorded),
        source: t.source || '',
    }));

    transactionsTable = createDataTable({
        el: '#transactions-table',
        columns: [
            { key: 'period', label: 'Period', sortable: true },
            { key: 'type', label: 'Type', sortable: true, render: (v) => `<span class="badge badge-${v === 'DEDUCT' ? 'danger' : 'info'} badge-dot">${escapeHtml(v)}</span>` },
            { key: 'vlEarned', label: 'VL Earned', sortable: true, type: 'number' },
            { key: 'slEarned', label: 'SL Earned', sortable: true, type: 'number' },
            { key: 'vlSpent', label: 'VL Spent', sortable: true, type: 'number' },
            { key: 'slSpent', label: 'SL Spent', sortable: true, type: 'number' },
            { key: 'vlBalance', label: 'VL Bal', sortable: false },
            { key: 'slBalance', label: 'SL Bal', sortable: false },
            { key: 'date', label: 'Date', sortable: true, type: 'date' },
        ],
        data: txnData,
        searchable: true,
        searchKeys: ['period', 'source', 'type'],
        pageSize: 15,
        emptyTitle: 'No Transactions',
        emptyMessage: 'No leave credit transactions recorded yet.',
    });

    // Usage history table
    const usage = card.leaveUsageHistory || [];
    const usageData = usage.map((u, idx) => ({
        id: idx,
        leaveType: getLeaveTypeLabel(u.leaveType || u.leave_type),
        days: toNum(u.daysUsed || u.days_used),
        period: formatDateRange(u.periodFrom || u.period_from, u.periodTo || u.period_to),
        approved: formatDate(u.dateApproved || u.date_approved),
        approvedBy: u.approvedBy || u.approved_by || '',
        vlAfter: u.balanceAfterVl !== undefined ? fmt(u.balanceAfterVl) : (u.balance_after_vl !== undefined ? fmt(u.balance_after_vl) : '--'),
        slAfter: u.balanceAfterSl !== undefined ? fmt(u.balanceAfterSl) : (u.balance_after_sl !== undefined ? fmt(u.balance_after_sl) : '--'),
    }));

    usageTable = createDataTable({
        el: '#usage-table',
        columns: [
            { key: 'leaveType', label: 'Leave Type', sortable: true },
            { key: 'days', label: 'Days', sortable: true, type: 'number' },
            { key: 'period', label: 'Period', sortable: false },
            { key: 'approved', label: 'Date Approved', sortable: true, type: 'date' },
            { key: 'approvedBy', label: 'Approved By', sortable: true },
            { key: 'vlAfter', label: 'VL After', sortable: false },
            { key: 'slAfter', label: 'SL After', sortable: false },
        ],
        data: usageData,
        searchable: true,
        searchKeys: ['leaveType', 'approvedBy'],
        pageSize: 15,
        emptyTitle: 'No Usage History',
        emptyMessage: 'No leave usage recorded yet.',
    });
}

// ---------------------------------------------------------------------------
// Application Detail Modal
// ---------------------------------------------------------------------------
async function showApplicationDetail(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) {
        toast.warning('Application not found.');
        return;
    }

    const type = getLeaveTypeLabel(app.leaveType || app.leave_type);
    const status = app.status || 'pending';
    const approver = app.currentApprover || app.current_approver || '';
    const from = formatDate(app.dateFrom || app.date_from);
    const to = formatDate(app.dateTo || app.date_to);
    const days = toNum(app.numDays || app.num_days);
    const filed = formatDate(app.submittedAt || app.created_at || app.createdAt);
    const office = app.office || '';
    const position = app.position || '';

    // Build approval timeline
    const history = app.approvalHistory || app.approval_history || [];
    let timeline = '';
    if (history.length > 0) {
        timeline = '<div style="margin-top:var(--space-4)"><strong>Approval History</strong><div style="margin-top:var(--space-2)">';
        for (const h of history) {
            const icon = h.action === 'approved' ? '&#10003;' : h.action === 'returned' ? '&#8634;' : '&#10007;';
            const color = h.action === 'approved' ? 'var(--color-success)' : h.action === 'returned' ? 'var(--color-warning)' : 'var(--color-danger)';
            timeline += `<div style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);display:flex;gap:var(--space-3);align-items:center">`;
            timeline += `<span style="color:${color};font-size:18px;font-weight:bold">${icon}</span>`;
            timeline += `<div><div style="font-weight:var(--font-medium)">${escapeHtml(h.portal || '')} — ${escapeHtml(h.action || '')}</div>`;
            timeline += `<div style="font-size:var(--text-xs);color:var(--color-text-muted)">${escapeHtml(h.approverName || '')} &middot; ${formatDate(h.timestamp)}</div>`;
            if (h.remarks) timeline += `<div style="font-size:var(--text-sm);color:var(--color-text-secondary);margin-top:2px">${escapeHtml(h.remarks)}</div>`;
            timeline += '</div></div>';
        }
        timeline += '</div></div>';
    }

    const returnReason = app.returnReason || app.return_reason;
    const returnHtml = returnReason
        ? `<div style="margin-top:var(--space-3);padding:var(--space-3);background:var(--color-warning-bg);border-radius:var(--radius-md)"><strong>Return Reason:</strong> ${escapeHtml(returnReason)}</div>`
        : '';

    const content = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div><label class="form-label">Application ID</label><div>${escapeHtml(app.id)}</div></div>
            <div><label class="form-label">Status</label><div>${statusBadge(status, approver)}</div></div>
            <div><label class="form-label">Leave Type</label><div>${escapeHtml(type)}</div></div>
            <div><label class="form-label">No. of Days</label><div>${fmt(days)}</div></div>
            <div><label class="form-label">Period</label><div>${escapeHtml(from)} to ${escapeHtml(to)}</div></div>
            <div><label class="form-label">Date Filed</label><div>${escapeHtml(filed)}</div></div>
            <div><label class="form-label">Office</label><div>${escapeHtml(office)}</div></div>
            <div><label class="form-label">Position</label><div>${escapeHtml(position)}</div></div>
        </div>
        ${returnHtml}
        ${timeline}
    `;

    openModal({
        title: `Application: ${app.id}`,
        content,
        size: 'lg',
        footer: status === 'approved'
            ? '<button class="btn btn-primary btn-sm" onclick="window.__downloadForm6 && window.__downloadForm6()">Download Form No. 6</button>'
            : '',
    });

    // Download handler for approved apps
    if (status === 'approved') {
        window.__downloadForm6 = () => {
            window.open(`/api/form-no6/${encodeURIComponent(app.id)}`, '_blank');
        };
    }
}

// ---------------------------------------------------------------------------
// Cancel Application
// ---------------------------------------------------------------------------
function cancelApplication(appId) {
    confirmModal({
        title: 'Cancel Application',
        message: `Are you sure you want to cancel application ${appId}? This action cannot be undone.`,
        confirmText: 'Cancel Application',
        confirmClass: 'btn-danger',
        onConfirm: async () => {
            try {
                const res = await fetch(`/api/cancel-application/${encodeURIComponent(appId)}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                });
                if (res.ok) {
                    toast.success('Application cancelled successfully.');
                    // Refresh data
                    applications = [];
                    applicationsTable = null;
                    await loadOverviewData();
                    loadApplications();
                } else {
                    const data = await res.json().catch(() => ({}));
                    toast.error(data.error?.message || 'Failed to cancel application.');
                }
            } catch (err) {
                toast.error('Network error. Please try again.');
            }
        },
    });
}

// ---------------------------------------------------------------------------
// Profile Modal
// ---------------------------------------------------------------------------
function showProfileModal() {
    const content = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div><label class="form-label">Name</label><div>${escapeHtml(user.name || user.fullName)}</div></div>
            <div><label class="form-label">Email</label><div>${escapeHtml(user.email)}</div></div>
            <div><label class="form-label">Office</label><div>${escapeHtml(user.office || '--')}</div></div>
            <div><label class="form-label">Position</label><div>${escapeHtml(user.position || '--')}</div></div>
            <div><label class="form-label">Employee No.</label><div>${escapeHtml(user.employeeNo || user.employee_number || '--')}</div></div>
            <div><label class="form-label">Salary Grade</label><div>${escapeHtml(user.salaryGrade || user.salary_grade || '--')}-${escapeHtml(user.step || '--')}</div></div>
        </div>
    `;

    openModal({
        title: 'My Profile',
        content,
        size: 'md',
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toNum(v) {
    const n = parseFloat(v);
    return isNaN(n) ? 0 : n;
}

function fmt(v) {
    const n = toNum(v);
    return n % 1 === 0 ? String(n) : n.toFixed(3);
}

function formatDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatDateRange(from, to) {
    const f = formatDate(from);
    const t = formatDate(to);
    if (f === t || t === '--') return f;
    return `${f} - ${t}`;
}

function statusBadge(status, approver) {
    const s = (status || '').toLowerCase();
    let cls = 'badge-neutral';
    let label = status;

    switch (s) {
        case 'pending':
            cls = 'badge-pending';
            label = approver ? `Pending ${approver}` : 'Pending';
            break;
        case 'approved':
            cls = 'badge-approved';
            label = 'Approved';
            break;
        case 'returned':
            cls = 'badge-returned';
            label = 'Returned';
            break;
        case 'rejected':
        case 'disapproved':
            cls = 'badge-rejected';
            label = 'Rejected';
            break;
        case 'cancelled':
            cls = 'badge-neutral';
            label = 'Cancelled';
            break;
    }

    return `<span class="badge ${cls}">${escapeHtml(label)}</span>`;
}
