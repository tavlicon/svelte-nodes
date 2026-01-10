<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { theme } from './theme.svelte';
  import { listFiles, formatFileSize, type FileInfo } from '../services/file-service';
  
  // Panel state
  let activePanel = $state<'assets' | 'models' | 'canvases' | null>(null);
  
  function togglePanel(panel: 'assets' | 'models' | 'canvases') {
    if (activePanel === panel) {
      activePanel = null;
    } else {
      activePanel = panel;
      // Refresh files when opening a panel
      if (panel === 'assets') {
        refreshAssets();
      } else if (panel === 'models') {
        refreshModels();
      } else if (panel === 'canvases') {
        refreshCanvases();
      }
    }
  }
  
  // Assets panel state
  let assetsTab = $state<'generated' | 'imported'>('imported');
  
  // File lists
  let generatedFiles = $state<FileInfo[]>([]);
  let importedFiles = $state<FileInfo[]>([]);
  let modelFiles = $state<FileInfo[]>([]);
  let canvasFiles = $state<FileInfo[]>([]);
  let isLoading = $state(false);
  
  // Refresh functions
  async function refreshAssets() {
    isLoading = true;
    try {
      const [generated, imported] = await Promise.all([
        listFiles('output'),
        listFiles('input'),
      ]);
      generatedFiles = generated;
      importedFiles = imported;
    } catch (error) {
      console.error('Error refreshing assets:', error);
    } finally {
      isLoading = false;
    }
  }
  
  async function refreshModels() {
    isLoading = true;
    try {
      modelFiles = await listFiles('models');
    } catch (error) {
      console.error('Error refreshing models:', error);
    } finally {
      isLoading = false;
    }
  }
  
  async function refreshCanvases() {
    isLoading = true;
    try {
      // For canvases, we list JSON files from the canvases directory
      const response = await fetch('/api/files?dir=canvases');
      if (response.ok) {
        canvasFiles = await response.json();
      }
    } catch (error) {
      console.error('Error refreshing canvases:', error);
    } finally {
      isLoading = false;
    }
  }
  
  function refreshFiles() {
    if (activePanel === 'assets') {
      refreshAssets();
    } else if (activePanel === 'models') {
      refreshModels();
    } else if (activePanel === 'canvases') {
      refreshCanvases();
    }
  }
  
  // Listen for file changes from other components
  function handleFilesChanged(e: CustomEvent) {
    const { directory } = e.detail;
    if (directory === 'input' || directory === 'output') {
      refreshAssets();
    } else if (directory === 'canvases') {
      refreshCanvases();
    }
  }
  
  // Handle dragging images from sidebar to canvas
  function handleImageDragStart(e: DragEvent, file: FileInfo) {
    if (!e.dataTransfer) return;
    
    // Set custom data type for sidebar images
    e.dataTransfer.setData('application/x-sidebar-image', JSON.stringify({
      path: file.path,
      name: file.name,
      type: file.type,
    }));
    
    e.dataTransfer.effectAllowed = 'copy';
    
    // Create a drag image from the thumbnail
    const target = e.target as HTMLElement;
    const thumbnail = target.querySelector('.file-thumbnail img') as HTMLImageElement;
    if (thumbnail) {
      e.dataTransfer.setDragImage(thumbnail, 50, 50);
    }
  }
  
  // Handle dragging models from sidebar to canvas
  function handleModelDragStart(e: DragEvent, file: FileInfo) {
    if (!e.dataTransfer) return;
    
    // Set custom data type for sidebar models
    e.dataTransfer.setData('application/x-sidebar-model', JSON.stringify({
      path: file.path,
      name: file.name,
      type: file.type,
      size: file.size,
    }));
    
    e.dataTransfer.effectAllowed = 'copy';
  }
  
  // Click-to-add: dispatch event to add image to canvas
  function handleImageClick(file: FileInfo) {
    window.dispatchEvent(new CustomEvent('sidebar-add-image', {
      detail: {
        path: file.path,
        name: file.name,
        type: file.type,
      }
    }));
  }
  
  // Click-to-add: dispatch event to add model to canvas
  function handleModelClick(file: FileInfo) {
    window.dispatchEvent(new CustomEvent('sidebar-add-model', {
      detail: {
        path: file.path,
        name: file.name,
        type: file.type,
        size: file.size,
      }
    }));
  }
  
  onMount(() => {
    window.addEventListener('files-changed', handleFilesChanged as EventListener);
    // Initial load
    refreshAssets();
  });
  
  onDestroy(() => {
    window.removeEventListener('files-changed', handleFilesChanged as EventListener);
  });
</script>

<div class="sidebar-container">
  <!-- Icon sidebar -->
  <nav class="icon-sidebar">
    <button 
      class="sidebar-icon"
      class:active={activePanel === 'assets'}
      onclick={() => togglePanel('assets')}
      title="Assets"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <path d="M14 3h7v7h-7z" />
        <path d="M14 14h7v7h-7z" />
        <path d="M3 14h7v7H3z" />
        <path d="M7 7l4-4m0 0l4 4m-4-4v8" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="icon-label">Assets</span>
    </button>
    
    <button 
      class="sidebar-icon"
      class:active={activePanel === 'models'}
      onclick={() => togglePanel('models')}
      title="Models"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
      <span class="icon-label">Models</span>
    </button>
    
    <button 
      class="sidebar-icon"
      class:active={activePanel === 'canvases'}
      onclick={() => togglePanel('canvases')}
      title="Canvases"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="8" height="6" rx="1" />
        <rect x="13" y="3" width="8" height="6" rx="1" />
        <rect x="8" y="15" width="8" height="6" rx="1" />
        <path d="M7 9v3a3 3 0 003 3h0" stroke-linecap="round" />
        <path d="M17 9v3a3 3 0 01-3 3h0" stroke-linecap="round" />
      </svg>
      <span class="icon-label">Canvases</span>
    </button>
  </nav>
  
  <!-- Expanded panel -->
  {#if activePanel}
    <div class="panel">
      {#if activePanel === 'assets'}
        <div class="panel-header">
          <div class="panel-tabs">
            <button 
              class="panel-tab"
              class:active={assetsTab === 'generated'}
              onclick={() => assetsTab = 'generated'}
            >
              Generated
            </button>
            <button 
              class="panel-tab"
              class:active={assetsTab === 'imported'}
              onclick={() => assetsTab = 'imported'}
            >
              Imported
            </button>
          </div>
          <button class="refresh-btn" onclick={refreshFiles} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        
        <div class="panel-content">
          {#if isLoading}
            <div class="loading-state">
              <div class="spinner"></div>
              <p>Loading...</p>
            </div>
          {:else if assetsTab === 'generated'}
            {#if generatedFiles.length === 0}
              <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <h3>Empty</h3>
                <p>No generated images yet</p>
              </div>
            {:else}
              <div class="file-grid">
                {#each generatedFiles as file (file.name)}
                  <button 
                    class="file-card" 
                    title={file.name}
                    aria-label={`Add ${file.name} to canvas`}
                    draggable="true"
                    ondragstart={(e) => handleImageDragStart(e, file)}
                    onclick={() => handleImageClick(file)}
                    type="button"
                  >
                    <div class="file-thumbnail">
                      <img src={file.path} alt={file.name} loading="lazy" draggable="false" />
                    </div>
                    <div class="file-info">
                      <span class="file-name">{file.name}</span>
                      <span class="file-size">{formatFileSize(file.size)}</span>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          {:else}
            {#if importedFiles.length === 0}
              <div class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <h3>Empty</h3>
                <p>No imported assets yet</p>
                <p class="hint">Drop images onto the canvas to import</p>
              </div>
            {:else}
              <div class="file-grid">
                {#each importedFiles as file (file.name)}
                  <button 
                    class="file-card" 
                    title={file.name}
                    aria-label={`Add ${file.name} to canvas`}
                    draggable="true"
                    ondragstart={(e) => handleImageDragStart(e, file)}
                    onclick={() => handleImageClick(file)}
                    type="button"
                  >
                    <div class="file-thumbnail">
                      <img src={file.path} alt={file.name} loading="lazy" draggable="false" />
                    </div>
                    <div class="file-info">
                      <span class="file-name">{file.name}</span>
                      <span class="file-size">{formatFileSize(file.size)}</span>
                    </div>
                  </button>
                {/each}
              </div>
            {/if}
          {/if}
        </div>
        
      {:else if activePanel === 'models'}
        <div class="panel-header">
          <h2 class="panel-title">MODELS</h2>
          <button class="refresh-btn" onclick={refreshFiles} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        
        <div class="panel-content">
          {#if isLoading}
            <div class="loading-state">
              <div class="spinner"></div>
              <p>Loading...</p>
            </div>
          {:else if modelFiles.length === 0}
            <div class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <rect x="3" y="3" width="7" height="7" rx="1" />
                <rect x="14" y="3" width="7" height="7" rx="1" />
                <rect x="3" y="14" width="7" height="7" rx="1" />
                <rect x="14" y="14" width="7" height="7" rx="1" />
              </svg>
              <h3>Empty</h3>
              <p>No models available</p>
            </div>
          {:else}
            <div class="file-list">
              {#each modelFiles as file (file.name)}
                <button 
                  class="file-item model-item" 
                  title={file.name}
                  aria-label={`Add ${file.name} to canvas`}
                  draggable="true"
                  ondragstart={(e) => handleModelDragStart(e, file)}
                  onclick={() => handleModelClick(file)}
                  type="button"
                >
                  <div class="model-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                      <path d="M12 2L2 7l10 5 10-5-10-5z" />
                      <path d="M2 17l10 5 10-5" />
                      <path d="M2 12l10 5 10-5" />
                    </svg>
                  </div>
                  <div class="model-info">
                    <span class="file-name">{file.name}</span>
                    <div class="model-meta">
                      <span class="model-type">{file.type.toUpperCase()}</span>
                      <span class="file-size">{formatFileSize(file.size)}</span>
                    </div>
                  </div>
                </button>
              {/each}
            </div>
          {/if}
        </div>
        
      {:else if activePanel === 'canvases'}
        <div class="panel-header">
          <h2 class="panel-title">CANVASES</h2>
          <button class="refresh-btn" onclick={refreshFiles} title="Refresh">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        
        <div class="panel-content">
          {#if isLoading}
            <div class="loading-state">
              <div class="spinner"></div>
              <p>Loading...</p>
            </div>
          {:else if canvasFiles.length === 0}
            <div class="empty-state">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <h3>Empty</h3>
              <p>No Canvases found</p>
            </div>
          {:else}
            <div class="file-list">
              {#each canvasFiles as file (file.name)}
                <div class="file-item canvas-item">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="8" height="6" rx="1" />
                    <rect x="13" y="3" width="8" height="6" rx="1" />
                    <rect x="8" y="15" width="8" height="6" rx="1" />
                    <path d="M7 9v3a3 3 0 003 3h0" stroke-linecap="round" />
                    <path d="M17 9v3a3 3 0 01-3 3h0" stroke-linecap="round" />
                  </svg>
                  <div class="canvas-info">
                    <span class="file-name">{file.name.replace('.json', '')}</span>
                    <span class="file-date">{new Date(file.modified).toLocaleDateString()}</span>
                  </div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .sidebar-container {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    display: flex;
    z-index: 50;
    pointer-events: auto;
  }
  
  /* Icon sidebar */
  .icon-sidebar {
    display: flex;
    flex-direction: column;
    width: 64px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-subtle);
    padding: 8px 0;
    gap: 4px;
  }
  
  .sidebar-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    padding: 12px 8px;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
  }
  
  .sidebar-icon:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }
  
  .sidebar-icon.active {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }
  
  .sidebar-icon.active::before {
    content: '';
    position: absolute;
    left: 0;
    top: 8px;
    bottom: 8px;
    width: 3px;
    background: var(--accent-primary);
    border-radius: 0 2px 2px 0;
  }
  
  .icon-label {
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.02em;
  }
  
  /* Expanded panel */
  .panel {
    width: 549px;
    background: var(--bg-primary);
    border-right: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-subtle);
    background: var(--bg-secondary);
    min-height: 48px;
  }
  
  .panel-title {
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--text-primary);
    margin: 0;
  }
  
  .panel-tabs {
    display: flex;
    gap: 0;
  }
  
  .panel-tab {
    padding: 8px 16px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    border-radius: var(--radius-md);
    transition: all 0.15s ease;
  }
  
  .panel-tab:hover {
    color: var(--text-primary);
  }
  
  .panel-tab.active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }
  
  .refresh-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: all 0.15s ease;
  }
  
  .refresh-btn:hover {
    color: var(--text-primary);
    background: var(--bg-tertiary);
  }
  
  /* Panel content */
  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }
  
  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 48px 24px;
    color: var(--text-muted);
  }
  
  .empty-state svg {
    margin-bottom: 16px;
    opacity: 0.5;
  }
  
  .empty-state h3 {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 8px 0;
  }
  
  .empty-state p {
    font-size: 14px;
    margin: 0;
  }
  
  .empty-state .hint {
    font-size: 12px;
    margin-top: 8px;
    opacity: 0.7;
  }
  
  /* File list */
  .file-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .file-item {
    display: flex;
    align-items: center;
    padding: 10px 12px;
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    cursor: pointer;
    transition: background 0.15s ease;
    gap: 10px;
    /* Reset button styles */
    font: inherit;
    text-align: left;
    width: 100%;
    border: 1px solid var(--border-subtle);
    color: inherit;
  }
  
  .file-item:hover {
    background: var(--bg-tertiary);
  }
  
  .file-item svg {
    flex-shrink: 0;
    color: var(--text-muted);
  }
  
  .canvas-item .canvas-info {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  
  .canvas-item .file-date {
    font-size: 11px;
    color: var(--text-muted);
  }
  
  /* Model items */
  .model-item {
    padding: 12px;
    align-items: flex-start;
  }
  
  .model-icon {
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--accent-glow);
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }
  
  .model-icon svg {
    color: var(--accent-primary);
  }
  
  .model-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
    flex: 1;
  }
  
  .model-info .file-name {
    font-size: 12px;
    font-weight: 500;
    line-height: 1.3;
    word-break: break-word;
    white-space: normal;
  }
  
  .model-meta {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .model-type {
    font-size: 10px;
    font-weight: 600;
    color: var(--accent-primary);
    background: var(--accent-glow);
    padding: 2px 6px;
    border-radius: var(--radius-sm);
    letter-spacing: 0.02em;
  }
  
  .model-item[draggable="true"] {
    cursor: grab;
  }
  
  .model-item[draggable="true"]:active {
    cursor: grabbing;
    opacity: 0.7;
  }
  
  .file-name {
    font-size: 13px;
    color: var(--text-primary);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  /* File grid for images */
  .file-grid {
    display: grid;
    grid-template-columns: repeat(3, 165px);
    gap: 9px;
  }
  
  .file-card {
    display: flex;
    flex-direction: column;
    background: var(--bg-secondary);
    border-radius: var(--radius-md);
    overflow: hidden;
    /* Reset button styles */
    font: inherit;
    padding: 0;
    text-align: left;
    cursor: pointer;
    transition: all 0.15s ease;
    border: 1px solid transparent;
  }
  
  .file-card:hover {
    background: var(--bg-tertiary);
    border-color: var(--border-subtle);
    transform: translateY(-1px);
  }
  
  .file-card[draggable="true"] {
    cursor: grab;
  }
  
  .file-card[draggable="true"]:active {
    cursor: grabbing;
    opacity: 0.7;
  }
  
  .file-thumbnail {
    width: 165px;
    height: 165px;
    overflow: hidden;
    background: var(--bg-tertiary);
  }
  
  .file-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  
  .file-info {
    padding: 8px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .file-info .file-name {
    font-size: 11px;
    line-height: 1.3;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }
  
  .file-size {
    font-size: 10px;
    color: var(--text-muted);
  }
  
  /* Loading state */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    color: var(--text-muted);
    gap: 12px;
  }
  
  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid var(--border-subtle);
    border-top-color: var(--accent-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
</style>
