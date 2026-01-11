<script lang="ts">
  import Canvas from '../ui/Canvas.svelte';
  import Sidebar from '../ui/Sidebar.svelte';
  import NodePanel from '../ui/NodePanel.svelte';
</script>

<div class="canvas-page">
  <Sidebar />
  <Canvas />
  <NodePanel />
</div>

<style>
  .canvas-page {
    flex: 1;
    display: flex;
    position: relative;
    overflow: hidden;
  }
</style>
