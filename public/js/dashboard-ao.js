/**
 * AO Dashboard — Administrative Officer portal module.
 *
 * Features: pending approvals, approve/return/reject workflow,
 * employee leave card management, CTO records, approval charts.
 */

import { initSidebar, ICONS } from '../components/sidebar.js';
import { createTabs } from '../components/tabs.js';
import { createDataTable } from '../components/table.js';
import { createBarChart, createDoughnutChart, destroyChart } from '../components/chart-wrapper.js';
import { toast } from '../components/toast.js';
import { openModal, closeModal, confirmModal } from '../components/modal.js';
import { renderEmptyState } from '../components/empty-state.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let user = null;
let sidebar = null;
let tabs = null;
let allApplications = [];
let employees = [];

// Tables
let pendingTable = null;
let approvedTable = null;
let employeesTable = null;
let ctoTable = null;

// Charts
let activityChart = null;
let typesChart = null;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        user = await fetchUser();
        if (!user) return;

        initLogoutSystem({ storage: 'local', redirectUrl: '/ao-login' });

        setupSidebar();
        setupTabs();
        setupTopbar();

        await loadOverviewData();
    } catch (err) {
        console.error('[AO Dashboard] Init failed:', err);
        toast.error('Failed to load dashboard. Please refresh.');
    }
}

// ---------------------------------------------------------------------------
// Auth
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
            name: user.name || user.fullName || 'Administrative Officer',
            role: 'Administrative Officer',
        },
        roleColor: '#1e3c72',
        activeId: 'overview',
        sections: [
            {
                title: 'Dashboard',
                links: [
                    { id: 'overview', label: 'Overview', icon: ICONS.home },
                    { id: 'pending', label: 'Pending Approvals', icon: ICONS.clipboardList, badge: 0 },
                    { id: 'approved', label: 'Approved', icon: ICONS.checkCircle },
                ],
            },
            {
                title: 'Management',
                links: [
                    { id: 'cards', label: 'Employee Cards', icon: ICONS.creditCard },
                    { id: 'cto', label: 'CTO Records', icon: ICONS.clock },
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
            { id: 'approved', label: 'Approved' },
            { id: 'cards', label: 'Employee Cards' },
            { id: 'cto', label: 'CTO' },
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
        case 'pending':
            if (!pendingTable) renderPendingTable();
            break;
        case 'approved':
            if (!approvedTable) renderApprovedTable();
            break;
        case 'cards':
            if (!employeesTable) loadEmployees();
            break;
        case 'cto':
            if (!ctoTable) loadEmployeesForCTO();
            break;
    }
}

// ---------------------------------------------------------------------------
// Topbar
// ---------------------------------------------------------------------------
function setupTopbar() {
    const title = document.getElementById('topbar-title');
    if (title) {
        const firstName = user.firstName || user.first_name || (user.name || '').split(' ')[0] || 'AO';
        title.textContent = `AO Dashboard — ${firstName}`;
    }

    document.getElementById('btn-refresh')?.addEventListener('click', refreshAll);

    document.getElementById('btn-view-all-pending')?.addEventListener('click', () => {
        tabs.setActive('pending');
        sidebar.setActive('pending');
    });
}

async function refreshAll() {
    toast.info('Refreshing...');
    allApplications = [];
    pendingTable = null;
    approvedTable = null;
    await loadOverviewData();
    toast.success('Data refreshed.');
}

// ---------------------------------------------------------------------------
// Overview Data
// ---------------------------------------------------------------------------
async function loadOverviewData() {
    const res = await fetch(`/api/portal-applications/AO?t=${Date.now()}`);
    if (!res.ok) {
        toast.error('Failed to load applications.');
        return;
    }

    const data = await res.json();
    allApplications = data.applications || data || [];

    const pending = allApplications.filter(a =>
        a.status === 'pending' && (a.currentApprover || a.current_approver || '').toUpperCase() === 'AO'
    );
    const approved = allApplications.filter(a => a.status !== 'pending' || (a.currentApprover || a.current_approver || '').toUpperCase() !== 'AO');

    const now = new Date();
    const thisMonth = approved.filter(a => {
        const d = new Date(a.aoApprovedAt || a.ao_approved_at || a.updatedAt || a.updated_at || '');
        return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    });

    // Stat cards
    setText('stat-pending', pending.length);
    setText('stat-approved', thisMonth.length);
    setText('stat-total', allApplications.length);

    // Badges
    tabs.updateBadge('pending', pending.length);
    sidebar.updateBadge('pending', pending.length);

    // Render recent pending
    renderRecentPending(pending);

    // Charts
    renderActivityChart(allApplications);
    renderTypesChart(allApplications);
}

// ---------------------------------------------------------------------------
// Recent Pending (Overview)
// ---------------------------------------------------------------------------
function renderRecentPending(pending) {
    const container = document.getElementById('recent-pending-list');
    if (!container) return;

    const recent = pending.slice(0, 5);

    if (recent.length === 0) {
        renderEmptyState(container, {
            icon: 'inbox',
            title: 'No Pending Applications',
            description: 'All caught up! No applications awaiting your review.',
        });
        return;
    }

    let html = '<div class="table-container"><table class="data-table"><thead><tr>';
    html += '<th>Employee</th><th>Leave Type</th><th>Period</th><th>Days</th><th>Actions</th>';
    html += '</tr></thead><tbody>';

    for (const app of recent) {
        const name = app.employeeName || app.employee_name || app.employeeEmail || '';
        const type = getLeaveTypeLabel(app.leaveType || app.leave_type);
        const from = fmtDate(app.dateFrom || app.date_from);
        const to = fmtDate(app.dateTo || app.date_to);
        const days = toNum(app.numDays || app.num_days);

        html += `<tr>`;
        html += `<td>${esc(name)}</td>`;
        html += `<td>${esc(type)}</td>`;
        html += `<td>${esc(from)} - ${esc(to)}</td>`;
        html += `<td>${fmt(days)}</td>`;
        html += `<td><div class="cell-actions">
            <button class="btn btn-success btn-sm btn-quick-approve" data-id="${esc(app.id)}">Approve</button>
            <button class="btn btn-ghost btn-sm btn-quick-view" data-id="${esc(app.id)}">View</button>
        </div></td>`;
        html += '</tr>';
    }

    html += '</tbody></table></div>';
    container.innerHTML = html;

    // Bind quick actions
    container.addEventListener('click', (e) => {
        const approveBtn = e.target.closest('.btn-quick-approve');
        if (approveBtn) { showApprovalModal(approveBtn.dataset.id, 'approved'); return; }
        const viewBtn = e.target.closest('.btn-quick-view');
        if (viewBtn) { showApplicationDetail(viewBtn.dataset.id); }
    });
}

// ---------------------------------------------------------------------------
// Charts
// ---------------------------------------------------------------------------
function renderActivityChart(apps) {
    destroyChart(activityChart);
    const container = document.getElementById('chart-activity');
    if (!container) return;

    const now = new Date();
    const months = [];
    const approvedCounts = [];
    const returnedCounts = [];

    for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push(d.toLocaleString('en-US', { month: 'short' }));
        const m = d.getMonth();
        const y = d.getFullYear();

        approvedCounts.push(apps.filter(a => {
            const dt = new Date(a.aoApprovedAt || a.ao_approved_at || a.updatedAt || a.updated_at || '');
            return dt.getMonth() === m && dt.getFullYear() === y &&
                   a.status !== 'pending' && a.status !== 'returned';
        }).length);

        returnedCounts.push(apps.filter(a => {
            const dt = new Date(a.updatedAt || a.updated_at || '');
            return dt.getMonth() === m && dt.getFullYear() === y && a.status === 'returned';
        }).length);
    }

    activityChart = createBarChart({
        el: '#chart-activity',
        labels: months,
        datasets: [
            { label: 'Forwarded', data: approvedCounts, color: '#2e7d32' },
            { label: 'Returned', data: returnedCounts, color: '#e65100' },
        ],
    });
}

function renderTypesChart(apps) {
    destroyChart(typesChart);
    const container = document.getElementById('chart-types');
    if (!container) return;

    const typeCounts = {};
    for (const app of apps) {
        const type = getLeaveTypeLabel(app.leaveType || app.leave_type);
        typeCounts[type] = (typeCounts[type] || 0) + 1;
    }

    const labels = Object.keys(typeCounts);
    const data = Object.values(typeCounts);
    const total = data.reduce((a, b) => a + b, 0);

    typesChart = createDoughnutChart({
        el: '#chart-types',
        labels,
        data,
        colors: ['#1565c0', '#c62828', '#e65100', '#6a1b9a', '#2e7d32', '#ff8f00', '#283593', '#00838f'],
    });

    setText('chart-types-total', total);
}

// ---------------------------------------------------------------------------
// Pending Approvals Table
// ---------------------------------------------------------------------------
function renderPendingTable() {
    const pending = allApplications.filter(a =>
        a.status === 'pending' && (a.currentApprover || a.current_approver || '').toUpperCase() === 'AO'
    );

    const tableData = pending.map(app => ({
        id: app.id,
        employee: app.employeeName || app.employee_name || app.employeeEmail || '',
        leaveType: getLeaveTypeLabel(app.leaveType || app.leave_type),
        dates: fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to),
        numDays: toNum(app.numDays || app.num_days),
        filed: fmtDate(app.submittedAt || app.created_at || app.createdAt),
        office: app.office || '',
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
            { key: 'filed', label: 'Filed', sortable: true, type: 'date' },
            {
                key: 'actions', label: 'Actions',
                render: (val, row) => `<div class="cell-actions">
                    <button class="btn btn-success btn-sm btn-approve" data-id="${esc(row.id)}">Approve</button>
                    <button class="btn btn-warning btn-sm btn-return" data-id="${esc(row.id)}">Return</button>
                    <button class="btn btn-danger btn-sm btn-reject" data-id="${esc(row.id)}">Reject</button>
                    <button class="btn btn-ghost btn-sm btn-view" data-id="${esc(row.id)}">View</button>
                </div>`,
            },
        ],
        data: tableData,
        searchable: true,
        searchKeys: ['employee', 'leaveType', 'office'],
        searchPlaceholder: 'Search pending applications...',
        pageSize: 15,
        emptyTitle: 'No Pending Applications',
        emptyMessage: 'There are no applications awaiting your review.',
    });

    bindTableActions('#pending-table');
}

// ---------------------------------------------------------------------------
// Approved Table
// ---------------------------------------------------------------------------
function renderApprovedTable() {
    const processed = allApplications.filter(a =>
        a.status !== 'pending' || (a.currentApprover || a.current_approver || '').toUpperCase() !== 'AO'
    );

    const tableData = processed.map(app => ({
        id: app.id,
        employee: app.employeeName || app.employee_name || app.employeeEmail || '',
        leaveType: getLeaveTypeLabel(app.leaveType || app.leave_type),
        dates: fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to),
        numDays: toNum(app.numDays || app.num_days),
        status: app.status || 'pending',
        currentApprover: app.currentApprover || app.current_approver || '',
        _raw: app,
    }));

    approvedTable = createDataTable({
        el: '#approved-table',
        columns: [
            { key: 'employee', label: 'Employee', sortable: true },
            { key: 'leaveType', label: 'Leave Type', sortable: true },
            { key: 'dates', label: 'Period', sortable: false },
            { key: 'numDays', label: 'Days', sortable: true, type: 'number' },
            {
                key: 'status', label: 'Status', sortable: true,
                render: (val, row) => statusBadge(val, row.currentApprover),
            },
            {
                key: 'actions', label: '',
                render: (val, row) => `<button class="btn btn-ghost btn-sm btn-view" data-id="${esc(row.id)}">View</button>`,
            },
        ],
        data: tableData,
        searchable: true,
        searchKeys: ['employee', 'leaveType', 'status'],
        pageSize: 15,
        filters: [
            { key: 'status', label: 'Status', options: ['All', 'pending', 'approved', 'returned', 'rejected'] },
        ],
        emptyTitle: 'No Processed Applications',
        emptyMessage: 'No applications have been processed yet.',
        onRowClick: (row) => showApplicationDetail(row.id),
    });

    bindTableActions('#approved-table');
}

// ---------------------------------------------------------------------------
// Table Action Delegation
// ---------------------------------------------------------------------------
function bindTableActions(selector) {
    const el = document.querySelector(selector);
    if (!el) return;

    el.addEventListener('click', (e) => {
        const approveBtn = e.target.closest('.btn-approve');
        if (approveBtn) { e.stopPropagation(); showApprovalModal(approveBtn.dataset.id, 'approved'); return; }

        const returnBtn = e.target.closest('.btn-return');
        if (returnBtn) { e.stopPropagation(); showApprovalModal(returnBtn.dataset.id, 'returned'); return; }

        const rejectBtn = e.target.closest('.btn-reject');
        if (rejectBtn) { e.stopPropagation(); showApprovalModal(rejectBtn.dataset.id, 'rejected'); return; }

        const viewBtn = e.target.closest('.btn-view');
        if (viewBtn) { e.stopPropagation(); showApplicationDetail(viewBtn.dataset.id); }
    });
}

// ---------------------------------------------------------------------------
// Approval Modal
// ---------------------------------------------------------------------------
function showApprovalModal(appId, action) {
    const app = allApplications.find(a => a.id === appId);
    if (!app) { toast.warning('Application not found.'); return; }

    const actionLabel = action === 'approved' ? 'Approve' : action === 'returned' ? 'Return' : 'Reject';
    const actionClass = action === 'approved' ? 'btn-success' : action === 'returned' ? 'btn-warning' : 'btn-danger';
    const employee = app.employeeName || app.employee_name || app.employeeEmail || '';
    const type = getLeaveTypeLabel(app.leaveType || app.leave_type);

    const content = `
        <div style="margin-bottom:var(--space-4)">
            <p><strong>Employee:</strong> ${esc(employee)}</p>
            <p><strong>Leave Type:</strong> ${esc(type)}</p>
            <p><strong>Period:</strong> ${esc(fmtDateRange(app.dateFrom || app.date_from, app.dateTo || app.date_to))}</p>
            <p><strong>Days:</strong> ${fmt(toNum(app.numDays || app.num_days))}</p>
        </div>
        <div class="form-group">
            <label class="form-label">Remarks (optional)</label>
            <textarea id="approval-remarks" class="form-textarea" rows="3" placeholder="Add remarks..."></textarea>
        </div>
    `;

    const modal = openModal({
        title: `${actionLabel} Application — ${appId}`,
        content,
        size: 'md',
        footer: `
            <button class="btn btn-ghost btn-sm" id="modal-cancel">Cancel</button>
            <button class="btn ${actionClass} btn-sm" id="modal-confirm">${actionLabel}</button>
        `,
    });

    // Bind footer actions
    document.getElementById('modal-cancel')?.addEventListener('click', () => modal.close());
    document.getElementById('modal-confirm')?.addEventListener('click', async () => {
        const remarks = document.getElementById('approval-remarks')?.value || '';
        await processApproval(appId, action, remarks);
        modal.close();
    });
}

async function processApproval(appId, action, remarks) {
    try {
        const res = await fetch('/api/approve-leave', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                applicationId: appId,
                action,
                remarks,
                portal: 'AO',
                approverName: user.name || user.fullName || '',
            }),
        });

        if (res.ok) {
            const label = action === 'approved' ? 'forwarded to HR' : action === 'returned' ? 'returned to employee' : 'rejected';
            toast.success(`Application ${label} successfully.`);
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
// Application Detail Modal
// ---------------------------------------------------------------------------
function showApplicationDetail(appId) {
    const app = allApplications.find(a => a.id === appId);
    if (!app) { toast.warning('Application not found.'); return; }

    const type = getLeaveTypeLabel(app.leaveType || app.leave_type);
    const status = app.status || 'pending';
    const approver = app.currentApprover || app.current_approver || '';
    const employee = app.employeeName || app.employee_name || '';
    const from = fmtDate(app.dateFrom || app.date_from);
    const to = fmtDate(app.dateTo || app.date_to);
    const days = toNum(app.numDays || app.num_days);
    const filed = fmtDate(app.submittedAt || app.created_at || app.createdAt);

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

    const content = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div><label class="form-label">Application ID</label><div>${esc(app.id)}</div></div>
            <div><label class="form-label">Status</label><div>${statusBadge(status, approver)}</div></div>
            <div><label class="form-label">Employee</label><div>${esc(employee)}</div></div>
            <div><label class="form-label">Leave Type</label><div>${esc(type)}</div></div>
            <div><label class="form-label">Period</label><div>${esc(from)} to ${esc(to)}</div></div>
            <div><label class="form-label">Days</label><div>${fmt(days)}</div></div>
            <div><label class="form-label">Office</label><div>${esc(app.office || '')}</div></div>
            <div><label class="form-label">Filed</label><div>${esc(filed)}</div></div>
        </div>
        ${timeline}
    `;

    const isPending = status === 'pending' && approver.toUpperCase() === 'AO';

    openModal({
        title: `Application Details — ${app.id}`,
        content,
        size: 'lg',
        footer: isPending
            ? `<button class="btn btn-success btn-sm" onclick="document.dispatchEvent(new CustomEvent('ao-action',{detail:{id:'${esc(app.id)}',action:'approved'}}))">Approve</button>
               <button class="btn btn-warning btn-sm" onclick="document.dispatchEvent(new CustomEvent('ao-action',{detail:{id:'${esc(app.id)}',action:'returned'}}))">Return</button>
               <button class="btn btn-danger btn-sm" onclick="document.dispatchEvent(new CustomEvent('ao-action',{detail:{id:'${esc(app.id)}',action:'rejected'}}))">Reject</button>`
            : '',
    });
}

// Listen for action events from detail modal
document.addEventListener('ao-action', (e) => {
    const { id, action } = e.detail;
    closeModal(); // Close detail modal
    showApprovalModal(id, action);
});

// ---------------------------------------------------------------------------
// Employee Cards Tab
// ---------------------------------------------------------------------------
async function loadEmployees() {
    try {
        const res = await fetch('/api/all-employees');
        if (!res.ok) throw new Error('Failed to fetch employees');
        const data = await res.json();
        employees = data.employees || [];

        const tableData = employees.map(emp => ({
            id: emp.email,
            name: emp.name || emp.fullName || '',
            email: emp.email || '',
            office: emp.office || '',
            employeeNo: emp.employeeNo || emp.employee_number || '',
        }));

        employeesTable = createDataTable({
            el: '#employees-table',
            columns: [
                { key: 'name', label: 'Name', sortable: true },
                { key: 'email', label: 'Email', sortable: true },
                { key: 'office', label: 'Office', sortable: true },
                { key: 'employeeNo', label: 'Employee No.', sortable: true },
                {
                    key: 'actions', label: '',
                    render: (val, row) => `<button class="btn btn-primary btn-sm btn-open-card" data-email="${esc(row.email)}">Open Card</button>`,
                },
            ],
            data: tableData,
            searchable: true,
            searchKeys: ['name', 'email', 'office', 'employeeNo'],
            searchPlaceholder: 'Search employees...',
            pageSize: 15,
            emptyTitle: 'No Employees',
            emptyMessage: 'No registered employees found.',
        });

        document.getElementById('employees-table')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-open-card');
            if (btn) openLeaveCardModal(btn.dataset.email);
        });
    } catch (err) {
        toast.error('Failed to load employee list.');
    }
}

// ---------------------------------------------------------------------------
// Leave Card Modal
// ---------------------------------------------------------------------------
async function openLeaveCardModal(email) {
    toast.info('Loading leave card...');

    try {
        const res = await fetch(`/api/leave-credits?employeeId=${encodeURIComponent(email)}`);
        if (!res.ok) throw new Error('Failed');
        const data = await res.json();
        const credits = data.credits;

        if (!credits) {
            toast.warning('No leave card found for this employee.');
            return;
        }

        const vlEarned = toNum(credits.vacationLeaveEarned || credits.vacation_leave_earned);
        const vlSpent = toNum(credits.vacationLeaveSpent || credits.vacation_leave_spent);
        const slEarned = toNum(credits.sickLeaveEarned || credits.sick_leave_earned);
        const slSpent = toNum(credits.sickLeaveSpent || credits.sick_leave_spent);

        const content = `
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:var(--space-3);margin-bottom:var(--space-4)">
                <div class="stat-card" style="text-align:center;padding:var(--space-3)">
                    <div style="font-size:var(--text-2xl);font-weight:bold;color:var(--color-info)">${fmt(vlEarned - vlSpent)}</div>
                    <div style="font-size:var(--text-xs);color:var(--color-text-muted)">VL Balance</div>
                </div>
                <div class="stat-card" style="text-align:center;padding:var(--space-3)">
                    <div style="font-size:var(--text-2xl);font-weight:bold;color:var(--color-danger)">${fmt(slEarned - slSpent)}</div>
                    <div style="font-size:var(--text-xs);color:var(--color-text-muted)">SL Balance</div>
                </div>
                <div class="stat-card" style="text-align:center;padding:var(--space-3)">
                    <div style="font-size:var(--text-2xl);font-weight:bold;color:var(--color-warning)">${fmt(toNum(credits.forceLeaveEarned || credits.force_leave_earned || 5) - toNum(credits.forceLeaveSpent || credits.force_leave_spent))}</div>
                    <div style="font-size:var(--text-xs);color:var(--color-text-muted)">FL Balance</div>
                </div>
                <div class="stat-card" style="text-align:center;padding:var(--space-3)">
                    <div style="font-size:var(--text-2xl);font-weight:bold;color:var(--color-role-sds)">${fmt(toNum(credits.splEarned || credits.spl_earned || 3) - toNum(credits.splSpent || credits.spl_spent))}</div>
                    <div style="font-size:var(--text-xs);color:var(--color-text-muted)">SPL Balance</div>
                </div>
            </div>
            <div><strong>Email:</strong> ${esc(email)}</div>
            <div style="margin-top:var(--space-2)"><strong>VL:</strong> ${fmt(vlEarned)} earned / ${fmt(vlSpent)} spent</div>
            <div><strong>SL:</strong> ${fmt(slEarned)} earned / ${fmt(slSpent)} spent</div>
        `;

        openModal({
            title: `Leave Card — ${esc(credits.name || email)}`,
            content,
            size: 'lg',
        });
    } catch (err) {
        toast.error('Failed to load leave card.');
    }
}

// ---------------------------------------------------------------------------
// CTO Tab
// ---------------------------------------------------------------------------
async function loadEmployeesForCTO() {
    if (employees.length === 0) {
        try {
            const res = await fetch('/api/all-employees');
            if (res.ok) {
                const data = await res.json();
                employees = data.employees || [];
            }
        } catch (err) { /* fall through */ }
    }

    const tableData = employees.map(emp => ({
        id: emp.email,
        name: emp.name || emp.fullName || '',
        email: emp.email || '',
        office: emp.office || '',
    }));

    ctoTable = createDataTable({
        el: '#cto-table',
        columns: [
            { key: 'name', label: 'Name', sortable: true },
            { key: 'email', label: 'Email', sortable: true },
            { key: 'office', label: 'Office', sortable: true },
            {
                key: 'actions', label: '',
                render: (val, row) => `<button class="btn btn-primary btn-sm btn-open-cto" data-email="${esc(row.email)}">View CTO</button>`,
            },
        ],
        data: tableData,
        searchable: true,
        searchKeys: ['name', 'email', 'office'],
        pageSize: 15,
        emptyTitle: 'No Employees',
        emptyMessage: 'No employees found.',
    });

    document.getElementById('cto-table')?.addEventListener('click', async (e) => {
        const btn = e.target.closest('.btn-open-cto');
        if (btn) {
            const email = btn.dataset.email;
            try {
                const res = await fetch(`/api/cto-records?employeeId=${encodeURIComponent(email)}`);
                if (!res.ok) throw new Error('Failed');
                const data = await res.json();
                const records = data.records || [];
                const total = records.reduce((sum, r) => sum + toNum(r.balance || (toNum(r.daysGranted || r.days_granted) - toNum(r.daysUsed || r.days_used))), 0);

                let html = `<p><strong>Total CTO Balance:</strong> ${fmt(total)} days</p>`;
                if (records.length > 0) {
                    html += '<div class="table-container" style="margin-top:var(--space-3)"><table class="data-table"><thead><tr>';
                    html += '<th>SO Details</th><th>Period</th><th>Granted</th><th>Used</th><th>Balance</th>';
                    html += '</tr></thead><tbody>';
                    for (const r of records) {
                        html += `<tr>
                            <td>${esc(r.soDetails || r.so_details || '')}</td>
                            <td>${esc(r.periodCovered || r.period_covered || '')}</td>
                            <td>${fmt(toNum(r.daysGranted || r.days_granted))}</td>
                            <td>${fmt(toNum(r.daysUsed || r.days_used))}</td>
                            <td>${fmt(toNum(r.balance || (toNum(r.daysGranted || r.days_granted) - toNum(r.daysUsed || r.days_used))))}</td>
                        </tr>`;
                    }
                    html += '</tbody></table></div>';
                } else {
                    html += '<p style="color:var(--color-text-muted);margin-top:var(--space-3)">No CTO records found.</p>';
                }

                openModal({
                    title: `CTO Records — ${esc(email)}`,
                    content: html,
                    size: 'lg',
                });
            } catch (err) {
                toast.error('Failed to load CTO records.');
            }
        }
    });
}

// ---------------------------------------------------------------------------
// Profile Modal
// ---------------------------------------------------------------------------
function showProfileModal() {
    const content = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
            <div><label class="form-label">Name</label><div>${esc(user.name || user.fullName || '')}</div></div>
            <div><label class="form-label">Email</label><div>${esc(user.email || '')}</div></div>
            <div><label class="form-label">Role</label><div>Administrative Officer</div></div>
        </div>
    `;
    openModal({ title: 'My Profile', content, size: 'md' });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmt(v) { const n = toNum(v); return n % 1 === 0 ? String(n) : n.toFixed(3); }

function fmtDate(dateStr) {
    if (!dateStr) return '--';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return String(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtDateRange(from, to) {
    const f = fmtDate(from);
    const t = fmtDate(to);
    if (f === t || t === '--') return f;
    return `${f} - ${t}`;
}

function esc(str) { return escapeHtml(str); }
function setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; }

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
