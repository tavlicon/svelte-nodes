<script lang="ts">
  import type { Snippet } from 'svelte';
  
  interface Props {
    visible?: boolean;
    width?: number;
    position?: 'left' | 'right';
    onclose?: () => void;
    /** Custom header content - if provided, renders inside default header layout with close button */
    header?: Snippet;
    /** Full custom header - if provided, completely replaces the header (no default close button) */
    customHeader?: Snippet;
    children: Snippet;
  }
  
  let { 
    visible = true, 
    width = 300,
    position = 'right',
    onclose,
    header,
    customHeader,
    children 
  }: Props = $props();
</script>

<div 
  class="panel" 
  class:visible 
  class:left={position === 'left'}
  class:right={position === 'right'}
  style="--panel-width: {width}px"
>
  {#if customHeader}
    {@render customHeader()}
  {:else if header || onclose}
    <header class="panel-header">
      {#if header}
        <div class="header-content">
          {@render header()}
        </div>
      {/if}
      {#if onclose}
        <div class="header-actions">
          <button class="icon-btn" onclick={onclose} title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      {/if}
    </header>
  {/if}
  
  <div class="panel-body">
    {@render children()}
  </div>
</div>

<style>
  .panel {
    background: #141414;
    border: 0.5px solid #28282A;
    border-radius: 20px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 175px 49px 0 rgba(5, 5, 5, 0.01), 0 112px 45px 0 rgba(5, 5, 5, 0.04);
    backdrop-filter: blur(50px);
    pointer-events: auto;
    height: 100%;
    
    /* Animation */
    opacity: 0;
    width: 0;
    min-width: 0;
    transition: opacity 180ms ease-out, width 180ms ease-out, min-width 180ms ease-out;
  }
  
  .panel.visible {
    opacity: 1;
    width: var(--panel-width);
    min-width: var(--panel-width);
  }
  
  /* Position-specific styles */
  .panel.left {
    margin-right: auto;
  }
  
  .panel.right {
    margin-left: auto;
  }
  
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px;
    background: transparent;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  
  .header-content {
    flex: 1;
    min-width: 0;
  }
  
  .header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
    margin-left: 12px;
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
  
  .panel-body {
    flex: 1;
    overflow-y: auto;
    overflow-x: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0; /* Important: allows flex child to shrink below content size */
  }
</style>
