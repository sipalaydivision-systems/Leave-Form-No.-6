/**
 * HR Dashboard — Human Resources certification portal module.
 *
 * Features: leave credit certification, digital signature capture,
 * approval/return workflow, analytics charts, employee card views.
 */

import { initSidebar, ICONS } from '../components/sidebar.js';
import { createTabs } from '../components/tabs.js';
import { createDataTable } from '../components/table.js';
import { createBarChart, createDoughnutChart, destroyChart } from '../components/chart-wrapper.js';
import { toast } from '../components/toast.js';
import { openModal, closeModal, confirmModal } from '../components/modal.js';
import { renderEmptyState } from '../components/empty-state.js';
import { initLeaveCalendar } from './leave-calendar-shared.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let user = null;
let sidebar = null;
let tabs = null;
let pendingApps = [];
let certifiedApps = [];
let allApps = [];
let employees = [];

let pendingTable = null;
let certifiedTable = null;
let employeesTable = null;

let monthlyChart = null;
let typesChart = null;
let statusChart = null;
let officeChart = null;
let leaveCalendar = null;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        user = await fetchUser();
        if (!user) return;

        initLogoutSystem({ storage: 'local', redirectUrl: '/hr-login' });

        setupSidebar();
        setupTabs();
        setupTopbar();

        await loadOverviewData();
    } catch (err) {
        console.error('[HR Dashboard] Init failed:', err);
        toast.error('Failed to load dashboard. Please refresh.');
    }
}

async function fetchUser() {
    const res = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/hr-login'; return null; }
    const data = await res.json();
    const u = data.user || data;
    const role = (u.role || u.portal || '').toLowerCase();
    if (role !== 'hr' && role !== 'it') { window.location.href = '/hr-login'; return null; }
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
            name: user.name || user.fullName || 'Admin Officer V',
            role: 'Admin Officer V',
        },
        roleColor: '#FF6B00',
        activeId: 'overview',
        sections: [
            {
                title: 'Dashboard',
                links: [
                    { id: 'overview', label: 'Overview', icon: ICONS.home },
                    { id: 'pending', label: 'Pending Certification', icon: ICONS.clipboardList, badge: 0 },
                    { id: 'certified', label: 'Certified', icon: ICONS.checkCircle },
                ],
            },
            {
                title: 'Management',
                links: [
                    { id: 'cards', label: 'Employee Cards', icon: ICONS.creditCard },
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
            tabs.setActive(linkId);
        },
        onProfileClick: () => showProfileModal(),
    });

    document.getElementById('hamburger-btn')?.addEventListener('click', () => sidebar.toggleMobile());
    document.querySelector('.sidebar-overlay')?.addEventListener('click', () => sidebar.toggleMobile(false));
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function setupTabs() {
    tabs = createTabs({
        el: '#dashboard-tabs',
        tabs: [
            { id: 'overview', label: 'Overview' },
            { id: 'pending', label: 'Pending', badge: 0 },
            { id: 'certified', label: 'Certified' },
            { id: 'cards', label: 'Employee Cards' },
            { id: 'calendar', label: 'Calendar' },
            { id: 'reports', label: 'Reports' },
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
        case 'pending': if (!pendingTable) renderPendingTable(); break;
        case 'certified': if (!certifiedTable) renderCertifiedTable(); break;
        case 'cards': if (!employeesTable) loadEmployees(); break;
        case 'calendar':
            if (!leaveCalendar) {
                leaveCalendar = initLeaveCalendar({ el: '#calendar-content', role: 'hr', email: user.email });
            }
            leaveCalendar.load();
            break;
        case 'reports': renderReportCharts(); break;
    }
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------
function getGreeting() {
    const h = new Date().getHours();
    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

function setupTopbar() {
    const title = document.getElementById('topbar-title');
    const firstName = user.firstName || user.first_name || (user.name || '').split(' ')[0] || 'HR';
    if (title) title.textContent = `HR Dashboard — ${firstName}`;

    // Hero
    setText('hero-greeting', `${getGreeting()}, ${firstName}`);
    const dateParts = [user.office, new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })];
    setText('hero-date', dateParts.filter(Boolean).join(' · '));

    document.getElementById('btn-refresh')?.addEventListener('click', refreshAll);
    document.getElementById('btn-view-all-pending')?.addEventListener('click', () => {
        tabs.setActive('pending');
        sidebar.setActive('pending');
    });
}

async function refreshAll() {
    toast.info('Refreshing...');
    pendingTable = null;
    certifiedTable = null;
    await loadOverviewData();
    toast.success('Data refreshed.');
}

// ---------------------------------------------------------------------------
// Overview Data
// ---------------------------------------------------------------------------
async function loadOverviewData() {
    const [pendingRes, certifiedRes] = await Promise.all([
        fetch(`/api/pending-applications/HR?t=${Date.now()}`).then(r => r.ok ? r.json() : null),
        fetch(`/api/hr-approved-applications?t=${Date.now()}`).then(r => r.ok ? r.json() : null),
    ]);

    pendingApps = pendingRes?.applications || pendingRes || [];
    certifiedApps = certifiedRes?.applications || certifiedRes || [];
    allApps = [...pendingApps, ...certifiedApps];

    const now = new Date();
    const thisMonthCertified = certifiedApps.filter(a => {
        const d = new Date(a.hrApprovedAt || a.hr_approved_at || '');
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });
    const returned = allApps.filter(a => a.status === 'returned').length;

    setText('stat-pending', pendingApps.length);
    setText('stat-certified', thisMonthCertified.length);
    setText('stat-returned', returned);
    setText('stat-total', allApps.length);

    // Hero metric
    setText('hero-metric', pendingApps.length);

    tabs.updateBadge('pending', pendingApps.length);
    sidebar.updateBadge('pending', pendingApps.length);

    renderRecentPending(pendingApps.slice(0, 5));
    renderMonthlyChart();
    renderTypesChart();
}

// ---------------------------------------------------------------------------
// Recent Pending (Overview)
// ---------------------------------------------------------------------------
function renderRecentPending(apps) {
    const container = document.getElementById('recent-pending-list');
    if (!container) return;

    if (apps.length === 0) {
        renderEmptyState(container, {
            icon: 'inbox',
            title: 'No Pending Certifications',
            description: 'All caught up! No applications awaiting HR certification.',
        });
        return;
    }

    let html = '<div class="table-container"><table class="data-table"><thead><tr>';
    html += '<th>Employee</th><th>Leave Type</th><th>Period</th><th>Days</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (const app of apps) {
        html += `<tr>`;
        html += `<td>${esc(app.employeeName || app.employee_name || '')}</td>`;
        html += `<td>${esc(getLeaveTypeLabel(app.leaveType || app.leave_type))}</td>`;
        html += `<td>${esc(fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to))}</td>`;
        html += `<td>${fmt(toNum(app.numDays || app.num_days))}</td>`;
        html += `<td><div class="cell-actions">
            <button class="btn btn-success btn-sm btn-certify" data-id="${esc(app.id)}">Certify</button>
            <button class="btn btn-ghost btn-sm btn-view" data-id="${esc(app.id)}">View</button>
        </div></td>`;
        html += '</tr>';
    }
    html += '</tbody></table></div>';
    container.innerHTML = html;

    container.addEventListener('click', (e) => {
        const certBtn = e.target.closest('.btn-certify');
        if (certBtn) { openCertificationModal(certBtn.dataset.id); return; }
        const viewBtn = e.target.closest('.btn-view');
        if (viewBtn) showApplicationDetail(viewBtn.dataset.id);
    });
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
function renderMonthlyChart() {
    destroyChart(monthlyChart);
    const now = new Date();
    const months = [];
    const counts = [];

    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toLocaleString('en-US', { month: 'short' }));
        const m = d.getMonth(), y = d.getFullYear();
        counts.push(certifiedApps.filter(a => {
            const dt = new Date(a.hrApprovedAt || a.hr_approved_at || a.updatedAt || '');
            return dt.getMonth() === m && dt.getFullYear() === y;
        }).length);
    }

    monthlyChart = createBarChart({
        el: '#chart-monthly',
        labels: months,
        datasets: [{ label: 'Certified', data: counts, color: '#d32f2f' }],
    });
}

function renderTypesChart() {
    destroyChart(typesChart);
    const typeCounts = {};
    for (const app of allApps) {
        const type = getLeaveTypeLabel(app.leaveType || app.leave_type);
        typeCounts[type] = (typeCounts[type] || 0) + 1;
    }
    const total = Object.values(typeCounts).reduce((a, b) => a + b, 0);
    typesChart = createDoughnutChart({
        el: '#chart-types',
        labels: Object.keys(typeCounts),
        data: Object.values(typeCounts),
        colors: ['#1565c0', '#c62828', '#e65100', '#6a1b9a', '#2e7d32', '#ff8f00', '#283593'],
    });
    setText('chart-types-total', total);
}

function renderReportCharts() {
    // Status distribution
    destroyChart(statusChart);
    const statusCounts = {};
    for (const app of allApps) {
        const s = app.status || 'pending';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
    }
    statusChart = createBarChart({
        el: '#chart-status',
        labels: Object.keys(statusCounts),
        datasets: [{ label: 'Count', data: Object.values(statusCounts), colors: Object.keys(statusCounts).map(s => {
            if (s === 'approved') return '#2e7d32';
            if (s === 'pending') return '#ff8f00';
            if (s === 'returned') return '#e65100';
            if (s === 'rejected') return '#c62828';
            return '#546e7a';
        }) }],
        dimOnHover: true,
    });

    // Office breakdown
    destroyChart(officeChart);
    const officeCounts = {};
    for (const app of allApps) {
        const o = app.office || 'Unknown';
        officeCounts[o] = (officeCounts[o] || 0) + 1;
    }
    const sorted = Object.entries(officeCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
    officeChart = createBarChart({
        el: '#chart-office',
        labels: sorted.map(e => e[0].length > 25 ? e[0].substring(0, 25) + '...' : e[0]),
        datasets: [{ label: 'Applications', data: sorted.map(e => e[1]), color: '#d32f2f' }],
        horizontal: true,
    });
}

// ---------------------------------------------------------------------------
// Pending Table
// ---------------------------------------------------------------------------
function renderPendingTable() {
    const tableData = pendingApps.map(app => ({
        id: app.id,
        employee: app.employeeName || app.employee_name || '',
        leaveType: getLeaveTypeLabel(app.leaveType || app.leave_type),
        dates: fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to),
        numDays: toNum(app.numDays || app.num_days),
        office: app.office || '',
        filed: fmtDate(app.submittedAt || app.created_at || app.createdAt),
        _raw: app,
    }));

    pendingTable = createDataTable({
        el: '#pending-table',
        columns: [
            { key: 'employee', label: 'Employee', sortable: true },
            { key: 'leaveType', label: 'Leave Type', sortable: true },
            { key: 'dates', label: 'Period', sortable: false },
            { key: 'numDays', label: 'Days', sortable: true, type: 'number' },
            { key: 'office', label: 'Office', sortable: true },
            {
                key: 'actions', label: 'Actions',
                render: (val, row) => `<div class="cell-actions">
                    <button class="btn btn-success btn-sm btn-certify" data-id="${esc(row.id)}">Certify</button>
                    <button class="btn btn-warning btn-sm btn-return" data-id="${esc(row.id)}">Return</button>
                </div>`,
            },
        ],
        data: tableData,
        searchable: true,
        searchKeys: ['employee', 'leaveType', 'office'],
        pageSize: 15,
        emptyTitle: 'No Pending Certifications',
        emptyMessage: 'All applications have been processed.',
    });

    bindTableActions('#pending-table');
}

// ---------------------------------------------------------------------------
// Certified Table
// ---------------------------------------------------------------------------
function renderCertifiedTable() {
    const tableData = certifiedApps.map(app => ({
        id: app.id,
        employee: app.employeeName || app.employee_name || '',
        leaveType: getLeaveTypeLabel(app.leaveType || app.leave_type),
        dates: fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to),
        numDays: toNum(app.numDays || app.num_days),
        status: app.status || 'pending',
        currentApprover: app.currentApprover || app.current_approver || '',
        certified: fmtDate(app.hrApprovedAt || app.hr_approved_at),
        _raw: app,
    }));

    certifiedTable = createDataTable({
        el: '#certified-table',
        columns: [
            { key: 'employee', label: 'Employee', sortable: true },
            { key: 'leaveType', label: 'Leave Type', sortable: true },
            { key: 'dates', label: 'Period', sortable: false },
            { key: 'numDays', label: 'Days', sortable: true, type: 'number' },
            { key: 'status', label: 'Status', sortable: true, render: (v, r) => statusBadge(v, r.currentApprover) },
            { key: 'certified', label: 'Certified', sortable: true, type: 'date' },
            { key: 'actions', label: '', render: (v, r) => `<button class="btn btn-ghost btn-sm btn-view" data-id="${esc(r.id)}">View</button>` },
        ],
        data: tableData,
        searchable: true,
        searchKeys: ['employee', 'leaveType'],
        pageSize: 15,
        filters: [
            { key: 'status', label: 'Status', options: ['All', 'pending', 'approved', 'returned', 'rejected'] },
        ],
        emptyTitle: 'No Certified Applications',
        emptyMessage: 'No applications have been certified yet.',
        onRowClick: (row) => showApplicationDetail(row.id),
    });

    bindTableActions('#certified-table');
}

function bindTableActions(selector) {
    document.querySelector(selector)?.addEventListener('click', (e) => {
        const certBtn = e.target.closest('.btn-certify');
        if (certBtn) { e.stopPropagation(); openCertificationModal(certBtn.dataset.id); return; }
        const retBtn = e.target.closest('.btn-return');
        if (retBtn) { e.stopPropagation(); showReturnModal(retBtn.dataset.id); return; }
        const viewBtn = e.target.closest('.btn-view');
        if (viewBtn) { e.stopPropagation(); showApplicationDetail(viewBtn.dataset.id); }
    });
}

// ---------------------------------------------------------------------------
// HR Certification Modal (core workflow)
// ---------------------------------------------------------------------------
async function openCertificationModal(appId) {
    const app = [...pendingApps, ...certifiedApps].find(a => a.id === appId);
    if (!app) { toast.warning('Application not found.'); return; }

    const email = app.employeeEmail || app.employee_email;
    toast.info('Loading leave credits...');

    // Fetch employee credits + CTO in parallel
    const [creditsRes, ctoRes] = await Promise.all([
        fetch(`/api/leave-credits?employeeId=${encodeURIComponent(email)}`).then(r => r.ok ? r.json() : null).catch(() => null),
        fetch(`/api/cto-records?employeeId=${encodeURIComponent(email)}`).then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    const credits = creditsRes?.credits || {};
    const ctoRecords = ctoRes?.records || [];
    const ctoBalance = ctoRecords.reduce((s, r) => s + toNum(r.balance || (toNum(r.daysGranted || r.days_granted) - toNum(r.daysUsed || r.days_used))), 0);

    const vlEarned = toNum(credits.vacationLeaveEarned || credits.vacation_leave_earned);
    const vlSpent = toNum(credits.vacationLeaveSpent || credits.vacation_leave_spent);
    const slEarned = toNum(credits.sickLeaveEarned || credits.sick_leave_earned);
    const slSpent = toNum(credits.sickLeaveSpent || credits.sick_leave_spent);
    const splEarned = toNum(credits.splEarned || credits.spl || 3);
    const splSpent = toNum(credits.splSpent);
    const flEarned = toNum(credits.forceLeaveEarned || credits.mandatoryForced || 5);
    const flSpent = toNum(credits.forceLeaveSpent);
    const wlEarned = toNum(credits.wellnessEarned || credits.wellness_earned || 5);
    const wlSpent = toNum(credits.wellnessSpent || credits.wellness_spent);
    const ctoEarned = ctoBalance;
    const ctoSpent = 0;

    if (!creditsRes) {
        toast.warning('Could not load leave credits. Balances may show as 0.');
    }

    const content = `
        <div style="margin-bottom:var(--space-4)">
            <p><strong>Employee:</strong> ${esc(app.employeeName || app.employee_name || '')}</p>
            <p><strong>Leave Type:</strong> ${esc(getLeaveTypeLabel(app.leaveType || app.leave_type))}</p>
            <p><strong>Period:</strong> ${esc(fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to))}</p>
            <p><strong>Days Requested:</strong> ${fmt(toNum(app.numDays || app.num_days))}</p>
        </div>

        <div class="card" style="margin-bottom:var(--space-4)">
            <div class="card-header"><h4 class="card-title" style="font-size:var(--text-sm)">7.A — Certification of Leave Credits</h4></div>
            <div class="card-body">
                <div class="cert-grid">
                    <div class="cert-grid-header"></div>
                    <div class="cert-grid-header">Earned</div>
                    <div class="cert-grid-header">Less</div>
                    <div class="cert-grid-header">Balance</div>

                    <div class="cert-grid-label">Vacation Leave</div>
                    <div><input type="number" step="0.001" id="cert-vl-earned" value="${fmt(vlEarned)}"></div>
                    <div><input type="number" step="0.001" id="cert-vl-less" value="${fmt(vlSpent)}"></div>
                    <div><input type="number" step="0.001" id="cert-vl-balance" value="${fmt(vlEarned - vlSpent)}" readonly></div>

                    <div class="cert-grid-label">Sick Leave</div>
                    <div><input type="number" step="0.001" id="cert-sl-earned" value="${fmt(slEarned)}"></div>
                    <div><input type="number" step="0.001" id="cert-sl-less" value="${fmt(slSpent)}"></div>
                    <div><input type="number" step="0.001" id="cert-sl-balance" value="${fmt(slEarned - slSpent)}" readonly></div>

                    <div class="cert-grid-label">Special Privilege</div>
                    <div><input type="number" step="0.001" id="cert-spl-earned" value="${fmt(splEarned)}"></div>
                    <div><input type="number" step="0.001" id="cert-spl-less" value="${fmt(splSpent)}"></div>
                    <div><input type="number" step="0.001" id="cert-spl-balance" value="${fmt(splEarned - splSpent)}" readonly></div>

                    <div class="cert-grid-label">Force Leave</div>
                    <div><input type="number" step="0.001" id="cert-fl-earned" value="${fmt(flEarned)}"></div>
                    <div><input type="number" step="0.001" id="cert-fl-less" value="${fmt(flSpent)}"></div>
                    <div><input type="number" step="0.001" id="cert-fl-balance" value="${fmt(flEarned - flSpent)}" readonly></div>

                    <div class="cert-grid-label">Wellness Leave</div>
                    <div><input type="number" step="0.001" id="cert-wl-earned" value="${fmt(wlEarned)}"></div>
                    <div><input type="number" step="0.001" id="cert-wl-less" value="${fmt(wlSpent)}"></div>
                    <div><input type="number" step="0.001" id="cert-wl-balance" value="${fmt(wlEarned - wlSpent)}" readonly></div>

                    <div class="cert-grid-label">CTO</div>
                    <div><input type="number" step="0.001" id="cert-cto-earned" value="${fmt(ctoEarned)}"></div>
                    <div><input type="number" step="0.001" id="cert-cto-less" value="${fmt(ctoSpent)}"></div>
                    <div><input type="number" step="0.001" id="cert-cto-balance" value="${fmt(ctoEarned - ctoSpent)}" readonly></div>
                </div>
            </div>
        </div>

        <div class="card" style="margin-bottom:var(--space-4)">
            <div class="card-header"><h4 class="card-title" style="font-size:var(--text-sm)">7.B — Recommendation</h4></div>
            <div class="card-body">
                <div class="form-group">
                    <label class="form-label">Days Approved</label>
                    <input type="number" step="0.001" class="form-input" id="cert-days-approved" value="${fmt(toNum(app.numDays || app.num_days))}" style="max-width:150px">
                </div>
                <div class="form-group">
                    <label class="form-label">Remarks</label>
                    <textarea class="form-textarea" id="cert-remarks" rows="2" placeholder="Optional remarks..."></textarea>
                </div>
            </div>
        </div>

        <div class="card" style="margin-bottom:var(--space-4)">
            <div class="card-header"><h4 class="card-title" style="font-size:var(--text-sm)">Authorized Officer Signature</h4></div>
            <div class="card-body">
                <canvas id="cert-signature-canvas" class="signature-canvas" width="500" height="120"></canvas>
                <div style="margin-top:var(--space-2);display:flex;gap:var(--space-2)">
                    <button class="btn btn-ghost btn-sm" id="cert-sig-clear">Clear</button>
                    <label class="btn btn-ghost btn-sm" style="cursor:pointer">
                        Upload Image
                        <input type="file" accept="image/*" id="cert-sig-upload" style="display:none">
                    </label>
                </div>
            </div>
        </div>
    `;

    const modal = openModal({
        title: `Certify — ${appId}`,
        content,
        size: 'lg',
        footer: `
            <button class="btn btn-ghost btn-sm" id="cert-cancel">Cancel</button>
            <button class="btn btn-warning btn-sm" id="cert-return">Return to Employee</button>
            <button class="btn btn-success btn-sm" id="cert-approve">Certify & Forward to ASDS</button>
        `,
    });

    // Initialize signature canvas
    initSignatureCanvas('cert-signature-canvas', 'cert-sig-clear', 'cert-sig-upload');

    // Auto-calculate balances for all leave types
    function bindBalanceCalc(prefix) {
        ['cert-' + prefix + '-earned', 'cert-' + prefix + '-less'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                const earned = toNum(document.getElementById('cert-' + prefix + '-earned')?.value);
                const less = toNum(document.getElementById('cert-' + prefix + '-less')?.value);
                const balEl = document.getElementById('cert-' + prefix + '-balance');
                if (balEl) balEl.value = fmt(earned - less);
            });
        });
    }
    ['vl', 'sl', 'spl', 'fl', 'wl', 'cto'].forEach(bindBalanceCalc);

    // Actions
    document.getElementById('cert-cancel')?.addEventListener('click', () => modal.close());
    document.getElementById('cert-return')?.addEventListener('click', () => {
        modal.close();
        showReturnModal(appId);
    });
    document.getElementById('cert-approve')?.addEventListener('click', async () => {
        const canvas = document.getElementById('cert-signature-canvas');
        const signatureData = canvas ? canvas.toDataURL('image/png') : '';
        const remarks = document.getElementById('cert-remarks')?.value || '';
        const daysApproved = document.getElementById('cert-days-approved')?.value || '';

        // Collect all certified balance data
        const certData = {
            vlEarned: toNum(document.getElementById('cert-vl-earned')?.value),
            vlLess: toNum(document.getElementById('cert-vl-less')?.value),
            vlBalance: toNum(document.getElementById('cert-vl-balance')?.value),
            slEarned: toNum(document.getElementById('cert-sl-earned')?.value),
            slLess: toNum(document.getElementById('cert-sl-less')?.value),
            slBalance: toNum(document.getElementById('cert-sl-balance')?.value),
            splEarned: toNum(document.getElementById('cert-spl-earned')?.value),
            splLess: toNum(document.getElementById('cert-spl-less')?.value),
            splBalance: toNum(document.getElementById('cert-spl-balance')?.value),
            flEarned: toNum(document.getElementById('cert-fl-earned')?.value),
            flLess: toNum(document.getElementById('cert-fl-less')?.value),
            flBalance: toNum(document.getElementById('cert-fl-balance')?.value),
            wlEarned: toNum(document.getElementById('cert-wl-earned')?.value),
            wlLess: toNum(document.getElementById('cert-wl-less')?.value),
            wlBalance: toNum(document.getElementById('cert-wl-balance')?.value),
            ctoEarned: toNum(document.getElementById('cert-cto-earned')?.value),
            ctoLess: toNum(document.getElementById('cert-cto-less')?.value),
            ctoBalance: toNum(document.getElementById('cert-cto-balance')?.value),
            daysApproved: toNum(daysApproved),
        };

        await processHRAction(appId, 'approved', remarks, signatureData, certData);
        modal.close();
    });
}

// ---------------------------------------------------------------------------
// Return Modal
// ---------------------------------------------------------------------------
function showReturnModal(appId) {
    const app = [...pendingApps, ...certifiedApps].find(a => a.id === appId);
    if (!app) return;

    const content = `
        <p>Return <strong>${esc(appId)}</strong> to employee for revision.</p>
        <div class="form-group" style="margin-top:var(--space-3)">
            <label class="form-label">Reason for Return</label>
            <textarea class="form-textarea" id="return-reason" rows="3" placeholder="Specify what needs to be corrected..."></textarea>
        </div>
    `;

    const modal = openModal({
        title: 'Return Application',
        content,
        size: 'md',
        footer: `
            <button class="btn btn-ghost btn-sm" id="return-cancel">Cancel</button>
            <button class="btn btn-warning btn-sm" id="return-confirm">Return to Employee</button>
        `,
    });

    document.getElementById('return-cancel')?.addEventListener('click', () => modal.close());
    document.getElementById('return-confirm')?.addEventListener('click', async () => {
        const reason = document.getElementById('return-reason')?.value || '';
        if (!reason.trim()) { toast.warning('Please provide a reason for return.'); return; }
        await processHRAction(appId, 'returned', reason, '');
        modal.close();
    });
}

// ---------------------------------------------------------------------------
// Process HR Action
// ---------------------------------------------------------------------------
async function processHRAction(appId, action, remarks, signature, certData) {
    try {
        const payload = {
            applicationId: appId,
            action,
            remarks,
            portal: 'HR',
            approverName: user.name || user.fullName || '',
            authorizedOfficerName: user.name || user.fullName || '',
            authorizedOfficerSignature: signature || undefined,
        };

        // Include certified balance data when approving
        if (certData) {
            Object.assign(payload, certData);
        }

        const res = await fetch('/api/approve-leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (res.ok) {
            const label = action === 'approved' ? 'certified and forwarded to ASDS' : 'returned to employee';
            toast.success(`Application ${label}.`);
            await refreshAll();
        } else {
            const data = await res.json().catch(() => ({}));
            toast.error(data.error?.message || data.message || 'Failed to process application.');
        }
    } catch (err) {
        toast.error('Network error. Please try again.');
    }
}

// ---------------------------------------------------------------------------
// Signature Canvas
// ---------------------------------------------------------------------------
function initSignatureCanvas(canvasId, clearBtnId, uploadInputId) {
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

    function startDraw(e) {
        e.preventDefault();
        isDrawing = true;
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
    }

    function draw(e) {
        if (!isDrawing) return;
        e.preventDefault();
        const pos = getPos(e);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.strokeStyle = '#000';
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
        canvas.classList.add('has-signature');
    }

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
// Application Detail
// ---------------------------------------------------------------------------
function showApplicationDetail(appId) {
    const app = [...pendingApps, ...certifiedApps].find(a => a.id === appId);
    if (!app) { toast.warning('Application not found.'); return; }

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

    const content = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div><label class="form-label">Application ID</label><div>${esc(app.id)}</div></div>
            <div><label class="form-label">Status</label><div>${statusBadge(app.status, app.currentApprover || app.current_approver)}</div></div>
            <div><label class="form-label">Employee</label><div>${esc(app.employeeName || app.employee_name || '')}</div></div>
            <div><label class="form-label">Leave Type</label><div>${esc(getLeaveTypeLabel(app.leaveType || app.leave_type))}</div></div>
            <div><label class="form-label">Period</label><div>${esc(fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to))}</div></div>
            <div><label class="form-label">Days</label><div>${fmt(toNum(app.numDays || app.num_days))}</div></div>
            <div><label class="form-label">Office</label><div>${esc(app.office || '')}</div></div>
            <div><label class="form-label">Filed</label><div>${esc(fmtDate(app.submittedAt || app.created_at))}</div></div>
            ${leaveDetails}
        </div>
        ${soSection}
        ${timeline}
    `;

    openModal({ title: `Application — ${appId}`, content, size: 'lg' });
}

// ---------------------------------------------------------------------------
// Employee Cards Tab
// ---------------------------------------------------------------------------
async function loadEmployees() {
    try {
        const res = await fetch('/api/all-employees');
        if (!res.ok) throw new Error();
        const data = await res.json();
        employees = data.employees || [];

        employeesTable = createDataTable({
            el: '#employees-table',
            columns: [
                { key: 'name', label: 'Name', sortable: true },
                { key: 'email', label: 'Email', sortable: true },
                { key: 'office', label: 'Office', sortable: true },
                {
                    key: 'actions', label: '',
                    render: (v, row) => `<button class="btn btn-primary btn-sm btn-open-card" data-email="${esc(row.email)}">View Card</button>`,
                },
            ],
            data: employees.map(e => ({
                id: e.email,
                name: e.name || e.fullName || '',
                email: e.email || '',
                office: e.office || '',
            })),
            searchable: true,
            searchKeys: ['name', 'email', 'office'],
            pageSize: 15,
            emptyTitle: 'No Employees',
            emptyMessage: 'No registered employees found.',
        });

        document.getElementById('employees-table')?.addEventListener('click', async (e) => {
            const btn = e.target.closest('.btn-open-card');
            if (!btn) return;
            const email = btn.dataset.email;
            try {
                const res = await fetch(`/api/leave-credits?employeeId=${encodeURIComponent(email)}`);
                if (!res.ok) throw new Error();
                const data = await res.json();
                const c = data.credits || {};
                const vlBal = toNum(c.vacationLeaveEarned || c.vacation_leave_earned) - toNum(c.vacationLeaveSpent || c.vacation_leave_spent);
                const slBal = toNum(c.sickLeaveEarned || c.sick_leave_earned) - toNum(c.sickLeaveSpent || c.sick_leave_spent);
                openModal({
                    title: `Leave Card — ${esc(c.name || email)}`,
                    content: `
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                            <div class="stat-card" style="text-align:center;padding:var(--space-3)">
                                <div style="font-size:var(--text-2xl);font-weight:bold;color:var(--color-info)">${fmt(vlBal)}</div>
                                <div style="font-size:var(--text-xs)">VL Balance</div>
                            </div>
                            <div class="stat-card" style="text-align:center;padding:var(--space-3)">
                                <div style="font-size:var(--text-2xl);font-weight:bold;color:var(--color-danger)">${fmt(slBal)}</div>
                                <div style="font-size:var(--text-xs)">SL Balance</div>
                            </div>
                        </div>`,
                    size: 'md',
                });
            } catch { toast.error('Failed to load leave card.'); }
        });
    } catch { toast.error('Failed to load employees.'); }
}

// ---------------------------------------------------------------------------
// Profile Modal
// ---------------------------------------------------------------------------
function showProfileModal() {
    openModal({
        title: 'My Profile',
        content: `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                <div><label class="form-label">Name</label><div>${esc(user.name || user.fullName || '')}</div></div>
                <div><label class="form-label">Email</label><div>${esc(user.email || '')}</div></div>
                <div><label class="form-label">Role</label><div>Human Resources</div></div>
            </div>`,
        size: 'md',
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmt(v) { const n = toNum(v); return n % 1 === 0 ? String(n) : n.toFixed(3); }
function fmtDate(s) { if (!s) return '--'; const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
function fmtDateRange(f, t) { const a = fmtDate(f), b = fmtDate(t); return a === b || b === '--' ? a : `${a} - ${b}`; }
function esc(s) { return escapeHtml(s); }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }

function statusBadge(status, approver) {
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
