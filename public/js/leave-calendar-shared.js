/**
 * Shared Leave Calendar module — reusable across all dashboards.
 *
 * Usage:
 *   import { initLeaveCalendar } from './leave-calendar-shared.js';
 *   const cal = initLeaveCalendar({ el: '#calendar-content', role: 'ao' });
 *   cal.load();                // fetch and render
 *   cal.destroy();             // cleanup
 *
 * RBAC:
 *   - Employee: sees own applications only (uses /api/my-applications)
 *   - AO/HR/ASDS/SDS/IT: sees division-wide data (uses /api/leave-calendar)
 *   - IT has full visibility, no filtering
 *   - AO is filtered server-side by school
 */

import { openModal } from '../components/modal.js';

// ---------------------------------------------------------------------------
// Leave-type helpers
// ---------------------------------------------------------------------------
const CHIP_CLASS_MAP = [
    [/vl|vacation/, 'type-vl'],
    [/sl|sick/, 'type-sl'],
    [/mfl|mandatory|force/, 'type-mfl'],
    [/spl|special/, 'type-spl'],
    [/ml|maternity|paternity/, 'type-ml'],
    [/wellness|leave_wl/, 'type-wl'],
    [/cto|others/, 'type-cto'],
];

function chipClass(leaveType) {
    const t = (leaveType || '').toLowerCase();
    for (const [re, cls] of CHIP_CLASS_MAP) { if (re.test(t)) return cls; }
    return 'type-other';
}

const CHIP_COLORS = {
    'type-vl': '#1976D2', 'type-sl': '#d32f2f', 'type-mfl': '#E65100',
    'type-spl': '#00897B', 'type-ml': '#7B1FA2', 'type-cto': '#455A64',
    'type-wl': '#00838f', 'type-other': '#757575',
};

const SHORT_NAMES = {
    leave_vl: 'VL', leave_vacation: 'VL',
    leave_sl: 'SL', leave_sick: 'SL',
    leave_mfl: 'MFL', leave_mandatory: 'MFL',
    leave_spl: 'SPL',
    leave_ml: 'Mat', leave_maternity: 'Mat',
    leave_paternity: 'Pat',
    leave_cto: 'CTO', leave_others: 'CTO',
    leave_soloparent: 'SP', leave_solo_parent: 'SP',
    leave_study: 'Study', leave_vawc: 'VAWC',
    leave_rehab: 'Rehab', leave_women: 'Women',
    leave_calamity: 'Cal', leave_adoption: 'Adopt',
    leave_wl: 'WL', leave_wellness: 'WL', wellness: 'WL',
};

function shortName(t) { return SHORT_NAMES[t] || 'Leave'; }

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS_SHORT = ['S','M','T','W','T','F','S'];
const DAYS_FULL  = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

const LEGEND_ITEMS = [
    { label: 'Vacation', cls: 'type-vl' },
    { label: 'Sick', cls: 'type-sl' },
    { label: 'Force Leave', cls: 'type-mfl' },
    { label: 'Special Privilege', cls: 'type-spl' },
    { label: 'Maternity/Paternity', cls: 'type-ml' },
    { label: 'Wellness', cls: 'type-wl' },
    { label: 'CTO/Others', cls: 'type-cto' },
];

function esc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s || ''); }

function fmtOrdinal(d) {
    const s = ['th','st','nd','rd'];
    const v = d % 100;
    return d + (s[(v - 20) % 10] || s[v] || s[0]);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function initLeaveCalendar(opts) {
    const container = typeof opts.el === 'string' ? document.querySelector(opts.el) : opts.el;
    if (!container) return { load() {}, destroy() {} };

    const role     = (opts.role || 'user').toLowerCase();
    const isAdmin  = ['ao','hr','asds','sds','it'].includes(role);
    const email    = opts.email || '';

    const now = new Date();
    let year  = now.getFullYear();
    let month = now.getMonth() + 1;
    let leaves = [];
    let mounted = false;

    // DOM refs
    let gridEl, toolbarEl, sidebarEl;

    // -----------------------------------------------------------------------
    // DOM scaffold
    // -----------------------------------------------------------------------
    function ensureDOM() {
        if (mounted) return;
        container.innerHTML = `
            <div class="lcal-container">
                <div class="lcal-sidebar" id="lcal-sidebar"></div>
                <div class="lcal-main">
                    <div class="lcal-toolbar" id="lcal-toolbar"></div>
                    <div class="lcal-mobile-legend" id="lcal-mobile-legend"></div>
                    <div class="lcal-grid" id="lcal-grid"></div>
                </div>
            </div>
        `;
        sidebarEl  = container.querySelector('#lcal-sidebar');
        toolbarEl  = container.querySelector('#lcal-toolbar');
        gridEl     = container.querySelector('#lcal-grid');

        // Mobile legend (visible < 1025px)
        const mlEl = container.querySelector('#lcal-mobile-legend');
        mlEl.innerHTML = LEGEND_ITEMS.map(i =>
            `<div class="lcal-mobile-legend-item"><div class="lcal-mobile-legend-dot" style="background:${CHIP_COLORS[i.cls]}"></div>${i.label}</div>`
        ).join('');

        mounted = true;
    }

    // -----------------------------------------------------------------------
    // Data fetching
    // -----------------------------------------------------------------------
    async function fetchLeaves() {
        try {
            if (isAdmin) {
                const res = await fetch(`/api/leave-calendar?month=${month}&year=${year}`);
                if (!res.ok) return [];
                const data = await res.json();
                return data.leaves || [];
            }
            const res = await fetch(`/api/my-applications/${encodeURIComponent(email)}`);
            if (!res.ok) return [];
            const data = await res.json();
            const apps = data.applications || [];
            return apps.filter(a => a.status === 'approved' || a.status === 'pending');
        } catch { return []; }
    }

    // -----------------------------------------------------------------------
    // Toolbar
    // -----------------------------------------------------------------------
    function renderToolbar() {
        toolbarEl.innerHTML = `
            <div class="lcal-toolbar-left">
                <span class="lcal-toolbar-month">${MONTHS[month - 1]}</span>
                <span class="lcal-toolbar-year">${year}</span>
            </div>
            <div class="lcal-toolbar-right">
                <button class="lcal-btn lcal-btn-nav" id="lcal-prev" title="Previous month">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button class="lcal-btn lcal-btn-today" id="lcal-today">Today</button>
                <button class="lcal-btn lcal-btn-nav" id="lcal-next" title="Next month">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>
                </button>
            </div>
        `;
        toolbarEl.querySelector('#lcal-prev').addEventListener('click', () => { month--; if (month < 1) { month = 12; year--; } fetchAndRender(); });
        toolbarEl.querySelector('#lcal-next').addEventListener('click', () => { month++; if (month > 12) { month = 1; year++; } fetchAndRender(); });
        toolbarEl.querySelector('#lcal-today').addEventListener('click', () => { year = now.getFullYear(); month = now.getMonth() + 1; fetchAndRender(); });
    }

    // -----------------------------------------------------------------------
    // Sidebar: mini calendar + today card + legend + stats
    // -----------------------------------------------------------------------
    function renderSidebar() {
        if (!sidebarEl) return;

        // --- Mini calendar ---
        const miniFirstDay = new Date(year, month - 1, 1).getDay();
        const miniDays     = new Date(year, month, 0).getDate();
        const prevDays     = new Date(year, month - 1, 0).getDate();

        // Build date→hasLeave lookup for mini cal
        const daysWithLeaves = new Set();
        leaves.forEach(a => {
            const from = a.dateFrom || a.date_from;
            const to   = a.dateTo || a.date_to;
            if (!from) return;
            const fd = new Date(from);
            const td = to ? new Date(to) : fd;
            for (let d = new Date(fd); d <= td; d.setDate(d.getDate() + 1)) {
                if (d.getFullYear() === year && d.getMonth() === month - 1) {
                    daysWithLeaves.add(d.getDate());
                }
            }
        });

        let miniGrid = DAYS_SHORT.map(d => `<div class="lcal-mini-hdr">${d}</div>`).join('');
        for (let i = miniFirstDay - 1; i >= 0; i--) {
            miniGrid += `<div class="lcal-mini-day other">${prevDays - i}</div>`;
        }
        for (let d = 1; d <= miniDays; d++) {
            const isToday = (d === now.getDate() && month === now.getMonth() + 1 && year === now.getFullYear());
            const hasLeave = daysWithLeaves.has(d);
            let cls = 'lcal-mini-day';
            if (isToday)   cls += ' today';
            if (hasLeave)  cls += ' has-leave';
            miniGrid += `<div class="${cls}">${d}</div>`;
        }
        const rem = (miniFirstDay + miniDays) % 7;
        if (rem > 0) for (let i = 1; i <= 7 - rem; i++) {
            miniGrid += `<div class="lcal-mini-day other">${i}</div>`;
        }

        // --- Today's leaves ---
        const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
        const todayLeaves = leaves.filter(a => {
            const from = a.dateFrom || a.date_from;
            const to   = a.dateTo || a.date_to;
            return todayStr >= from && todayStr <= to;
        });
        const todayDateFmt = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

        let todayLeavesHtml = '';
        if (todayLeaves.length === 0) {
            todayLeavesHtml = '<div style="font-size:var(--text-sm);color:var(--color-text-muted);padding:var(--space-2) 0">No leaves today</div>';
        } else {
            todayLeavesHtml = todayLeaves.slice(0, 5).map(a => {
                const lt = a.leaveType || a.leave_type || '';
                const color = CHIP_COLORS[chipClass(lt)] || '#757575';
                const empName = isAdmin ? (a.employeeName || '').split(',')[0] : shortName(lt);
                return `<div class="lcal-today-item" data-lid="${esc(a.id)}">
                    <div class="lcal-today-dot" style="background:${color}"></div>
                    <span>${esc(empName)} — ${shortName(lt)}</span>
                </div>`;
            }).join('');
            if (todayLeaves.length > 5) {
                todayLeavesHtml += `<div style="font-size:var(--text-xs);color:var(--color-info);font-weight:var(--font-semibold)">+${todayLeaves.length - 5} more</div>`;
            }
        }

        // --- Stats ---
        const monthLeaves = leaves.filter(a => {
            const from = a.dateFrom || a.date_from;
            if (!from) return false;
            const d = new Date(from);
            return d.getFullYear() === year && d.getMonth() === month - 1;
        });
        const approved  = monthLeaves.filter(a => a.status === 'approved').length;
        const pending   = monthLeaves.filter(a => a.status === 'pending').length;
        const totalDays = monthLeaves.reduce((s, a) => s + (parseFloat(a.numDays || a.num_days) || 0), 0);
        const uniqueEmps = isAdmin ? new Set(monthLeaves.map(a => a.employeeName || a.employeeEmail)).size : 0;

        sidebarEl.innerHTML = `
            <div class="lcal-mini">
                <div class="lcal-mini-nav">
                    <button class="lcal-mini-btn" id="lcal-mini-prev">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="15 18 9 12 15 6"/></svg>
                    </button>
                    <div class="lcal-mini-title">${MONTHS[month - 1]} ${year}</div>
                    <button class="lcal-mini-btn" id="lcal-mini-next">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="9 18 15 12 9 6"/></svg>
                    </button>
                </div>
                <div class="lcal-mini-grid">${miniGrid}</div>
            </div>

            <div class="lcal-today-card">
                <div class="lcal-today-label">Today</div>
                <div class="lcal-today-date">${todayDateFmt}</div>
                <div class="lcal-today-info">${todayLeaves.length} leave${todayLeaves.length !== 1 ? 's' : ''} today</div>
                <div class="lcal-today-leaves">${todayLeavesHtml}</div>
            </div>

            <div class="lcal-legend">
                <div class="lcal-legend-title">Leave Types</div>
                <div class="lcal-legend-list">
                    ${LEGEND_ITEMS.map(i => `<div class="lcal-legend-item"><div class="lcal-legend-dot" style="background:${CHIP_COLORS[i.cls]}"></div>${i.label}</div>`).join('')}
                </div>
            </div>

            <div class="lcal-stats">
                <div class="lcal-stats-title">This Month</div>
                <div class="lcal-stats-grid">
                    <div class="lcal-stat-item"><div class="lcal-stat-value" style="color:var(--color-primary)">${monthLeaves.length}</div><div class="lcal-stat-label">Total</div></div>
                    <div class="lcal-stat-item"><div class="lcal-stat-value" style="color:var(--color-success)">${approved}</div><div class="lcal-stat-label">Approved</div></div>
                    <div class="lcal-stat-item"><div class="lcal-stat-value" style="color:var(--color-warning)">${pending}</div><div class="lcal-stat-label">Pending</div></div>
                    <div class="lcal-stat-item"><div class="lcal-stat-value" style="color:var(--color-info)">${totalDays.toFixed(1)}</div><div class="lcal-stat-label">Days</div></div>
                    ${isAdmin ? `<div class="lcal-stat-item" style="grid-column:span 2"><div class="lcal-stat-value" style="color:var(--color-role-sds)">${uniqueEmps}</div><div class="lcal-stat-label">Employees</div></div>` : ''}
                </div>
            </div>
        `;

        // Bind mini nav
        sidebarEl.querySelector('#lcal-mini-prev')?.addEventListener('click', () => { month--; if (month < 1) { month = 12; year--; } fetchAndRender(); });
        sidebarEl.querySelector('#lcal-mini-next')?.addEventListener('click', () => { month++; if (month > 12) { month = 1; year++; } fetchAndRender(); });

        // Bind today-item clicks
        sidebarEl.querySelectorAll('.lcal-today-item[data-lid]').forEach(el => {
            el.addEventListener('click', () => showLeaveDetail(el.dataset.lid));
        });
    }

    // -----------------------------------------------------------------------
    // Main calendar grid
    // -----------------------------------------------------------------------
    function renderGrid() {
        if (!gridEl) return;

        const firstDay    = new Date(year, month - 1, 1).getDay();
        const daysInMonth = new Date(year, month, 0).getDate();
        const prevDays    = new Date(year, month - 1, 0).getDate();

        // Day headers
        let html = DAYS_FULL.map((d, i) =>
            `<div class="lcal-day-header${i === 0 || i === 6 ? ' weekend' : ''}">${d}</div>`
        ).join('');

        // Previous month padding
        for (let i = firstDay - 1; i >= 0; i--)
            html += `<div class="lcal-day-cell other-month"><div class="lcal-day-num">${prevDays - i}</div></div>`;

        // Current month days
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month - 1, day);
            const isToday   = date.toDateString() === now.toDateString();
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const dateStr   = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

            const dayLeaves = leaves.filter(a => {
                const from = a.dateFrom || a.date_from;
                const to   = a.dateTo || a.date_to;
                return dateStr >= from && dateStr <= to;
            });

            let cls = 'lcal-day-cell';
            if (isToday)   cls += ' today';
            if (isWeekend) cls += ' weekend';

            html += `<div class="${cls}"><div class="lcal-day-num">${day}</div>`;

            const max = 3;
            dayLeaves.slice(0, max).forEach(a => {
                const lt = a.leaveType || a.leave_type || '';
                const empName = isAdmin ? ((a.employeeName || '').split(',')[0] || '') : '';
                const isPending = a.status === 'pending';
                const statusTag = isPending ? ' (P)' : '';
                const label = isAdmin ? `${shortName(lt)} ${empName}` : `${shortName(lt)}${statusTag}`;
                html += `<div class="lcal-chip ${chipClass(lt)}${isPending ? ' pending' : ''}" data-lid="${esc(a.id)}" title="${esc(a.employeeName || '')} — ${esc(typeof getLeaveTypeLabel === 'function' ? getLeaveTypeLabel(lt) : lt)}">${label}</div>`;
            });

            if (dayLeaves.length > max)
                html += `<div class="lcal-more" data-date="${dateStr}">+${dayLeaves.length - max} more</div>`;

            html += '</div>';
        }

        // Next month padding
        const total = firstDay + daysInMonth;
        const rem = total % 7 === 0 ? 0 : 7 - (total % 7);
        for (let i = 1; i <= rem; i++)
            html += `<div class="lcal-day-cell other-month"><div class="lcal-day-num">${i}</div></div>`;

        gridEl.innerHTML = html;

        // Bind clicks
        if (!gridEl._lcalBound) {
            gridEl._lcalBound = true;
            gridEl.addEventListener('click', e => {
                const chip = e.target.closest('.lcal-chip[data-lid]');
                if (chip) { showLeaveDetail(chip.dataset.lid); return; }
                const more = e.target.closest('.lcal-more[data-date]');
                if (more) showDayModal(more.dataset.date);
            });
        }
    }

    // -----------------------------------------------------------------------
    // Modals
    // -----------------------------------------------------------------------
    function showLeaveDetail(id) {
        const leave = leaves.find(l => String(l.id) === String(id));
        if (!leave) return;
        const lt = leave.leaveType || leave.leave_type || '';
        const typeLabel = typeof getLeaveTypeLabel === 'function' ? getLeaveTypeLabel(lt) : lt;
        const color = CHIP_COLORS[chipClass(lt)] || '#757575';
        const isApproved = leave.status === 'approved';
        const statusColor = isApproved ? 'var(--color-success)' : 'var(--color-warning)';
        const statusLabel = isApproved ? 'APPROVED' : `PENDING${leave.currentApprover ? ' at ' + leave.currentApprover : ''}`;

        const dateFrom = leave.dateFrom || leave.date_from || '--';
        const dateTo   = leave.dateTo || leave.date_to || dateFrom;
        const days     = leave.numDays || leave.num_days || '--';

        openModal({
            title: 'Leave Details',
            content: `
                <div style="display:flex;align-items:center;gap:var(--space-2);margin-bottom:var(--space-4)">
                    <div style="width:14px;height:14px;border-radius:4px;background:${color}"></div>
                    <span style="font-size:var(--text-md);font-weight:var(--font-semibold)">${esc(typeLabel)}</span>
                    <span style="margin-left:auto;font-size:var(--text-sm);font-weight:var(--font-semibold);color:${statusColor}">${statusLabel}</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                    <div><label class="form-label">Employee</label><div style="font-weight:var(--font-medium)">${esc(leave.employeeName || '')}</div></div>
                    <div><label class="form-label">Office</label><div>${esc(leave.office || '--')}</div></div>
                    <div><label class="form-label">From</label><div>${esc(dateFrom)}</div></div>
                    <div><label class="form-label">To</label><div>${esc(dateTo)}</div></div>
                    <div><label class="form-label">Days</label><div style="font-weight:var(--font-semibold)">${days}</div></div>
                    <div><label class="form-label">Application ID</label><div style="font-size:var(--text-sm);color:var(--color-text-muted)">${esc(leave.id || '--')}</div></div>
                </div>`,
            size: 'md',
        });
    }

    function showDayModal(dateStr) {
        const dayLeaves = leaves.filter(a => {
            const from = a.dateFrom || a.date_from;
            const to   = a.dateTo || a.date_to;
            return dateStr >= from && dateStr <= to;
        });
        if (!dayLeaves.length) return;
        const d = new Date(dateStr);
        const dateLabel = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

        const rows = dayLeaves.map(a => {
            const lt = a.leaveType || a.leave_type || '';
            const color = CHIP_COLORS[chipClass(lt)] || '#757575';
            const isApproved = a.status === 'approved';
            const statusColor = isApproved ? 'var(--color-success)' : 'var(--color-warning)';
            const empName = a.employeeName || shortName(lt);
            return `<div style="padding:var(--space-2) var(--space-3);border-bottom:1px solid var(--color-border-light);display:flex;align-items:center;gap:var(--space-2);cursor:pointer;transition:background 150ms" data-lid="${esc(a.id)}" onmouseover="this.style.background='var(--color-gray-50)'" onmouseout="this.style.background=''">
                <div style="width:10px;height:10px;border-radius:3px;background:${color};flex-shrink:0"></div>
                <span style="flex:1;font-size:var(--text-sm)">${esc(empName)} — <strong>${shortName(lt)}</strong></span>
                <span style="font-size:var(--text-xs);font-weight:var(--font-semibold);color:${statusColor}">${a.status.toUpperCase()}</span>
            </div>`;
        }).join('');

        openModal({
            title: `${dateLabel}`,
            content: `<div style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:var(--space-3)">${dayLeaves.length} leave${dayLeaves.length !== 1 ? 's' : ''}</div>${rows}`,
            size: 'sm',
        });
        setTimeout(() => {
            document.querySelectorAll('[data-lid]').forEach(el => {
                if (el.closest('.modal')) el.addEventListener('click', () => showLeaveDetail(el.dataset.lid));
            });
        }, 100);
    }

    // -----------------------------------------------------------------------
    // Orchestration
    // -----------------------------------------------------------------------
    async function fetchAndRender() {
        leaves = await fetchLeaves();
        renderToolbar();
        renderGrid();
        renderSidebar();
    }

    return {
        async load() {
            ensureDOM();
            await fetchAndRender();
        },
        destroy() {
            container.innerHTML = '';
            mounted = false;
            leaves = [];
        },
    };
}
