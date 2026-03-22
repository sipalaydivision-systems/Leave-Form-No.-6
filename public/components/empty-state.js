/**
 * Empty State Component — Shows a placeholder when content is empty.
 *
 * Usage:
 *   import { renderEmptyState } from './components/empty-state.js';
 *
 *   renderEmptyState('#container', {
 *       title: 'No Applications Yet',
 *       description: 'File a leave application to get started.',
 *       icon: 'document',
 *       actionLabel: 'File Leave',
 *       onAction: () => { ... },
 *   });
 */

const EMPTY_ICONS = {
    document: '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="12" y="6" width="40" height="52" rx="4"/><line x1="22" y1="20" x2="42" y2="20"/><line x1="22" y1="28" x2="42" y2="28"/><line x1="22" y1="36" x2="34" y2="36"/></svg>',
    calendar: '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="8" y="12" width="48" height="44" rx="4"/><line x1="8" y1="24" x2="56" y2="24"/><line x1="20" y1="6" x2="20" y2="18"/><line x1="44" y1="6" x2="44" y2="18"/><circle cx="24" cy="36" r="2"/><circle cx="32" cy="36" r="2"/><circle cx="40" cy="36" r="2"/></svg>',
    users: '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="24" cy="22" r="8"/><path d="M8 52v-4a12 12 0 0124 0v4"/><circle cx="42" cy="22" r="6" opacity="0.5"/><path d="M40 52v-3a10 10 0 0116 0v3" opacity="0.5"/></svg>',
    chart: '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="10" y="32" width="10" height="22" rx="2"/><rect x="27" y="20" width="10" height="34" rx="2"/><rect x="44" y="10" width="10" height="44" rx="2"/></svg>',
    inbox: '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 38l10-24h28l10 24"/><rect x="8" y="38" width="48" height="18" rx="4"/><path d="M8 38h14a4 4 0 004 4h12a4 4 0 004-4h14"/></svg>',
    search: '<svg viewBox="0 0 64 64" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="28" cy="28" r="16"/><line x1="40" y1="40" x2="54" y2="54"/></svg>',
};

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

export function renderEmptyState(el, config = {}) {
    const container = typeof el === 'string' ? document.querySelector(el) : el;
    if (!container) return;

    const icon = config.iconHtml || EMPTY_ICONS[config.icon] || EMPTY_ICONS.document;

    let html = `
    <div class="empty-state">
        <div class="empty-state-icon">${icon}</div>
        <div class="empty-state-title">${escHtml(config.title || 'Nothing here yet')}</div>
        <div class="empty-state-desc">${escHtml(config.description || '')}</div>
        ${config.actionLabel ? `<button class="btn btn-primary empty-state-action">${escHtml(config.actionLabel)}</button>` : ''}
    </div>`;

    container.innerHTML = html;

    if (config.actionLabel && config.onAction) {
        container.querySelector('.empty-state-action')
            .addEventListener('click', config.onAction);
    }
}

export { EMPTY_ICONS };

if (typeof window !== 'undefined') {
    window.renderEmptyState = renderEmptyState;
}
