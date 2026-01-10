<script lang="ts">
  import { graphStore } from '../graph/store.svelte';
  import { nodeRegistry } from '../graph/nodes/registry';
  import { theme } from './theme.svelte';
  import { inferenceManager } from '../inference/manager';
  import { executionEngine } from '../graph/execution';
  
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
  
  // Check backend status on mount
  $effect(() => {
    checkBackendStatus();
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
  
  async function handleRunGraph() {
    if (isExecuting) return;
    isExecuting = true;
    try {
      await executionEngine.execute();
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
  <div class="toolbar-section brand">
    <span class="logo">◆</span>
    <span class="title">Generative Studio</span>
  </div>
  
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
      class="toolbar-btn run-btn"
      onclick={handleRunGraph}
      disabled={isExecuting || graphStore.nodes.size === 0}
      title="Run the graph"
    >
      {#if isExecuting}
        <span class="spinner"></span>
        Running...
      {:else}
        <span class="icon">▶</span>
        Run
      {/if}
    </button>
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
    
    <div class="separator"></div>
    
    <button 
      class="toolbar-btn theme-toggle"
      onclick={() => theme.toggle()}
      title={theme.isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      {#if theme.isDark}
        <span class="icon">☀️</span>
      {:else}
        <span class="icon">🌙</span>
      {/if}
    </button>
  </div>
</header>

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
  
  .brand {
    gap: 10px;
  }
  
  .logo {
    font-size: 20px;
    color: var(--accent-primary);
  }
  
  .title {
    font-weight: 600;
    font-size: 14px;
    letter-spacing: -0.02em;
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
  
  /* Run button */
  .run-btn {
    background: #10b981;
    border-color: #10b981;
    color: white;
  }
  
  .run-btn:hover:not(:disabled) {
    background: #059669;
    border-color: #059669;
  }
  
  .run-btn:disabled {
    background: var(--bg-tertiary);
    border-color: var(--border-subtle);
    color: var(--text-muted);
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
</style>
