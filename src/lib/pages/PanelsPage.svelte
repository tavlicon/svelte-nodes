<script lang="ts">
  import { onMount } from 'svelte';
  import Panel from '../ui/Panel.svelte';
  import NodePanel from '../ui/NodePanel.svelte';
  import { graphStore } from '../graph/store.svelte';
  import { listFiles, formatFileSize, type FileInfo } from '../services/file-service';
  
  // Assets panel state
  let assetsTab = $state<'generated' | 'imported'>('generated');
  let generatedFiles = $state<FileInfo[]>([]);
  let importedFiles = $state<FileInfo[]>([]);
  let modelFiles = $state<FileInfo[]>([]);
  let isLoadingAssets = $state(false);
  let isLoadingModels = $state(false);
  
  // Demo model node ID
  let demoModelNodeId = $state<string | null>(null);
  
  async function refreshAssets() {
    isLoadingAssets = true;
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
      isLoadingAssets = false;
    }
  }
  
  async function refreshModels() {
    isLoadingModels = true;
    try {
      modelFiles = await listFiles('models');
    } catch (error) {
      console.error('Error refreshing models:', error);
    } finally {
      isLoadingModels = false;
    }
  }
  
  function ensureDemoModelNode() {
    let existingModelNode: string | null = null;
    graphStore.nodes.forEach((node, id) => {
      if (node.type === 'model' && !existingModelNode) {
        existingModelNode = id;
      }
    });
    
    if (existingModelNode) {
      demoModelNodeId = existingModelNode;
      graphStore.selectNode(existingModelNode);
    } else {
      const nodeId = graphStore.addNode('model', 0, 0);
      demoModelNodeId = nodeId;
      graphStore.selectNode(nodeId);
    }
  }
  
  onMount(() => {
    refreshAssets();
    refreshModels();
    ensureDemoModelNode();
  });
</script>

<div class="panels-page">
  <div class="page-header">
    <h1>Panels Library</h1>
    <p class="subtitle">Reusable panel patterns for the Generative Design Studio</p>
  </div>
  
  <div class="components-grid">
    <!-- Assets Panel -->
    <section class="component-section">
      <div class="section-header">
        <h2>Assets Panel</h2>
        <p class="section-desc">src/lib/ui/Sidebar.svelte → Assets</p>
      </div>
      
      <div class="panel-wrapper">
        <Panel visible={true} width={429} position="left">
          {#snippet customHeader()}
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
              <div class="header-actions">
                <button class="icon-btn" onclick={refreshAssets} title="Refresh">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          {/snippet}
          
          <div class="panel-content">
            {#if isLoadingAssets}
              <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading...</p>
              </div>
            {:else if assetsTab === 'generated'}
              {#if generatedFiles.length === 0}
                <div class="empty-state">
                  <h3>No generated images</h3>
                  <p>Run the graph to generate images</p>
                </div>
              {:else}
                <div class="file-grid">
                  {#each generatedFiles as file (file.name)}
                    <button class="file-card" title={`${file.name} (${formatFileSize(file.size)})`}>
                      <div class="file-thumbnail">
                        <img src={file.path} alt={file.name} loading="lazy" />
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            {:else}
              {#if importedFiles.length === 0}
                <div class="empty-state">
                  <h3>No imported assets</h3>
                  <p>Drop images onto the canvas to import</p>
                </div>
              {:else}
                <div class="file-grid">
                  {#each importedFiles as file (file.name)}
                    <button class="file-card" title={`${file.name} (${formatFileSize(file.size)})`}>
                      <div class="file-thumbnail">
                        <img src={file.path} alt={file.name} loading="lazy" />
                      </div>
                    </button>
                  {/each}
                </div>
              {/if}
            {/if}
          </div>
        </Panel>
      </div>
    </section>
    
    <!-- Models Panel -->
    <section class="component-section">
      <div class="section-header">
        <h2>Models Panel</h2>
        <p class="section-desc">src/lib/ui/Sidebar.svelte → Models</p>
      </div>
      
      <div class="panel-wrapper">
        <Panel visible={true} width={429} position="left">
          {#snippet customHeader()}
            <div class="panel-header">
              <div class="panel-tabs">
                <button class="panel-tab active">Models</button>
              </div>
              <div class="header-actions">
                <button class="icon-btn" onclick={refreshModels} title="Refresh">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          {/snippet}
          
          <div class="panel-content">
            {#if isLoadingModels}
              <div class="loading-state">
                <div class="spinner"></div>
                <p>Loading...</p>
              </div>
            {:else if modelFiles.length === 0}
              <div class="empty-state">
                <h3>No models available</h3>
                <p>Add models to data/models directory</p>
              </div>
            {:else}
              <div class="file-list">
                {#each modelFiles as file (file.name)}
                  <button class="file-item model-item" title={file.name}>
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
        </Panel>
      </div>
    </section>
    
    <!-- Node Panel -->
    <section class="component-section">
      <div class="section-header">
        <h2>Node Panel</h2>
        <p class="section-desc">src/lib/ui/NodePanel.svelte</p>
      </div>
      
      <div class="panel-wrapper nodepanel">
        <NodePanel />
      </div>
    </section>
  </div>
</div>

<style>
  .panels-page {
    flex: 1;
    padding: 32px 48px;
    overflow-y: auto;
    background: var(--bg-primary);
  }
  
  .page-header {
    margin-bottom: 32px;
  }
  
  .page-header h1 {
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 32px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0 0 8px 0;
  }
  
  .subtitle {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 14px;
    color: var(--text-muted);
    margin: 0;
  }
  
  .components-grid {
    display: flex;
    gap: 32px;
    align-items: flex-start;
  }
  
  .component-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .section-header {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .section-header h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  
  .section-desc {
    font-size: 11px;
    font-family: 'JetBrains Mono', monospace;
    color: var(--text-muted);
    margin: 0;
  }
  
  /* Panel wrapper with fixed height and width */
  .panel-wrapper {
    position: relative;
    width: 429px;
    height: 700px;
    background: var(--bg-secondary);
    border-radius: var(--radius-lg);
    flex-shrink: 0;
  }
  
  .panel-wrapper.nodepanel {
    width: 300px;
    background: transparent;
  }
  
  /* Make Panel fill the wrapper */
  .panel-wrapper :global(.panel) {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    border-radius: var(--radius-lg);
  }
  
  /* NodePanel container - remove extra positioning */
  .panel-wrapper.nodepanel :global(.node-panel-container) {
    position: static;
    width: 100%;
    height: 100%;
  }
  
  .panel-wrapper.nodepanel :global(.panel) {
    position: relative;
    width: 100%;
  }
  
  /* Panel header styles - matching Sidebar.svelte */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 12px 16px;
    background: transparent;
    flex-shrink: 0;
  }
  
  .panel-tabs {
    display: flex;
    gap: 16px;
  }
  
  .panel-tab {
    padding: 0;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 15px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s ease;
  }
  
  .panel-tab:hover {
    color: rgba(255, 255, 255, 0.6);
  }
  
  .panel-tab.active {
    color: #ffffff;
  }
  
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  
  .icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: none;
    border: none;
    color: rgba(255, 255, 255, 0.4);
    cursor: pointer;
    border-radius: 6px;
    transition: all 0.15s ease;
  }
  
  .icon-btn:hover {
    color: rgba(255, 255, 255, 0.8);
    background: rgba(255, 255, 255, 0.06);
  }
  
  .icon-btn svg {
    width: 16px;
    height: 16px;
  }
  
  /* Panel content with scrollbar - matching Sidebar.svelte */
  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 0 8px 24px 8px;
    
    /* Custom scrollbar */
    scrollbar-width: thin;
    scrollbar-color: rgba(255, 255, 255, 0.2) transparent;
  }
  
  .panel-content::-webkit-scrollbar {
    width: 6px;
  }
  
  .panel-content::-webkit-scrollbar-track {
    background: transparent;
    margin: 4px 0;
  }
  
  .panel-content::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
  }
  
  .panel-content::-webkit-scrollbar-thumb:hover {
    background: rgba(255, 255, 255, 0.25);
  }
  
  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 48px 16px;
    color: rgba(255, 255, 255, 0.4);
  }
  
  .empty-state h3 {
    font-size: 14px;
    font-weight: 500;
    margin: 0 0 4px 0;
    color: rgba(255, 255, 255, 0.5);
  }
  
  .empty-state p {
    font-size: 12px;
    margin: 0;
  }
  
  /* Loading state */
  .loading-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 16px;
    color: rgba(255, 255, 255, 0.4);
  }
  
  .spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(255, 255, 255, 0.1);
    border-top-color: rgba(255, 255, 255, 0.4);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-bottom: 8px;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* File grid for images */
  .file-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
  }
  
  .file-card {
    aspect-ratio: 1;
    border-radius: 8px;
    overflow: hidden;
    cursor: pointer;
    border: none;
    padding: 0;
    background: rgba(255, 255, 255, 0.03);
    transition: all 0.15s ease;
  }
  
  .file-card:hover {
    background: rgba(255, 255, 255, 0.08);
    transform: scale(1.02);
  }
  
  .file-thumbnail {
    width: 100%;
    height: 100%;
  }
  
  .file-thumbnail img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
  
  /* File list for models */
  .file-list {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .file-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px;
    border-radius: 8px;
    cursor: pointer;
    border: none;
    background: rgba(255, 255, 255, 0.03);
    transition: all 0.15s ease;
    text-align: left;
    width: 100%;
  }
  
  .file-item:hover {
    background: rgba(255, 255, 255, 0.08);
  }
  
  .model-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 40px;
    height: 40px;
    background: rgba(124, 77, 255, 0.15);
    border-radius: 8px;
    color: rgba(124, 77, 255, 0.8);
    flex-shrink: 0;
  }
  
  .model-info {
    flex: 1;
    min-width: 0;
  }
  
  .file-name {
    display: block;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  
  .model-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: 2px;
  }
  
  .model-type {
    font-size: 10px;
    font-weight: 600;
    color: rgba(124, 77, 255, 0.9);
    background: rgba(124, 77, 255, 0.15);
    padding: 2px 6px;
    border-radius: 4px;
  }
  
  .file-size {
    font-size: 11px;
    color: var(--text-muted);
  }
</style>
