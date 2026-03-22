/**
 * Toast Notification System
 *
 * Usage:
 *   import { toast } from './components/toast.js';
 *   toast.success('Application approved');
 *   toast.error('Insufficient leave balance', 'Validation Error');
 *   toast.warning('Session expiring soon');
 *   toast.info('2 new applications pending');
 */

const TOAST_ICONS = {
    success: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    error:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
    warning: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    info:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
};

const DEFAULTS = {
    success: { duration: 3000, title: 'Success' },
    error:   { duration: 0, title: 'Error' },     // Errors persist
    warning: { duration: 5000, title: 'Warning' },
    info:    { duration: 3000, title: 'Info' },
};

const MAX_VISIBLE = 5;

let container = null;
let toasts = [];
let toastId = 0;

function ensureContainer() {
    if (container) return;
    container = document.createElement('div');
    container.className = 'toast-container';
    container.setAttribute('role', 'alert');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
}

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function createToast(type, message, title, options = {}) {
    ensureContainer();

    const id = ++toastId;
    const defaults = DEFAULTS[type] || DEFAULTS.info;
    const duration = options.duration !== undefined ? options.duration : defaults.duration;
    const displayTitle = title || defaults.title;

    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    el.dataset.toastId = id;

    el.innerHTML = `
        <span class="toast-icon">${TOAST_ICONS[type] || TOAST_ICONS.info}</span>
        <div class="toast-body">
            <div class="toast-title">${escHtml(displayTitle)}</div>
            ${message ? `<div class="toast-message">${escHtml(message)}</div>` : ''}
        </div>
        <button class="toast-dismiss" aria-label="Dismiss">&times;</button>
        ${duration > 0 ? `<div class="toast-progress toast-${type}" style="width:100%"></div>` : ''}
    `;

    // Dismiss button
    el.querySelector('.toast-dismiss').addEventListener('click', () => removeToast(id));

    // Add to container
    container.appendChild(el);

    const toastEntry = { id, el, timer: null };
    toasts.push(toastEntry);

    // Auto-dismiss progress bar
    if (duration > 0) {
        const progress = el.querySelector('.toast-progress');
        if (progress) {
            requestAnimationFrame(() => {
                progress.style.transitionDuration = duration + 'ms';
                progress.style.width = '0%';
            });
        }
        toastEntry.timer = setTimeout(() => removeToast(id), duration);
    }

    // Enforce max visible
    while (toasts.length > MAX_VISIBLE) {
        removeToast(toasts[0].id);
    }

    return id;
}

function removeToast(id) {
    const idx = toasts.findIndex(t => t.id === id);
    if (idx === -1) return;

    const entry = toasts[idx];
    if (entry.timer) clearTimeout(entry.timer);

    entry.el.classList.add('removing');
    entry.el.addEventListener('animationend', () => {
        entry.el.remove();
    });

    toasts.splice(idx, 1);

    // Fallback removal if animation doesn't fire
    setTimeout(() => { try { entry.el.remove(); } catch(e) {} }, 300);
}

function clearAll() {
    [...toasts].forEach(t => removeToast(t.id));
}

export const toast = {
    success: (message, title, options) => createToast('success', message, title, options),
    error:   (message, title, options) => createToast('error', message, title, options),
    warning: (message, title, options) => createToast('warning', message, title, options),
    info:    (message, title, options) => createToast('info', message, title, options),
    remove:  removeToast,
    clearAll,
};

// Also expose globally for non-module scripts
if (typeof window !== 'undefined') {
    window.toast = toast;
}
