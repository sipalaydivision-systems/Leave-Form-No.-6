/**
 * Sidebar Component — Renders a collapsible sidebar navigation.
 *
 * Usage:
 *   import { initSidebar } from './components/sidebar.js';
 *   initSidebar({
 *       el: '#sidebar',
 *       profile: { name: 'John Doe', role: 'Employee', avatar: null },
 *       sections: [
 *           { title: 'Main', links: [
 *               { id: 'overview', label: 'Overview', icon: ICONS.home, badge: 0, active: true },
 *           ]},
 *       ],
 *       footerLinks: [
 *           { id: 'settings', label: 'Settings', icon: ICONS.settings },
 *           { id: 'help', label: 'Help Center', icon: ICONS.help },
 *       ],
 *       onNavigate: (linkId) => { ... },
 *       onProfileClick: () => { ... },
 *       roleColor: '#003366',
 *   });
 */

// --- SVG Icons (inline, no dependency) ---
export const ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>',
    fileText: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>',
    clipboardList: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/><line x1="10" y1="11" x2="16" y2="11"/><line x1="10" y1="15" x2="16" y2="15"/><circle cx="7" cy="11" r="0.5"/><circle cx="7" cy="15" r="0.5"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
    creditCard: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>',
    users: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
    checkCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    helpCircle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    barChart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/></svg>',
    shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
    database: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/></svg>',
    activity: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
    server: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="8" rx="2" ry="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2"/><line x1="6" y1="6" x2="6.01" y2="6"/><line x1="6" y1="18" x2="6.01" y2="18"/></svg>',
    userPlus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="8.5" cy="7" r="4"/><line x1="20" y1="8" x2="20" y2="14"/><line x1="23" y1="11" x2="17" y2="11"/></svg>',
    logout: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
    chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
    chevronLeft: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>',
    chevronRight: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>',
    menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
    search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>',
    filter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>',
};

/**
 * Get initials from a name string (first letter of first + last name).
 */
function getInitials(name) {
    if (!name) return '?';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0][0].toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * Escape HTML to prevent XSS when inserting user content.
 */
function esc(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

/**
 * Initialize the sidebar component.
 */
export function initSidebar(config) {
    const container = typeof config.el === 'string'
        ? document.querySelector(config.el)
        : config.el;

    if (!container) {
        console.error('[Sidebar] Container not found:', config.el);
        return null;
    }

    // Default to collapsed; only expand if user has explicitly expanded it
    const storedCollapsed = localStorage.getItem('sidebar-collapsed');
    const state = {
        collapsed: storedCollapsed === null ? true : storedCollapsed === 'true',
        mobileOpen: false,
        activeId: config.activeId || null,
        openDropdowns: new Set(JSON.parse(localStorage.getItem('sidebar-dropdowns') || '[]')),
    };

    function render() {
        const roleColor = config.roleColor || 'var(--color-primary)';
        const initials = getInitials(config.profile?.name);

        container.className = 'sidebar' +
            (state.collapsed ? ' collapsed' : '') +
            (state.mobileOpen ? ' mobile-open' : '');

        let html = '';

        // Profile section
        html += `
        <div class="sidebar-profile" id="sidebar-profile" role="button" tabindex="0" aria-label="Profile">
            <div class="sidebar-avatar" style="background:${roleColor}">${config.profile?.avatarUrl
                ? `<img src="${esc(config.profile.avatarUrl)}" alt="Avatar">`
                : esc(initials)}</div>
            <div class="sidebar-profile-info">
                <div class="sidebar-profile-name">${esc(config.profile?.name)}</div>
                <div class="sidebar-profile-role">${esc(config.profile?.role)}</div>
            </div>
            <span class="sidebar-profile-arrow">${ICONS.chevronDown}</span>
        </div>`;

        // Navigation sections
        html += '<nav class="sidebar-nav" role="navigation">';

        for (const section of (config.sections || [])) {
            html += '<div class="sidebar-section">';
            if (section.title) {
                html += `<div class="sidebar-section-title">${esc(section.title)}</div>`;
            }
            for (const link of (section.links || [])) {
                if (link.children) {
                    const isOpen = state.openDropdowns.has(link.id);
                    html += `
                    <div class="sidebar-link sidebar-dropdown-toggle"
                         data-dropdown="${esc(link.id)}"
                         aria-expanded="${isOpen}"
                         role="button" tabindex="0">
                        <span class="sidebar-link-icon">${link.icon || ''}</span>
                        <span class="sidebar-link-label">${esc(link.label)}</span>
                        <span class="sidebar-dropdown-arrow">${ICONS.chevronDown}</span>
                    </div>
                    <div class="sidebar-dropdown-menu ${isOpen ? 'open' : ''}" id="dropdown-${esc(link.id)}">`;
                    for (const child of link.children) {
                        html += renderLink(child);
                    }
                    html += '</div>';
                } else {
                    html += renderLink(link);
                }
            }
            html += '</div>';
        }

        html += '</nav>';

        // Footer
        html += '<div class="sidebar-footer">';
        for (const link of (config.footerLinks || [])) {
            html += renderLink(link);
        }
        // Collapse toggle
        html += `
        <button class="sidebar-toggle" id="sidebar-collapse-btn" aria-label="Toggle sidebar">
            <span class="sidebar-link-icon">${state.collapsed ? ICONS.chevronRight : ICONS.chevronLeft}</span>
        </button>`;
        html += '</div>';

        container.innerHTML = html;
        bindEvents();
    }

    function renderLink(link) {
        const isActive = link.id === state.activeId;
        let extraClasses = isActive ? ' active' : '';

        let badgeHtml = '';
        if (link.badge && link.badge > 0) {
            badgeHtml = `<span class="sidebar-link-badge">${link.badge > 99 ? '99+' : link.badge}</span>`;
        }
        if (link.chip) {
            badgeHtml += `<span class="sidebar-link-chip">${esc(link.chip)}</span>`;
        }

        const href = link.href || '#';
        const tag = link.href ? 'a' : 'div';
        const hrefAttr = link.href ? ` href="${esc(link.href)}"` : '';

        return `
        <${tag} class="sidebar-link${extraClasses}" data-link-id="${esc(link.id)}"${hrefAttr} role="link" tabindex="0">
            <span class="sidebar-link-icon">${link.icon || ''}</span>
            <span class="sidebar-link-label">${esc(link.label)}</span>
            ${badgeHtml}
        </${tag}>`;
    }

    function bindEvents() {
        // Profile click
        const profileEl = container.querySelector('#sidebar-profile');
        if (profileEl) {
            profileEl.addEventListener('click', () => {
                if (config.onProfileClick) config.onProfileClick();
            });
        }

        // Navigation links
        container.querySelectorAll('.sidebar-link:not(.sidebar-dropdown-toggle)').forEach(el => {
            el.addEventListener('click', (e) => {
                const linkId = el.dataset.linkId;
                if (!linkId) return;
                if (!el.getAttribute('href') || el.getAttribute('href') === '#') {
                    e.preventDefault();
                }
                setActive(linkId);
                if (config.onNavigate) config.onNavigate(linkId);
                // Close mobile sidebar on navigate
                if (state.mobileOpen) {
                    state.mobileOpen = false;
                    render();
                }
            });
        });

        // Dropdown toggles
        container.querySelectorAll('.sidebar-dropdown-toggle').forEach(el => {
            el.addEventListener('click', () => {
                const dropdownId = el.dataset.dropdown;
                if (state.openDropdowns.has(dropdownId)) {
                    state.openDropdowns.delete(dropdownId);
                } else {
                    state.openDropdowns.add(dropdownId);
                }
                localStorage.setItem('sidebar-dropdowns', JSON.stringify([...state.openDropdowns]));
                render();
            });
        });

        // Collapse toggle
        const collapseBtn = container.querySelector('#sidebar-collapse-btn');
        if (collapseBtn) {
            collapseBtn.addEventListener('click', () => {
                state.collapsed = !state.collapsed;
                localStorage.setItem('sidebar-collapsed', state.collapsed);
                render();
            });
        }

        // Hover-to-expand on desktop when collapsed
        if (window.innerWidth > 768) {
            container.addEventListener('mouseenter', () => {
                if (state.collapsed) container.classList.add('hovering');
            });
            container.addEventListener('mouseleave', () => {
                container.classList.remove('hovering');
            });
        }
    }

    function setActive(linkId) {
        state.activeId = linkId;
        container.querySelectorAll('.sidebar-link').forEach(el => {
            el.classList.toggle('active', el.dataset.linkId === linkId);
        });
    }

    function updateBadge(linkId, count) {
        const link = container.querySelector(`[data-link-id="${linkId}"] .sidebar-link-badge`);
        if (link) {
            link.textContent = count > 99 ? '99+' : count;
            link.style.display = count > 0 ? '' : 'none';
        }
    }

    function toggleMobile(open) {
        state.mobileOpen = typeof open === 'boolean' ? open : !state.mobileOpen;
        render();
    }

    // Initial render
    render();

    // Public API
    return { setActive, updateBadge, toggleMobile, render };
}

/**
 * Inject a mobile overlay alongside the sidebar.
 */
export function initSidebarOverlay(sidebarEl) {
    let overlay = document.querySelector('.sidebar-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'sidebar-overlay';
        const sidebar = typeof sidebarEl === 'string' ? document.querySelector(sidebarEl) : sidebarEl;
        if (sidebar && sidebar.parentNode) {
            sidebar.parentNode.insertBefore(overlay, sidebar.nextSibling);
        }
    }
    overlay.addEventListener('click', () => {
        const sidebar = document.querySelector('.sidebar');
        if (sidebar) {
            sidebar.classList.remove('mobile-open');
            overlay.style.display = 'none';
        }
    });
    return overlay;
}
