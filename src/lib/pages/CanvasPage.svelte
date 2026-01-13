<script lang="ts">
  import Canvas from '../ui/Canvas.svelte';
  import Sidebar from '../ui/Sidebar.svelte';
  import NodePanel from '../ui/NodePanel.svelte';
  import CanvasControlPanel from '../ui/CanvasControlPanel.svelte';
</script>

<div class="canvas-page">
  <Sidebar />
  <Canvas />
  <NodePanel />
  <CanvasControlPanel />
</div>

<style>
  .canvas-page {
    flex: 1;
    display: flex;
    position: relative;
    overflow: hidden;
  }
</style>
