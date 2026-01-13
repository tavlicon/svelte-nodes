<script lang="ts">
  import { onMount } from 'svelte';
  import CanvasPage from './lib/pages/CanvasPage.svelte';
  import UIIndexPage from './lib/pages/UIIndexPage.svelte';
  import PanelsPage from './lib/pages/PanelsPage.svelte';
  import ComponentsPage from './lib/pages/ComponentsPage.svelte';
  import BackendStatus from './lib/ui/BackendStatus.svelte';
  import { theme } from './lib/ui/theme.svelte';
  import { router, type Page } from './lib/router.svelte';
  
  // Initialize router on mount
  onMount(() => {
    router.init();
  });
  
  function handleNavClick(page: Page) {
    router.navigate(page);
  }
  
  function toggleTheme() {
    theme.toggle();
  }
  
  // Derive breadcrumb for UI section
  let breadcrumb = $derived.by(() => {
    if (router.page === 'ui/components') return 'Components';
    if (router.page === 'ui/panels') return 'Panels';
    return null;
  });
</script>

<div class="studio" class:light={theme.current === 'light'} class:dark={theme.current === 'dark'}>
  {#if router.isUISection}
    <!-- UI pages: minimal nav with Canvas button at bottom -->
    <nav class="ui-nav">
      <div class="nav-spacer"></div>
      
      <div class="nav-bottom">
        <!-- Only show Canvas button on UI pages -->
        <button 
          class="nav-icon"
          onclick={() => handleNavClick('canvas')}
          title="Canvas"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18" />
            <path d="M9 21V9" />
          </svg>
          <span class="nav-label">Canvas</span>
        </button>
      </div>
    </nav>
  {/if}
  
  <div class="main-area">
    {#if router.page === 'canvas'}
      <BackendStatus />
    {:else if router.isUISection}
      <!-- UI header with optional breadcrumb and theme toggle -->
      <header class="ui-header">
        <div class="ui-header-left">
          {#if breadcrumb}
            <button class="breadcrumb-link" onclick={() => handleNavClick('ui')}>UI</button>
            <span class="breadcrumb-sep">/</span>
            <span class="breadcrumb-current">{breadcrumb}</span>
          {/if}
        </div>
        <div class="ui-header-right">
          <button 
            class="theme-toggle-btn"
            onclick={toggleTheme}
            title={theme.current === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {#if theme.current === 'dark'}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="5" />
                <line x1="12" y1="1" x2="12" y2="3" />
                <line x1="12" y1="21" x2="12" y2="23" />
                <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
                <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
                <line x1="1" y1="12" x2="3" y2="12" />
                <line x1="21" y1="12" x2="23" y2="12" />
                <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
                <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
              </svg>
            {:else}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
            {/if}
          </button>
        </div>
      </header>
    {/if}
    
    <div class="workspace">
      {#if router.page === 'canvas'}
        <CanvasPage />
      {:else if router.page === 'ui'}
        <UIIndexPage />
      {:else if router.page === 'ui/panels'}
        <PanelsPage />
      {:else if router.page === 'ui/components'}
        <ComponentsPage />
      {/if}
    </div>
  </div>
</div>

<style>
  .studio {
    display: flex;
    width: 100%;
    height: 100%;
    background: var(--bg-primary);
    color: var(--text-primary);
    transition: background 0.2s ease, color 0.2s ease;
    
    /* Shared design tokens */
    --radius-sm: 4px;
    --radius-md: 8px;
    --radius-lg: 12px;
    
    --font-sans: 'Sora', system-ui, sans-serif;
    --font-mono: 'JetBrains Mono', monospace;
    
    --success: #10b981;
    --warning: #f59e0b;
    --error: #ef4444;
  }
  
  /* Light theme (default) */
  .studio.light {
    --bg-primary: #fafafa;
    --bg-secondary: #f5f5f5;
    --bg-tertiary: #ebebeb;
    --bg-elevated: #ffffff;
    
    --text-primary: #1a1a1a;
    --text-secondary: #525252;
    --text-muted: #9a9a9a;
    
    --accent-primary: #5b5fc7;
    --accent-secondary: #7c7ff2;
    --accent-glow: rgba(91, 95, 199, 0.2);
    
    --border-subtle: rgba(0, 0, 0, 0.06);
    --border-default: rgba(0, 0, 0, 0.12);
    
    --shadow-sm: 0 1px 3px rgba(0, 0, 0, 0.08);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.1);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.12);
    
    --canvas-dot: rgba(0, 0, 0, 0.15);
    --node-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }
  
  /* Dark theme */
  .studio.dark {
    --bg-primary: #0a0a0b;
    --bg-secondary: #141416;
    --bg-tertiary: #1c1c1f;
    --bg-elevated: #242428;
    
    --text-primary: #f0f0f2;
    --text-secondary: #a0a0a8;
    --text-muted: #606068;
    
    --accent-primary: #6366f1;
    --accent-secondary: #818cf8;
    --accent-glow: rgba(99, 102, 241, 0.3);
    
    --border-subtle: rgba(255, 255, 255, 0.06);
    --border-default: rgba(255, 255, 255, 0.1);
    
    --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
    --shadow-md: 0 4px 12px rgba(0, 0, 0, 0.4);
    --shadow-lg: 0 8px 24px rgba(0, 0, 0, 0.5);
    
    --canvas-dot: rgba(255, 255, 255, 0.08);
    --node-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
  }
  
  /* UI pages navigation rail */
  .ui-nav {
    display: flex;
    flex-direction: column;
    width: 72px;
    background: var(--bg-secondary);
    border-right: 1px solid var(--border-subtle);
    flex-shrink: 0;
    padding: 12px 0;
  }
  
  .nav-spacer {
    flex: 1;
  }
  
  .nav-bottom {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  
  .nav-icon {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 8px;
    margin: 0 8px;
    background: none;
    border: none;
    border-radius: var(--radius-md);
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .nav-icon:hover {
    color: var(--text-secondary);
    background: var(--border-subtle);
  }
  
  .nav-label {
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }
  
  /* Main area */
  .main-area {
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    overflow: hidden;
  }
  
  .workspace {
    flex: 1;
    display: flex;
    position: relative;
    overflow: hidden;
  }
  
  /* UI header with breadcrumb and theme toggle */
  .ui-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 24px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-subtle);
    min-height: 44px;
  }
  
  .ui-header-left {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .ui-header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  
  .breadcrumb-link {
    background: none;
    border: none;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
    cursor: pointer;
    padding: 0;
    transition: color 0.15s ease;
  }
  
  .breadcrumb-link:hover {
    color: var(--accent-primary);
  }
  
  .breadcrumb-sep {
    color: var(--text-muted);
    opacity: 0.5;
  }
  
  .breadcrumb-current {
    font-size: 13px;
    font-weight: 500;
    color: var(--text-primary);
  }
  
  .theme-toggle-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: var(--bg-tertiary);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    color: var(--text-secondary);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  
  .theme-toggle-btn:hover {
    background: var(--bg-elevated);
    border-color: var(--border-default);
    color: var(--text-primary);
  }
</style>
