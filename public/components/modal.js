/**
 * Modal Component — Creates accessible, focus-trapped modals.
 *
 * Usage:
 *   import { openModal, closeModal, confirmModal } from './components/modal.js';
 *
 *   // Simple content modal
 *   const modal = openModal({
 *       title: 'Application Details',
 *       content: '<div>...</div>',
 *       size: 'lg',        // 'sm' | 'md' (default) | 'lg' | 'xl'
 *       onClose: () => {},
 *   });
 *
 *   // Confirmation modal
 *   confirmModal({
 *       title: 'Approve Leave?',
 *       message: 'This will advance the application to the next approver.',
 *       confirmText: 'Approve',
 *       confirmClass: 'btn-success',
 *       onConfirm: () => { ... },
 *   });
 */

let activeModals = [];

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

/**
 * Open a modal dialog.
 */
export function openModal(config = {}) {
    const {
        title = '',
        content = '',
        size = 'md',
        footer = null,
        closable = true,
        onClose = null,
        onOpen = null,
    } = config;

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay open';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    if (title) overlay.setAttribute('aria-label', title);

    // Size class
    const sizeClass = size === 'lg' ? ' modal-lg' : size === 'xl' ? ' modal-xl' : '';

    overlay.innerHTML = `
        <div class="modal${sizeClass}">
            ${title ? `
            <div class="modal-header">
                <h3 class="modal-title">${escHtml(title)}</h3>
                ${closable ? '<button class="modal-close" aria-label="Close">&times;</button>' : ''}
            </div>` : ''}
            <div class="modal-body">${content}</div>
            ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
        </div>
    `;

    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    const modalEl = overlay.querySelector('.modal');
    const id = Date.now();
    const entry = { id, overlay, modalEl, onClose };
    activeModals.push(entry);

    // Close button
    const closeBtn = overlay.querySelector('.modal-close');
    if (closeBtn && closable) {
        closeBtn.addEventListener('click', () => closeModal(id));
    }

    // Click overlay to close
    if (closable) {
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal(id);
        });
    }

    // Escape key
    const escHandler = (e) => {
        if (e.key === 'Escape' && closable) {
            closeModal(id);
        }
    };
    document.addEventListener('keydown', escHandler);
    entry._escHandler = escHandler;

    // Focus trap
    trapFocus(modalEl);

    // onOpen callback
    if (onOpen) {
        requestAnimationFrame(() => onOpen(modalEl, id));
    }

    return {
        id,
        el: modalEl,
        overlay,
        close: () => closeModal(id),
        setContent: (html) => { overlay.querySelector('.modal-body').innerHTML = html; },
        setFooter: (html) => {
            let footerEl = overlay.querySelector('.modal-footer');
            if (!footerEl) {
                footerEl = document.createElement('div');
                footerEl.className = 'modal-footer';
                modalEl.appendChild(footerEl);
            }
            footerEl.innerHTML = html;
        },
    };
}

/**
 * Close a modal by ID.
 */
export function closeModal(id) {
    const idx = activeModals.findIndex(m => m.id === id);
    if (idx === -1) return;

    const entry = activeModals[idx];
    if (entry._escHandler) {
        document.removeEventListener('keydown', entry._escHandler);
    }

    entry.overlay.classList.remove('open');
    entry.overlay.remove();
    activeModals.splice(idx, 1);

    if (activeModals.length === 0) {
        document.body.style.overflow = '';
    }

    if (entry.onClose) entry.onClose();
}

/**
 * Close all open modals.
 */
export function closeAllModals() {
    [...activeModals].forEach(m => closeModal(m.id));
}

/**
 * Confirmation dialog.
 */
export function confirmModal(config = {}) {
    const {
        title = 'Confirm',
        message = 'Are you sure?',
        confirmText = 'Confirm',
        cancelText = 'Cancel',
        confirmClass = 'btn-primary',
        onConfirm = null,
        onCancel = null,
    } = config;

    const content = `<p style="color:var(--color-text-secondary);font-size:var(--text-md);line-height:var(--leading-relaxed)">${escHtml(message)}</p>`;

    const footer = `
        <button class="btn btn-outline modal-cancel-btn">${escHtml(cancelText)}</button>
        <button class="btn ${confirmClass} modal-confirm-btn">${escHtml(confirmText)}</button>
    `;

    const modal = openModal({
        title,
        content,
        footer,
        size: 'sm',
        onClose: onCancel,
    });

    const confirmBtn = modal.overlay.querySelector('.modal-confirm-btn');
    const cancelBtn = modal.overlay.querySelector('.modal-cancel-btn');

    confirmBtn.addEventListener('click', () => {
        modal.close();
        if (onConfirm) onConfirm();
    });

    cancelBtn.addEventListener('click', () => {
        modal.close();
        if (onCancel) onCancel();
    });

    confirmBtn.focus();

    return modal;
}

/**
 * Simple focus trap within an element.
 */
function trapFocus(el) {
    const focusable = el.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusable.length > 0) {
        focusable[0].focus();
    }
}

// Expose globally
if (typeof window !== 'undefined') {
    window.openModal = openModal;
    window.closeModal = closeModal;
    window.confirmModal = confirmModal;
    window.closeAllModals = closeAllModals;
}
