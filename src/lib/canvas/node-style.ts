/**
 * Centralized Node Styling Constants
 * 
 * Single source of truth for node visual properties across all renderers:
 * - Canvas.svelte (DOM overlays)
 * - renderer-2d.ts (Canvas 2D fallback)
 * - renderer.ts (WebGPU)
 * - nodes.wgsl (WebGPU shader)
 * - Sidebar.svelte (preview thumbnails)
 */

// =============================================================================
// Geometry Configuration
// =============================================================================

/**
 * Base border radius in pixels at 100% zoom
 */
export const NODE_BORDER_RADIUS = 4;

/**
 * Border radius for sidebar preview thumbnails (CSS pixels, fixed)
 */
export const SIDEBAR_PREVIEW_RADIUS = 4;

/**
 * Minimum zoom level (20%)
 */
export const MIN_ZOOM = 0.2;

/**
 * Maximum zoom level (500%)
 */
export const MAX_ZOOM = 5;

// =============================================================================
// Border Width Configuration
// =============================================================================

/**
 * Selection border width at 100% zoom
 */
export const SELECTION_BORDER_WIDTH = 1.25;

/**
 * Hover border width at 100% zoom
 */
export const HOVER_BORDER_WIDTH = 0.75;

/**
 * Default border width at 100% zoom
 */
export const DEFAULT_BORDER_WIDTH = 0.5;

// =============================================================================
// Color Configuration
// =============================================================================

/**
 * Selection colors - used for selected node borders
 */
export const COLORS = {
  // Selection state
  selection: {
    border: '#9E9EA0',
    borderRgba: 'rgba(158, 158, 160, 1)',
    glow: 'rgba(158, 158, 160, 0.2)',
    glowIntense: 'rgba(158, 158, 160, 0.3)',
  },
  
  // Status colors
  status: {
    idle: { border: 'rgba(255, 255, 255, 0.15)', glow: 'transparent' },
    pending: { border: '#f59e0b', glow: 'rgba(245, 158, 11, 0.4)' },
    running: { border: '#3b82f6', glow: 'rgba(59, 130, 246, 0.4)' },
    complete: { border: '#22c55e', glow: 'rgba(34, 197, 94, 0.2)' },
    error: { border: '#ef4444', glow: 'rgba(239, 68, 68, 0.4)' },
  },
  
  // Mesh node accent
  mesh: {
    border: '#4da6ff',
    glow: 'rgba(77, 166, 255, 0.2)',
  },
  
  // Node backgrounds
  background: {
    image: '#1a1a1e',
    model: 'linear-gradient(270deg, #373534 0%, #424140 100%)',
    output: '#1a1a1e',
    mesh: 'linear-gradient(135deg, #1a2a3f 0%, #1a1a2f 100%)',
  },
  
  // Drop shadow for elevated nodes
  dropShadow: '0 2px 8px rgba(0, 0, 0, 0.15)',
} as const;

// =============================================================================
// Box Shadow Generators (for DOM overlays)
// =============================================================================

/**
 * Generate box-shadow CSS for selection state
 * Uses box-shadow instead of border to avoid corner gaps with images
 */
export function getSelectionBoxShadow(includeDropShadow = false): string {
  const shadows = [
    `0 0 0 1px ${COLORS.selection.border}`,
    `0 0 0 2px ${COLORS.selection.glow}`,
  ];
  if (includeDropShadow) {
    shadows.push(COLORS.dropShadow);
  }
  return shadows.join(', ');
}

/**
 * Generate box-shadow CSS for status states
 */
export function getStatusBoxShadow(
  status: 'idle' | 'pending' | 'running' | 'complete' | 'error',
  includeDropShadow = false
): string {
  const statusColor = COLORS.status[status];
  const shadows = [
    `0 0 0 1px ${statusColor.border}`,
  ];
  if (statusColor.glow !== 'transparent') {
    shadows.push(`0 0 12px ${statusColor.glow}`);
  }
  if (includeDropShadow) {
    shadows.push(COLORS.dropShadow);
  }
  return shadows.join(', ');
}

/**
 * Generate box-shadow CSS for mesh selection
 */
export function getMeshSelectionBoxShadow(): string {
  return `0 0 0 1px ${COLORS.mesh.border}, 0 0 0 2px ${COLORS.mesh.glow}`;
}

// =============================================================================
// Geometry Helper Functions
// =============================================================================

/**
 * Calculate the border radius for canvas rendering (2D/WebGPU)
 * Works in world coordinates that get scaled by zoom.
 * 
 * Behavior:
 * - zoom <= 100%: radius stays visually constant at 4px on screen
 * - zoom > 100%: radius increases proportionally (corners appear more rounded)
 * 
 * @param zoom - Current camera zoom level (1 = 100%)
 * @returns Border radius in world coordinates
 */
export function getCanvasNodeRadius(zoom: number = 1): number {
  if (zoom <= 1) {
    // Below/at 100%: compensate for zoom to maintain constant 4px screen appearance
    // worldUnits * zoom = screenPx, so worldUnits = screenPx / zoom
    return NODE_BORDER_RADIUS / zoom;
  }
  // Above 100%: use base radius in world units, which scales up on screen
  // At 200% zoom: 4 world units * 2 = 8px on screen
  return NODE_BORDER_RADIUS;
}

/**
 * Calculate the border radius for DOM overlay elements (screen pixels)
 * 
 * Behavior:
 * - zoom <= 100%: radius stays at 4px
 * - zoom > 100%: radius increases proportionally
 * 
 * @param zoom - Current camera zoom level (1 = 100%)
 * @returns Border radius in screen pixels for CSS
 */
export function getDOMNodeRadius(zoom: number = 1): number {
  if (zoom <= 1) {
    // Below/at 100%: constant 4px
    return NODE_BORDER_RADIUS;
  }
  // Above 100%: scale with zoom
  return NODE_BORDER_RADIUS * zoom;
}

/**
 * Get the border radius for WebGPU shader data
 * @param zoom - Current camera zoom level  
 * @returns Border radius value to pass to shader
 */
export function getShaderNodeRadius(zoom: number = 1): number {
  // WebGPU shader works in world coordinates
  return getCanvasNodeRadius(zoom);
}

/**
 * Calculate the border width for canvas rendering (2D)
 * Follows same scaling rules as radius for visual consistency.
 * 
 * @param zoom - Current camera zoom level
 * @param isSelected - Whether the node is selected
 * @param isHovered - Whether the node is hovered
 * @returns Border width in world coordinates
 */
export function getCanvasBorderWidth(
  zoom: number = 1,
  isSelected: boolean = false,
  isHovered: boolean = false
): number {
  const baseWidth = isSelected 
    ? SELECTION_BORDER_WIDTH 
    : isHovered 
      ? HOVER_BORDER_WIDTH 
      : DEFAULT_BORDER_WIDTH;
  
  if (zoom <= 1) {
    // Below/at 100%: compensate for zoom to maintain constant screen appearance
    return baseWidth / zoom;
  }
  // Above 100%: use base width in world units
  return baseWidth;
}

/**
 * Calculate the border width for DOM overlay elements (screen pixels)
 * 
 * @param zoom - Current camera zoom level
 * @param isSelected - Whether the node is selected
 * @param isHovered - Whether the node is hovered
 * @returns Border width in screen pixels for CSS
 */
export function getDOMBorderWidth(
  zoom: number = 1,
  isSelected: boolean = false,
  isHovered: boolean = false
): number {
  const baseWidth = isSelected 
    ? SELECTION_BORDER_WIDTH 
    : isHovered 
      ? HOVER_BORDER_WIDTH 
      : DEFAULT_BORDER_WIDTH;
  
  if (zoom <= 1) {
    // Below/at 100%: constant width
    return baseWidth;
  }
  // Above 100%: scale with zoom
  return baseWidth * zoom;
}

// =============================================================================
// CSS Custom Properties (for injection into DOM)
// =============================================================================

/**
 * Generate CSS custom properties string for node styling
 * Can be injected into a style attribute or :root
 */
export function getNodeStyleCSSVariables(): string {
  return `
    --node-border-radius: ${NODE_BORDER_RADIUS}px;
    --node-selection-border: ${COLORS.selection.border};
    --node-selection-glow: ${COLORS.selection.glow};
    --node-drop-shadow: ${COLORS.dropShadow};
    --node-status-running: ${COLORS.status.running.border};
    --node-status-complete: ${COLORS.status.complete.border};
    --node-status-error: ${COLORS.status.error.border};
    --node-status-pending: ${COLORS.status.pending.border};
  `.trim();
}
