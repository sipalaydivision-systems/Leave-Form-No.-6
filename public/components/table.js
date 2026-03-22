/**
 * DataTable Component — Sortable, filterable, paginated, with multi-select.
 *
 * Usage:
 *   import { createDataTable } from './components/table.js';
 *
 *   const table = createDataTable({
 *       el: '#my-table',
 *       columns: [
 *           { key: 'name', label: 'Name', sortable: true },
 *           { key: 'status', label: 'Status', sortable: true, render: (val) => `<span class="badge badge-${val}">${val}</span>` },
 *           { key: 'date', label: 'Date Filed', sortable: true, type: 'date' },
 *           { key: 'actions', label: '', render: (val, row) => `<button>View</button>` },
 *       ],
 *       data: [...],
 *       searchable: true,
 *       searchKeys: ['name', 'status'],
 *       selectable: true,
 *       pageSize: 15,
 *       emptyMessage: 'No applications found',
 *       emptyIcon: '...svg...',
 *       onSelect: (selectedRows) => {},
 *       onRowClick: (row) => {},
 *       filters: [
 *           { key: 'status', label: 'Status', options: ['All', 'Pending', 'Approved'] },
 *       ],
 *   });
 *
 *   table.setData(newData);
 *   table.getSelected();
 *   table.refresh();
 */

function escHtml(str) {
    if (str === null || str === undefined) return '';
    const d = document.createElement('div');
    d.textContent = String(str);
    return d.innerHTML;
}

export function createDataTable(config) {
    const container = typeof config.el === 'string'
        ? document.querySelector(config.el)
        : config.el;

    if (!container) {
        console.error('[DataTable] Container not found:', config.el);
        return null;
    }

    const state = {
        data: config.data || [],
        filteredData: [],
        sortKey: null,
        sortDir: 'asc',
        searchQuery: '',
        page: 1,
        pageSize: config.pageSize || 15,
        selected: new Set(),
        selectAll: false,
        activeFilters: {},
    };

    // Initialize filter defaults
    if (config.filters) {
        config.filters.forEach(f => { state.activeFilters[f.key] = 'All'; });
    }

    function applyFilters() {
        let data = [...state.data];

        // Search
        if (state.searchQuery && config.searchKeys) {
            const q = state.searchQuery.toLowerCase();
            data = data.filter(row =>
                config.searchKeys.some(key => {
                    const val = row[key];
                    return val && String(val).toLowerCase().includes(q);
                })
            );
        }

        // Dropdown filters
        for (const [key, value] of Object.entries(state.activeFilters)) {
            if (value && value !== 'All') {
                data = data.filter(row => String(row[key]).toLowerCase() === value.toLowerCase());
            }
        }

        // Sort
        if (state.sortKey) {
            const col = config.columns.find(c => c.key === state.sortKey);
            data.sort((a, b) => {
                let va = a[state.sortKey];
                let vb = b[state.sortKey];
                if (col?.type === 'date') {
                    va = va ? new Date(va).getTime() : 0;
                    vb = vb ? new Date(vb).getTime() : 0;
                } else if (col?.type === 'number') {
                    va = parseFloat(va) || 0;
                    vb = parseFloat(vb) || 0;
                } else {
                    va = String(va || '').toLowerCase();
                    vb = String(vb || '').toLowerCase();
                }
                if (va < vb) return state.sortDir === 'asc' ? -1 : 1;
                if (va > vb) return state.sortDir === 'asc' ? 1 : -1;
                return 0;
            });
        }

        state.filteredData = data;
        state.page = Math.min(state.page, Math.max(1, Math.ceil(data.length / state.pageSize)));
    }

    function getPageData() {
        const start = (state.page - 1) * state.pageSize;
        return state.filteredData.slice(start, start + state.pageSize);
    }

    function getTotalPages() {
        return Math.max(1, Math.ceil(state.filteredData.length / state.pageSize));
    }

    function render() {
        applyFilters();
        const pageData = getPageData();
        const totalPages = getTotalPages();
        const hasData = state.filteredData.length > 0;
        const selectable = config.selectable;

        let html = '<div class="table-wrapper">';

        // Toolbar (search + filters)
        if (config.searchable || config.filters) {
            html += '<div class="table-toolbar">';
            html += '<div class="table-toolbar-left">';
            if (config.searchable) {
                html += `
                <div class="table-search">
                    <span class="table-search-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    </span>
                    <input type="text" class="dt-search" placeholder="${escHtml(config.searchPlaceholder || 'Search...')}" value="${escHtml(state.searchQuery)}">
                </div>`;
            }
            html += '</div><div class="table-toolbar-right">';
            if (config.filters) {
                for (const filter of config.filters) {
                    html += `
                    <select class="form-select btn-sm dt-filter" data-filter-key="${escHtml(filter.key)}">
                        ${filter.options.map(opt => `<option value="${escHtml(opt)}" ${state.activeFilters[filter.key] === opt ? 'selected' : ''}>${escHtml(opt)}</option>`).join('')}
                    </select>`;
                }
            }
            html += '</div></div>';
        }

        // Bulk actions bar
        if (selectable && state.selected.size > 0) {
            html += `
            <div class="bulk-actions">
                <span class="bulk-actions-count">${state.selected.size} selected</span>
                <div class="bulk-actions-buttons" id="dt-bulk-actions"></div>
            </div>`;
        }

        if (hasData) {
            // Table
            html += '<div class="table-container"><table class="data-table">';

            // Header
            html += '<thead><tr>';
            if (selectable) {
                html += `<th style="width:40px"><input type="checkbox" class="table-checkbox dt-select-all" ${state.selectAll ? 'checked' : ''}></th>`;
            }
            for (const col of config.columns) {
                const isSorted = state.sortKey === col.key;
                const sortClass = col.sortable ? ' sortable' : '';
                const sortState = isSorted ? (state.sortDir === 'asc' ? ' sort-asc' : ' sort-desc') : '';
                const sortIcon = col.sortable ? `<span class="sort-icon">${isSorted && state.sortDir === 'desc' ? '&#9660;' : '&#9650;'}</span>` : '';
                const widthStyle = col.width ? ` style="width:${col.width}"` : '';
                html += `<th class="${sortClass}${sortState}" data-sort-key="${col.sortable ? escHtml(col.key) : ''}"${widthStyle}>${escHtml(col.label)} ${sortIcon}</th>`;
            }
            html += '</tr></thead>';

            // Body
            html += '<tbody>';
            for (const row of pageData) {
                const rowId = row.id || row._id || JSON.stringify(row);
                const isSelected = state.selected.has(rowId);
                html += `<tr class="${isSelected ? 'selected' : ''}" data-row-id="${escHtml(String(rowId))}">`;
                if (selectable) {
                    html += `<td><input type="checkbox" class="table-checkbox dt-row-select" data-id="${escHtml(String(rowId))}" ${isSelected ? 'checked' : ''}></td>`;
                }
                for (const col of config.columns) {
                    const val = row[col.key];
                    const rendered = col.render ? col.render(val, row) : escHtml(val);
                    html += `<td>${rendered}</td>`;
                }
                html += '</tr>';
            }
            html += '</tbody></table></div>';

            // Pagination
            if (totalPages > 1) {
                const start = (state.page - 1) * state.pageSize + 1;
                const end = Math.min(state.page * state.pageSize, state.filteredData.length);
                html += '<div class="table-pagination">';
                html += `<span class="table-pagination-info">${start}-${end} of ${state.filteredData.length}</span>`;
                html += '<div class="table-pagination-controls">';
                html += `<button class="btn btn-ghost btn-sm dt-page-prev" ${state.page <= 1 ? 'disabled' : ''}>&#8249;</button>`;
                // Show up to 5 page buttons
                const startPage = Math.max(1, state.page - 2);
                const endPage = Math.min(totalPages, startPage + 4);
                for (let p = startPage; p <= endPage; p++) {
                    html += `<button class="btn btn-ghost btn-sm dt-page-num ${p === state.page ? 'active' : ''}" data-page="${p}">${p}</button>`;
                }
                html += `<button class="btn btn-ghost btn-sm dt-page-next" ${state.page >= totalPages ? 'disabled' : ''}>&#8250;</button>`;
                html += '</div></div>';
            }
        } else {
            // Empty state
            html += `
            <div class="empty-state">
                ${config.emptyIcon ? `<div class="empty-state-icon">${config.emptyIcon}</div>` : '<div class="empty-state-icon"><svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg></div>'}
                <div class="empty-state-title">${escHtml(config.emptyTitle || 'No data')}</div>
                <div class="empty-state-desc">${escHtml(config.emptyMessage || 'There are no items to display.')}</div>
            </div>`;
        }

        html += '</div>';
        container.innerHTML = html;
        bindTableEvents();
    }

    function bindTableEvents() {
        // Search
        const searchInput = container.querySelector('.dt-search');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                state.searchQuery = e.target.value;
                state.page = 1;
                render();
            });
            // Re-focus after render
            searchInput.focus();
            searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }

        // Filters
        container.querySelectorAll('.dt-filter').forEach(sel => {
            sel.addEventListener('change', (e) => {
                state.activeFilters[sel.dataset.filterKey] = e.target.value;
                state.page = 1;
                render();
            });
        });

        // Sort
        container.querySelectorAll('th[data-sort-key]').forEach(th => {
            const key = th.dataset.sortKey;
            if (!key) return;
            th.addEventListener('click', () => {
                if (state.sortKey === key) {
                    state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
                } else {
                    state.sortKey = key;
                    state.sortDir = 'asc';
                }
                render();
            });
        });

        // Select all
        const selectAll = container.querySelector('.dt-select-all');
        if (selectAll) {
            selectAll.addEventListener('change', (e) => {
                state.selectAll = e.target.checked;
                const pageData = getPageData();
                pageData.forEach(row => {
                    const id = row.id || row._id || JSON.stringify(row);
                    if (state.selectAll) state.selected.add(id);
                    else state.selected.delete(id);
                });
                render();
                if (config.onSelect) config.onSelect([...state.selected], state.data.filter(r => state.selected.has(r.id || r._id)));
            });
        }

        // Row checkboxes
        container.querySelectorAll('.dt-row-select').forEach(cb => {
            cb.addEventListener('change', (e) => {
                const id = cb.dataset.id;
                if (e.target.checked) state.selected.add(id);
                else state.selected.delete(id);
                render();
                if (config.onSelect) config.onSelect([...state.selected], state.data.filter(r => state.selected.has(r.id || r._id)));
            });
        });

        // Row click
        if (config.onRowClick) {
            container.querySelectorAll('tbody tr').forEach(tr => {
                tr.addEventListener('click', (e) => {
                    if (e.target.closest('.dt-row-select') || e.target.closest('.cell-actions') || e.target.closest('button') || e.target.closest('a')) return;
                    const rowId = tr.dataset.rowId;
                    const row = state.data.find(r => String(r.id || r._id) === rowId);
                    if (row) config.onRowClick(row);
                });
                tr.style.cursor = 'pointer';
            });
        }

        // Pagination
        container.querySelectorAll('.dt-page-num').forEach(btn => {
            btn.addEventListener('click', () => {
                state.page = parseInt(btn.dataset.page);
                render();
            });
        });
        const prevBtn = container.querySelector('.dt-page-prev');
        if (prevBtn) prevBtn.addEventListener('click', () => { state.page--; render(); });
        const nextBtn = container.querySelector('.dt-page-next');
        if (nextBtn) nextBtn.addEventListener('click', () => { state.page++; render(); });

        // Render bulk action buttons (callback-driven)
        if (config.bulkActions && state.selected.size > 0) {
            const bulkContainer = container.querySelector('#dt-bulk-actions');
            if (bulkContainer) {
                for (const action of config.bulkActions) {
                    const btn = document.createElement('button');
                    btn.className = `btn btn-sm ${action.class || 'btn-outline'}`;
                    btn.textContent = action.label;
                    btn.addEventListener('click', () => {
                        const selectedRows = state.data.filter(r => state.selected.has(r.id || r._id));
                        action.handler(selectedRows, [...state.selected]);
                    });
                    bulkContainer.appendChild(btn);
                }
            }
        }
    }

    // Public API
    function setData(newData) {
        state.data = newData || [];
        state.selected.clear();
        state.selectAll = false;
        render();
    }

    function getSelected() {
        return state.data.filter(r => state.selected.has(r.id || r._id || JSON.stringify(r)));
    }

    function clearSelection() {
        state.selected.clear();
        state.selectAll = false;
        render();
    }

    function refresh() {
        render();
    }

    // Initial render
    render();

    return { setData, getSelected, clearSelection, refresh, getState: () => ({ ...state }) };
}

// Expose globally
if (typeof window !== 'undefined') {
    window.createDataTable = createDataTable;
}
