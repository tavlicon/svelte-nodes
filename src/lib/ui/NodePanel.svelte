<script lang="ts">
  import { graphStore } from '../graph/store.svelte';
  import { nodeRegistry, type ExtendedNodeDefinition } from '../graph/nodes/registry';
  import ParameterEditor from './ParameterEditor.svelte';
  import Panel from './Panel.svelte';
  import MeshViewer from './MeshViewer.svelte';
  
  // Get first selected node
  let selectedNode = $derived.by(() => {
    const ids = Array.from(graphStore.selectedNodeIds);
    if (ids.length !== 1) return null;
    return graphStore.getNodeById(ids[0]) ?? null;
  });
  
  let nodeDef = $derived.by(() => {
    if (!selectedNode) return null;
    return nodeRegistry[selectedNode.type] ?? null;
  });
  
  // Check if node has prompts group
  let hasPrompts = $derived.by(() => {
    if (!nodeDef?.parameterMeta) return false;
    return Object.values(nodeDef.parameterMeta).some(meta => meta.group === 'prompts');
  });
  
  // Check if node has sampler params
  let hasSamplerParams = $derived.by(() => {
    if (!nodeDef?.parameterMeta) return false;
    return Object.values(nodeDef.parameterMeta).some(meta => meta.group === 'sampler');
  });
  
  // Track if panel should be visible (node is selected)
  let isVisible = $derived(selectedNode !== null && nodeDef !== null);
  
  function handleClose() {
    graphStore.deselectAll();
  }
</script>

<aside class="node-panel-container">
  <Panel 
    visible={isVisible} 
    width={300} 
    position="right"
    onclose={handleClose}
  >
    {#snippet header()}
  {#if selectedNode && nodeDef}
      <span class="node-type">{nodeDef.category}</span>
      <h2 class="node-name">{nodeDef.name}</h2>
      {/if}
    {/snippet}
    
    {#if selectedNode && nodeDef}
      <div class="panel-inner">
      {#if hasPrompts}
        <section class="prompts-section">
          <h3 class="section-title">Conditioning</h3>
          <ParameterEditor 
            node={selectedNode} 
            definition={nodeDef}
            filterGroup="prompts"
          />
        </section>
      {/if}
      
      {#if hasSamplerParams}
        <section class="params-section">
          <h3 class="section-title">Sampler Parameters</h3>
          <ParameterEditor 
            node={selectedNode} 
            definition={nodeDef}
            filterGroup="sampler"
          />
        </section>
      {/if}
      
      {#if !hasPrompts && !hasSamplerParams}
        <section class="params-section">
          <h3 class="section-title">Parameters</h3>
          <ParameterEditor 
            node={selectedNode} 
            definition={nodeDef}
          />
        </section>
      {/if}
      
      <section class="status-section">
        <h3 class="section-title">Status</h3>
        <div class="status-row">
          <span class="status-label">State</span>
          <span class="status-value status-{selectedNode.status}">
            {selectedNode.status}
          </span>
        </div>
        {#if selectedNode.type === 'output' && selectedNode.params.timeTaken}
          <div class="status-row" style="margin-top: 6px;">
            <span class="status-label">Generation Time</span>
            <span class="status-value time-value">
              {(selectedNode.params.timeTaken as number / 1000).toFixed(2)}s
            </span>
          </div>
        {/if}
        {#if selectedNode.error}
          <div class="error-message">
            {selectedNode.error}
          </div>
        {/if}
      </section>
      
      {#if selectedNode.type === 'mesh-output' || selectedNode.type === 'triposr'}
        <section class="preview-section">
          <h3 class="section-title">3D Preview</h3>
          <div class="preview-mesh">
            <MeshViewer 
              meshUrl={selectedNode.params.meshUrl as string || ''} 
              width={272}
              height={200}
              autoRotate={true}
            />
          </div>
          {#if selectedNode.params.meshUrl}
            <a 
              class="download-btn"
              href={selectedNode.params.meshUrl as string}
              download
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
              Download GLB
            </a>
          {/if}
        </section>
      {:else if selectedNode.thumbnailUrl}
        <section class="preview-section">
          <h3 class="section-title">Preview</h3>
          <div class="preview-image">
            <img src={selectedNode.thumbnailUrl} alt="Preview" />
          </div>
        </section>
      {/if}
      
      {#if selectedNode.type === 'output' && selectedNode.params.outputPath}
        <section class="output-section">
          <h3 class="section-title">Output Location</h3>
          <div class="output-path">
            <code class="path-text">{selectedNode.params.outputPath}</code>
          </div>
        </section>
      {/if}
        
      {#if selectedNode.type === 'mesh-output' && selectedNode.params.outputPath}
        <section class="output-section">
          <h3 class="section-title">Mesh Info</h3>
          <div class="mesh-stats">
            <div class="stat-row">
              <span class="stat-label">Vertices</span>
              <span class="stat-value">{selectedNode.params.vertices?.toLocaleString() || 0}</span>
            </div>
            <div class="stat-row">
              <span class="stat-label">Faces</span>
              <span class="stat-value">{selectedNode.params.faces?.toLocaleString() || 0}</span>
            </div>
            {#if selectedNode.params.timeTaken}
              <div class="stat-row">
                <span class="stat-label">Generation Time</span>
                <span class="stat-value">{(selectedNode.params.timeTaken as number / 1000).toFixed(2)}s</span>
              </div>
            {/if}
          </div>
          <div class="output-path">
            <code class="path-text">{selectedNode.params.outputPath}</code>
          </div>
        </section>
      {/if}
        
        {#if selectedNode.type === 'output' && selectedNode.params.generationParams}
          {@const params = selectedNode.params.generationParams as Record<string, unknown>}
          <section class="output-section">
            <h3 class="section-title">Generation Settings</h3>
            <div class="generation-params">
              <div class="params-grid">
                {#if params.prompt}
                  <div class="param-item full-width">
                    <span class="param-key">Prompt</span>
                  </div>
                  <div class="param-item full-width" style="margin-bottom: 4px;">
                    <span class="param-val prompt" title={params.prompt as string}>{params.prompt}</span>
                  </div>
                {/if}
                {#if params.negativePrompt}
                  <div class="param-item full-width">
                    <span class="param-key">Negative</span>
                  </div>
                  <div class="param-item full-width" style="margin-bottom: 4px;">
                    <span class="param-val prompt" title={params.negativePrompt as string}>{params.negativePrompt}</span>
                  </div>
                {/if}
                <div class="param-item">
                  <span class="param-key">Steps</span>
                  <span class="param-val">{params.steps}</span>
                </div>
                <div class="param-item">
                  <span class="param-key">CFG</span>
                  <span class="param-val">{params.cfg}</span>
                </div>
                <div class="param-item">
                  <span class="param-key">Denoise</span>
                  <span class="param-val">{params.denoise}</span>
                </div>
                <div class="param-item">
                  <span class="param-key">Seed</span>
                  <span class="param-val">{params.seed}</span>
                </div>
                <div class="param-item">
                  <span class="param-key">Sampler</span>
                  <span class="param-val">{params.sampler}</span>
                </div>
                <div class="param-item">
                  <span class="param-key">Scheduler</span>
                  <span class="param-val">{params.scheduler}</span>
          </div>
          {#if selectedNode.params.timeTaken}
                  <div class="param-item full-width" style="margin-top: 4px; border-top: 1px solid var(--border-subtle); padding-top: 4px;">
                    <span class="param-key">Time</span>
                    <span class="param-val">{(selectedNode.params.timeTaken as number / 1000).toFixed(2)}s</span>
                  </div>
                {/if}
              </div>
            </div>
        </section>
      {/if}
    </div>
  {/if}
  </Panel>
</aside>

<style>
  .node-panel-container {
    position: absolute;
    right: 12px;
    top: 12px;
    bottom: 36px;
    z-index: 50;
    pointer-events: none;
  }
  
  .node-type {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent-primary);
    display: block;
  }
  
  .node-name {
    font-size: 15px;
    font-weight: 600;
    margin-top: 2px;
    color: var(--text-primary);
  }
  
  .panel-inner {
    padding: 12px 14px 24px;
  }
  
  .prompts-section,
  .params-section,
  .status-section,
  .preview-section,
  .output-section {
    margin-bottom: 16px;
  }
  
  .prompts-section {
    padding-bottom: 14px;
    border-bottom: 1px solid var(--border-subtle);
  }
  
  .section-title {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 8px;
  }
  
  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 6px 10px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
  }
  
  .status-label {
    font-size: 12px;
    color: var(--text-secondary);
  }
  
  .status-value {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 2px 6px;
    border-radius: var(--radius-sm);
  }
  
  .status-idle {
    color: var(--text-muted);
    background: var(--bg-elevated);
  }
  
  .status-pending {
    color: var(--warning);
    background: rgba(245, 158, 11, 0.15);
  }
  
  .status-running {
    color: var(--accent-primary);
    background: var(--accent-glow);
  }
  
  .status-complete {
    color: var(--success);
    background: rgba(16, 185, 129, 0.15);
  }
  
  .status-error {
    color: var(--error);
    background: rgba(239, 68, 68, 0.15);
  }
  
  .time-value {
    color: var(--accent-primary);
    background: var(--accent-glow);
    font-family: var(--font-mono);
  }
  
  .error-message {
    margin-top: 6px;
    padding: 6px 10px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: var(--radius-md);
    color: var(--error);
    font-size: 11px;
  }
  
  .preview-image {
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    overflow: hidden;
    aspect-ratio: 1;
  }
  
  .preview-image img {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  
  .preview-mesh {
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    overflow: hidden;
  }
  
  .download-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-top: 8px;
    padding: 8px 12px;
    background: var(--accent-glow);
    border: 1px solid var(--accent-primary);
    border-radius: var(--radius-md);
    color: var(--accent-primary);
    font-size: 11px;
    font-weight: 500;
    text-decoration: none;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .download-btn:hover {
    background: var(--accent-primary);
    color: white;
  }
  
  .mesh-stats {
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    padding: 8px 10px;
    margin-bottom: 8px;
  }
  
  .stat-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 4px 0;
  }
  
  .stat-row:not(:last-child) {
    border-bottom: 1px solid var(--border-subtle);
  }
  
  .stat-label {
    font-size: 11px;
    color: var(--text-secondary);
  }
  
  .stat-value {
    font-size: 11px;
    font-weight: 600;
    font-family: var(--font-mono);
    color: var(--text-primary);
  }
  
  .output-path {
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    padding: 8px 10px;
    margin-bottom: 8px;
  }
  
  .path-text {
    font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    font-size: 10px;
    color: var(--success);
    word-break: break-all;
    line-height: 1.4;
  }
  
  .output-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 5px 10px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    margin-bottom: 4px;
  }
  
  .meta-label {
    font-size: 11px;
    color: var(--text-secondary);
  }
  
  .meta-value {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-primary);
  }
  
  .generation-params {
    margin-top: 8px;
    padding: 8px 10px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
  }
  
  .params-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 12px;
  }
  
  .param-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 10px;
    padding: 2px 0;
  }
  
  .param-item.full-width {
    grid-column: 1 / -1;
  }
  
  .param-key {
    color: var(--text-muted);
  }
  
  .param-val {
    color: var(--text-primary);
    font-family: var(--font-mono);
    text-align: right;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .param-val.prompt {
    max-width: 100%;
    font-size: 10px;
    font-style: italic;
    color: var(--text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
