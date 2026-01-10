<script lang="ts">
  import { graphStore } from '../graph/store.svelte';
  import { nodeRegistry, type ExtendedNodeDefinition } from '../graph/nodes/registry';
  import ParameterEditor from './ParameterEditor.svelte';
  
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
</script>

<aside class="node-panel">
  {#if selectedNode && nodeDef}
    <header class="panel-header">
      <span class="node-type">{nodeDef.category}</span>
      <h2 class="node-name">{nodeDef.name}</h2>
    </header>
    
    <div class="panel-content">
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
        {#if selectedNode.error}
          <div class="error-message">
            {selectedNode.error}
          </div>
        {/if}
      </section>
      
      {#if selectedNode.thumbnailUrl}
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
          {#if selectedNode.params.timeTaken}
            <div class="output-meta">
              <span class="meta-label">Generation time:</span>
              <span class="meta-value">{(selectedNode.params.timeTaken / 1000).toFixed(2)}s</span>
            </div>
          {/if}
        </section>
      {/if}
    </div>
  {:else}
    <div class="empty-state">
      <div class="empty-icon">◇</div>
      <p class="empty-text">Select a node to view its properties</p>
    </div>
  {/if}
</aside>

<style>
  .node-panel {
    width: 300px;
    min-width: 300px;
    background: var(--bg-secondary);
    border-left: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .empty-state {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 32px;
    color: var(--text-muted);
  }
  
  .empty-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.3;
  }
  
  .empty-text {
    font-size: 13px;
    text-align: center;
  }
  
  .panel-header {
    padding: 16px;
    border-bottom: 1px solid var(--border-subtle);
  }
  
  .node-type {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent-primary);
  }
  
  .node-name {
    font-size: 16px;
    font-weight: 600;
    margin-top: 4px;
  }
  
  .panel-content {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
  }
  
  .prompts-section,
  .params-section,
  .status-section,
  .preview-section {
    margin-bottom: 24px;
  }
  
  .prompts-section {
    padding-bottom: 20px;
    border-bottom: 1px solid var(--border-subtle);
  }
  
  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
    margin-bottom: 12px;
  }
  
  .status-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
  }
  
  .status-label {
    font-size: 13px;
    color: var(--text-secondary);
  }
  
  .status-value {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 2px 8px;
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
  
  .error-message {
    margin-top: 8px;
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: var(--radius-md);
    color: var(--error);
    font-size: 12px;
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
  
  .output-section {
    margin-bottom: 24px;
  }
  
  .output-path {
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
    padding: 12px;
    margin-bottom: 12px;
  }
  
  .path-text {
    font-family: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    font-size: 11px;
    color: var(--success);
    word-break: break-all;
    line-height: 1.5;
  }
  
  .output-meta {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    background: var(--bg-tertiary);
    border-radius: var(--radius-md);
  }
  
  .meta-label {
    font-size: 12px;
    color: var(--text-secondary);
  }
  
  .meta-value {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-primary);
  }
</style>
