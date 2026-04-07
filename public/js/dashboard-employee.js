/**
 * Employee Dashboard — Main application module.
 *
 * Powers the employee portal: leave balances, charts, applications table,
 * leave card history, sidebar navigation, and file-leave actions.
 */

import { initSidebar, ICONS } from '../components/sidebar.js';
import { createTabs } from '../components/tabs.js';
import { createDataTable } from '../components/table.js';
import { toast } from '../components/toast.js';
import { openModal, confirmModal } from '../components/modal.js';
import { renderEmptyState } from '../components/empty-state.js';
import { initLeaveCalendar } from './leave-calendar-shared.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let user = null;
let sidebar = null;
let tabs = null;
let applicationsTable = null;
let transactionsTable = null;
let usageTable = null;
let applications = [];
let leaveCredits = null;
let leaveCalendar = null;

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
    if (!res.ok) { window.location.href = '/login'; return null; }
    const data = await res.json();
    const u = data.user || data;
    const role = (u.role || u.portal || '').toLowerCase();
    if (role !== 'user' && role !== 'employee') { window.location.href = '/login'; return null; }
    if (u.mustChangePassword) { window.location.href = '/change-password.html'; return null; }
    return u;
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
        roleColor: '#50DD24',
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
            if (linkId === 'leavecard') {
                window.location.href = `/employee-leavecard.html?email=${encodeURIComponent(user.email)}`;
                return;
            }
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
            if (tabId === 'leavecard') {
                window.location.href = `/employee-leavecard.html?email=${encodeURIComponent(user.email)}`;
                return;
            }
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
        case 'calendar':
            if (!leaveCalendar) {
                leaveCalendar = initLeaveCalendar({ el: '#calendar-content', role: 'user', email: user.email });
            }
            leaveCalendar.load();
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
    }

    // Applications
    if (appsRes?.success && appsRes.applications) {
        applications = appsRes.applications;
        renderRecentApps(applications);

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
    const wlEarned = toNum(credits.wellnessEarned || credits.wellness_earned || 5);
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
                    if (row.status === 'returned') {
                        btns += ` <button class="btn btn-primary btn-sm btn-resubmit-app" data-id="${escapeHtml(row.id)}">Resubmit</button>`;
                    }
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
            const resubmitBtn = e.target.closest('.btn-resubmit-app');
            if (resubmitBtn) {
                e.stopPropagation();
                showResubmitModal(resubmitBtn.dataset.id);
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
    const [res, creditsRes, ctoRes] = await Promise.all([
        fetch(`/api/employee-leavecard?employeeId=${encodeURIComponent(email)}`),
        fetch(`/api/leave-credits?employeeId=${encodeURIComponent(email)}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/cto-records?employeeId=${encodeURIComponent(email)}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    // Render balance cards
    const balContainer = document.getElementById('leavecard-balances');
    if (balContainer) {
        const cr = creditsRes?.credits || {};
        const ctoRecords = ctoRes?.records || [];
        const ctoBalance = ctoRecords.reduce((s, r) => s + toNum(r.balance != null ? r.balance : (toNum(r.daysGranted || r.days_granted) - toNum(r.daysUsed || r.days_used))), 0);

        const items = [
            { label: 'Vacation Leave', earned: toNum(cr.vacationLeaveEarned || cr.vacation_leave_earned), spent: toNum(cr.vacationLeaveSpent || cr.vacation_leave_spent), color: '#1565c0' },
            { label: 'Sick Leave', earned: toNum(cr.sickLeaveEarned || cr.sick_leave_earned), spent: toNum(cr.sickLeaveSpent || cr.sick_leave_spent), color: '#00897b' },
            { label: 'Force Leave', earned: toNum(cr.forceLeaveEarned || cr.mandatoryForced || 5), spent: toNum(cr.forceLeaveSpent), color: '#e65100' },
            { label: 'Special Privilege', earned: toNum(cr.splEarned || cr.spl || 3), spent: toNum(cr.splSpent), color: '#6a1b9a' },
            { label: 'Wellness Leave', earned: toNum(cr.wellnessEarned || cr.wellness_earned || 5), spent: toNum(cr.wellnessSpent || cr.wellness_spent), color: '#2e7d32' },
            { label: 'CTO', earned: ctoBalance, spent: 0, color: '#455a64' },
        ];

        balContainer.innerHTML = items.map(i => {
            const bal = i.label === 'CTO' ? i.earned : (i.earned - i.spent);
            return `
            <div style="background:var(--color-neutral-50);border-radius:var(--radius-md);padding:var(--space-4);border-left:4px solid ${i.color}">
                <div style="font-size:var(--text-2xl);font-weight:var(--font-bold);color:${i.color}">${fmt(bal)}</div>
                <div style="font-size:var(--text-sm);font-weight:var(--font-semibold);color:var(--color-neutral-700);margin-top:2px">${escapeHtml(i.label)}</div>
                <div style="font-size:var(--text-xs);color:var(--color-neutral-500);margin-top:4px">${i.label === 'CTO' ? `${fmt(i.earned)} available` : `${fmt(i.earned)} earned &middot; ${fmt(i.spent)} used`}</div>
            </div>`;
        }).join('');
    }

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
    const currentYear = new Date().getFullYear();

    // ── Helper: build a row object from a raw transaction ──────────────────────
    function txnRow(t, idx) {
        return {
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
        };
    }

    const TXN_COLS = [
        { key: 'period', label: 'Period', sortable: true },
        { key: 'type', label: 'Type', sortable: true, render: (v) => `<span class="badge badge-${v === 'DEDUCT' ? 'danger' : 'info'} badge-dot">${escapeHtml(v)}</span>` },
        { key: 'vlEarned', label: 'VL Earned', sortable: true, type: 'number' },
        { key: 'slEarned', label: 'SL Earned', sortable: true, type: 'number' },
        { key: 'vlSpent', label: 'VL Spent', sortable: true, type: 'number' },
        { key: 'slSpent', label: 'SL Spent', sortable: true, type: 'number' },
        { key: 'vlBalance', label: 'VL Bal', sortable: false },
        { key: 'slBalance', label: 'SL Bal', sortable: false },
        { key: 'date', label: 'Date', sortable: true, type: 'date' },
    ];

    // ── Split transactions: current-year vs prior-year vs ambiguous ────────────
    const allTxns = card.transactions || [];
    const currentTxns = allTxns.filter(t => t.isCurrentYear === true);
    const priorTxns   = allTxns.filter(t => t.isCurrentYear === false || (t.leaveYear !== null && t.leaveYear !== undefined && t.leaveYear !== currentYear));
    const ambigTxns   = allTxns.filter(t => t.leaveYear === null || t.leaveYear === undefined);

    // Update section badge
    const txnBadge = document.getElementById('txn-year-badge');
    if (txnBadge) txnBadge.textContent = `${currentYear}`;

    transactionsTable = createDataTable({
        el: '#transactions-table',
        columns: TXN_COLS,
        data: currentTxns.map(txnRow),
        searchable: true,
        searchKeys: ['period', 'source', 'type'],
        pageSize: 15,
        emptyTitle: 'No Transactions',
        emptyMessage: `No leave credit transactions recorded for ${currentYear} yet.`,
    });

    // ── Helper: build a row object from a raw usage-history entry ──────────────
    function usageRow(u, idx, yearLabel) {
        return {
            id: idx,
            leaveType: getLeaveTypeLabel(u.leaveType || u.leave_type),
            days: toNum(u.daysUsed || u.days_used),
            period: formatDateRange(u.periodFrom || u.period_from, u.periodTo || u.period_to),
            approved: formatDate(u.dateApproved || u.date_approved),
            approvedBy: u.approvedBy || u.approved_by || '',
            vlAfter: u.balanceAfterVl !== undefined ? fmt(u.balanceAfterVl) : (u.balance_after_vl !== undefined ? fmt(u.balance_after_vl) : '--'),
            slAfter: u.balanceAfterSl !== undefined ? fmt(u.balanceAfterSl) : (u.balance_after_sl !== undefined ? fmt(u.balance_after_sl) : '--'),
            yearLabel: yearLabel || '',
        };
    }

    const USAGE_COLS = [
        { key: 'leaveType', label: 'Leave Type', sortable: true },
        { key: 'days', label: 'Days', sortable: true, type: 'number' },
        { key: 'period', label: 'Period', sortable: false },
        { key: 'approved', label: 'Date Approved', sortable: true, type: 'date' },
        { key: 'approvedBy', label: 'Approved By', sortable: true },
        { key: 'vlAfter', label: 'VL After', sortable: false },
        { key: 'slAfter', label: 'SL After', sortable: false },
    ];

    // ── Split usage history: current-year vs prior-year ────────────────────────
    const allUsage = card.leaveUsageHistory || [];
    const currentUsage = allUsage.filter(u => u.isCurrentYear === true);
    const priorUsage   = allUsage.filter(u => u.isCurrentYear === false || (u.leaveYear !== null && u.leaveYear !== undefined && u.leaveYear !== currentYear));
    const ambigUsage   = allUsage.filter(u => u.leaveYear === null || u.leaveYear === undefined);

    const usageBadge = document.getElementById('usage-year-badge');
    if (usageBadge) usageBadge.textContent = `${currentYear}`;

    usageTable = createDataTable({
        el: '#usage-table',
        columns: USAGE_COLS,
        data: currentUsage.map((u, i) => usageRow(u, i)),
        searchable: true,
        searchKeys: ['leaveType', 'approvedBy'],
        pageSize: 15,
        emptyTitle: 'No Usage History',
        emptyMessage: `No leave usage recorded for ${currentYear} yet.`,
    });

    // ── Historical Records section ─────────────────────────────────────────────
    const historicalTxns  = [...priorTxns, ...ambigTxns];
    const historicalUsage = [...priorUsage, ...ambigUsage];
    const totalHistorical = historicalTxns.length + historicalUsage.length;

    const histSection = document.getElementById('historical-records-section');
    if (histSection && totalHistorical > 0) {
        histSection.style.display = '';

        const countBadge = document.getElementById('historical-count-badge');
        if (countBadge) countBadge.textContent = `${totalHistorical} record${totalHistorical !== 1 ? 's' : ''}`;

        // Historical transactions — add a "Year" column so users know which year each belongs to
        const HIST_TXN_COLS = [
            { key: 'year', label: 'Year', sortable: true, render: (v) => v
                ? `<span style="font-size:var(--text-xs);font-weight:var(--font-semibold);background:var(--color-neutral-200);color:var(--color-neutral-600);padding:1px 6px;border-radius:4px">${escapeHtml(String(v))}</span>`
                : `<span style="font-size:var(--text-xs);color:var(--color-warning-600,#d97706);font-weight:var(--font-semibold)">⚠ Unknown</span>` },
            ...TXN_COLS,
        ];

        createDataTable({
            el: '#historical-transactions-table',
            columns: HIST_TXN_COLS,
            data: historicalTxns.map((t, idx) => ({
                ...txnRow(t, idx),
                year: t.leaveYear || null,
            })),
            searchable: true,
            searchKeys: ['period', 'source', 'type'],
            pageSize: 15,
            emptyTitle: 'No Prior-Year Transactions',
            emptyMessage: 'No historical transaction records found.',
        });

        // Historical usage — add "Year" column
        const HIST_USAGE_COLS = [
            { key: 'year', label: 'Year', sortable: true, render: (v) => v
                ? `<span style="font-size:var(--text-xs);font-weight:var(--font-semibold);background:var(--color-neutral-200);color:var(--color-neutral-600);padding:1px 6px;border-radius:4px">${escapeHtml(String(v))}</span>`
                : `<span style="font-size:var(--text-xs);color:var(--color-warning-600,#d97706);font-weight:var(--font-semibold)">⚠ Unknown</span>` },
            ...USAGE_COLS,
        ];

        createDataTable({
            el: '#historical-usage-table',
            columns: HIST_USAGE_COLS,
            data: historicalUsage.map((u, idx) => ({
                ...usageRow(u, idx),
                year: u.leaveYear || null,
            })),
            searchable: true,
            searchKeys: ['leaveType', 'approvedBy'],
            pageSize: 15,
            emptyTitle: 'No Prior-Year Leave Usage',
            emptyMessage: 'No historical leave usage records found.',
        });
    }

    // CTO records
    loadCtoRecords();
}

async function loadCtoRecords() {
    const container = document.getElementById('cto-table');
    if (!container) return;

    try {
        const res = await fetch(`/api/cto-records?employeeId=${encodeURIComponent(user.email)}`);
        if (!res.ok) {
            renderEmptyState(container, { icon: 'document', title: 'No CTO Records', description: 'No compensatory time-off records found.' });
            return;
        }
        const data = await res.json();
        const records = data.records || [];
        if (records.length === 0) {
            renderEmptyState(container, { icon: 'document', title: 'No CTO Records', description: 'No compensatory time-off records found.' });
            return;
        }

        createDataTable({
            el: '#cto-table',
            columns: [
                { key: 'soDetails', label: 'Special Order', sortable: true },
                { key: 'periodCovered', label: 'Period Covered', sortable: true },
                { key: 'daysGranted', label: 'Days Granted', sortable: true, type: 'number' },
                { key: 'daysUsed', label: 'Days Used', sortable: true, type: 'number' },
                { key: 'balance', label: 'Balance', sortable: true, type: 'number' },
                { key: 'source', label: 'Source', sortable: false },
            ],
            data: records.map((r, i) => ({
                id: i,
                soDetails: r.soDetails || r.specialOrder || '--',
                periodCovered: r.periodCovered || '--',
                daysGranted: toNum(r.daysGranted),
                daysUsed: toNum(r.daysUsed),
                balance: fmt(toNum(r.daysGranted) - toNum(r.daysUsed)),
                source: r.source === 'excel-migration' ? 'Excel Import' : (r.source || 'Manual'),
            })),
            pageSize: 10,
            emptyTitle: 'No CTO Records',
            emptyMessage: 'No compensatory time-off records found.',
        });
    } catch {
        renderEmptyState(container, { icon: 'document', title: 'Error', description: 'Failed to load CTO records.' });
    }
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

    const returnReason = app.returnRemarks || app.returnReason || app.return_reason;
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

    let footer = '';
    if (status === 'approved') {
        footer = '<button class="btn btn-primary btn-sm" onclick="window.__downloadForm6 && window.__downloadForm6()">Download Form No. 6</button>';
    } else if (status === 'returned') {
        footer = `<button class="btn btn-primary btn-sm" onclick="window.__resubmitFromDetail && window.__resubmitFromDetail()">Resubmit Application</button>`;
    }

    openModal({
        title: `Application: ${app.id}`,
        content,
        size: 'lg',
        footer,
    });

    // Download handler for approved apps
    if (status === 'approved') {
        window.__downloadForm6 = () => {
            window.open(`/api/form-no6/${encodeURIComponent(app.id)}`, '_blank');
        };
    }

    // Resubmit handler for returned apps
    if (status === 'returned') {
        window.__resubmitFromDetail = () => {
            closeAllModals();
            showResubmitModal(app.id);
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
// Resubmit Returned Application (Editable)
// ---------------------------------------------------------------------------
const RESUBMIT_LEAVE_TYPES = [
    { id: 'leave_vl',       name: 'Vacation Leave',                       panel: 'location' },
    { id: 'leave_mfl',      name: 'Mandatory / Forced Leave',             panel: null },
    { id: 'leave_sl',       name: 'Sick Leave',                           panel: 'sick' },
    { id: 'leave_ml',       name: 'Maternity Leave',                      panel: null },
    { id: 'leave_pl',       name: 'Paternity Leave',                      panel: null },
    { id: 'leave_spl',      name: 'Special Privilege Leave',              panel: 'location' },
    { id: 'leave_solo',     name: 'Solo Parent Leave',                    panel: null },
    { id: 'leave_study',    name: 'Study Leave',                          panel: 'study' },
    { id: 'leave_vawc',     name: '10-Day VAWC Leave',                    panel: null },
    { id: 'leave_rehab',    name: 'Rehabilitation Privilege',             panel: null },
    { id: 'leave_women',    name: 'Special Leave Benefits for Women',     panel: 'women' },
    { id: 'leave_calamity', name: 'Special Emergency (Calamity) Leave',   panel: null },
    { id: 'leave_adoption', name: 'Adoption Leave',                       panel: null },
    { id: 'leave_wl',       name: 'Wellness Leave',                       panel: null },
    { id: 'leave_others',   name: 'Others',                               panel: 'others' },
];

function resubmitCalcWorkingDays(fromStr, toStr) {
    const start = new Date(fromStr);
    const end = new Date(toStr);
    if (isNaN(start) || isNaN(end) || start > end) return 0;
    let count = 0;
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const dow = d.getDay();
        if (dow >= 1 && dow <= 5) count++;
    }
    return count;
}

function showResubmitModal(appId) {
    const app = applications.find(a => a.id === appId);
    if (!app) { toast.warning('Application not found.'); return; }

    if (app.status !== 'returned') {
        toast.warning('This application is not in returned status.');
        return;
    }

    const returnReason = app.returnRemarks || app.returnReason || app.return_reason || '';
    const leaveType = app.leaveType || app.leave_type || '';
    const dateFrom = (app.dateFrom || app.date_from || '').split('T')[0];
    const dateTo = (app.dateTo || app.date_to || '').split('T')[0];
    const numDays = toNum(app.numDays || app.num_days);
    const leaveHours = toNum(app.leaveHours);
    const isPartial = leaveHours > 0 && leaveHours < 8;

    // Build leave type options
    const typeOptions = RESUBMIT_LEAVE_TYPES.map(t =>
        `<option value="${t.id}" ${t.id === leaveType ? 'selected' : ''}>${escapeHtml(t.name)}</option>`
    ).join('');

    const content = `
        ${returnReason ? `<div style="margin-bottom:var(--space-4);padding:var(--space-3);background:var(--color-warning-light);border:1px solid var(--color-warning);border-radius:var(--radius-md);font-size:var(--text-sm)"><strong>Return Reason:</strong> ${escapeHtml(returnReason)}</div>` : ''}

        <div class="form-group">
            <label class="form-label">Leave Type</label>
            <select class="form-input" id="resub-leave-type">${typeOptions}</select>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div class="form-group">
                <label class="form-label">Date From</label>
                <input type="date" class="form-input" id="resub-date-from" value="${dateFrom}">
            </div>
            <div class="form-group">
                <label class="form-label">Date To</label>
                <input type="date" class="form-input" id="resub-date-to" value="${dateTo}">
            </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3);align-items:end">
            <div class="form-group" style="margin-bottom:0">
                <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer">
                    <input type="checkbox" id="resub-partial" ${isPartial ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--color-primary)">
                    Partial day (less than 8 hours)
                </label>
            </div>
            <div class="form-group" id="resub-hours-group" style="display:${isPartial ? 'block' : 'none'};margin-bottom:0">
                <label class="form-label">Hours</label>
                <input type="number" class="form-input" id="resub-hours" min="1" max="7" value="${isPartial ? leaveHours : 4}" style="max-width:80px">
            </div>
        </div>

        <div class="form-group" style="margin-top:var(--space-2)">
            <label class="form-label">No. of Days</label>
            <div class="form-input" id="resub-num-days" style="background:var(--color-gray-100);cursor:default">${isPartial ? (leaveHours / 8).toFixed(3) : numDays}</div>
        </div>

        <!-- Conditional panels -->
        <div id="resub-panel-location" style="display:none;margin-top:var(--space-3)">
            <div class="form-group">
                <label class="form-label">Location</label>
                <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer;margin-bottom:var(--space-1)">
                    <input type="radio" name="resub-location" value="ph" ${app.locationPH ? 'checked' : ''}> Within the Philippines
                </label>
                <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer">
                    <input type="radio" name="resub-location" value="abroad" ${app.locationAbroad ? 'checked' : ''}> Abroad (Specify)
                </label>
                <input type="text" class="form-input" id="resub-abroad-specify" placeholder="Specify country/destination" value="${escapeHtml(app.abroadSpecify || '')}" style="margin-top:var(--space-2);display:${app.locationAbroad ? 'block' : 'none'}">
            </div>
        </div>

        <div id="resub-panel-sick" style="display:none;margin-top:var(--space-3)">
            <div class="form-group">
                <label class="form-label">Sick Leave Details</label>
                <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer;margin-bottom:var(--space-1)">
                    <input type="radio" name="resub-sick" value="hospital" ${app.sickHospital ? 'checked' : ''}> In Hospital
                </label>
                <input type="text" class="form-input" id="resub-hospital-illness" placeholder="Specify illness" value="${escapeHtml(app.hospitalIllness || '')}" style="margin-bottom:var(--space-2);display:${app.sickHospital ? 'block' : 'none'}">
                <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer">
                    <input type="radio" name="resub-sick" value="outpatient" ${app.sickOutpatient ? 'checked' : ''}> Out Patient
                </label>
                <input type="text" class="form-input" id="resub-outpatient-illness" placeholder="Specify illness" value="${escapeHtml(app.outpatientIllness || '')}" style="margin-top:var(--space-2);display:${app.sickOutpatient ? 'block' : 'none'}">
            </div>
        </div>

        <div id="resub-panel-study" style="display:none;margin-top:var(--space-3)">
            <div class="form-group">
                <label class="form-label">Study Leave Purpose</label>
                <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer;margin-bottom:var(--space-1)">
                    <input type="radio" name="resub-study" value="masters" ${app.studyMasters ? 'checked' : ''}> Completion of Master's Degree
                </label>
                <label style="display:flex;align-items:center;gap:var(--space-2);font-size:var(--text-sm);cursor:pointer">
                    <input type="radio" name="resub-study" value="bar" ${app.studyBar ? 'checked' : ''}> BAR / Board Examination Review
                </label>
            </div>
        </div>

        <div id="resub-panel-women" style="display:none;margin-top:var(--space-3)">
            <div class="form-group">
                <label class="form-label">Specify Illness</label>
                <input type="text" class="form-input" id="resub-women-illness" value="${escapeHtml(app.womenIllness || '')}" placeholder="Specify illness">
            </div>
        </div>

        <div id="resub-panel-others" style="display:none;margin-top:var(--space-3)">
            <div class="form-group">
                <label class="form-label">Specify Leave Type</label>
                <input type="text" class="form-input" id="resub-other-specify" value="${escapeHtml(app.otherLeaveSpecify || '')}" placeholder="e.g. CTO - SO #12345">
            </div>
            <div class="form-group">
                <label class="form-label">Special Order (PDF)</label>
                <input type="file" id="resub-so-upload" accept=".pdf" style="font-size:var(--text-sm)">
                ${app.soFileName ? `<div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:var(--space-1)">Current: ${escapeHtml(app.soFileName)}</div>` : ''}
            </div>
        </div>

        <div class="form-group" style="margin-top:var(--space-3)">
            <label class="form-label">Remarks</label>
            <textarea id="resub-remarks" class="form-textarea" rows="2" placeholder="Explain corrections made...">${escapeHtml(app.remarks || '')}</textarea>
        </div>

        <div style="margin-top:var(--space-3)">
            <label class="form-label">Employee Signature</label>
            <canvas id="resub-sig-canvas" width="500" height="120" style="border:2px dashed var(--color-border);border-radius:var(--radius-md);cursor:crosshair;touch-action:none;width:100%;height:120px;background:#fff"></canvas>
            <div style="margin-top:var(--space-2);display:flex;gap:var(--space-2)">
                <button class="btn btn-ghost btn-sm" type="button" id="resub-sig-clear">Clear</button>
                <label class="btn btn-ghost btn-sm" style="cursor:pointer">
                    Upload Image
                    <input type="file" accept="image/*" id="resub-sig-upload" style="display:none">
                </label>
            </div>
        </div>
    `;

    const modal = openModal({
        title: `Edit & Resubmit — ${app.id}`,
        content,
        size: 'lg',
        footer: `
            <button class="btn btn-ghost btn-sm" id="resub-cancel">Cancel</button>
            <button class="btn btn-primary btn-sm" id="resub-confirm">Resubmit Application</button>
        `,
    });

    // --- Panel visibility ---
    function updatePanels() {
        const sel = document.getElementById('resub-leave-type')?.value || '';
        const typeDef = RESUBMIT_LEAVE_TYPES.find(t => t.id === sel);
        const panel = typeDef?.panel || null;
        ['location', 'sick', 'study', 'women', 'others'].forEach(p => {
            const el = document.getElementById('resub-panel-' + p);
            if (el) el.style.display = (p === panel) ? 'block' : 'none';
        });
    }
    updatePanels();
    document.getElementById('resub-leave-type')?.addEventListener('change', updatePanels);

    // --- Days calculation ---
    function recalcDays() {
        const from = document.getElementById('resub-date-from')?.value;
        const to = document.getElementById('resub-date-to')?.value;
        const partial = document.getElementById('resub-partial')?.checked;
        const hoursEl = document.getElementById('resub-hours');
        const display = document.getElementById('resub-num-days');
        if (!display) return;

        if (partial) {
            document.getElementById('resub-date-to').value = from;
            const hours = Math.max(1, Math.min(7, parseInt(hoursEl?.value, 10) || 4));
            display.textContent = (hours / 8).toFixed(3);
        } else {
            if (from && to) {
                display.textContent = resubmitCalcWorkingDays(from, to);
            }
        }
    }
    document.getElementById('resub-date-from')?.addEventListener('change', recalcDays);
    document.getElementById('resub-date-to')?.addEventListener('change', recalcDays);
    document.getElementById('resub-hours')?.addEventListener('input', recalcDays);

    // Partial day toggle
    document.getElementById('resub-partial')?.addEventListener('change', (e) => {
        document.getElementById('resub-hours-group').style.display = e.target.checked ? 'block' : 'none';
        if (e.target.checked) {
            document.getElementById('resub-date-to').value = document.getElementById('resub-date-from').value;
        }
        recalcDays();
    });

    // Location abroad toggle
    document.querySelectorAll('input[name="resub-location"]').forEach(r => {
        r.addEventListener('change', () => {
            document.getElementById('resub-abroad-specify').style.display =
                document.querySelector('input[name="resub-location"][value="abroad"]')?.checked ? 'block' : 'none';
        });
    });

    // Sick type toggle
    document.querySelectorAll('input[name="resub-sick"]').forEach(r => {
        r.addEventListener('change', () => {
            const val = document.querySelector('input[name="resub-sick"]:checked')?.value;
            document.getElementById('resub-hospital-illness').style.display = val === 'hospital' ? 'block' : 'none';
            document.getElementById('resub-outpatient-illness').style.display = val === 'outpatient' ? 'block' : 'none';
        });
    });

    // --- Signature canvas ---
    const canvas = document.getElementById('resub-sig-canvas');
    if (canvas) {
        const ctx = canvas.getContext('2d');
        let drawing = false;
        function getPos(e) {
            const rect = canvas.getBoundingClientRect();
            const sx = canvas.width / rect.width, sy = canvas.height / rect.height;
            const cx = e.touches ? e.touches[0].clientX : e.clientX;
            const cy = e.touches ? e.touches[0].clientY : e.clientY;
            return { x: (cx - rect.left) * sx, y: (cy - rect.top) * sy };
        }
        function startDraw(e) { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }
        function draw(e) { if (!drawing) return; e.preventDefault(); const p = getPos(e); ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.strokeStyle = '#000'; ctx.lineTo(p.x, p.y); ctx.stroke(); canvas.style.borderColor = 'var(--color-success)'; canvas.style.borderStyle = 'solid'; }
        function stopDraw() { drawing = false; }
        canvas.addEventListener('mousedown', startDraw);
        canvas.addEventListener('mousemove', draw);
        canvas.addEventListener('mouseup', stopDraw);
        canvas.addEventListener('mouseleave', stopDraw);
        canvas.addEventListener('touchstart', startDraw, { passive: false });
        canvas.addEventListener('touchmove', draw, { passive: false });
        canvas.addEventListener('touchend', stopDraw);

        document.getElementById('resub-sig-clear')?.addEventListener('click', () => {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            canvas.style.borderColor = ''; canvas.style.borderStyle = '';
        });
        document.getElementById('resub-sig-upload')?.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const img = new Image();
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
                const w = img.width * scale, h = img.height * scale;
                ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
                canvas.style.borderColor = 'var(--color-success)'; canvas.style.borderStyle = 'solid';
            };
            img.src = URL.createObjectURL(file);
        });

        // Load existing signature if available
        if (app.employeeSignature) {
            const img = new Image();
            img.onload = () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                const scale = Math.min(canvas.width / img.width, canvas.height / img.height);
                const w = img.width * scale, h = img.height * scale;
                ctx.drawImage(img, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
                canvas.style.borderColor = 'var(--color-success)'; canvas.style.borderStyle = 'solid';
            };
            img.src = app.employeeSignature;
        }
    }

    // --- Cancel ---
    document.getElementById('resub-cancel')?.addEventListener('click', () => modal.close());

    // --- Submit ---
    document.getElementById('resub-confirm')?.addEventListener('click', async () => {
        const btn = document.getElementById('resub-confirm');
        const newLeaveType = document.getElementById('resub-leave-type')?.value;
        const newDateFrom = document.getElementById('resub-date-from')?.value;
        const newDateTo = document.getElementById('resub-date-to')?.value;
        const partial = document.getElementById('resub-partial')?.checked;
        const hours = parseInt(document.getElementById('resub-hours')?.value, 10) || 0;
        const remarks = document.getElementById('resub-remarks')?.value || '';

        // Validation
        if (!newDateFrom || !newDateTo) { toast.warning('Please select date range.'); return; }
        if (new Date(newDateFrom) > new Date(newDateTo)) { toast.warning('Date From cannot be after Date To.'); return; }

        // Calculate final numDays
        let finalDays;
        let leaveHoursVal = undefined;
        let isHalfDayVal = undefined;
        if (partial) {
            const h = Math.max(1, Math.min(7, hours));
            finalDays = h / 8;
            leaveHoursVal = h;
            isHalfDayVal = (h === 4);
        } else {
            finalDays = resubmitCalcWorkingDays(newDateFrom, newDateTo);
        }
        if (finalDays <= 0) { toast.warning('No working days in the selected range.'); return; }

        // Get signature
        const sigCanvas = document.getElementById('resub-sig-canvas');
        const sigData = sigCanvas ? sigCanvas.toDataURL('image/png') : '';

        // Build updatedData
        const updatedData = {
            leaveType: newLeaveType,
            dateFrom: newDateFrom,
            dateTo: partial ? newDateFrom : newDateTo,
            numDays: finalDays,
            remarks: remarks || 'Application resubmitted with edits',
            employeeSignature: sigData || undefined,
        };
        if (leaveHoursVal !== undefined) updatedData.leaveHours = leaveHoursVal;
        if (isHalfDayVal !== undefined) updatedData.isHalfDay = isHalfDayVal;
        if (!partial) { updatedData.leaveHours = 0; updatedData.isHalfDay = false; }

        // Conditional fields based on leave type panel
        const typeDef = RESUBMIT_LEAVE_TYPES.find(t => t.id === newLeaveType);
        if (typeDef?.panel === 'location') {
            const locVal = document.querySelector('input[name="resub-location"]:checked')?.value;
            updatedData.locationPH = locVal === 'ph';
            updatedData.locationAbroad = locVal === 'abroad';
            if (locVal === 'abroad') updatedData.abroadSpecify = document.getElementById('resub-abroad-specify')?.value || '';
        } else if (typeDef?.panel === 'sick') {
            const sickVal = document.querySelector('input[name="resub-sick"]:checked')?.value;
            updatedData.sickHospital = sickVal === 'hospital';
            updatedData.sickOutpatient = sickVal === 'outpatient';
            if (sickVal === 'hospital') updatedData.hospitalIllness = document.getElementById('resub-hospital-illness')?.value || '';
            if (sickVal === 'outpatient') updatedData.outpatientIllness = document.getElementById('resub-outpatient-illness')?.value || '';
        } else if (typeDef?.panel === 'study') {
            const studyVal = document.querySelector('input[name="resub-study"]:checked')?.value;
            updatedData.studyMasters = studyVal === 'masters';
            updatedData.studyBar = studyVal === 'bar';
        } else if (typeDef?.panel === 'women') {
            updatedData.womenIllness = document.getElementById('resub-women-illness')?.value || '';
        } else if (typeDef?.panel === 'others') {
            updatedData.otherLeaveSpecify = document.getElementById('resub-other-specify')?.value || '';
        }

        // SO file upload (for "others" type)
        const soInput = document.getElementById('resub-so-upload');
        if (soInput?.files?.[0]) {
            try {
                const file = soInput.files[0];
                if (file.size > 10 * 1024 * 1024) { toast.warning('SO file must be under 10MB.'); return; }
                const reader = new FileReader();
                const soData = await new Promise((resolve, reject) => {
                    reader.onload = () => resolve(reader.result);
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });
                updatedData.soFileData = soData;
                updatedData.soFileName = file.name;
            } catch { toast.error('Failed to read SO file.'); return; }
        }

        btn.disabled = true;
        btn.textContent = 'Resubmitting...';

        try {
            const res = await fetch('/api/resubmit-leave', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ applicationId: appId, updatedData }),
            });

            const data = await res.json().catch(() => ({}));
            if (res.ok && data.success) {
                toast.success('Application resubmitted successfully. It will be reviewed by AO.');
                modal.close();
                applications = [];
                applicationsTable = null;
                await loadOverviewData();
                loadApplications();
            } else {
                toast.error(data.error || 'Failed to resubmit application.');
                btn.disabled = false;
                btn.textContent = 'Resubmit Application';
            }
        } catch (err) {
            toast.error('Network error. Please try again.');
            btn.disabled = false;
            btn.textContent = 'Resubmit Application';
        }
    });
}

// ---------------------------------------------------------------------------
// Profile Modal
// ---------------------------------------------------------------------------
function showProfileModal() {
    const officeSelect = `<select class="form-input" id="prof-office" style="width:100%">
        <option value="">-- Select School/Office --</option>
        <optgroup label="Elementary Schools">
            <option value="Agripino Alvarez Elementary School">Agripino Alvarez Elementary School</option>
            <option value="Banag Elementary School">Banag Elementary School</option>
            <option value="Barangay V Elementary School">Barangay V Elementary School</option>
            <option value="Barasbarasan Elementary School">Barasbarasan Elementary School</option>
            <option value="Barasbarasan Elementary School - Indangawan Annex">Barasbarasan Elementary School - Indangawan Annex</option>
            <option value="Bawog Elementary School">Bawog Elementary School</option>
            <option value="Binotusan Elementary School">Binotusan Elementary School</option>
            <option value="Binulig Elementary School">Binulig Elementary School</option>
            <option value="Bungabunga Elementary School">Bungabunga Elementary School</option>
            <option value="Cabadiangan Elementary School">Cabadiangan Elementary School</option>
            <option value="Calangcang Elementary School">Calangcang Elementary School</option>
            <option value="Calat-an Elementary School">Calat-an Elementary School</option>
            <option value="Cambogui-ot Elementary School">Cambogui-ot Elementary School</option>
            <option value="Camindangan Elementary School">Camindangan Elementary School</option>
            <option value="Cansauro Elementary School">Cansauro Elementary School</option>
            <option value="Cantaca Elementary School">Cantaca Elementary School</option>
            <option value="Canturay Elementary School">Canturay Elementary School</option>
            <option value="Cartagena Elementary School">Cartagena Elementary School</option>
            <option value="Cayhagan Elementary School">Cayhagan Elementary School</option>
            <option value="Crossing Tanduay Elementary School">Crossing Tanduay Elementary School</option>
            <option value="Genaro P. Alvarez Elementary School">Genaro P. Alvarez Elementary School</option>
            <option value="Genaro P. Alvarez Elementary School II">Genaro P. Alvarez Elementary School II</option>
            <option value="Gil M. Montilla Elementary School">Gil M. Montilla Elementary School</option>
            <option value="Hda. Maricalum Elementary School">Hda. Maricalum Elementary School</option>
            <option value="Manlucahoc Elementary School">Manlucahoc Elementary School</option>
            <option value="Maricalum Elementary School">Maricalum Elementary School</option>
            <option value="Nabulao Elementary School">Nabulao Elementary School</option>
            <option value="Nabulao Elementary School - Buyog Annex">Nabulao Elementary School - Buyog Annex</option>
            <option value="Nauhang Primary School">Nauhang Primary School</option>
            <option value="Patag Magbanua Elementary School">Patag Magbanua Elementary School</option>
        </optgroup>
        <optgroup label="Secondary Schools">
            <option value="Cambogui-ot National High School">Cambogui-ot National High School</option>
            <option value="Camindangan National High School">Camindangan National High School</option>
            <option value="Cayhagan National High School">Cayhagan National High School</option>
            <option value="Gil Montilla National High School">Gil Montilla National High School</option>
            <option value="Gil Montilla NHS - Binulig Extension">Gil Montilla NHS - Binulig Extension</option>
            <option value="Gil Montilla NHS - Cabadiangan Extension">Gil Montilla NHS - Cabadiangan Extension</option>
            <option value="Gil Montilla NHS - Crossing Tanduay Extension">Gil Montilla NHS - Crossing Tanduay Extension</option>
            <option value="Gil Montilla NHS - Manlucahoc Extension">Gil Montilla NHS - Manlucahoc Extension</option>
            <option value="Jacinto Montilla Memorial National High School">Jacinto Montilla Memorial National High School</option>
            <option value="Leodegario Ponce Gonzales National High School">Leodegario Ponce Gonzales National High School</option>
            <option value="Mariano Gemora National High School">Mariano Gemora National High School</option>
            <option value="Maricalum Farm School">Maricalum Farm School</option>
            <option value="Nabulao National High School">Nabulao National High School</option>
            <option value="Sipalay City National High School">Sipalay City National High School</option>
        </optgroup>
        <optgroup label="Integrated Schools">
            <option value="Dungga Integrated School">Dungga Integrated School</option>
            <option value="Dung-i Integrated School">Dung-i Integrated School</option>
            <option value="Macarandan Integrated School">Macarandan Integrated School</option>
            <option value="Mauboy Integrated School">Mauboy Integrated School</option>
            <option value="Omas Integrated School">Omas Integrated School</option>
            <option value="Tugas Integrated School">Tugas Integrated School</option>
            <option value="Vista Alegre Integrated School">Vista Alegre Integrated School</option>
        </optgroup>
        <optgroup label="Division Office">
            <option value="CID">CID - Curriculum Implementation Division</option>
            <option value="ASDS - Assistant Schools Division Superintendent">ASDS - Assistant Schools Division Superintendent</option>
            <option value="OSDS">OSDS - Office of the Schools Division Superintendent</option>
            <option value="SGOD">SGOD - School Governance and Operations Division</option>
        </optgroup>
    </select>`;

    const positionSelect = `<select class="form-input" id="prof-position" style="width:100%">
        <option value="">-- Select Position --</option>
        <option value="Teacher I" data-sg="11">Teacher I (SG-11)</option>
        <option value="Teacher II" data-sg="12">Teacher II (SG-12)</option>
        <option value="Teacher III" data-sg="13">Teacher III (SG-13)</option>
        <option value="Special Science Teacher I" data-sg="13">Special Science Teacher I (SG-13)</option>
        <option value="Special Education Teacher I" data-sg="14">Special Education Teacher I (SG-14)</option>
        <option value="Guidance Counselor I" data-sg="11">Guidance Counselor I (SG-11)</option>
        <option value="Master Teacher I" data-sg="18">Master Teacher I (SG-18)</option>
        <option value="Master Teacher II" data-sg="19">Master Teacher II (SG-19)</option>
        <option value="Head Teacher I" data-sg="14">Head Teacher I (SG-14)</option>
        <option value="Head Teacher II" data-sg="15">Head Teacher II (SG-15)</option>
        <option value="Head Teacher III" data-sg="16">Head Teacher III (SG-16)</option>
        <option value="School Principal I" data-sg="19">School Principal I (SG-19)</option>
        <option value="School Principal II" data-sg="20">School Principal II (SG-20)</option>
        <option value="Assistant School Principal II" data-sg="19">Assistant School Principal II (SG-19)</option>
        <option value="Administrative Officer V" data-sg="18">Administrative Officer V (SG-18)</option>
        <option value="Administrative Officer IV" data-sg="15">Administrative Officer IV (SG-15)</option>
        <option value="Administrative Officer II" data-sg="11">Administrative Officer II (SG-11)</option>
        <option value="Administrative Assistant III" data-sg="9">Administrative Assistant III (SG-9)</option>
        <option value="Administrative Assistant II" data-sg="8">Administrative Assistant II (SG-8)</option>
        <option value="Administrative Aide VI" data-sg="6">Administrative Aide VI (SG-6)</option>
        <option value="Administrative Aide IV" data-sg="4">Administrative Aide IV (SG-4)</option>
        <option value="Chief Education Supervisor" data-sg="24">Chief Education Supervisor (SG-24)</option>
        <option value="Education Program Supervisor" data-sg="22">Education Program Supervisor (SG-22)</option>
        <option value="Public Schools District Supervisor" data-sg="22">Public Schools District Supervisor (SG-22)</option>
        <option value="Senior Education Program Specialist" data-sg="19">Senior Education Program Specialist (SG-19)</option>
        <option value="Education Program Specialist II" data-sg="16">Education Program Specialist II (SG-16)</option>
        <option value="Accountant III" data-sg="19">Accountant III (SG-19)</option>
        <option value="Planning Officer III" data-sg="18">Planning Officer III (SG-18)</option>
        <option value="Project Development Officer II" data-sg="15">Project Development Officer II (SG-15)</option>
        <option value="Project Development Officer I" data-sg="11">Project Development Officer I (SG-11)</option>
        <option value="Information Technology Officer I" data-sg="19">Information Technology Officer I (SG-19)</option>
        <option value="Engineer III" data-sg="19">Engineer III (SG-19)</option>
        <option value="Attorney III" data-sg="21">Attorney III (SG-21)</option>
        <option value="Legal Assistant I" data-sg="10">Legal Assistant I (SG-10)</option>
        <option value="Medical Officer III" data-sg="21">Medical Officer III (SG-21)</option>
        <option value="Dentist II" data-sg="17">Dentist II (SG-17)</option>
        <option value="Nurse II" data-sg="16">Nurse II (SG-16)</option>
        <option value="Registrar I" data-sg="11">Registrar I (SG-11)</option>
        <option value="Librarian II" data-sg="15">Librarian II (SG-15)</option>
        <option value="Assistant Schools Division Superintendent" data-sg="25">Assistant Schools Division Superintendent (SG-25)</option>
    </select>`;

    const sec = (t) => `<p style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#888;margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid #e5e7eb">${t}</p>`;
    const fg = (lbl, el) => `<div class="form-group"><label class="form-label">${lbl}</label>${el}</div>`;
    const inp = (id, val, ph = '') => `<input class="form-input" id="${id}" style="width:100%" value="${val}"${ph ? ` placeholder="${ph}"` : ''}>`;

    const content = `
        <div style="margin-bottom:20px">
            ${sec('Personal Information')}
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px">
                ${fg('Last Name', inp('prof-lastName', escapeHtml(user.lastName || '')))}
                ${fg('First Name', inp('prof-firstName', escapeHtml(user.firstName || '')))}
                ${fg('Middle Name', inp('prof-middleName', escapeHtml(user.middleName || '')))}
                ${fg('Suffix <span style="color:#9ca3af;font-weight:400">(optional)</span>', inp('prof-suffix', escapeHtml(user.suffix || ''), 'Jr., III, etc.'))}
            </div>
        </div>
        <div style="margin-bottom:20px">
            ${sec('Account')}
            <div class="form-group" style="margin-bottom:12px">
                <label class="form-label">Email <span style="color:#9ca3af;font-weight:400">(cannot be changed)</span></label>
                <div class="form-input" style="width:100%;background:#f3f4f6;color:#6b7280;cursor:not-allowed">${escapeHtml(user.email)}</div>
            </div>
            <div style="max-width:50%">
                ${fg('Employee No.', inp('prof-employeeNo', escapeHtml(user.employeeNo || user.employee_number || '')))}
            </div>
        </div>
        <div>
            ${sec('Employment')}
            <div class="form-group" style="margin-bottom:12px">
                <label class="form-label">Office / School</label>
                ${officeSelect}
            </div>
            <div class="form-group" style="margin-bottom:12px">
                <label class="form-label">Position</label>
                ${positionSelect}
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;margin-bottom:12px">
                ${fg('Salary Grade', inp('prof-salaryGrade', escapeHtml(user.salaryGrade || user.salary_grade || '')))}
                ${fg('Step', inp('prof-step', escapeHtml(user.step || '')))}
            </div>
            <div style="max-width:50%">
                ${fg('Monthly Salary', inp('prof-salary', escapeHtml(user.salary || '')))}
            </div>
        </div>
    `;

    const modal = openModal({
        title: 'Edit Profile',
        content,
        size: 'lg',
        footer: `
            <button class="btn btn-ghost btn-sm" id="prof-cancel">Cancel</button>
            <button class="btn btn-primary btn-sm" id="prof-save">Save Changes</button>
        `,
    });

    // Pre-select current values on the dropdowns
    const officeEl = document.getElementById('prof-office');
    const positionEl = document.getElementById('prof-position');
    const sgEl = document.getElementById('prof-salaryGrade');
    if (officeEl) officeEl.value = user.office || '';
    if (positionEl) {
        positionEl.value = user.position || '';
        positionEl.addEventListener('change', () => {
            const sg = positionEl.options[positionEl.selectedIndex]?.dataset?.sg || '';
            if (sg && sgEl) sgEl.value = sg;
        });
    }

    document.getElementById('prof-cancel')?.addEventListener('click', () => modal.close());
    document.getElementById('prof-save')?.addEventListener('click', async () => {
        const lastName = document.getElementById('prof-lastName').value.trim();
        const firstName = document.getElementById('prof-firstName').value.trim();
        if (!lastName || !firstName) { toast.warning('Last name and first name are required.'); return; }

        const middleName = document.getElementById('prof-middleName').value.trim();
        const suffix = document.getElementById('prof-suffix').value.trim();
        const fullName = `${lastName}${suffix ? ' ' + suffix : ''}, ${firstName}${middleName ? ' ' + middleName : ''}`;

        const payload = {
            email: user.email,
            fullName,
            firstName, lastName, middleName, suffix,
            office: document.getElementById('prof-office').value,
            position: document.getElementById('prof-position').value,
            employeeNo: document.getElementById('prof-employeeNo').value.trim(),
            salaryGrade: document.getElementById('prof-salaryGrade').value.trim(),
            step: document.getElementById('prof-step').value.trim(),
            salary: document.getElementById('prof-salary').value.trim(),
        };

        try {
            const res = await fetch('/api/update-employee-profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await res.json();
            if (data.success) {
                toast.success('Profile updated successfully.');
                Object.assign(user, data.user || {});
                user.name = fullName;
                user.fullName = fullName;
                modal.close();
            } else {
                toast.error(data.error || 'Update failed.');
            }
        } catch (e) {
            toast.error('Network error. Please try again.');
        }
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
