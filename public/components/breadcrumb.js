/**
 * Breadcrumb Component
 *
 * Usage:
 *   import { renderBreadcrumb } from './components/breadcrumb.js';
 *   renderBreadcrumb('#breadcrumb', [
 *       { label: 'Dashboard', href: '/dashboard' },
 *       { label: 'My Applications' },
 *       { label: 'SDO Sipalay-05' },
 *   ]);
 */

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

export function renderBreadcrumb(el, items = []) {
    const container = typeof el === 'string' ? document.querySelector(el) : el;
    if (!container) return;

    container.className = 'topbar-breadcrumb';
    container.setAttribute('aria-label', 'Breadcrumb');

    const parts = items.map((item, i) => {
        const isLast = i === items.length - 1;
        if (isLast) {
            return `<span style="color:var(--color-text)">${escHtml(item.label)}</span>`;
        }
        if (item.href) {
            return `<a href="${escHtml(item.href)}">${escHtml(item.label)}</a><span class="topbar-breadcrumb-sep">/</span>`;
        }
        return `<span>${escHtml(item.label)}</span><span class="topbar-breadcrumb-sep">/</span>`;
    });

    container.innerHTML = parts.join('');
}

if (typeof window !== 'undefined') {
    window.renderBreadcrumb = renderBreadcrumb;
}
