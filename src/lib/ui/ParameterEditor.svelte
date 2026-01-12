<script lang="ts">
  import { graphStore } from '../graph/store.svelte';
  import type { NodeInstance, NodeDefinition } from '../graph/types';
  import type { ParameterMeta, ExtendedNodeDefinition } from '../graph/nodes/registry';
  
  interface Props {
    node: NodeInstance;
    definition: ExtendedNodeDefinition;
    filterGroup?: string;
    excludeGroups?: string[];
  }
  
  let { node, definition, filterGroup, excludeGroups = [] }: Props = $props();
  
  function handleParamChange(key: string, value: unknown) {
    graphStore.updateNode(node.id, {
      params: { ...node.params, [key]: value },
    });
  }
  
  function getMeta(key: string): ParameterMeta | undefined {
    return definition.parameterMeta?.[key];
  }
  
  function shouldShowParam(key: string): boolean {
    const meta = getMeta(key);
    const group = meta?.group || 'default';
    
    // Hide model info params
    if (group === 'model') return false;
    
    // Filter by group if specified
    if (filterGroup && group !== filterGroup) return false;
    
    // Exclude specified groups
    if (excludeGroups.includes(group)) return false;
    
    return true;
  }
  
  function getLabel(key: string, meta?: ParameterMeta): string {
    return meta?.label || key.replace(/_/g, ' ');
  }
</script>

<div class="parameter-editor">
  {#each Object.entries(definition.defaultParams) as [key, defaultValue]}
    {#if shouldShowParam(key)}
      {@const meta = getMeta(key)}
      <div class="param-row" class:full-width={meta?.type === 'textarea'}>
        <label class="param-label" for={`param-${key}`}>
          {getLabel(key, meta)}
        </label>
        
        {#if meta?.type === 'textarea'}
          <textarea
            id={`param-${key}`}
            class="param-textarea"
            value={node.params[key] as string ?? defaultValue}
            oninput={(e) => handleParamChange(key, e.currentTarget.value)}
            placeholder={meta.placeholder || `Enter ${key}...`}
          ></textarea>
        {:else if meta?.type === 'select'}
          {@const currentValue = node.params[key] ?? defaultValue}
          <select
            id={`param-${key}`}
            class="param-select"
            value={String(currentValue)}
            onchange={(e) => {
              const val = e.currentTarget.value;
              // Convert back to number if the default was numeric
              const parsedVal = typeof defaultValue === 'number' ? parseFloat(val) : val;
              handleParamChange(key, parsedVal);
            }}
          >
            {#each meta.options || [] as option}
              <option value={String(option.value)} selected={String(option.value) === String(currentValue)}>
                {option.label}
              </option>
            {/each}
          </select>
        {:else if meta?.type === 'slider'}
          <div class="slider-container">
            <input
              id={`param-${key}`}
              type="range"
              class="param-slider"
              min={meta.min ?? 0}
              max={meta.max ?? 100}
              step={meta.step ?? 1}
              value={node.params[key] as number ?? defaultValue}
              oninput={(e) => handleParamChange(key, parseFloat(e.currentTarget.value))}
            />
            <span class="slider-value">{node.params[key] ?? defaultValue}</span>
          </div>
        {:else if typeof defaultValue === 'string'}
          {#if key === 'text' || key === 'prompt' || key.includes('prompt')}
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
            min={meta?.min}
            max={meta?.max}
            step={meta?.step}
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
    {/if}
  {/each}
</div>

<style>
  .parameter-editor {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  
  .param-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  
  .param-row.full-width {
    width: 100%;
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
    transition: border-color 0.15s ease;
  }
  
  .param-input:focus,
  .param-textarea:focus,
  .param-select:focus {
    outline: none;
    border-color: var(--accent-primary);
  }
  
  .param-textarea {
    min-height: 60px;
    resize: vertical;
    font-family: var(--font-mono);
  }
  
  .param-select {
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23888' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;
    /* Ensure text is always visible */
    color: var(--text-primary);
    text-overflow: ellipsis;
    white-space: nowrap;
    overflow: hidden;
  }
  
  /* Fix for Webkit browsers where select text can disappear */
  .param-select::-ms-expand {
    display: none;
  }
  
  .param-select option {
    background: var(--bg-secondary);
    color: var(--text-primary);
    padding: 8px;
  }
  
  .param-select option:checked {
    background: var(--accent-primary);
    color: white;
  }
  
  /* Slider styles */
  .slider-container {
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
    cursor: pointer;
  }
  
  .param-slider::-webkit-slider-thumb {
    appearance: none;
    width: 12px;
    height: 12px;
    background: var(--accent-primary);
    border-radius: 50%;
    cursor: grab;
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }
  
  .param-slider::-webkit-slider-thumb:hover {
    transform: scale(1.1);
    box-shadow: 0 0 6px var(--accent-glow);
  }
  
  .param-slider::-webkit-slider-thumb:active {
    cursor: grabbing;
    transform: scale(0.95);
  }
  
  .param-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    background: var(--accent-primary);
    border: none;
    border-radius: 50%;
    cursor: grab;
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
