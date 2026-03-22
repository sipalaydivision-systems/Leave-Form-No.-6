/**
 * IT Dashboard — System administration portal.
 *
 * Features: user management, registration approvals, system maintenance,
 * reconciliation, data operations, analytics.
 */

import { initSidebar, ICONS } from '../components/sidebar.js';
import { createTabs } from '../components/tabs.js';
import { createDataTable } from '../components/table.js';
import { createDoughnutChart, createBarChart, destroyChart } from '../components/chart-wrapper.js';
import { toast } from '../components/toast.js';
import { openModal, confirmModal } from '../components/modal.js';
import { renderEmptyState } from '../components/empty-state.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let user = null;
let sidebar = null;
let tabs = null;
let registrations = [];
let users = [];

let registrationsTable = null;
let usersTable = null;
let rolesChart = null;
let appStatusChart = null;

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
document.addEventListener('DOMContentLoaded', init);

async function init() {
    try {
        user = await fetchUser();
        if (!user) return;

        initLogoutSystem({ storage: 'local', redirectUrl: '/it-login' });

        setupSidebar();
        setupTabs();
        setupTopbar();

        await loadOverviewData();
    } catch (err) {
        console.error('[IT Dashboard] Init failed:', err);
        toast.error('Failed to load dashboard.');
    }
}

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
            name: user.name || user.fullName || 'IT Admin',
            role: 'IT Administrator',
        },
        roleColor: '#283593',
        activeId: 'overview',
        sections: [
            {
                title: 'Dashboard',
                links: [
                    { id: 'overview', label: 'Overview', icon: ICONS.home },
                    { id: 'registrations', label: 'Registrations', icon: ICONS.userPlus, badge: 0 },
                    { id: 'users', label: 'User Management', icon: ICONS.users },
                ],
            },
            {
                title: 'System',
                links: [
                    { id: 'system', label: 'Maintenance', icon: ICONS.server },
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
            { id: 'registrations', label: 'Registrations', badge: 0 },
            { id: 'users', label: 'Users' },
            { id: 'system', label: 'System' },
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
        case 'registrations': if (!registrationsTable) loadRegistrations(); break;
        case 'users': if (!usersTable) loadUsers(); break;
        case 'system': loadSystemStatus(); break;
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
    const firstName = user.firstName || user.first_name || (user.name || '').split(' ')[0] || 'IT';
    if (title) title.textContent = `IT Admin — ${firstName}`;

    // Hero
    setText('hero-greeting', `${getGreeting()}, ${firstName}`);
    const dateParts = [user.office, new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })];
    setText('hero-date', dateParts.filter(Boolean).join(' · '));

    document.getElementById('btn-refresh')?.addEventListener('click', async () => {
        toast.info('Refreshing...');
        registrationsTable = null; usersTable = null;
        await loadOverviewData();
        toast.success('Refreshed.');
    });
}

// ---------------------------------------------------------------------------
// Overview Data
// ---------------------------------------------------------------------------
async function loadOverviewData() {
    const [usersRes, regsRes, appsRes, stateRes] = await Promise.all([
        fetch('/api/all-registered-users').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/registration-stats').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/all-applications').then(r => r.ok ? r.json() : null).catch(() => null),
        fetch('/api/system-state').then(r => r.ok ? r.json() : null).catch(() => null),
    ]);

    // Users — endpoint returns { registrations: [...] }
    const allUsers = usersRes?.registrations || usersRes?.users || [];
    users = Array.isArray(allUsers) ? allUsers : [];
    setText('stat-users', users.length);

    // Registrations — endpoint returns { stats: { pending, ... } }
    const pendingCount = regsRes?.stats?.pending || regsRes?.pending || regsRes?.pendingCount || 0;
    setText('stat-pending-reg', pendingCount);
    tabs.updateBadge('registrations', pendingCount);
    sidebar.updateBadge('registrations', pendingCount);

    // Applications
    const apps = appsRes?.applications || appsRes || [];
    setText('stat-apps', apps.length);

    // System state — endpoint returns { state: { maintenanceMode } }
    const maintenance = stateRes?.state?.maintenanceMode || stateRes?.maintenanceMode || false;
    setText('stat-maintenance', maintenance ? 'Maintenance' : 'Online');

    // Hero metric
    setText('hero-metric', maintenance ? 'Maint.' : 'Online');

    // Charts
    renderRolesChart(allUsers);
    renderAppStatusChart(apps);
}

function renderRolesChart(allUsers) {
    destroyChart(rolesChart);
    if (!allUsers || allUsers.length === 0) { setText('chart-roles-total', 0); return; }
    const roleCounts = {};
    for (const u of allUsers) {
        const role = u.role || u.portal || 'user';
        roleCounts[role] = (roleCounts[role] || 0) + 1;
    }
    const total = Object.values(roleCounts).reduce((a, b) => a + b, 0);
    setText('chart-roles-total', total);

    rolesChart = createDoughnutChart({
        el: '#chart-roles',
        labels: Object.keys(roleCounts).map(r => r.toUpperCase()),
        data: Object.values(roleCounts),
        colors: ['#003366', '#1e3c72', '#d32f2f', '#ff6f00', '#6a1b9a', '#283593', '#2e7d32'],
    });
}

function renderAppStatusChart(apps) {
    destroyChart(appStatusChart);
    if (!apps || apps.length === 0) return;
    const statusCounts = {};
    for (const a of apps) {
        const s = a.status || 'pending';
        statusCounts[s] = (statusCounts[s] || 0) + 1;
    }

    appStatusChart = createBarChart({
        el: '#chart-app-status',
        labels: Object.keys(statusCounts),
        datasets: [{
            label: 'Count',
            data: Object.values(statusCounts),
            colors: Object.keys(statusCounts).map(s => {
                if (s === 'approved') return '#2e7d32';
                if (s === 'pending') return '#ff8f00';
                if (s === 'returned') return '#e65100';
                return '#c62828';
            }),
        }],
        dimOnHover: true,
    });
}

// ---------------------------------------------------------------------------
// Registrations Tab
// ---------------------------------------------------------------------------
async function loadRegistrations() {
    try {
        const res = await fetch('/api/all-registered-users');
        if (!res.ok) throw new Error();
        const data = await res.json();
        const allRegs = data.registrations || [];
        registrations = allRegs.filter(r => r.status === 'pending');

        registrationsTable = createDataTable({
            el: '#registrations-table',
            columns: [
                { key: 'name', label: 'Name', sortable: true },
                { key: 'email', label: 'Email', sortable: true },
                { key: 'office', label: 'Office', sortable: true },
                { key: 'position', label: 'Position', sortable: true },
                { key: 'date', label: 'Requested', sortable: true, type: 'date' },
                {
                    key: 'actions', label: 'Actions',
                    render: (v, row) => `<div class="cell-actions">
                        <button class="btn btn-success btn-sm btn-approve-reg" data-email="${esc(row.email)}">Approve</button>
                        <button class="btn btn-danger btn-sm btn-reject-reg" data-email="${esc(row.email)}">Reject</button>
                    </div>`,
                },
            ],
            data: registrations.map(r => ({
                id: r.email || r.id,
                name: r.name || r.fullName || '',
                email: r.email || '',
                office: r.office || '',
                position: r.position || '',
                date: fmtDate(r.createdAt || r.created_at || r.registeredAt),
            })),
            searchable: true,
            searchKeys: ['name', 'email', 'office'],
            pageSize: 15,
            emptyTitle: 'No Pending Registrations',
            emptyMessage: 'All registration requests have been processed.',
        });

        document.getElementById('registrations-table')?.addEventListener('click', (e) => {
            const approveBtn = e.target.closest('.btn-approve-reg');
            if (approveBtn) { processRegistration(approveBtn.dataset.email, 'approve'); return; }
            const rejectBtn = e.target.closest('.btn-reject-reg');
            if (rejectBtn) processRegistration(rejectBtn.dataset.email, 'reject');
        });
    } catch { toast.error('Failed to load registrations.'); }
}

async function processRegistration(email, action) {
    const endpoint = action === 'approve' ? '/api/approve-registration' : '/api/reject-registration';
    const label = action === 'approve' ? 'approved' : 'rejected';

    confirmModal({
        title: `${action === 'approve' ? 'Approve' : 'Reject'} Registration`,
        message: `Are you sure you want to ${action} the registration for ${email}?`,
        confirmText: action === 'approve' ? 'Approve' : 'Reject',
        confirmClass: action === 'approve' ? 'btn-success' : 'btn-danger',
        onConfirm: async () => {
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });
                if (res.ok) {
                    toast.success(`Registration ${label}.`);
                    registrationsTable = null;
                    loadRegistrations();
                    loadOverviewData();
                } else {
                    const data = await res.json().catch(() => ({}));
                    toast.error(data.message || `Failed to ${action} registration.`);
                }
            } catch { toast.error('Network error.'); }
        },
    });
}

// ---------------------------------------------------------------------------
// Users Tab
// ---------------------------------------------------------------------------
async function loadUsers() {
    try {
        if (users.length === 0) {
            const res = await fetch('/api/all-registered-users');
            if (res.ok) {
                const data = await res.json();
                users = data.registrations || data.users || [];
            }
        }

        usersTable = createDataTable({
            el: '#users-table',
            columns: [
                { key: 'name', label: 'Name', sortable: true },
                { key: 'email', label: 'Email', sortable: true },
                { key: 'role', label: 'Role', sortable: true, render: (v) => `<span class="badge badge-info">${esc((v || '').toUpperCase())}</span>` },
                { key: 'office', label: 'Office', sortable: true },
                {
                    key: 'actions', label: '',
                    render: (v, row) => `<div class="cell-actions">
                        <button class="btn btn-ghost btn-sm btn-reset-pw" data-email="${esc(row.email)}">Reset PW</button>
                        <button class="btn btn-ghost btn-sm btn-delete-user" data-email="${esc(row.email)}" style="color:var(--color-danger)">Delete</button>
                    </div>`,
                },
            ],
            data: users.map(u => ({
                id: u.email || u.id,
                name: u.name || u.fullName || '',
                email: u.email || '',
                role: u.role || u.portal || 'user',
                office: u.office || '',
            })),
            searchable: true,
            searchKeys: ['name', 'email', 'role', 'office'],
            pageSize: 20,
            filters: [
                { key: 'role', label: 'Role', options: ['All', 'user', 'ao', 'hr', 'asds', 'sds', 'it'] },
            ],
            emptyTitle: 'No Users',
            emptyMessage: 'No registered users found.',
        });

        document.getElementById('users-table')?.addEventListener('click', (e) => {
            const resetBtn = e.target.closest('.btn-reset-pw');
            if (resetBtn) { resetPassword(resetBtn.dataset.email); return; }
            const deleteBtn = e.target.closest('.btn-delete-user');
            if (deleteBtn) deleteUser(deleteBtn.dataset.email);
        });

        // Add IT Staff button
        document.getElementById('btn-add-staff')?.addEventListener('click', showAddStaffModal);
    } catch { toast.error('Failed to load users.'); }
}

function resetPassword(email) {
    confirmModal({
        title: 'Reset Password',
        message: `Reset password for ${email}? They will need to set a new password.`,
        confirmText: 'Reset',
        confirmClass: 'btn-warning',
        onConfirm: async () => {
            try {
                const res = await fetch('/api/it/reset-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });
                if (res.ok) {
                    const data = await res.json();
                    toast.success(`Password reset. Temp: ${data.tempPassword || 'Check logs'}`);
                } else { toast.error('Failed to reset password.'); }
            } catch { toast.error('Network error.'); }
        },
    });
}

function deleteUser(email) {
    confirmModal({
        title: 'Delete User',
        message: `Permanently delete ${email}? This cannot be undone.`,
        confirmText: 'Delete',
        confirmClass: 'btn-danger',
        onConfirm: async () => {
            try {
                const res = await fetch('/api/delete-user', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email }),
                });
                if (res.ok) {
                    toast.success('User deleted.');
                    usersTable = null;
                    users = [];
                    loadUsers();
                    loadOverviewData();
                } else { toast.error('Failed to delete user.'); }
            } catch { toast.error('Network error.'); }
        },
    });
}

function showAddStaffModal() {
    const content = `
        <div class="form-group">
            <label class="form-label">Full Name</label>
            <input type="text" class="form-input" id="staff-name" placeholder="e.g. Juan Dela Cruz">
        </div>
        <div class="form-group">
            <label class="form-label">Email</label>
            <input type="email" class="form-input" id="staff-email" placeholder="e.g. juan@deped.gov.ph">
        </div>
        <div class="form-group">
            <label class="form-label">Password</label>
            <input type="password" class="form-input" id="staff-password" placeholder="Minimum 6 characters">
        </div>
    `;

    const modal = openModal({
        title: 'Add IT Staff',
        content,
        size: 'md',
        footer: `
            <button class="btn btn-ghost btn-sm" id="staff-cancel">Cancel</button>
            <button class="btn btn-primary btn-sm" id="staff-save">Add Staff</button>
        `,
    });

    document.getElementById('staff-cancel')?.addEventListener('click', () => modal.close());
    document.getElementById('staff-save')?.addEventListener('click', async () => {
        const name = document.getElementById('staff-name')?.value?.trim();
        const email = document.getElementById('staff-email')?.value?.trim();
        const password = document.getElementById('staff-password')?.value;

        if (!name || !email || !password) { toast.warning('All fields are required.'); return; }
        if (password.length < 6) { toast.warning('Password must be at least 6 characters.'); return; }

        try {
            const res = await fetch('/api/add-it-staff', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, email, password }),
            });
            if (res.ok) {
                toast.success('IT staff added successfully.');
                modal.close();
                usersTable = null;
                users = [];
                loadUsers();
                loadOverviewData();
            } else {
                const data = await res.json().catch(() => ({}));
                toast.error(data.message || 'Failed to add staff.');
            }
        } catch { toast.error('Network error.'); }
    });
}

// ---------------------------------------------------------------------------
// System Tab
// ---------------------------------------------------------------------------
async function loadSystemStatus() {
    try {
        const res = await fetch('/api/system-state');
        if (!res.ok) return;
        const data = await res.json();
        const maintenance = data.maintenanceMode || data.maintenance_mode || false;
        const toggle = document.getElementById('maintenance-toggle');
        if (toggle) toggle.checked = maintenance;
    } catch { /* ignore */ }

    // Maintenance toggle
    const toggle = document.getElementById('maintenance-toggle');
    if (toggle && !toggle.dataset.bound) {
        toggle.dataset.bound = 'true';
        toggle.addEventListener('change', async () => {
            try {
                const res = await fetch('/api/system-maintenance', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ enabled: toggle.checked }),
                });
                if (res.ok) {
                    toast.success(`Maintenance mode ${toggle.checked ? 'enabled' : 'disabled'}.`);
                    setText('stat-maintenance', toggle.checked ? 'Maintenance' : 'Online');
                } else {
                    toggle.checked = !toggle.checked;
                    toast.error('Failed to toggle maintenance mode.');
                }
            } catch {
                toggle.checked = !toggle.checked;
                toast.error('Network error.');
            }
        });
    }

    // Reconcile button
    const reconcileBtn = document.getElementById('btn-reconcile');
    if (reconcileBtn && !reconcileBtn.dataset.bound) {
        reconcileBtn.dataset.bound = 'true';
        reconcileBtn.addEventListener('click', () => {
            confirmModal({
                title: 'Run Reconciliation',
                message: 'This will clean up duplicate accrual entries and sync data. Continue?',
                confirmText: 'Run',
                confirmClass: 'btn-primary',
                onConfirm: async () => {
                    try {
                        toast.info('Running reconciliation...');
                        const res = await fetch('/api/run-reconciliation', { method: 'POST' });
                        if (res.ok) {
                            const data = await res.json();
                            toast.success(data.message || 'Reconciliation complete.');
                        } else { toast.error('Reconciliation failed.'); }
                    } catch { toast.error('Network error.'); }
                },
            });
        });
    }
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
                <div><label class="form-label">Role</label><div>IT Administrator</div></div>
            </div>`,
        size: 'md',
    });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toNum(v) { const n = parseFloat(v); return isNaN(n) ? 0 : n; }
function fmt(v) { const n = toNum(v); return n % 1 === 0 ? String(n) : n.toFixed(3); }
function esc(s) { return escapeHtml(s); }
function setText(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function fmtDate(s) { if (!s) return '--'; const d = new Date(s); return isNaN(d) ? String(s) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
