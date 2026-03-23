/**
 * Component Library Index — Re-exports all components.
 *
 * Usage (from ES module):
 *   import { initSidebar, toast, openModal, createDataTable, createTabs } from './components/index.js';
 *
 * For non-module scripts, each component also registers itself on window.
 */

export { initSidebar, initSidebarOverlay, ICONS } from './sidebar.js';
export { toast } from './toast.js';
export { openModal, closeModal, confirmModal, closeAllModals } from './modal.js';
export { createDataTable } from './table.js';
export { createTabs } from './tabs.js';
export { renderStatCards, createCard } from './card.js';
export { createLineChart, createBarChart, createDoughnutChart, destroyChart } from './chart-wrapper.js';
export { renderEmptyState, EMPTY_ICONS } from './empty-state.js';
