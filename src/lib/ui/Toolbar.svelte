<script lang="ts">
  import { graphStore } from '../graph/store.svelte';
  import { nodeRegistry } from '../graph/nodes/registry';
  import { inferenceManager } from '../inference/manager';
  import { executionEngine } from '../orchestration/execution';
  
  let showNodeMenu = $state(false);
  let showZoomMenu = $state(false);
  
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
  
  async function handleRunGraph() {
    if (isExecuting) return;
    
    // Check backend status before running
    await checkBackendStatus();
    
    // Warn if backend is not available
    if (!backendStatus.available || !backendStatus.modelLoaded) {
      lastExecutionError = 'Backend server not available. Please start the backend server in terminal: cd backend && source venv/bin/activate && python server.py';
      console.warn('⚠️ Backend not ready:', backendStatus);
      return;
    }
    
    isExecuting = true;
    lastExecutionError = null;
    showErrorToast = false;
    
    try {
      const result = await executionEngine.execute();
      if (!result.success && result.error) {
        lastExecutionError = result.error;
        console.error('❌ Pipeline execution failed:', result.error);
      }
    } catch (error) {
      lastExecutionError = error instanceof Error ? error.message : String(error);
      console.error('❌ Pipeline execution error:', lastExecutionError);
    } finally {
      isExecuting = false;
    }
  }
  
  function handleAddNode(type: string) {
    // Add node at center of viewport with offset based on existing nodes
    const nodeCount = graphStore.nodes.size;
    const offset = nodeCount * 30; // Stagger nodes
    const x = -graphStore.camera.x + offset;
    const y = -graphStore.camera.y + offset;
    const newNodeId = graphStore.addNode(type, x, y);
    
    // Select the new node
    graphStore.selectNode(newNodeId, false);
    showNodeMenu = false;
  }
  
  function handleDeleteSelected() {
    graphStore.selectedNodeIds.forEach((id) => {
      graphStore.deleteNode(id);
    });
  }
  
  function handleUndo() {
    graphStore.undo();
  }
  
  function handleRedo() {
    graphStore.redo();
  }
  
  function handleZoomIn() {
    graphStore.setCamera({ zoom: Math.min(5, graphStore.camera.zoom * 1.2) });
    showZoomMenu = false;
  }
  
  function handleZoomOut() {
    graphStore.setCamera({ zoom: Math.max(0.1, graphStore.camera.zoom * 0.8) });
    showZoomMenu = false;
  }
  
  function handleZoomToFit() {
    // Calculate bounding box of all nodes
    const nodes = Array.from(graphStore.nodes.values());
    if (nodes.length === 0) {
      // No nodes, reset to default view with some offset
      graphStore.setCamera({ x: 100, y: 100, zoom: 1 });
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
    
    // Add padding
    const padding = 80;
    const contentWidth = (maxX - minX) + padding * 2;
    const contentHeight = (maxY - minY) + padding * 2;
    
    // Estimate viewport size - account for sidebars (sidebar ~60px, property panel ~280px, toolbar ~52px)
    // Use window dimensions as a base estimate
    const viewportWidth = Math.max(600, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 340);
    const viewportHeight = Math.max(400, (typeof window !== 'undefined' ? window.innerHeight : 800) - 52);
    
    // Calculate zoom to fit (cap for comfortable viewing)
    const zoomX = viewportWidth / contentWidth;
    const zoomY = viewportHeight / contentHeight;
    const finalZoom = Math.max(0.1, Math.min(zoomX, zoomY, 1.5));
    
    // For top-left anchored: screenX = (worldX + camX) * zoom
    // Content center should appear at viewport center
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    const camX = viewportWidth / (2 * finalZoom) - contentCenterX;
    const camY = viewportHeight / (2 * finalZoom) - contentCenterY;
    
    graphStore.setCamera({ x: camX, y: camY, zoom: finalZoom });
    showZoomMenu = false;
  }
  
  function handleResetView() {
    graphStore.setCamera({ x: 0, y: 0, zoom: 1 });
    showZoomMenu = false;
  }
  
  // Get current zoom percentage for display
  let zoomPercent = $derived(Math.round(graphStore.camera.zoom * 100));
</script>

<header class="toolbar">
  <div class="toolbar-section actions">
    <div class="dropdown">
      <button 
        class="toolbar-btn primary"
        onclick={() => showNodeMenu = !showNodeMenu}
      >
        <span class="icon">+</span>
        Add Node
      </button>
      
      {#if showNodeMenu}
        <div class="dropdown-menu">
          {#each Object.entries(nodeRegistry) as [type, def]}
            <button 
              class="dropdown-item"
              onclick={() => handleAddNode(type)}
            >
              <span class="node-category">{def.category}</span>
              {def.name}
            </button>
          {/each}
        </div>
      {/if}
    </div>
    
    <div class="separator"></div>
    
    <button 
      class="toolbar-btn"
      onclick={handleDeleteSelected}
      disabled={graphStore.selectedNodeIds.size === 0}
    >
      Delete
    </button>
    
    <div class="separator"></div>
    
    <button 
      class="toolbar-btn with-shortcut"
      onclick={handleUndo}
      disabled={!graphStore.canUndo}
      title="Undo"
    >
      Undo
      <span class="shortcut">⌘Z</span>
    </button>
    <button 
      class="toolbar-btn with-shortcut"
      onclick={handleRedo}
      disabled={!graphStore.canRedo}
      title="Redo"
    >
      Redo
      <span class="shortcut">⇧⌘Z</span>
    </button>
    
    <div class="separator"></div>
    
    <button 
      class="generate-btn"
      class:error={lastExecutionError !== null}
      onclick={handleRunGraph}
      disabled={isExecuting || graphStore.nodes.size === 0}
      title={lastExecutionError ? `Last error: ${lastExecutionError}` : 'Generate'}
    >
      {#if isExecuting}
        <span class="spinner spinner-dark"></span>
        Generating...
      {:else if lastExecutionError}
        <span class="icon">⚠️</span>
        Error
      {:else}
        <svg class="ai-icon" width="16" height="17" viewBox="0 0 16 17" fill="none">
          <path d="M6.43464 3.35631L6.8932 4.63055C7.40321 6.04478 8.51676 7.15826 9.93099 7.66822L11.2053 8.12677C11.3203 8.1682 11.3203 8.33105 11.2053 8.37248L9.93099 8.83103C8.51671 9.34102 7.40319 10.4545 6.8932 11.8687L6.43464 13.1429C6.39321 13.2579 6.23035 13.2579 6.18891 13.1429L5.73035 11.8687C5.22035 10.4545 4.10679 9.341 2.69257 8.83103L1.41828 8.37248C1.30328 8.33106 1.30328 8.1682 1.41828 8.12677L2.69257 7.66822C4.10685 7.15824 5.22036 6.04472 5.73035 4.63055L6.18891 3.35631C6.23034 3.2406 6.3932 3.2406 6.43464 3.35631Z" fill="currentColor"/>
          <path d="M12.1706 0.294462L12.4034 0.939426C12.662 1.65512 13.2255 2.21937 13.942 2.47794L14.587 2.71078C14.6455 2.7322 14.6455 2.81434 14.587 2.83506L13.942 3.0679C13.2263 3.32646 12.662 3.89 12.4034 4.60641L12.1706 5.25137C12.1491 5.30994 12.067 5.30994 12.0463 5.25137L11.8134 4.60641C11.5548 3.89072 10.9913 3.32646 10.2749 3.0679L9.62987 2.83506C9.57129 2.81363 9.57129 2.73149 9.62987 2.71078L10.2749 2.47794C10.9906 2.21937 11.5548 1.65583 11.8134 0.939426L12.0463 0.294462C12.067 0.235179 12.1498 0.235179 12.1706 0.294462Z" fill="currentColor"/>
          <path d="M12.1706 11.251L12.4034 11.8959C12.662 12.6116 13.2255 13.1759 13.942 13.4344L14.587 13.6673C14.6455 13.6887 14.6455 13.7708 14.587 13.7916L13.942 14.0244C13.2263 14.283 12.662 14.8465 12.4034 15.5629L12.1706 16.2079C12.1491 16.2664 12.067 16.2664 12.0463 16.2079L11.8134 15.5629C11.5548 14.8472 10.9913 14.283 10.2749 14.0244L9.62987 13.7916C9.57129 13.7701 9.57129 13.688 9.62987 13.6673L10.2749 13.4344C10.9906 13.1759 11.5548 12.6123 11.8134 11.8959L12.0463 11.251C12.067 11.1924 12.1498 11.1924 12.1706 11.251Z" fill="currentColor"/>
        </svg>
        Generate
      {/if}
    </button>
    
    {#if lastExecutionError}
      <button 
        class="toolbar-btn clear-error"
        onclick={clearError}
        title="Clear error"
      >
        ✕
      </button>
    {/if}
  </div>
  
  <div class="toolbar-section view">
    <!-- Backend Status Indicator -->
    <div 
      class="backend-status" 
      class:connected={backendStatus.available && backendStatus.modelLoaded}
      class:loading={backendStatus.available && !backendStatus.modelLoaded}
      title={backendStatus.available 
        ? `Backend: ${backendStatus.device} | Model: ${backendStatus.modelLoaded ? 'loaded' : 'loading...'}` 
        : 'Backend offline - using simulation mode'}
    >
      <span class="status-dot"></span>
      <span class="status-text">
        {#if backendStatus.available && backendStatus.modelLoaded}
          {backendStatus.device.toUpperCase()}
        {:else if backendStatus.available}
          Loading...
        {:else}
          Simulation
        {/if}
      </span>
    </div>
    
    <div class="separator"></div>
    
    <div class="dropdown">
      <button 
        class="toolbar-btn zoom-btn"
        onclick={() => showZoomMenu = !showZoomMenu}
      >
        {zoomPercent}%
        <span class="dropdown-arrow">▾</span>
      </button>
      
      {#if showZoomMenu}
        <div class="dropdown-menu zoom-menu">
          <button class="dropdown-item" onclick={handleZoomToFit}>
            <span class="item-label">Zoom to fit</span>
            <span class="item-shortcut">⌘1</span>
          </button>
          <button class="dropdown-item" onclick={handleZoomIn}>
            <span class="item-label">Zoom in</span>
            <span class="item-shortcut">⌘+</span>
          </button>
          <button class="dropdown-item" onclick={handleZoomOut}>
            <span class="item-label">Zoom out</span>
            <span class="item-shortcut">⌘−</span>
          </button>
        </div>
      {/if}
    </div>
    
  </div>
</header>

<!-- Error Toast Notification -->
{#if showErrorToast && lastExecutionError}
  <div class="error-toast">
    <div class="error-toast-content">
      <div class="error-toast-header">
        <span class="error-icon">⚠️</span>
        <span class="error-title">Pipeline Error</span>
        <button class="error-close" onclick={clearError}>✕</button>
      </div>
      <div class="error-message">{lastExecutionError}</div>
      {#if !backendStatus.available || !backendStatus.modelLoaded}
        <div class="error-help">
          <strong>How to fix:</strong>
          <ol>
            <li>Open a new terminal</li>
            <li>Navigate to the backend directory: <code>cd backend</code></li>
            <li>Activate virtual environment: <code>source venv/bin/activate</code></li>
            <li>Start the server: <code>python server.py</code></li>
          </ol>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .toolbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    height: 52px;
    padding: 0 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-subtle);
    gap: 16px;
  }
  
  .toolbar-section {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .toolbar-btn {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .toolbar-btn:hover:not(:disabled) {
    background: var(--bg-elevated);
    border-color: var(--border-default);
  }
  
  .toolbar-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  
  .toolbar-btn.primary {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  
  .toolbar-btn.primary:hover {
    background: var(--accent-secondary);
    border-color: var(--accent-secondary);
  }
  
  .toolbar-btn.icon-only {
    padding: 8px 10px;
    font-size: 16px;
    font-weight: 600;
  }
  
  .icon {
    font-size: 16px;
    font-weight: 600;
  }
  
  .toolbar-btn.with-shortcut {
    gap: 8px;
  }
  
  .shortcut {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    background: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: system-ui, -apple-system, sans-serif;
  }
  
  .toolbar-btn:disabled .shortcut {
    opacity: 0.5;
  }
  
  .separator {
    width: 1px;
    height: 24px;
    background: var(--border-subtle);
  }
  
  .dropdown {
    position: relative;
  }
  
  .dropdown-menu {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 4px;
    min-width: 200px;
    background: var(--bg-elevated);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-lg);
    overflow: hidden;
    z-index: 100;
  }
  
  .dropdown-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s ease;
  }
  
  .dropdown-item:hover {
    background: var(--bg-tertiary);
  }
  
  .node-category {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    background: var(--bg-secondary);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
  
  /* Zoom menu styles */
  .zoom-btn {
    min-width: 70px;
    justify-content: space-between;
  }
  
  .dropdown-arrow {
    font-size: 10px;
    opacity: 0.6;
    margin-left: 4px;
  }
  
  .zoom-menu {
    right: 0;
    left: auto;
    min-width: 180px;
  }
  
  .zoom-menu .dropdown-item {
    justify-content: space-between;
  }
  
  .item-label {
    flex: 1;
  }
  
  .item-shortcut {
    font-size: 12px;
    color: var(--text-muted);
    font-family: system-ui, -apple-system, sans-serif;
  }
  
  /* Generate button - pill style */
  .generate-btn {
    display: inline-flex;
    height: 40px;
    padding: 8px 20px 8px 14px;
    justify-content: center;
    align-items: center;
    gap: 8px;
    border-radius: 100px;
    background: var(--bb-volt-85, #DCFDB5);
    border: none;
    color: #111111;
    font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 14px;
    font-weight: 400;
    letter-spacing: -0.01em;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .generate-btn:hover:not(:disabled) {
    background: var(--bb-volt-75, #c9f59a);
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
  
  .generate-btn.error:hover:not(:disabled) {
    background: #dc2626;
  }
  
  .ai-icon {
    width: 16px;
    height: 17px;
    flex-shrink: 0;
  }
  
  .spinner-dark {
    border-color: rgba(0, 0, 0, 0.2);
    border-top-color: #111111;
  }
  
  .clear-error {
    padding: 6px 8px;
    font-size: 12px;
    background: #ef4444;
    border-color: #ef4444;
    color: white;
  }
  
  .clear-error:hover {
    background: #dc2626;
    border-color: #dc2626;
  }
  
  .spinner {
    width: 14px;
    height: 14px;
    border: 2px solid rgba(255, 255, 255, 0.3);
    border-top-color: white;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Backend status indicator */
  .backend-status {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    font-size: 11px;
    font-weight: 500;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f59e0b;
  }
  
  .backend-status.connected .status-dot {
    background: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
  }
  
  .backend-status.loading .status-dot {
    background: #3b82f6;
    animation: pulse 1.5s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  
  .status-text {
    color: var(--text-secondary);
  }
  
  .backend-status.connected .status-text {
    color: #10b981;
  }
  
  /* Error Toast Notification */
  .error-toast {
    position: fixed;
    top: 72px;
    right: 20px;
    max-width: 500px;
    z-index: 1000;
    animation: slideIn 0.3s ease-out;
  }
  
  @keyframes slideIn {
    from {
      transform: translateX(100%);
      opacity: 0;
    }
    to {
      transform: translateX(0);
      opacity: 1;
    }
  }
  
  .error-toast-content {
    background: var(--bg-elevated);
    border: 2px solid #ef4444;
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-xl);
    overflow: hidden;
  }
  
  .error-toast-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    background: #ef4444;
    color: white;
  }
  
  .error-icon {
    font-size: 18px;
  }
  
  .error-title {
    flex: 1;
    font-weight: 600;
    font-size: 14px;
  }
  
  .error-close {
    background: none;
    border: none;
    color: white;
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    transition: background 0.15s ease;
  }
  
  .error-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }
  
  .error-message {
    padding: 16px;
    color: var(--text-primary);
    font-size: 13px;
    line-height: 1.5;
    border-bottom: 1px solid var(--border-subtle);
  }
  
  .error-help {
    padding: 16px;
    background: var(--bg-secondary);
    font-size: 13px;
    line-height: 1.6;
  }
  
  .error-help strong {
    display: block;
    margin-bottom: 8px;
    color: var(--text-primary);
  }
  
  .error-help ol {
    margin: 0;
    padding-left: 20px;
  }
  
  .error-help li {
    margin: 4px 0;
    color: var(--text-secondary);
  }
  
  .error-help code {
    background: var(--bg-tertiary);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
    font-size: 12px;
    color: var(--accent-primary);
  }
</style>
