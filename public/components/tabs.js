/**
 * Tabs Component — Client-side tab switching with badge counts.
 *
 * Usage:
 *   import { createTabs } from './components/tabs.js';
 *
 *   const tabs = createTabs({
 *       el: '#my-tabs',
 *       tabs: [
 *           { id: 'overview', label: 'Overview', badge: null },
 *           { id: 'pending', label: 'Pending', badge: 5 },
 *           { id: 'approved', label: 'Approved', badge: 0 },
 *       ],
 *       activeTab: 'overview',
 *       onChange: (tabId) => { ... },
 *   });
 *
 *   tabs.setActive('pending');
 *   tabs.updateBadge('pending', 3);
 */

function escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

export function createTabs(config) {
    const container = typeof config.el === 'string'
        ? document.querySelector(config.el)
        : config.el;

    if (!container) {
        console.error('[Tabs] Container not found:', config.el);
        return null;
    }

    const state = {
        activeTab: config.activeTab || (config.tabs[0] && config.tabs[0].id),
        badges: {},
    };

    // Init badges
    config.tabs.forEach(t => {
        state.badges[t.id] = t.badge ?? null;
    });

    function render() {
        let html = '<div class="tabs" role="tablist">';
        for (const tab of config.tabs) {
            const isActive = tab.id === state.activeTab;
            const badge = state.badges[tab.id];
            const badgeHtml = badge !== null && badge !== undefined && badge > 0
                ? `<span class="tab-badge">${badge > 99 ? '99+' : badge}</span>`
                : '';

            html += `
            <button class="tab ${isActive ? 'active' : ''}"
                    role="tab"
                    aria-selected="${isActive}"
                    data-tab-id="${escHtml(tab.id)}">
                ${tab.icon ? `<span class="tab-icon">${tab.icon}</span>` : ''}
                ${escHtml(tab.label)}
                ${badgeHtml}
            </button>`;
        }
        html += '</div>';

        container.innerHTML = html;
        bindEvents();

        // Toggle content panels
        updatePanels();
    }

    function updatePanels() {
        // Look for sibling or child elements with data-tab-panel="tabId"
        const parent = container.parentElement || document;
        parent.querySelectorAll('[data-tab-panel]').forEach(panel => {
            if (panel.dataset.tabPanel === state.activeTab) {
                panel.classList.add('active');
                panel.style.display = '';
            } else {
                panel.classList.remove('active');
                panel.style.display = 'none';
            }
        });
    }

    function bindEvents() {
        container.querySelectorAll('.tab').forEach(btn => {
            btn.addEventListener('click', () => {
                const tabId = btn.dataset.tabId;
                if (tabId === state.activeTab) return;
                state.activeTab = tabId;
                render();
                if (config.onChange) config.onChange(tabId);
            });
        });
    }

    function setActive(tabId) {
        state.activeTab = tabId;
        render();
    }

    function updateBadge(tabId, count) {
        state.badges[tabId] = count;
        const tabEl = container.querySelector(`[data-tab-id="${tabId}"] .tab-badge`);
        if (tabEl) {
            if (count > 0) {
                tabEl.textContent = count > 99 ? '99+' : count;
                tabEl.style.display = '';
            } else {
                tabEl.style.display = 'none';
            }
        }
    }

    function getActive() {
        return state.activeTab;
    }

    // Initial render
    render();

    return { setActive, updateBadge, getActive, render };
}

// Expose globally
if (typeof window !== 'undefined') {
    window.createTabs = createTabs;
}
