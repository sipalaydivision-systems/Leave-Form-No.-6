/**
 * Card & Stat Card Components
 *
 * Usage:
 *   import { renderStatCards } from './components/card.js';
 *
 *   renderStatCards('#stats-grid', [
 *       { label: 'VL Balance', value: '12.5', icon: 'blue', suffix: 'days' },
 *       { label: 'Pending', value: '3', icon: 'orange', change: '+1 today', positive: false },
 *   ]);
 */

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

/**
 * Render a grid of stat cards.
 */
export function renderStatCards(el, stats) {
    const container = typeof el === 'string' ? document.querySelector(el) : el;
    if (!container) return;

    let html = '';
    for (const stat of stats) {
        const changeClass = stat.positive === true ? 'positive' : stat.positive === false ? 'negative' : '';
        const changeHtml = stat.change
            ? `<div class="stat-card-change ${changeClass}">${escHtml(stat.change)}</div>`
            : '';

        const iconHtml = stat.iconHtml
            ? `<div class="stat-card-icon ${stat.icon || ''}">${stat.iconHtml}</div>`
            : stat.icon
                ? `<div class="stat-card-icon ${stat.icon}"></div>`
                : '';

        html += `
        <div class="stat-card" ${stat.id ? `id="${escHtml(stat.id)}"` : ''}>
            <div class="stat-card-header">
                <span class="stat-card-label">${escHtml(stat.label)}</span>
                ${iconHtml}
            </div>
            <div class="stat-card-value">
                ${escHtml(String(stat.value))}${stat.suffix ? `<span class="text-sm text-muted" style="margin-left:4px">${escHtml(stat.suffix)}</span>` : ''}
            </div>
            ${changeHtml}
        </div>`;
    }

    container.innerHTML = html;
}

/**
 * Create a generic card element.
 */
export function createCard(config = {}) {
    const { title, headerRight, body, footer, className } = config;

    const card = document.createElement('div');
    card.className = 'card' + (className ? ' ' + className : '');

    let html = '';
    if (title || headerRight) {
        html += `<div class="card-header">
            <h3 class="card-title">${escHtml(title || '')}</h3>
            ${headerRight || ''}
        </div>`;
    }
    html += `<div class="card-body">${body || ''}</div>`;
    if (footer) {
        html += `<div class="card-footer">${footer}</div>`;
    }

    card.innerHTML = html;
    return card;
}

// Expose globally
if (typeof window !== 'undefined') {
    window.renderStatCards = renderStatCards;
    window.createCard = createCard;
}
