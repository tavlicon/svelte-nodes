<script lang="ts">
  import Panel from '../ui/Panel.svelte';
  
  // Assets panel state - local UI only
  let assetsTab = $state<'generated' | 'imported'>('generated');
  
  // Mock data for generated files
  const mockGeneratedFiles = [
    { name: 'img2img_001.png', size: '102.4 KB', path: '/data/output/img2img_001.png' },
    { name: 'img2img_002.png', size: '98.7 KB', path: '/data/output/img2img_002.png' },
    { name: 'img2img_003.png', size: '105.2 KB', path: '/data/output/img2img_003.png' },
    { name: 'img2img_004.png', size: '112.1 KB', path: '/data/output/img2img_004.png' },
    { name: 'img2img_005.png', size: '94.3 KB', path: '/data/output/img2img_005.png' },
    { name: 'img2img_006.png', size: '108.9 KB', path: '/data/output/img2img_006.png' },
  ];
  
  // Mock data for imported files
  const mockImportedFiles = [
    { name: 'reference_shoe.png', size: '45.2 KB', path: '/data/input/reference_shoe.png' },
    { name: 'texture_leather.jpg', size: '128.5 KB', path: '/data/input/texture_leather.jpg' },
    { name: 'colorway_sample.png', size: '32.1 KB', path: '/data/input/colorway_sample.png' },
  ];
  
  // Mock data for model files
  const mockModelFiles = [
    { name: 'v1-5-pruned-emaonly-fp16.safetensors', type: 'safetensors', size: '2.13 GB' },
    { name: 'sd-v1-5-inpainting.ckpt', type: 'ckpt', size: '4.27 GB' },
    { name: 'vae-ft-mse-840000.safetensors', type: 'safetensors', size: '334.6 MB' },
  ];
  
  // Mock node panel data
  const mockNodeData = {
    type: 'MODEL',
    name: 'SD 1.5 img2img',
    params: {
      positive_prompt: 'a beautiful, photograph',
      negative_prompt: 'blurry, low quality',
      seed: 42,
      steps: 20,
      cfg: 7.5,
      denoise: 0.75,
      sampler: 'euler_a',
      scheduler: 'normal',
    }
  };
  
  // Demo refresh action (no-op, just for visual demo)
  function handleRefresh() {
    // No-op - purely visual demo
  }
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
                <button class="icon-btn" onclick={handleRefresh} title="Refresh">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          {/snippet}
          
          <div class="panel-content">
            {#if assetsTab === 'generated'}
              <div class="file-grid">
                {#each mockGeneratedFiles as file (file.name)}
                  <button class="file-card" title={`${file.name} (${file.size})`}>
                    <div class="file-thumbnail placeholder">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    </div>
                  </button>
                {/each}
              </div>
            {:else}
              <div class="file-grid">
                {#each mockImportedFiles as file (file.name)}
                  <button class="file-card" title={`${file.name} (${file.size})`}>
                    <div class="file-thumbnail placeholder">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <rect x="3" y="3" width="18" height="18" rx="2" />
                        <circle cx="8.5" cy="8.5" r="1.5" />
                        <path d="M21 15l-5-5L5 21" />
                      </svg>
                    </div>
                  </button>
                {/each}
              </div>
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
                <button class="icon-btn" onclick={handleRefresh} title="Refresh">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 12a9 9 0 11-2.2-5.9M21 3v6h-6" stroke-linecap="round" stroke-linejoin="round" />
                  </svg>
                </button>
              </div>
            </div>
          {/snippet}
          
          <div class="panel-content">
            <div class="file-list">
              {#each mockModelFiles as file (file.name)}
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
                      <span class="file-size">{file.size}</span>
                    </div>
                  </div>
                </button>
              {/each}
            </div>
          </div>
        </Panel>
      </div>
    </section>
    
    <!-- Node Panel (Static Mock) -->
    <section class="component-section">
      <div class="section-header">
        <h2>Node Panel</h2>
        <p class="section-desc">src/lib/ui/NodePanel.svelte</p>
      </div>
      
      <div class="panel-wrapper nodepanel">
        <Panel visible={true} width={300} position="right">
          {#snippet header()}
            <span class="node-type">{mockNodeData.type}</span>
            <h2 class="node-name">{mockNodeData.name}</h2>
          {/snippet}
          
          <div class="panel-inner">
            <!-- Conditioning Section -->
            <section class="params-section">
              <h3 class="section-title">Conditioning</h3>
              <div class="param-group">
                <div class="param-field">
                  <label class="param-label" for="demo-positive-prompt">Positive Prompt</label>
                  <textarea id="demo-positive-prompt" class="param-textarea" readonly>{mockNodeData.params.positive_prompt}</textarea>
                </div>
                <div class="param-field">
                  <label class="param-label" for="demo-negative-prompt">Negative Prompt</label>
                  <textarea id="demo-negative-prompt" class="param-textarea" readonly>{mockNodeData.params.negative_prompt}</textarea>
                </div>
              </div>
            </section>
            
            <!-- Sampler Parameters Section -->
            <section class="params-section">
              <h3 class="section-title">Sampler Parameters</h3>
              <div class="param-group">
                <div class="param-field">
                  <label class="param-label" for="demo-seed">Seed</label>
                  <input id="demo-seed" type="number" class="param-input" value={mockNodeData.params.seed} readonly />
                </div>
                <div class="param-field">
                  <label class="param-label" for="demo-steps">Steps</label>
                  <div class="slider-row">
                    <input id="demo-steps" type="range" class="param-slider" min="1" max="50" value={mockNodeData.params.steps} disabled />
                    <span class="slider-value">{mockNodeData.params.steps}</span>
                  </div>
                </div>
                <div class="param-field">
                  <label class="param-label" for="demo-cfg">CFG Scale</label>
                  <div class="slider-row">
                    <input id="demo-cfg" type="range" class="param-slider" min="1" max="20" step="0.5" value={mockNodeData.params.cfg} disabled />
                    <span class="slider-value">{mockNodeData.params.cfg}</span>
                  </div>
                </div>
                <div class="param-field">
                  <label class="param-label" for="demo-sampler">Sampler</label>
                  <select id="demo-sampler" class="param-select" disabled>
                    <option value="euler_a" selected>Euler Ancestral</option>
                  </select>
                </div>
                <div class="param-field">
                  <label class="param-label" for="demo-scheduler">Scheduler</label>
                  <select id="demo-scheduler" class="param-select" disabled>
                    <option value="normal" selected>Normal</option>
                  </select>
                </div>
                <div class="param-field">
                  <label class="param-label" for="demo-denoise">Denoise</label>
                  <div class="slider-row">
                    <input id="demo-denoise" type="range" class="param-slider" min="0" max="1" step="0.01" value={mockNodeData.params.denoise} disabled />
                    <span class="slider-value">{mockNodeData.params.denoise}</span>
                  </div>
                </div>
              </div>
            </section>
            
            <!-- Status Section -->
            <section class="params-section">
              <h3 class="section-title">Status</h3>
              <div class="status-row">
                <span class="status-label">State</span>
                <span class="status-badge complete">COMPLETE</span>
              </div>
            </section>
          </div>
        </Panel>
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
  
  .file-thumbnail.placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255, 255, 255, 0.2);
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
  
  /* Node Panel Styles */
  .node-type {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent-primary);
    display: block;
    margin-bottom: 2px;
  }
  
  .node-name {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  
  .panel-inner {
    padding: 0 16px 16px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  
  .params-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .section-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin: 0;
  }
  
  .param-group {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .param-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .param-label {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: capitalize;
  }
  
  .param-input,
  .param-textarea,
  .param-select {
    width: 100%;
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 12px;
  }
  
  .param-textarea {
    min-height: 50px;
    resize: vertical;
    font-family: var(--font-mono);
  }
  
  .param-select {
    cursor: pointer;
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;
  }
  
  .slider-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .param-slider {
    flex: 1;
    height: 4px;
    appearance: none;
    background: var(--bg-tertiary);
    border-radius: 2px;
  }
  
  .param-slider::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    background: var(--accent-primary);
    border-radius: 50%;
  }
  
  .slider-value {
    min-width: 40px;
    padding: 3px 6px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-sm);
    font-size: 11px;
    font-family: var(--font-mono);
    text-align: center;
    color: var(--text-primary);
  }
  
  .status-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .status-label {
    font-size: 12px;
    color: var(--text-secondary);
  }
  
  .status-badge {
    font-size: 10px;
    font-weight: 600;
    padding: 4px 8px;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  
  .status-badge.complete {
    background: rgba(16, 185, 129, 0.15);
    color: #10b981;
  }
</style>
