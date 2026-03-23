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
const DAYS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function esc(s) { return typeof escapeHtml === 'function' ? escapeHtml(s) : String(s || ''); }

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------
export function initLeaveCalendar(opts) {
    const container = typeof opts.el === 'string' ? document.querySelector(opts.el) : opts.el;
    if (!container) return { load() {}, destroy() {} };

    const role     = (opts.role || 'user').toLowerCase();
    const isAdmin  = ['ao','hr','asds','sds','it'].includes(role);
    const email    = opts.email || '';

    let year  = new Date().getFullYear();
    let month = new Date().getMonth() + 1;
    let leaves = [];
    let mounted = false;

    // DOM refs (created on first load)
    let navEl, legendEl, gridEl, summaryEl;

    function ensureDOM() {
        if (mounted) return;
        container.innerHTML = `
            <div class="cal-nav" id="lcal-nav"></div>
            <div class="cal-legend" id="lcal-legend"></div>
            <div class="cal-grid" id="lcal-grid"></div>
            <div class="cal-summary" id="lcal-summary"></div>
        `;
        navEl     = container.querySelector('#lcal-nav');
        legendEl  = container.querySelector('#lcal-legend');
        gridEl    = container.querySelector('#lcal-grid');
        summaryEl = container.querySelector('#lcal-summary');

        // Nav
        navEl.innerHTML = `
            <button class="cal-nav-btn" id="lcal-prev">&laquo; Prev</button>
            <div class="cal-month-label" id="lcal-month-label"></div>
            <button class="cal-nav-btn" id="lcal-next">Next &raquo;</button>
            <button class="cal-nav-btn today-btn" id="lcal-today">Today</button>
        `;
        navEl.querySelector('#lcal-prev').addEventListener('click', () => { month--; if (month < 1) { month = 12; year--; } fetchAndRender(); });
        navEl.querySelector('#lcal-next').addEventListener('click', () => { month++; if (month > 12) { month = 1; year++; } fetchAndRender(); });
        navEl.querySelector('#lcal-today').addEventListener('click', () => { const n = new Date(); year = n.getFullYear(); month = n.getMonth() + 1; fetchAndRender(); });

        // Legend
        const items = [
            { label: 'Vacation', cls: 'type-vl' },
            { label: 'Sick', cls: 'type-sl' },
            { label: 'Mandatory/Forced', cls: 'type-mfl' },
            { label: 'Special Privilege', cls: 'type-spl' },
            { label: 'Maternity/Paternity', cls: 'type-ml' },
            { label: 'Wellness', cls: 'type-wl' },
            { label: 'CTO/Others', cls: 'type-cto' },
        ];
        legendEl.innerHTML = items.map(i =>
            `<div class="cal-legend-item"><div class="cal-legend-dot cal-chip ${i.cls}" style="width:12px;height:12px;display:inline-block"></div> ${i.label}</div>`
        ).join('');

        mounted = true;
    }

    async function fetchLeaves() {
        try {
            if (isAdmin) {
                const res = await fetch(`/api/leave-calendar?month=${month}&year=${year}`);
                if (!res.ok) return [];
                const data = await res.json();
                return data.leaves || [];
            }
            // Employee — use own applications
            const res = await fetch(`/api/my-applications/${encodeURIComponent(email)}`);
            if (!res.ok) return [];
            const data = await res.json();
            const apps = data.applications || [];
            return apps.filter(a => a.status === 'approved' || a.status === 'pending');
        } catch { return []; }
    }

    function renderGrid() {
        if (!gridEl) return;
        const label = container.querySelector('#lcal-month-label');
        if (label) label.textContent = `${MONTHS[month - 1]} ${year}`;

        const firstDay    = new Date(year, month - 1, 1).getDay();
        const daysInMonth = new Date(year, month, 0).getDate();
        const today       = new Date();
        const prevDays    = new Date(year, month - 1, 0).getDate();

        let html = DAYS.map(d => `<div class="cal-day-header">${d}</div>`).join('');

        // Prev-month padding
        for (let i = firstDay - 1; i >= 0; i--)
            html += `<div class="cal-day-cell other-month"><div class="cal-day-number">${prevDays - i}</div></div>`;

        // Current month
        for (let day = 1; day <= daysInMonth; day++) {
            const date = new Date(year, month - 1, day);
            const isToday   = date.toDateString() === today.toDateString();
            const isWeekend = date.getDay() === 0 || date.getDay() === 6;
            const dateStr   = `${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;

            const dayLeaves = leaves.filter(a => {
                const from = a.dateFrom || a.date_from;
                const to   = a.dateTo || a.date_to;
                return dateStr >= from && dateStr <= to;
            });

            let cls = 'cal-day-cell';
            if (isToday)   cls += ' today';
            if (isWeekend) cls += ' weekend';

            html += `<div class="${cls}"><div class="cal-day-number">${day}</div>`;

            const max = 3;
            dayLeaves.slice(0, max).forEach(a => {
                const lt = a.leaveType || a.leave_type || '';
                const empName = isAdmin ? ((a.employeeName || '').split(',')[0] || '') : '';
                const statusTag = a.status === 'approved' ? '' : ' (P)';
                const label = isAdmin ? `${shortName(lt)}: ${empName}` : `${shortName(lt)}${statusTag}`;
                html += `<div class="cal-chip ${chipClass(lt)}" data-lid="${esc(a.id)}" title="${esc(a.employeeName || '')} — ${esc(getLeaveTypeLabel(lt))}">${label}</div>`;
            });

            if (dayLeaves.length > max)
                html += `<div class="cal-more" data-date="${dateStr}">+${dayLeaves.length - max} more</div>`;

            html += '</div>';
        }

        // Next-month padding
        const total = firstDay + daysInMonth;
        const rem   = total % 7 === 0 ? 0 : 7 - (total % 7);
        for (let i = 1; i <= rem; i++)
            html += `<div class="cal-day-cell other-month"><div class="cal-day-number">${i}</div></div>`;

        gridEl.innerHTML = html;

        // Bind clicks (once)
        if (!gridEl._lcalBound) {
            gridEl._lcalBound = true;
            gridEl.addEventListener('click', e => {
                const chip = e.target.closest('.cal-chip[data-lid]');
                if (chip) { showLeaveDetail(chip.dataset.lid); return; }
                const more = e.target.closest('.cal-more[data-date]');
                if (more) showDayModal(more.dataset.date);
            });
        }
    }

    function renderSummary() {
        if (!summaryEl) return;
        const monthLeaves = leaves.filter(a => {
            const from = a.dateFrom || a.date_from;
            if (!from) return false;
            const d = new Date(from);
            return d.getFullYear() === year && d.getMonth() === month - 1;
        });
        const approved = monthLeaves.filter(a => a.status === 'approved').length;
        const pending  = monthLeaves.filter(a => a.status === 'pending').length;
        const totalDays = monthLeaves.reduce((s, a) => s + (parseFloat(a.numDays || a.num_days) || 0), 0);
        const uniqueEmps = isAdmin ? new Set(monthLeaves.map(a => a.employeeName || a.employeeEmail)).size : 0;

        let html = `
            <div class="cal-stat"><div class="cal-stat-value">${monthLeaves.length}</div><div class="cal-stat-label">Total</div></div>
            <div class="cal-stat" style="border-color:var(--color-success)"><div class="cal-stat-value" style="color:var(--color-success)">${approved}</div><div class="cal-stat-label">Approved</div></div>
            <div class="cal-stat" style="border-color:var(--color-warning)"><div class="cal-stat-value" style="color:var(--color-warning)">${pending}</div><div class="cal-stat-label">Pending</div></div>
            <div class="cal-stat" style="border-color:var(--color-info)"><div class="cal-stat-value" style="color:var(--color-info)">${totalDays.toFixed(1)}</div><div class="cal-stat-label">Total Days</div></div>
        `;
        if (isAdmin) {
            html += `<div class="cal-stat" style="border-color:var(--color-role-sds)"><div class="cal-stat-value" style="color:var(--color-role-sds)">${uniqueEmps}</div><div class="cal-stat-label">Employees</div></div>`;
        }
        summaryEl.innerHTML = html;
    }

    function showLeaveDetail(id) {
        const leave = leaves.find(l => String(l.id) === String(id));
        if (!leave) return;
        const lt = leave.leaveType || leave.leave_type || '';
        const typeLabel = typeof getLeaveTypeLabel === 'function' ? getLeaveTypeLabel(lt) : lt;
        const statusColor = leave.status === 'approved' ? 'var(--color-success)' : 'var(--color-warning)';
        openModal({
            title: 'Leave Details',
            content: `<div style="display:grid;grid-template-columns:1fr 1fr;gap:var(--space-3)">
                <div><label class="form-label">Employee</label><div>${esc(leave.employeeName || '')}</div></div>
                <div><label class="form-label">Office</label><div>${esc(leave.office || '--')}</div></div>
                <div><label class="form-label">Leave Type</label><div>${esc(typeLabel)}</div></div>
                <div><label class="form-label">Days</label><div>${leave.numDays || leave.num_days || '--'}</div></div>
                <div><label class="form-label">From</label><div>${esc(leave.dateFrom || leave.date_from || '--')}</div></div>
                <div><label class="form-label">To</label><div>${esc(leave.dateTo || leave.date_to || '--')}</div></div>
                <div><label class="form-label">Status</label><div style="color:${statusColor};font-weight:600">${(leave.status || '').toUpperCase()}${leave.currentApprover ? ' (at ' + leave.currentApprover + ')' : ''}</div></div>
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
            const statusColor = a.status === 'approved' ? 'var(--color-success)' : 'var(--color-warning)';
            return `<div style="padding:var(--space-2) 0;border-bottom:1px solid var(--color-border);display:flex;justify-content:space-between;align-items:center;cursor:pointer" data-lid="${esc(a.id)}">
                <span>${esc(a.employeeName || shortName(lt))} — ${shortName(lt)}</span>
                <span style="color:${statusColor};font-weight:600">${a.status}</span>
            </div>`;
        }).join('');
        openModal({ title: `Leaves on ${dateLabel}`, content: rows, size: 'sm' });
        setTimeout(() => {
            document.querySelectorAll('[data-lid]').forEach(el => {
                if (el.closest('.modal')) el.addEventListener('click', () => showLeaveDetail(el.dataset.lid));
            });
        }, 100);
    }

    async function fetchAndRender() {
        leaves = await fetchLeaves();
        renderGrid();
        renderSummary();
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
