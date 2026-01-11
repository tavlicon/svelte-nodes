<script lang="ts">
  import { onMount } from 'svelte';
  import CanvasPage from './lib/pages/CanvasPage.svelte';
  import PanelsPage from './lib/pages/PanelsPage.svelte';
  import ComponentsPage from './lib/pages/ComponentsPage.svelte';
  import Toolbar from './lib/ui/Toolbar.svelte';
  import { theme } from './lib/ui/theme.svelte';
  import { router, type Page } from './lib/router.svelte';
  
  // Initialize router on mount
  onMount(() => {
    router.init();
  });
  
  function handleNavClick(page: Page) {
    router.navigate(page);
  }
</script>

<div class="studio" class:light={theme.current === 'light'} class:dark={theme.current === 'dark'}>
  <!-- Navigation tabs -->
  <nav class="page-nav">
    <button 
      class="nav-tab" 
      class:active={router.page === 'canvas'}
      onclick={() => handleNavClick('canvas')}
    >
      Canvas
    </button>
    <button 
      class="nav-tab" 
      class:active={router.page === 'panels'}
      onclick={() => handleNavClick('panels')}
    >
      Panels
    </button>
    <button 
      class="nav-tab" 
      class:active={router.page === 'components'}
      onclick={() => handleNavClick('components')}
    >
      Components
    </button>
  </nav>
  
  {#if router.page === 'canvas'}
  <Toolbar />
  {/if}
  
  <div class="workspace">
    {#if router.page === 'canvas'}
      <CanvasPage />
    {:else if router.page === 'panels'}
      <PanelsPage />
    {:else if router.page === 'components'}
      <ComponentsPage />
    {/if}
  </div>
</div>

<style>
  .studio {
    display: flex;
    flex-direction: column;
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
  
  .page-nav {
    display: flex;
    gap: 0;
    padding: 0 16px;
    background: var(--bg-secondary);
    border-bottom: 1px solid var(--border-subtle);
  }
  
  .nav-tab {
    padding: 12px 20px;
    font-size: 13px;
    font-weight: 500;
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
    position: relative;
  }
  
  .nav-tab:hover {
    color: var(--text-secondary);
  }
  
  .nav-tab.active {
    color: var(--text-primary);
  }
  
  .nav-tab.active::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--accent-primary);
    border-radius: 2px 2px 0 0;
  }
  
  .workspace {
    flex: 1;
    display: flex;
    position: relative;
    overflow: hidden;
  }
</style>
