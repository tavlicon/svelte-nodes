<script lang="ts">
  import { inferenceManager } from '../inference/manager';
  
  let backendStatus = $state<{
    available: boolean;
    modelLoaded: boolean;
    device: string;
  }>({
    available: false,
    modelLoaded: false,
    device: 'checking...',
  });
  
  // Check backend status on mount
  $effect(() => {
    checkBackendStatus();
  });
  
  async function checkBackendStatus() {
    try {
      const status = await inferenceManager.checkBackendStatus();
      backendStatus = {
        available: inferenceManager.isBackendAvailable(),
        modelLoaded: status.modelLoaded,
        device: status.device || 'simulation',
      };
    } catch (e) {
      backendStatus = {
        available: false,
        modelLoaded: false,
        device: 'offline',
      };
    }
  }
</script>

<div 
  class="backend-status" 
  class:connected={backendStatus.available && backendStatus.modelLoaded}
  class:loading={backendStatus.available && !backendStatus.modelLoaded}
  title={backendStatus.available 
    ? `Backend: ${backendStatus.device} | Model: ${backendStatus.modelLoaded ? 'loaded' : 'loading...'}` 
    : 'Backend offline - using simulation mode'}
>
  <span class="status-dot"></span>
  <span class="status-text">
    {#if backendStatus.available && backendStatus.modelLoaded}
      {backendStatus.device.toUpperCase()}
    {:else if backendStatus.available}
      Loading...
    {:else}
      Simulation
    {/if}
  </span>
</div>

<style>
  .backend-status {
    position: fixed;
    top: 16px;
    right: 16px;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: rgb(20, 20, 20);
    border: 1px solid rgb(40, 40, 40);
    border-radius: 100px;
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    font-size: 12px;
    font-weight: 500;
    color: rgb(153, 153, 153);
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #f59e0b;
  }
  
  .backend-status.connected .status-dot {
    background: #10b981;
    box-shadow: 0 0 8px rgba(16, 185, 129, 0.5);
  }
  
  .backend-status.loading .status-dot {
    background: #3b82f6;
    animation: pulse 1.5s ease-in-out infinite;
  }
  
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }
  
  .status-text {
    color: rgb(153, 153, 153);
  }
  
  .backend-status.connected .status-text {
    color: #10b981;
  }
</style>
