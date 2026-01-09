<script lang="ts">
  import { graphStore } from '../graph/store.svelte';
  import type { NodeInstance, NodeDefinition } from '../graph/types';
  
  interface Props {
    node: NodeInstance;
    definition: NodeDefinition;
  }
  
  let { node, definition }: Props = $props();
  
  function handleParamChange(key: string, value: unknown) {
    graphStore.updateNode(node.id, {
      params: { ...node.params, [key]: value },
    });
  }
</script>

<div class="parameter-editor">
  {#each Object.entries(definition.defaultParams) as [key, defaultValue]}
    <div class="param-row">
      <label class="param-label" for={`param-${key}`}>
        {key.replace(/_/g, ' ')}
      </label>
      
      {#if typeof defaultValue === 'string'}
        {#if key === 'text' || key === 'prompt'}
          <textarea
            id={`param-${key}`}
            class="param-textarea"
            value={node.params[key] as string ?? defaultValue}
            oninput={(e) => handleParamChange(key, e.currentTarget.value)}
            placeholder={`Enter ${key}...`}
          ></textarea>
        {:else}
          <input
            id={`param-${key}`}
            type="text"
            class="param-input"
            value={node.params[key] as string ?? defaultValue}
            oninput={(e) => handleParamChange(key, e.currentTarget.value)}
          />
        {/if}
      {:else if typeof defaultValue === 'number'}
        <input
          id={`param-${key}`}
          type="number"
          class="param-input"
          value={node.params[key] as number ?? defaultValue}
          oninput={(e) => handleParamChange(key, parseFloat(e.currentTarget.value) || 0)}
        />
      {:else if typeof defaultValue === 'boolean'}
        <label class="param-toggle">
          <input
            type="checkbox"
            checked={node.params[key] as boolean ?? defaultValue}
            onchange={(e) => handleParamChange(key, e.currentTarget.checked)}
          />
          <span class="toggle-slider"></span>
        </label>
      {/if}
    </div>
  {/each}
</div>

<style>
  .parameter-editor {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .param-row {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  
  .param-label {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-secondary);
    text-transform: capitalize;
  }
  
  .param-input,
  .param-textarea {
    width: 100%;
    padding: 10px 12px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-size: 13px;
    transition: border-color 0.15s ease;
  }
  
  .param-input:focus,
  .param-textarea:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
  
  .param-textarea {
    min-height: 80px;
    resize: vertical;
    font-family: var(--font-mono);
  }
  
  .param-toggle {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
    cursor: pointer;
  }
  
  .param-toggle input {
    opacity: 0;
    width: 0;
    height: 0;
  }
  
  .toggle-slider {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: 12px;
    transition: all 0.2s ease;
  }
  
  .toggle-slider::before {
    content: '';
    position: absolute;
    width: 18px;
    height: 18px;
    left: 2px;
    bottom: 2px;
    background: var(--text-secondary);
    border-radius: 50%;
    transition: all 0.2s ease;
  }
  
  .param-toggle input:checked + .toggle-slider {
    background: var(--accent-primary);
    border-color: var(--accent-primary);
  }
  
  .param-toggle input:checked + .toggle-slider::before {
    transform: translateX(20px);
    background: white;
  }
</style>
