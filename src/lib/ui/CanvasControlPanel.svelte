<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { graphStore } from '../graph/store.svelte';
  import { inferenceManager } from '../inference/manager';
  import { executionEngine } from '../orchestration/execution';
  import { MIN_ZOOM } from '../canvas/node-style';
  
  let showZoomMenu = $state(false);
  
  // Check if there's a valid pipeline (model node with connected input)
  let hasValidPipeline = $derived.by(() => {
    const nodes = Array.from(graphStore.nodes.values());
    const edges = Array.from(graphStore.edges.values());
    
    // Find model nodes (model or triposr)
    const modelNodes = nodes.filter(n => n.type === 'model' || n.type === 'triposr');
    if (modelNodes.length === 0) return false;
    
    // Check if any model node has an input connection
    for (const modelNode of modelNodes) {
      const hasInput = edges.some(edge => edge.targetNodeId === modelNode.id);
      if (hasInput) return true;
    }
    
    return false;
  });
  
  // Backend status
  let backendStatus = $state<{
    available: boolean;
    modelLoaded: boolean;
    device: string;
  }>({
    available: false,
    modelLoaded: false,
    device: 'checking...',
  });
  
  let isExecuting = $state(false);
  let lastExecutionError = $state<string | null>(null);
  let showErrorToast = $state(false);
  let errorToastTimeout: ReturnType<typeof setTimeout> | null = null;
  
  // Cancel button visibility (for animation)
  let showCancelButton = $state(false);
  
  // Check backend status on mount
  $effect(() => {
    checkBackendStatus();
  });
  
  // Auto-hide error toast after 10 seconds
  $effect(() => {
    if (lastExecutionError) {
      showErrorToast = true;
      if (errorToastTimeout) clearTimeout(errorToastTimeout);
      errorToastTimeout = setTimeout(() => {
        showErrorToast = false;
      }, 10000);
    }
  });
  
  // Close zoom menu when clicking outside
  function handleClickOutside(e: MouseEvent) {
    if (showZoomMenu) {
      const target = e.target as HTMLElement;
      if (!target.closest('.zoom-dropdown')) {
        showZoomMenu = false;
      }
    }
  }
  
  $effect(() => {
    if (typeof window !== 'undefined') {
      window.addEventListener('click', handleClickOutside);
      return () => window.removeEventListener('click', handleClickOutside);
    }
  });
  
  async function checkBackendStatus() {
    try {
      const status = await inferenceManager.checkBackendStatus();
      backendStatus = {
        available: inferenceManager.isBackendAvailable(),
        modelLoaded: status.modelLoaded,
        device: status.device || 'simulation',
      };
    } catch (e) {
      backendStatus = {
        available: false,
        modelLoaded: false,
        device: 'offline',
      };
    }
  }
  
  function clearError() {
    lastExecutionError = null;
    showErrorToast = false;
    if (errorToastTimeout) {
      clearTimeout(errorToastTimeout);
      errorToastTimeout = null;
    }
  }
  
  async function handleGenerate() {
    if (isExecuting) return;
    
    // Check backend status before running
    await checkBackendStatus();
    
    // Warn if backend is not available
    if (!backendStatus.available || !backendStatus.modelLoaded) {
      lastExecutionError = 'Backend server not available. Please start the backend server.';
      console.warn('⚠️ Backend not ready:', backendStatus);
      return;
    }
    
    isExecuting = true;
    showCancelButton = true;
    lastExecutionError = null;
    showErrorToast = false;
    
    try {
      const result = await executionEngine.execute();
      if (!result.success && result.error) {
        // Don't show error if it was just cancelled
        if (result.error !== 'Execution cancelled') {
          lastExecutionError = result.error;
          console.error('❌ Pipeline execution failed:', result.error);
        }
      }
    } catch (error) {
      lastExecutionError = error instanceof Error ? error.message : String(error);
      console.error('❌ Pipeline execution error:', lastExecutionError);
    } finally {
      isExecuting = false;
      showCancelButton = false;
    }
  }
  
  function handleCancel() {
    executionEngine.cancel();
  }
  
  function handleUndo() {
    graphStore.undo();
  }
  
  function handleRedo() {
    graphStore.redo();
  }
  
  // Svelte tweened store for smooth camera animations
  const tweenedCamera = tweened(
    { x: 0, y: 0, zoom: 1 },
    { duration: 300, easing: cubicOut }
  );
  
  // Track if we're animating (to avoid setting camera from initial tweened value)
  let isAnimating = false;
  let unsubscribeTweened: (() => void) | null = null;
  
  // Setup subscription on mount (not in $effect to avoid initial value issues)
  onMount(() => {
    unsubscribeTweened = tweenedCamera.subscribe(cam => {
      // Only update camera when we're actually animating
      if (isAnimating) {
        graphStore.setCamera(cam);
      }
    });
  });
  
  onDestroy(() => {
    unsubscribeTweened?.();
  });
  
  // Animated camera transition using Svelte's optimized tweening
  function animateCamera(
    target: { x?: number; y?: number; zoom?: number },
    duration = 300
  ) {
    const current = {
      x: graphStore.camera.x,
      y: graphStore.camera.y,
      zoom: graphStore.camera.zoom,
    };
    
    // Start animation - set flag before tweening
    isAnimating = true;
    
    // Initialize tweened to current position first (instant)
    tweenedCamera.set(current, { duration: 0 });
    
    // Then animate to target
    tweenedCamera.set(
      {
        x: target.x ?? current.x,
        y: target.y ?? current.y,
        zoom: target.zoom ?? current.zoom,
      },
      { duration }
    ).then(() => {
      // Animation complete
      isAnimating = false;
    });
  }
  
  function handleZoomIn() {
    const targetZoom = Math.min(5, graphStore.camera.zoom * 1.2);
    animateCamera({ zoom: targetZoom }, 200);
    showZoomMenu = false;
  }
  
  function handleZoomOut() {
    const targetZoom = Math.max(MIN_ZOOM, graphStore.camera.zoom * 0.8);
    animateCamera({ zoom: targetZoom }, 200);
    showZoomMenu = false;
  }
  
  function handleZoomToFit() {
    const nodes = Array.from(graphStore.nodes.values());
    if (nodes.length === 0) {
      animateCamera({ x: 100, y: 100, zoom: 1 }, 300);
      showZoomMenu = false;
      return;
    }
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });
    
    const padding = 80;
    const contentWidth = (maxX - minX) + padding * 2;
    const contentHeight = (maxY - minY) + padding * 2;
    
    const viewportWidth = Math.max(600, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 340);
    const viewportHeight = Math.max(400, (typeof window !== 'undefined' ? window.innerHeight : 800) - 52);
    
    const zoomX = viewportWidth / contentWidth;
    const zoomY = viewportHeight / contentHeight;
    const finalZoom = Math.max(MIN_ZOOM, Math.min(zoomX, zoomY, 1.5));
    
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    const camX = viewportWidth / (2 * finalZoom) - contentCenterX;
    const camY = viewportHeight / (2 * finalZoom) - contentCenterY;
    
    animateCamera({ x: camX, y: camY, zoom: finalZoom }, 400);
    showZoomMenu = false;
  }
  
  function handleResetZoom() {
    animateCamera({ zoom: 1 }, 250);
    showZoomMenu = false;
  }
  
  let zoomPercent = $derived(Math.round(graphStore.camera.zoom * 100));
</script>

<div class="control-panel">
  <div class="panel-container">
    <!-- Generate Button -->
    <button 
      class="generate-btn"
      class:error={lastExecutionError !== null}
      onclick={handleGenerate}
      disabled={isExecuting || !hasValidPipeline}
      title={!hasValidPipeline ? 'Connect an image to a model to generate' : (lastExecutionError ? `Error: ${lastExecutionError}` : 'Generate (⌘G)')}
    >
      {#if isExecuting}
        <span class="spinner"></span>
      {:else}
        <!-- Sparkle/AI icon -->
        <svg class="ai-icon" width="16" height="17" viewBox="0 0 16 17" fill="none">
          <path d="M6.43464 3.35631L6.8932 4.63055C7.40321 6.04478 8.51676 7.15826 9.93099 7.66822L11.2053 8.12677C11.3203 8.1682 11.3203 8.33105 11.2053 8.37248L9.93099 8.83103C8.51671 9.34102 7.40319 10.4545 6.8932 11.8687L6.43464 13.1429C6.39321 13.2579 6.23035 13.2579 6.18891 13.1429L5.73035 11.8687C5.22035 10.4545 4.10679 9.341 2.69257 8.83103L1.41828 8.37248C1.30328 8.33106 1.30328 8.1682 1.41828 8.12677L2.69257 7.66822C4.10685 7.15824 5.22036 6.04472 5.73035 4.63055L6.18891 3.35631C6.23034 3.2406 6.3932 3.2406 6.43464 3.35631Z" fill="currentColor"/>
          <path d="M12.1706 0.294462L12.4034 0.939426C12.662 1.65512 13.2255 2.21937 13.942 2.47794L14.587 2.71078C14.6455 2.7322 14.6455 2.81434 14.587 2.83506L13.942 3.0679C13.2263 3.32646 12.662 3.89 12.4034 4.60641L12.1706 5.25137C12.1491 5.30994 12.067 5.30994 12.0463 5.25137L11.8134 4.60641C11.5548 3.89072 10.9913 3.32646 10.2749 3.0679L9.62987 2.83506C9.57129 2.81363 9.57129 2.73149 9.62987 2.71078L10.2749 2.47794C10.9906 2.21937 11.5548 1.65583 11.8134 0.939426L12.0463 0.294462C12.067 0.235179 12.1498 0.235179 12.1706 0.294462Z" fill="currentColor"/>
          <path d="M12.1706 11.251L12.4034 11.8959C12.662 12.6116 13.2255 13.1759 13.942 13.4344L14.587 13.6673C14.6455 13.6887 14.6455 13.7708 14.587 13.7916L13.942 14.0244C13.2263 14.283 12.662 14.8465 12.4034 15.5629L12.1706 16.2079C12.1491 16.2664 12.067 16.2664 12.0463 16.2079L11.8134 15.5629C11.5548 14.8472 10.9913 14.283 10.2749 14.0244L9.62987 13.7916C9.57129 13.7701 9.57129 13.688 9.62987 13.6673L10.2749 13.4344C10.9906 13.1759 11.5548 12.6123 11.8134 11.8959L12.0463 11.251C12.067 11.1924 12.1498 11.1924 12.1706 11.251Z" fill="currentColor"/>
        </svg>
      {/if}
      <span>Generate</span>
    </button>
    
    <!-- Cancel Button (shown when executing) -->
    {#if showCancelButton}
      <button 
        class="icon-btn cancel-btn"
        onclick={handleCancel}
        title="Cancel generation"
      >
        <!-- X icon -->
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M18 6L6 18M6 6l12 12" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    {/if}
    
    <!-- Divider -->
    <div class="divider"></div>
    
    <!-- Redo Button -->
    <button 
      class="icon-btn"
      onclick={handleRedo}
      disabled={!graphStore.canRedo}
      title="Redo (⇧⌘Z)"
    >
      <!-- Redo icon (clockwise arrow) -->
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M21 12a9 9 0 11-3-6.7" stroke-linecap="round"/>
        <path d="M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    
    <!-- Undo Button -->
    <button 
      class="icon-btn"
      onclick={handleUndo}
      disabled={!graphStore.canUndo}
      title="Undo (⌘Z)"
    >
      <!-- Undo icon (counterclockwise arrow) -->
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M3 12a9 9 0 116 6.7" stroke-linecap="round"/>
        <path d="M3 21v-6h6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
    
    <!-- Divider -->
    <div class="divider"></div>
    
    <!-- Zoom Dropdown -->
    <div class="zoom-dropdown">
      <button 
        class="zoom-btn"
        onclick={(e) => { e.stopPropagation(); showZoomMenu = !showZoomMenu; }}
      >
        <span class="zoom-value">{zoomPercent}%</span>
        <svg class="chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      
      {#if showZoomMenu}
        <div class="zoom-menu">
          <button class="zoom-menu-item" onclick={handleZoomToFit}>
            <span>Zoom to fit</span>
            <span class="shortcut">⌘1</span>
          </button>
          <button class="zoom-menu-item" onclick={handleZoomIn}>
            <span>Zoom in</span>
            <span class="shortcut">⌘+</span>
          </button>
          <button class="zoom-menu-item" onclick={handleZoomOut}>
            <span>Zoom out</span>
            <span class="shortcut">⌘−</span>
          </button>
          <div class="zoom-menu-divider"></div>
          <button class="zoom-menu-item" onclick={handleResetZoom}>
            <span>Reset to 100%</span>
            <span class="shortcut">⌘0</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
</div>

<!-- Error Toast -->
{#if showErrorToast && lastExecutionError}
  <div class="error-toast">
    <div class="error-content">
      <span class="error-icon">⚠️</span>
      <span class="error-text">{lastExecutionError}</span>
      <button class="error-close" onclick={clearError}>✕</button>
    </div>
  </div>
{/if}

<style>
  .control-panel {
    position: fixed;
    bottom: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 100;
    pointer-events: auto;
  }
  
  .panel-container {
    display: flex;
    flex-direction: row;
    align-items: center;
    gap: 6px;
    padding: 12px;
    background: rgb(5, 5, 5);
    border-radius: 100px;
    box-shadow: 0 6px 27px rgba(5, 5, 5, 0.24);
    /* Smooth width transition when cancel button appears/disappears */
    transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  /* Generate Button - Volt green pill */
  .generate-btn {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 40px;
    padding: 0 20px 0 14px;
    background: #DCFDB5;
    border: none;
    border-radius: 100px;
    color: rgb(5, 5, 5);
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 15px;
    font-weight: 500;
    letter-spacing: 0.01em; /* Tweak kerning here: negative = tighter, positive = looser */
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .generate-btn:hover:not(:disabled) {
    background: #c9f59a;
  }
  
  .generate-btn:active:not(:disabled) {
    transform: scale(0.98);
  }
  
  .generate-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  .generate-btn.error {
    background: #ef4444;
    color: white;
  }
  
  .ai-icon {
    width: 16px;
    height: 17px;
    flex-shrink: 0;
  }
  
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(5, 5, 5, 0.2);
    border-top-color: rgb(5, 5, 5);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Divider */
  .divider {
    width: 1px;
    height: 32px;
    background: rgb(36, 36, 36);
    margin: 0 6px;
  }
  
  /* Icon Buttons */
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: transparent;
    border: none;
    border-radius: 50%;
    color: rgb(153, 153, 153);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .icon-btn:hover:not(:disabled) {
    color: rgb(244, 244, 244);
    background: rgba(255, 255, 255, 0.1);
  }
  
  .icon-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  
  .icon-btn svg {
    width: 24px;
    height: 24px;
  }
  
  /* Cancel Button */
  .cancel-btn {
    animation: cancelFadeIn 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  }
  
  .cancel-btn:hover:not(:disabled) {
    color: rgb(255, 100, 100);
    background: rgba(255, 100, 100, 0.15);
  }
  
  @keyframes cancelFadeIn {
    from {
      opacity: 0;
      transform: scale(0.8);
      width: 0;
      margin: 0;
    }
    to {
      opacity: 1;
      transform: scale(1);
      width: 32px;
      margin: 0;
    }
  }
  
  /* Zoom Dropdown */
  .zoom-dropdown {
    position: relative;
  }
  
  .zoom-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    height: 32px;
    padding: 0 12px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: rgb(153, 153, 153);
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 14px;
    font-weight: 400;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .zoom-btn:hover {
    color: rgb(244, 244, 244);
    background: rgba(255, 255, 255, 0.1);
  }
  
  .zoom-value {
    min-width: 40px;
    text-align: right;
  }
  
  .chevron {
    opacity: 0.6;
  }
  
  /* Zoom Menu */
  .zoom-menu {
    position: absolute;
    bottom: calc(100% + 8px);
    right: 0;
    min-width: 180px;
    background: rgb(28, 28, 28);
    border: 1px solid rgb(48, 48, 48);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    animation: fadeIn 0.15s ease;
  }
  
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }
  
  .zoom-menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    color: rgb(244, 244, 244);
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s ease;
  }
  
  .zoom-menu-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  
  .zoom-menu-item .shortcut {
    color: rgb(102, 102, 102);
    font-size: 12px;
  }
  
  .zoom-menu-divider {
    height: 1px;
    background: rgb(48, 48, 48);
    margin: 4px 0;
  }
  
  /* Error Toast */
  .error-toast {
    position: fixed;
    bottom: 100px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 101;
    animation: slideUp 0.3s ease;
  }
  
  @keyframes slideUp {
    from { opacity: 0; transform: translate(-50%, 10px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }
  
  .error-content {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: rgb(28, 28, 28);
    border: 1px solid #ef4444;
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    max-width: 400px;
  }
  
  .error-icon {
    font-size: 16px;
  }
  
  .error-text {
    flex: 1;
    color: rgb(244, 244, 244);
    font-size: 13px;
    line-height: 1.4;
  }
  
  .error-close {
    background: none;
    border: none;
    color: rgb(153, 153, 153);
    font-size: 16px;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    transition: all 0.15s ease;
  }
  
  .error-close:hover {
    color: rgb(244, 244, 244);
    background: rgba(255, 255, 255, 0.1);
  }
</style>
