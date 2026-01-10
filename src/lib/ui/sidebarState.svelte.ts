/**
 * Sidebar state store - shared state for sidebar open/closed status
 */

// Sidebar dimensions
export const ICON_SIDEBAR_WIDTH = 72;
export const PANEL_GAP = 12;
export const PANEL_WIDTH = 429;

// Total width when panel is open
export const SIDEBAR_TOTAL_WIDTH = ICON_SIDEBAR_WIDTH + PANEL_GAP + PANEL_WIDTH; // 513px

// Reactive state
let isPanelOpen = $state(false);

export const sidebarState = {
  get isOpen() {
    return isPanelOpen;
  },
  set isOpen(value: boolean) {
    isPanelOpen = value;
  },
  
  // Get the width of the sidebar area that overlaps the canvas
  get width() {
    return isPanelOpen ? SIDEBAR_TOTAL_WIDTH : ICON_SIDEBAR_WIDTH;
  }
};
