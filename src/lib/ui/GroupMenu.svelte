<script lang="ts">
  interface Props {
    x: number;
    y: number;
    visible: boolean;
    showGroup: boolean;
    showUngroup: boolean;
    showTidy: boolean;
    tidyDisabled: boolean;
    onGroup: () => void;
    onUngroup: () => void;
    onTidy: () => void;
    onclose: () => void;
    onHoverChange?: (hovered: boolean) => void;
  }

  let { x, y, visible, showGroup, showUngroup, showTidy, tidyDisabled, onGroup, onUngroup, onTidy, onclose, onHoverChange }: Props = $props();

  function handleBackdropPointerDown(e: PointerEvent) {
    if (e.target === e.currentTarget) {
      onclose();
    }
  }

  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onclose();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

<div class="group-menu-backdrop" class:visible={visible} onpointerdown={handleBackdropPointerDown} role="presentation">
  <div
    class="group-menu"
    style={`left: ${x}px; top: ${y}px;`}
    role="menu"
    tabindex="-1"
    onpointerdown={(e) => e.stopPropagation()}
    onmouseenter={() => onHoverChange?.(true)}
    onmouseleave={() => onHoverChange?.(false)}
  >
    {#if showGroup}
      <button class="group-menu-item" onclick={onGroup} type="button" role="menuitem">
        <span class="icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M9 3.75H15M6 3.75H5.75C4.64543 3.75 3.75 4.64543 3.75 5.75V6M18 3.75H18.25C19.3546 3.75 20.25 4.64543 20.25 5.75V6M15 20.25H9M18 20.25H18.25C19.3546 20.25 20.25 19.3546 20.25 18.25V18M6 20.25H5.75C4.64543 20.25 3.75 19.3546 3.75 18.25V18M3.75 15V9M20.25 15V9.375" stroke="white" stroke-width="1.5"/>
          </svg>
        </span>
        <span class="label">Group</span>
      </button>
    {/if}
    {#if showUngroup}
      <button class="group-menu-item" onclick={onUngroup} type="button" role="menuitem">
        <span class="icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M13.9 19.5C13.9 20.0523 14.3477 20.5 14.9 20.5H19.5C20.0523 20.5 20.5 20.0523 20.5 19.5V14.9C20.5 14.3477 20.0523 13.9 19.5 13.9H14.9C14.3477 13.9 13.9 14.3477 13.9 14.9V19.5Z" stroke="white" stroke-dasharray="2 2"/>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M4 19.5C4 20.0523 4.44772 20.5 5 20.5H9.6C10.1523 20.5 10.6 20.0523 10.6 19.5V14.9C10.6 14.3477 10.1523 13.9 9.6 13.9H5C4.44771 13.9 4 14.3477 4 14.9V19.5Z" stroke="white" stroke-dasharray="2 2"/>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M13.9 9.6C13.9 10.1523 14.3477 10.6 14.9 10.6H19.5C20.0523 10.6 20.5 10.1523 20.5 9.6V5C20.5 4.44771 20.0523 4 19.5 4H14.9C14.3477 4 13.9 4.44772 13.9 5V9.6Z" stroke="white" stroke-dasharray="2 2"/>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M4 9.6C4 10.1523 4.44772 10.6 5 10.6H9.6C10.1523 10.6 10.6 10.1523 10.6 9.6V5C10.6 4.44771 10.1523 4 9.6 4H5C4.44771 4 4 4.44772 4 5V9.6Z" stroke="white" stroke-dasharray="2 2"/>
          </svg>
        </span>
        <span class="label">Ungroup</span>
      </button>
    {/if}
    {#if showTidy}
      <button class="group-menu-item" class:disabled={tidyDisabled} onclick={onTidy} disabled={tidyDisabled} type="button" role="menuitem">
        <span class="icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <!-- Horizontal distribute icon: 3 vertical bars with equal spacing arrows -->
            <rect x="4" y="6" width="3" height="12" rx="1" stroke="white" stroke-width="1.5"/>
            <rect x="10.5" y="6" width="3" height="12" rx="1" stroke="white" stroke-width="1.5"/>
            <rect x="17" y="6" width="3" height="12" rx="1" stroke="white" stroke-width="1.5"/>
            <!-- Equal spacing indicators -->
            <path d="M7.5 12H10" stroke="white" stroke-width="1" stroke-linecap="round"/>
            <path d="M14 12H16.5" stroke="white" stroke-width="1" stroke-linecap="round"/>
          </svg>
        </span>
        <span class="label">Tidy Up</span>
      </button>
    {/if}
  </div>
</div>

<style>
  .group-menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 210;
    opacity: 0;
    pointer-events: none;
    transition: opacity 140ms cubic-bezier(0.0, 0, 0.2, 1);
  }
  
  .group-menu-backdrop.visible {
    opacity: 1;
    /* Don't block pointer events on the backdrop - only the menu itself should capture events */
    pointer-events: none;
  }

  .group-menu {
    position: absolute;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 24px;
    background: rgba(20, 20, 20, 0.92);
    border: 1px solid #2a2a2d;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
    min-width: 140px;
    transform: translateY(4px);
    opacity: 0;
    pointer-events: auto;
    transition: opacity 140ms cubic-bezier(0.0, 0, 0.2, 1), transform 140ms cubic-bezier(0.0, 0, 0.2, 1);
  }
  
  .group-menu-backdrop.visible .group-menu {
    transform: translateY(0);
    opacity: 1;
  }

  .group-menu-item {
    height: 38px;
    padding: 0 12px 0 8px;
    border-radius: 14px;
    border: none;
    background: #1f1f22;
    color: #f4f4f4;
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s ease;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .group-menu-item:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
  }

  .group-menu-item.disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .icon {
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: #2a2a2d;
    border-radius: 10px;
  }

  .label {
    color: rgba(244, 244, 244, 0.9);
  }
</style>
