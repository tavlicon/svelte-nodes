<script lang="ts">
  import { router } from '../router.svelte';
  
  // Component groups with metadata for future Storybook/test integration
  const componentGroups = [
    {
      id: 'components',
      name: 'Base Components',
      description: 'Core UI primitives: buttons, inputs, sliders, badges, and typography',
      route: 'ui/components' as const,
      icon: 'cube',
      stateCount: 24,
      categories: ['Buttons', 'Inputs', 'Sliders', 'Badges', 'Typography', 'Tabs']
    },
    {
      id: 'panels',
      name: 'Panel Patterns',
      description: 'Reusable panel layouts for sidebars, property editors, and file browsers',
      route: 'ui/panels' as const,
      icon: 'layout',
      stateCount: 12,
      categories: ['Assets Panel', 'Models Panel', 'Node Panel']
    }
  ];
  
  function navigateTo(route: 'ui/components' | 'ui/panels') {
    router.navigate(route);
  }
</script>

<div class="ui-index">
  <header class="page-header">
    <h1>UI Component Library</h1>
    <p class="subtitle">Visual documentation of all component states for development and testing</p>
    
    <div class="meta-info">
      <span class="meta-item">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
        </svg>
        {componentGroups.length} Groups
      </span>
      <span class="meta-item">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        {componentGroups.reduce((sum, g) => sum + g.stateCount, 0)} States
      </span>
    </div>
  </header>
  
  <main class="groups-grid">
    {#each componentGroups as group (group.id)}
      <button class="group-card" onclick={() => navigateTo(group.route)}>
        <div class="card-icon">
          {#if group.icon === 'cube'}
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
              <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
            </svg>
          {:else if group.icon === 'layout'}
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 9h18M9 21V9" />
            </svg>
          {/if}
        </div>
        
        <div class="card-content">
          <h2 class="card-title">{group.name}</h2>
          <p class="card-description">{group.description}</p>
          
          <div class="card-meta">
            <span class="state-count">{group.stateCount} states</span>
            <span class="category-list">
              {group.categories.slice(0, 3).join(' · ')}
              {#if group.categories.length > 3}
                <span class="more">+{group.categories.length - 3}</span>
              {/if}
            </span>
          </div>
        </div>
        
        <div class="card-arrow">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M5 12h14M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </div>
      </button>
    {/each}
  </main>
  
  <footer class="page-footer">
    <div class="footer-info">
      <h3>Integration Ready</h3>
      <p>
        Component states are defined as structured data arrays, ready for:
      </p>
      <ul class="integration-list">
        <li>
          <strong>Storybook</strong> — Auto-generate stories from state definitions
        </li>
        <li>
          <strong>Visual Regression</strong> — Snapshot each state for comparison
        </li>
        <li>
          <strong>Accessibility Testing</strong> — Run axe-core on all variants
        </li>
      </ul>
    </div>
  </footer>
</div>

<style>
  .ui-index {
    flex: 1;
    padding: 48px;
    overflow-y: auto;
    background: var(--bg-primary);
    display: flex;
    flex-direction: column;
    gap: 48px;
    max-width: 1200px;
    margin: 0 auto;
  }
  
  .page-header {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  
  .page-header h1 {
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 40px;
    font-weight: 700;
    color: var(--text-primary);
    margin: 0;
    letter-spacing: -0.02em;
  }
  
  .subtitle {
    font-family: 'Helvetica Now Text', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 16px;
    color: var(--text-secondary);
    margin: 0;
    max-width: 600px;
  }
  
  .meta-info {
    display: flex;
    gap: 24px;
    margin-top: 8px;
  }
  
  .meta-item {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    font-weight: 500;
    color: var(--text-muted);
  }
  
  .meta-item svg {
    opacity: 0.6;
  }
  
  /* Groups Grid */
  .groups-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
    gap: 24px;
  }
  
  .group-card {
    display: flex;
    align-items: flex-start;
    gap: 20px;
    padding: 28px;
    background: var(--bg-secondary);
    border: 1px solid var(--border-subtle);
    border-radius: 16px;
    cursor: pointer;
    text-align: left;
    transition: all 0.2s ease;
    position: relative;
    overflow: hidden;
  }
  
  .group-card::before {
    content: '';
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, var(--accent-primary) 0%, transparent 60%);
    opacity: 0;
    transition: opacity 0.3s ease;
  }
  
  .group-card:hover {
    border-color: var(--accent-primary);
    transform: translateY(-2px);
    box-shadow: var(--shadow-lg);
  }
  
  .group-card:hover::before {
    opacity: 0.03;
  }
  
  .group-card:hover .card-arrow {
    transform: translateX(4px);
    color: var(--accent-primary);
  }
  
  .card-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 56px;
    height: 56px;
    background: linear-gradient(135deg, var(--accent-primary), var(--accent-secondary));
    border-radius: 14px;
    color: white;
    flex-shrink: 0;
  }
  
  .card-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
    position: relative;
    z-index: 1;
  }
  
  .card-title {
    font-size: 18px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
  }
  
  .card-description {
    font-size: 14px;
    color: var(--text-secondary);
    margin: 0;
    line-height: 1.5;
  }
  
  .card-meta {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: 8px;
  }
  
  .state-count {
    font-size: 12px;
    font-weight: 600;
    color: var(--accent-primary);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  
  .category-list {
    font-size: 12px;
    color: var(--text-muted);
  }
  
  .category-list .more {
    color: var(--accent-secondary);
    font-weight: 500;
  }
  
  .card-arrow {
    color: var(--text-muted);
    transition: all 0.2s ease;
    flex-shrink: 0;
    margin-top: 4px;
  }
  
  /* Footer */
  .page-footer {
    padding-top: 32px;
    border-top: 1px solid var(--border-subtle);
  }
  
  .footer-info h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 8px 0;
  }
  
  .footer-info p {
    font-size: 13px;
    color: var(--text-secondary);
    margin: 0 0 16px 0;
  }
  
  .integration-list {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  
  .integration-list li {
    font-size: 12px;
    color: var(--text-muted);
  }
  
  .integration-list strong {
    color: var(--text-secondary);
    font-weight: 600;
  }
</style>
