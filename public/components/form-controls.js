/**
 * Form Controls — Searchable dropdown, date range picker, radio groups.
 *
 * Usage:
 *   import { createSearchableDropdown, createDateRangePicker } from './components/form-controls.js';
 *
 *   createSearchableDropdown({
 *       el: '#leave-type-select',
 *       options: [{ value: 'leave_vl', label: 'Vacation Leave' }, ...],
 *       placeholder: 'Select leave type',
 *       onChange: (value, option) => {},
 *   });
 */

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

/**
 * Searchable Dropdown (replaces native <select> for better UX).
 */
export function createSearchableDropdown(config) {
    const container = typeof config.el === 'string'
        ? document.querySelector(config.el)
        : config.el;
    if (!container) return null;

    const state = {
        open: false,
        value: config.value || '',
        filter: '',
        options: config.options || [],
        highlighted: -1,
    };

    function getLabel() {
        const opt = state.options.find(o => o.value === state.value);
        return opt ? opt.label : '';
    }

    function getFiltered() {
        if (!state.filter) return state.options;
        const q = state.filter.toLowerCase();
        return state.options.filter(o => o.label.toLowerCase().includes(q));
    }

    function render() {
        const label = getLabel();
        container.className = 'dropdown-search' + (config.className ? ' ' + config.className : '');

        let html = `
        <input type="text"
               class="form-input dropdown-search-input"
               value="${escHtml(label)}"
               placeholder="${escHtml(config.placeholder || 'Select...')}"
               readonly
               role="combobox"
               aria-expanded="${state.open}"
               aria-haspopup="listbox">
        `;

        if (state.open) {
            const filtered = getFiltered();
            html += `
            <div class="dropdown-search-menu open" role="listbox">
                <div class="dropdown-search-filter">
                    <input type="text" class="dd-filter-input" placeholder="Search..." value="${escHtml(state.filter)}" autofocus>
                </div>
                ${filtered.length === 0
                    ? '<div style="padding:12px;text-align:center;color:var(--color-text-muted);font-size:var(--text-sm)">No results</div>'
                    : filtered.map((opt, i) => `
                        <div class="dropdown-option ${opt.value === state.value ? 'selected' : ''} ${i === state.highlighted ? 'highlighted' : ''}"
                             data-value="${escHtml(opt.value)}"
                             role="option"
                             aria-selected="${opt.value === state.value}">
                            ${escHtml(opt.label)}
                            ${opt.description ? `<span class="text-xs text-muted" style="display:block">${escHtml(opt.description)}</span>` : ''}
                        </div>
                    `).join('')}
            </div>`;
        }

        container.innerHTML = html;
        bindEvents();
    }

    function bindEvents() {
        const input = container.querySelector('.dropdown-search-input');
        const filterInput = container.querySelector('.dd-filter-input');

        input.addEventListener('click', (e) => {
            e.stopPropagation();
            state.open = !state.open;
            state.filter = '';
            state.highlighted = -1;
            render();
        });

        if (filterInput) {
            filterInput.addEventListener('input', (e) => {
                state.filter = e.target.value;
                state.highlighted = -1;
                render();
                // Re-focus filter
                const newFilter = container.querySelector('.dd-filter-input');
                if (newFilter) {
                    newFilter.focus();
                    newFilter.setSelectionRange(newFilter.value.length, newFilter.value.length);
                }
            });

            filterInput.addEventListener('keydown', (e) => {
                const filtered = getFiltered();
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    state.highlighted = Math.min(state.highlighted + 1, filtered.length - 1);
                    render();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    state.highlighted = Math.max(state.highlighted - 1, 0);
                    render();
                } else if (e.key === 'Enter' && state.highlighted >= 0) {
                    e.preventDefault();
                    selectOption(filtered[state.highlighted]);
                } else if (e.key === 'Escape') {
                    state.open = false;
                    render();
                }
            });

            filterInput.focus();
        }

        container.querySelectorAll('.dropdown-option').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const opt = state.options.find(o => o.value === el.dataset.value);
                if (opt) selectOption(opt);
            });
        });

        // Close on outside click
        const closeHandler = (e) => {
            if (!container.contains(e.target)) {
                state.open = false;
                render();
                document.removeEventListener('click', closeHandler);
            }
        };
        if (state.open) {
            setTimeout(() => document.addEventListener('click', closeHandler), 0);
        }
    }

    function selectOption(opt) {
        state.value = opt.value;
        state.open = false;
        render();
        if (config.onChange) config.onChange(opt.value, opt);
    }

    function setValue(val) {
        state.value = val;
        render();
    }

    function getValue() {
        return state.value;
    }

    function setOptions(opts) {
        state.options = opts;
        render();
    }

    render();

    return { setValue, getValue, setOptions, render };
}

/**
 * Create a simple date range input.
 */
export function createDateRangePicker(config) {
    const container = typeof config.el === 'string'
        ? document.querySelector(config.el)
        : config.el;
    if (!container) return null;

    const state = {
        from: config.from || '',
        to: config.to || '',
    };

    function render() {
        container.innerHTML = `
        <div class="form-row" style="gap:var(--space-2);align-items:end">
            <div class="form-group" style="flex:1">
                <label class="form-label">${escHtml(config.fromLabel || 'From')}</label>
                <input type="date" class="form-input dr-from" value="${state.from}" ${config.min ? `min="${config.min}"` : ''}>
            </div>
            <div class="form-group" style="flex:1">
                <label class="form-label">${escHtml(config.toLabel || 'To')}</label>
                <input type="date" class="form-input dr-to" value="${state.to}" ${config.max ? `max="${config.max}"` : ''}>
            </div>
        </div>`;

        const fromInput = container.querySelector('.dr-from');
        const toInput = container.querySelector('.dr-to');

        fromInput.addEventListener('change', (e) => {
            state.from = e.target.value;
            toInput.min = state.from;
            if (config.onChange) config.onChange(state.from, state.to);
        });

        toInput.addEventListener('change', (e) => {
            state.to = e.target.value;
            fromInput.max = state.to;
            if (config.onChange) config.onChange(state.from, state.to);
        });
    }

    function getRange() {
        return { from: state.from, to: state.to };
    }

    function setRange(from, to) {
        state.from = from;
        state.to = to;
        render();
    }

    render();

    return { getRange, setRange };
}

// Expose globally
if (typeof window !== 'undefined') {
    window.createSearchableDropdown = createSearchableDropdown;
    window.createDateRangePicker = createDateRangePicker;
}
