<script lang="ts">
  /**
   * Canvas Menu Component
   * 
   * A non-zoomable menu overlay that appears when clicking the plus icon on nodes.
   * Allows users to select a model type which creates and auto-connects a new node.
   */

  interface MenuItem {
    id: string;
    label: string;
    nodeType: string;
  }

  interface Props {
    x: number;
    y: number;
    sourcePortType?: 'image' | 'mesh';
    onselect: (nodeType: string) => void;
    onclose: () => void;
  }

  let { x, y, sourcePortType = 'image', onselect, onclose }: Props = $props();

  // Menu items based on source port type
  const menuItems = $derived.by<MenuItem[]>(() => {
    if (sourcePortType === 'image') {
      return [
        { id: 'triposr', label: 'TripoSR', nodeType: 'triposr' },
        { id: 'model', label: 'SD 1.5 img2img', nodeType: 'model' },
      ];
    }
    // For mesh outputs, could add mesh-specific operations here
    return [];
  });

  let hoveredItem = $state<string | null>(null);

  function handleItemClick(e: MouseEvent, nodeType: string) {
    e.stopPropagation();
    onselect(nodeType);
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }

  // Click outside detection
  function handleBackdropClick(e: MouseEvent) {
    // Only close if clicking the backdrop itself, not the menu
    if (e.target === e.currentTarget) {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<!-- Invisible backdrop to capture clicks outside -->
<div 
  class="menu-backdrop" 
  onclick={handleBackdropClick}
  onpointerdown={(e) => e.stopPropagation()}
  role="presentation"
>
  <!-- Menu container positioned at the connector icon -->
  <div 
    class="canvas-menu"
    style={`left: ${x}px; top: ${y}px;`}
    role="menu"
    tabindex="-1"
  >
    {#each menuItems as item (item.id)}
      <button
        class="menu-item"
        class:hovered={hoveredItem === item.id}
        onmouseenter={() => hoveredItem = item.id}
        onmouseleave={() => hoveredItem = null}
        onclick={(e) => handleItemClick(e, item.nodeType)}
        role="menuitem"
      >
        <span class="menu-item-label">{item.label}</span>
      </button>
    {/each}
  </div>
</div>

<style>
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 199;
    /* Transparent backdrop to catch clicks */
  }

  .canvas-menu {
    position: absolute;
    width: 300px;
    background: #1A1A1A;
    border: 1px solid #28282A;
    border-radius: 12px;
    backdrop-filter: blur(50px);
    -webkit-backdrop-filter: blur(50px);
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    overflow: hidden;
    z-index: 200;
    animation: menuFadeIn 0.15s ease;
  }

  @keyframes menuFadeIn {
    from { 
      opacity: 0; 
      transform: translateY(4px); 
    }
    to { 
      opacity: 1; 
      transform: translateY(0); 
    }
  }

  .menu-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    height: 56px;
    padding: 12px 16px;
    background: none;
    border: none;
    border-bottom: 1px solid #28282A;
    color: rgba(158, 158, 160, 1);
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 14px;
    font-weight: 400;
    text-align: left;
    cursor: pointer;
    transition: background 0.1s ease, color 0.1s ease;
  }

  .menu-item:last-child {
    border-bottom: none;
  }

  .menu-item:hover,
  .menu-item.hovered {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(244, 244, 244, 1);
  }

  .menu-item:active {
    background: rgba(255, 255, 255, 0.12);
  }

  .menu-item-label {
    flex: 1;
  }
</style>
