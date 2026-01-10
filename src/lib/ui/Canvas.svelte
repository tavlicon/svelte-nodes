<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { CanvasRenderer } from '../canvas/renderer';
  import { Canvas2DRenderer } from '../canvas/renderer-2d';
  import { getNodesInRect } from '../canvas/interaction';
  import { graphStore, getNodesVersion } from '../graph/store.svelte';
  import { theme } from './theme.svelte';
  import { uploadFile } from '../services/file-service';
  import { 
    hitTestPort, 
    findNearestPort, 
    getPortPosition,
    getPortPositions,
    type PortPosition,
    PORT_HANDLE_RADIUS,
  } from '../canvas/ports';
  import { arePortsCompatible } from '../graph/types';
  
  // Renderer interface
  interface IRenderer {
    initialize(): Promise<boolean>;
    resize(width: number, height: number): void;
    render(nodes: Map<string, any>, edges: Map<string, any>, camera: any, selectedIds: Set<string>): void;
    destroy(): void;
    worldToScreen(worldX: number, worldY: number, camera: any): { x: number; y: number };
    getViewportSize(): { width: number; height: number };
    setTheme?(isDark: boolean): void;
    setInteractionState?(state: {
      hoveredNodeId?: string | null;
      hoveredEdgeId?: string | null;
      selectedEdgeIds?: Set<string>;
      pendingConnection?: {
        startX: number;
        startY: number;
        endX: number;
        endY: number;
        isFromOutput: boolean;
      } | null;
    }): void;
    hitTestEdge?(
      worldX: number,
      worldY: number,
      nodes: Map<string, any>,
      edges: Map<string, any>,
      threshold?: number
    ): string | null;
  }
  
  let canvasElement: HTMLCanvasElement;
  let containerElement: HTMLDivElement;
  let renderer = $state<IRenderer | null>(null);
  let animationFrameId: number;
  let resizeObserver: ResizeObserver | null = null;
  let rendererType = $state<'webgpu' | '2d' | 'none'>('none');
  
  // Canvas dimensions
  let canvasWidth = $state(0);
  let canvasHeight = $state(0);
  
  // Interaction state
  let mode = $state<'select' | 'pan' | 'drag' | 'marquee'>('select');
  let spacePressed = $state(false);
  let isDragging = $state(false);
  let isPanning = $state(false);
  let marqueeAdditive = $state(false);
  let marqueeStartWorld = $state<{ x: number; y: number } | null>(null);
  let marqueeStartScreen = $state<{ x: number; y: number } | null>(null);
  let marqueeCurrentWorld = $state<{ x: number; y: number } | null>(null);
  let marqueeCurrentScreen = $state<{ x: number; y: number } | null>(null);
  let initialSelection = new Set<string>();
  
  // Drag state - stores initial positions
  let dragStartWorld = { x: 0, y: 0 };
  let dragNodeStartPositions = new Map<string, { x: number; y: number }>();
  
  // Multi-touch
  let activePointers = new Map<number, { x: number; y: number }>();
  let lastPinchDistance = 0;
  let lastPinchCenter = { x: 0, y: 0 };
  
  // Drag and drop state
  let isDragOver = $state(false);
  let newlyAddedNodeIds = $state<Set<string>>(new Set());
  
  // Hover state
  let hoveredNodeId = $state<string | null>(null);
  let hoveredEdgeId = $state<string | null>(null);
  
  // Connection dragging state
  let isConnecting = $state(false);
  let connectionStart = $state<PortPosition | null>(null);
  let connectionEndWorld = $state<{ x: number; y: number } | null>(null);
  let snapTarget = $state<PortPosition | null>(null);
  
  // Edge reconnection state (dragging an edge endpoint)
  let isReconnecting = $state(false);
  let reconnectingEdgeId = $state<string | null>(null);
  let reconnectingEndpoint = $state<'source' | 'target' | null>(null);
  let reconnectFixedEnd = $state<{ x: number; y: number } | null>(null);
  
  // Default node size for image resizing
  const NODE_SIZE = 200;
  
  onMount(() => {
    initRenderer();
    // Use capture phase to intercept before browser handles ⌘Z
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    
    // Add test nodes on load for debugging (enable via URL param: ?test=1)
    if (typeof window !== 'undefined' && window.location.search.includes('test=1')) {
      setTimeout(() => addTestNodes(), 100);
    }
  });
  
  let testNodesAdded = false;
  
  function addTestNodes() {
    // Prevent duplicate test node creation
    if (testNodesAdded) {
      console.log('Test nodes already added, skipping');
      return;
    }
    
    // Also check if nodes already exist
    if (graphStore.nodes.size > 0) {
      console.log('Nodes already exist, skipping test node creation');
      return;
    }
    
    testNodesAdded = true;
    
    // Add an image node on the left (placeholder - no actual image)
    const imageId = graphStore.addNode(
      'image',
      -250, -100,
      {
        imageUrl: '', // Empty for now, tests port rendering
        filename: 'placeholder',
        originalWidth: 200,
        originalHeight: 200,
      },
      200, 200
    );
    
    // Add a model node on the right
    const modelId = graphStore.addNode(
      'model',
      150, -60,
      {
        modelPath: '/data/models/test.safetensors',
        modelName: 'test-model',
        modelType: 'safetensors',
        modelSize: 1000000,
      },
      200, 120
    );
    
    // Connect image output to model image input
    graphStore.addEdge(imageId, 'image', modelId, 'image');
  }
  
  onDestroy(() => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    resizeObserver?.disconnect();
    renderer?.destroy();
    document.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('keyup', handleKeyUp);
  });
  
  async function initRenderer() {
    // Force Canvas2D for debugging coordinate issues
    const forceCanvas2D = typeof window !== 'undefined' && window.location.search.includes('force2d=1');
    
    // Try WebGPU first (unless forced to Canvas2D)
    if (navigator.gpu && !forceCanvas2D) {
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (adapter) {
          const webgpuRenderer = new CanvasRenderer(canvasElement);
          const success = await webgpuRenderer.initialize();
          if (success) {
            webgpuRenderer.setTheme(theme.isDark);
            renderer = webgpuRenderer;
            rendererType = 'webgpu';
            console.warn('Using WebGPU renderer');
          }
        }
      } catch (e) {
        console.warn('WebGPU initialization failed:', e);
      }
    }
    
    // Fall back to Canvas 2D
    if (!renderer) {
      console.log('WebGPU not available, using Canvas 2D fallback');
      const canvas2dRenderer = new Canvas2DRenderer(canvasElement);
      const success = await canvas2dRenderer.initialize();
      if (success) {
        canvas2dRenderer.setTheme(theme.isDark);
        renderer = canvas2dRenderer;
        rendererType = '2d';
      } else {
        console.error('Failed to initialize any renderer');
        return;
      }
    }
    
    resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(containerElement);
    handleResize();
    
    function renderLoop() {
      if (renderer) {
        // Access store properties directly to ensure we get current values
        renderer.render(
          graphStore.nodes,
          graphStore.edges,
          graphStore.camera,
          graphStore.selectedNodeIds
        );
      }
      animationFrameId = requestAnimationFrame(renderLoop);
    }
    renderLoop();
  }
  
  function handleResize() {
    if (!containerElement || !renderer) return;
    
    // Get container size to determine canvas size
    const containerRect = containerElement.getBoundingClientRect();
    const width = containerRect.width;
    const height = containerRect.height;
    
    // Set canvas internal size (for rendering) and CSS size (for display)
    canvasElement.width = width * window.devicePixelRatio;
    canvasElement.height = height * window.devicePixelRatio;
    canvasElement.style.width = `${width}px`;
    canvasElement.style.height = `${height}px`;
    
    // Update state variables and renderer with the same dimensions
    canvasWidth = width;
    canvasHeight = height;
    renderer.resize(width, height);
  }
  
  // Convert screen to world coordinates (top-left anchored)
  // This ensures nodes maintain their screen position on resize
  function screenToWorld(screenX: number, screenY: number) {
    const cam = graphStore.camera;
    const worldX = screenX / cam.zoom - cam.x;
    const worldY = screenY / cam.zoom - cam.y;
    return { x: worldX, y: worldY };
  }

  // Convert world to screen coordinates (top-left anchored)
  function worldToScreen(worldX: number, worldY: number) {
    const cam = graphStore.camera;
    return {
      x: (worldX + cam.x) * cam.zoom,
      y: (worldY + cam.y) * cam.zoom,
    };
  }
  
  // Zoom to fit all nodes in view (top-left anchored)
  function zoomToFit() {
    const nodes = Array.from(graphStore.nodes.values());
    if (nodes.length === 0) {
      // No nodes, reset to default view with some offset so origin isn't at corner
      graphStore.setCamera({ x: 100, y: 100, zoom: 1 });
      return;
    }
    
    // Get viewport dimensions - use renderer's actual size if available
    const viewport = renderer?.getViewportSize();
    const viewportWidth = viewport?.width || canvasWidth || 1000;
    const viewportHeight = viewport?.height || canvasHeight || 600;
    
    // Calculate bounding box of all nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    nodes.forEach(node => {
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });
    
    // Add generous padding around content
    const padding = 80;
    const contentWidth = (maxX - minX) + padding * 2;
    const contentHeight = (maxY - minY) + padding * 2;
    
    // Calculate zoom to fit content (cap between 0.1 and 1.5 for comfortable viewing)
    const zoomX = viewportWidth / contentWidth;
    const zoomY = viewportHeight / contentHeight;
    const finalZoom = Math.max(0.1, Math.min(zoomX, zoomY, 1.5));
    
    // For top-left anchored coordinates: screenX = (worldX + camX) * zoom
    // To center content: the content's center should appear at viewport center
    // Content center = (minX + maxX) / 2, (minY + maxY) / 2
    // We want: (contentCenterX + camX) * zoom = viewportWidth / 2
    // Solving: camX = viewportWidth / (2 * zoom) - contentCenterX
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    const camX = viewportWidth / (2 * finalZoom) - contentCenterX;
    const camY = viewportHeight / (2 * finalZoom) - contentCenterY;
    
    graphStore.setCamera({ x: camX, y: camY, zoom: finalZoom });
  }
  
  // Hit test nodes (returns topmost hit)
  function hitTestNode(screenX: number, screenY: number): string | null {
    const world = screenToWorld(screenX, screenY);
    
    // Test in reverse order (top-most first)
    const nodeArray = Array.from(graphStore.nodes.values()).reverse();
    
    for (const node of nodeArray) {
      if (
        world.x >= node.x &&
        world.x <= node.x + node.width &&
        world.y >= node.y &&
        world.y <= node.y + node.height
      ) {
        return node.id;
      }
    }
    return null;
  }
  
  // Hit test for edge endpoints - returns edge info if clicking near an endpoint
  function hitTestEdgeEndpoint(
    worldX: number, 
    worldY: number, 
    threshold: number = 15
  ): { edgeId: string; endpoint: 'source' | 'target'; fixedEnd: { x: number; y: number } } | null {
    for (const [edgeId, edge] of graphStore.edges) {
      const sourceNode = graphStore.nodes.get(edge.sourceNodeId);
      const targetNode = graphStore.nodes.get(edge.targetNodeId);
      if (!sourceNode || !targetNode) continue;
      
      const sourcePort = getPortPosition(sourceNode, edge.sourcePortId, true);
      const targetPort = getPortPosition(targetNode, edge.targetPortId, false);
      
      if (!sourcePort || !targetPort) continue;
      
      // Check distance to source endpoint
      const dxSource = worldX - sourcePort.x;
      const dySource = worldY - sourcePort.y;
      const distSource = Math.sqrt(dxSource * dxSource + dySource * dySource);
      
      if (distSource <= threshold) {
        return { 
          edgeId, 
          endpoint: 'source', 
          fixedEnd: { x: targetPort.x, y: targetPort.y } 
        };
      }
      
      // Check distance to target endpoint
      const dxTarget = worldX - targetPort.x;
      const dyTarget = worldY - targetPort.y;
      const distTarget = Math.sqrt(dxTarget * dxTarget + dyTarget * dyTarget);
      
      if (distTarget <= threshold) {
        return { 
          edgeId, 
          endpoint: 'target', 
          fixedEnd: { x: sourcePort.x, y: sourcePort.y } 
        };
      }
    }
    return null;
  }
  
  function handleKeyDown(e: KeyboardEvent) {
    // Check if we're in an input field - if so, let browser handle undo/redo
    const target = e.target as HTMLElement;
    const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
    
    // Undo: Cmd/Ctrl + Z (handle first, with highest priority)
    if (e.key === 'z' && (e.metaKey || e.ctrlKey) && !e.shiftKey && !isInInput) {
      e.preventDefault();
      e.stopPropagation();
      graphStore.undo();
      return;
    }
    
    // Redo: Cmd/Ctrl + Shift + Z
    if (e.key === 'z' && (e.metaKey || e.ctrlKey) && e.shiftKey && !isInInput) {
      e.preventDefault();
      e.stopPropagation();
      graphStore.redo();
      return;
    }
    
    // Zoom to fit: Cmd/Ctrl + 1
    if (e.key === '1' && (e.metaKey || e.ctrlKey) && !isInInput) {
      e.preventDefault();
      e.stopPropagation();
      zoomToFit();
      return;
    }
    
    // Zoom in: Cmd/Ctrl + = or Cmd/Ctrl + +
    if ((e.key === '=' || e.key === '+') && (e.metaKey || e.ctrlKey) && !isInInput) {
      e.preventDefault();
      e.stopPropagation();
      graphStore.setCamera({ zoom: Math.min(5, graphStore.camera.zoom * 1.2) });
      return;
    }
    
    // Zoom out: Cmd/Ctrl + -
    if (e.key === '-' && (e.metaKey || e.ctrlKey) && !isInInput) {
      e.preventDefault();
      e.stopPropagation();
      graphStore.setCamera({ zoom: Math.max(0.1, graphStore.camera.zoom * 0.8) });
      return;
    }
    
    if (e.code === 'Space' && !spacePressed) {
      spacePressed = true;
      e.preventDefault();
    }
    if (e.key === 'Escape') {
      graphStore.deselectAll();
      isDragging = false;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInInput) {
      // Delete selected nodes
      if (graphStore.selectedNodeIds.size > 0) {
        graphStore.selectedNodeIds.forEach(id => graphStore.deleteNode(id));
      }
      // Delete selected edges
      if (graphStore.selectedEdgeIds.size > 0) {
        graphStore.selectedEdgeIds.forEach(id => graphStore.deleteEdge(id));
        graphStore.selectedEdgeIds = new Set();
      }
    }
  }
  
  function handleKeyUp(e: KeyboardEvent) {
    if (e.code === 'Space') {
      spacePressed = false;
    }
  }
  
  function handlePointerDown(e: PointerEvent) {
    e.preventDefault();
    canvasElement.focus();
    
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    // Use the same rect dimensions for coordinate conversions to ensure consistency
    const viewWidth = rect.width;
    const viewHeight = rect.height;
    const world = screenToWorld(screenX, screenY, viewWidth, viewHeight);
    
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    canvasElement.setPointerCapture(e.pointerId);
    marqueeStartWorld = null;
    marqueeStartScreen = null;
    marqueeCurrentWorld = null;
    marqueeCurrentScreen = null;
    
    // Two-finger: always pan/zoom
    if (activePointers.size === 2) {
      mode = 'pan';
      isPanning = true;
      const pointers = Array.from(activePointers.values());
      lastPinchCenter = {
        x: (pointers[0].x + pointers[1].x) / 2,
        y: (pointers[0].y + pointers[1].y) / 2,
      };
      lastPinchDistance = Math.hypot(
        pointers[1].x - pointers[0].x,
        pointers[1].y - pointers[0].y
      );
      return;
    }
    
    // Spacebar held: pan mode
    if (spacePressed) {
      mode = 'pan';
      isPanning = true;
      lastPinchCenter = { x: e.clientX, y: e.clientY };
      return;
    }
    
    // Check for port hit first (start connection)
    for (const node of graphStore.nodes.values()) {
      const portHit = hitTestPort(world.x, world.y, node);
      if (portHit) {
        // Start connection dragging
        isConnecting = true;
        connectionStart = portHit;
        connectionEndWorld = { x: world.x, y: world.y };
        graphStore.deselectAll(); // Deselect nodes when starting connection
        return;
      }
    }
    
    // Check for edge endpoint hit first (to start reconnection drag)
    const endpointHit = hitTestEdgeEndpoint(world.x, world.y);
    if (endpointHit) {
      // Start reconnecting this edge
      isReconnecting = true;
      reconnectingEdgeId = endpointHit.edgeId;
      reconnectingEndpoint = endpointHit.endpoint;
      reconnectFixedEnd = endpointHit.fixedEnd;
      connectionEndWorld = { x: world.x, y: world.y };
      snapTarget = null;
      graphStore.deselectAll();
      graphStore.selectedEdgeIds = new Set([endpointHit.edgeId]);
      return;
    }
    
    // Check for edge hit (select edge)
    if (renderer?.hitTestEdge) {
      const edgeHit = renderer.hitTestEdge(world.x, world.y, graphStore.nodes, graphStore.edges);
      if (edgeHit) {
        if (e.shiftKey) {
          // Add to selection
          const newSet = new Set(graphStore.selectedEdgeIds);
          if (newSet.has(edgeHit)) {
            newSet.delete(edgeHit);
          } else {
            newSet.add(edgeHit);
          }
          graphStore.selectedEdgeIds = newSet;
        } else {
          // Single select
          graphStore.selectedNodeIds = new Set();
          graphStore.selectedEdgeIds = new Set([edgeHit]);
        }
        return;
      }
    }
    
    // Single click: select or drag
    const hitNodeId = hitTestNode(screenX, screenY);
    
    if (hitNodeId) {
      // Shift-click: toggle selection
      if (e.shiftKey) {
        if (graphStore.selectedNodeIds.has(hitNodeId)) {
          // Deselect
          const newSet = new Set(graphStore.selectedNodeIds);
          newSet.delete(hitNodeId);
          graphStore.selectedNodeIds = newSet;
        } else {
          // Add to selection
          graphStore.selectNode(hitNodeId, true);
        }
      } else {
        // Regular click: select only this node (unless already selected)
        if (!graphStore.selectedNodeIds.has(hitNodeId)) {
          graphStore.selectNode(hitNodeId, false);
        }
      }
      
      // Start dragging all selected nodes if at least one remains selected
      if (graphStore.selectedNodeIds.size > 0) {
        mode = 'drag';
        isDragging = true;
        
        const world = screenToWorld(screenX, screenY, viewWidth, viewHeight);
        dragStartWorld = { x: world.x, y: world.y };
        
        // Store initial positions of all selected nodes
        dragNodeStartPositions.clear();
        graphStore.selectedNodeIds.forEach(id => {
          const node = graphStore.getNodeById(id);
          if (node) {
            dragNodeStartPositions.set(id, { x: node.x, y: node.y });
          }
        });
      } else {
        mode = 'select';
        isDragging = false;
      }
    } else {
      // Clicked empty space: start potential marquee select
      mode = 'select';
      isDragging = false;
      marqueeAdditive = e.shiftKey;
      initialSelection = new Set(graphStore.selectedNodeIds);
      marqueeStartScreen = { x: screenX, y: screenY };
      marqueeStartWorld = screenToWorld(screenX, screenY, viewWidth, viewHeight);
      marqueeCurrentScreen = null;
      marqueeCurrentWorld = null;
    }
  }
  
  function handlePointerMove(e: PointerEvent) {
    if (!activePointers.has(e.pointerId)) return;
    
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    // Use the same rect dimensions for coordinate conversions
    const viewWidth = rect.width;
    const viewHeight = rect.height;
    const world = screenToWorld(screenX, screenY, viewWidth, viewHeight);
    
    // Connection dragging
    if (isConnecting && connectionStart) {
      connectionEndWorld = { x: world.x, y: world.y };
      
      // Find nearest compatible port to snap to
      const lookingForOutput = !connectionStart.isOutput; // If we started from output, look for input
      const nearest = findNearestPort(
        world.x, 
        world.y, 
        graphStore.nodes, 
        lookingForOutput,
        connectionStart.nodeId, // Exclude source node
        40 // Snap distance
      );
      
      // Check port compatibility
      if (nearest && arePortsCompatible(
        connectionStart.isOutput ? connectionStart.type : nearest.type,
        connectionStart.isOutput ? nearest.type : connectionStart.type
      )) {
        snapTarget = nearest;
      } else {
        snapTarget = null;
      }
      
      return;
    }
    
    // Edge reconnection dragging
    if (isReconnecting && reconnectingEdgeId && reconnectFixedEnd) {
      connectionEndWorld = { x: world.x, y: world.y };
      
      // Find nearest compatible port to snap to
      const lookingForOutput = reconnectingEndpoint === 'source'; // If dragging source, look for output
      const edge = graphStore.edges.get(reconnectingEdgeId);
      const excludeNodeId = reconnectingEndpoint === 'source' 
        ? edge?.targetNodeId 
        : edge?.sourceNodeId;
      
      const nearest = findNearestPort(
        world.x, 
        world.y, 
        graphStore.nodes, 
        lookingForOutput,
        excludeNodeId, // Exclude the node at the other end
        40 // Snap distance
      );
      
      snapTarget = nearest || null;
      return;
    }
    
    // Two-finger pan/zoom
    if (activePointers.size === 2 && mode === 'pan') {
      const pointers = Array.from(activePointers.values());
      const currentCenter = {
        x: (pointers[0].x + pointers[1].x) / 2,
        y: (pointers[0].y + pointers[1].y) / 2,
      };
      const currentDistance = Math.hypot(
        pointers[1].x - pointers[0].x,
        pointers[1].y - pointers[0].y
      );
      
      const dx = currentCenter.x - lastPinchCenter.x;
      const dy = currentCenter.y - lastPinchCenter.y;
      const zoomFactor = currentDistance / lastPinchDistance;
      const newZoom = Math.max(0.1, Math.min(5, graphStore.camera.zoom * zoomFactor));
      
      graphStore.setCamera({
        x: graphStore.camera.x + dx / graphStore.camera.zoom,
        y: graphStore.camera.y + dy / graphStore.camera.zoom,
        zoom: newZoom,
      });
      
      lastPinchCenter = currentCenter;
      lastPinchDistance = currentDistance;
      return;
    }
    
    // Single-finger pan (spacebar held)
    if (mode === 'pan' && isPanning && activePointers.size === 1) {
      const dx = e.clientX - lastPinchCenter.x;
      const dy = e.clientY - lastPinchCenter.y;
      
      graphStore.setCamera({
        x: graphStore.camera.x + dx / graphStore.camera.zoom,
        y: graphStore.camera.y + dy / graphStore.camera.zoom,
      });
      
      lastPinchCenter = { x: e.clientX, y: e.clientY };
      return;
    }
    
    // Begin marquee selection when dragging on empty space
    if (
      mode === 'select' &&
      !isDragging &&
      marqueeStartScreen &&
      marqueeStartWorld
    ) {
      const distance = Math.hypot(
        screenX - marqueeStartScreen.x,
        screenY - marqueeStartScreen.y
      );
      if (distance > 4) {
        mode = 'marquee';
        marqueeCurrentScreen = { x: screenX, y: screenY };
        marqueeCurrentWorld = screenToWorld(screenX, screenY, viewWidth, viewHeight);
      }
    }
    
    // Update marquee selection live
    if (mode === 'marquee' && marqueeStartWorld) {
      marqueeCurrentScreen = { x: screenX, y: screenY };
      marqueeCurrentWorld = screenToWorld(screenX, screenY, viewWidth, viewHeight);
      
      const ids = getNodesInRect(
        marqueeStartWorld.x,
        marqueeStartWorld.y,
        marqueeCurrentWorld.x,
        marqueeCurrentWorld.y,
        graphStore.nodes
      );
      
      const newSelection = marqueeAdditive ? new Set(initialSelection) : new Set<string>();
      ids.forEach(id => newSelection.add(id));
      graphStore.selectedNodeIds = newSelection;
      return;
    }
    
    // Drag selected nodes
    if (mode === 'drag' && isDragging && graphStore.selectedNodeIds.size > 0) {
      const world = screenToWorld(screenX, screenY, viewWidth, viewHeight);
      const deltaX = world.x - dragStartWorld.x;
      const deltaY = world.y - dragStartWorld.y;
      
      // Move all selected nodes by the same delta
      dragNodeStartPositions.forEach((startPos, nodeId) => {
        graphStore.updateNode(nodeId, {
          x: startPos.x + deltaX,
          y: startPos.y + deltaY,
        });
      });
    }
  }
  
  function handlePointerUp(e: PointerEvent) {
    activePointers.delete(e.pointerId);
    canvasElement.releasePointerCapture(e.pointerId);
    
    // Complete connection
    if (isConnecting && connectionStart) {
      if (snapTarget) {
        // Create the edge
        const sourceNodeId = connectionStart.isOutput ? connectionStart.nodeId : snapTarget.nodeId;
        const sourcePortId = connectionStart.isOutput ? connectionStart.portId : snapTarget.portId;
        const targetNodeId = connectionStart.isOutput ? snapTarget.nodeId : connectionStart.nodeId;
        const targetPortId = connectionStart.isOutput ? snapTarget.portId : connectionStart.portId;
        
        graphStore.addEdge(sourceNodeId, sourcePortId, targetNodeId, targetPortId);
      }
      
      // Reset connection state
      isConnecting = false;
      connectionStart = null;
      connectionEndWorld = null;
      snapTarget = null;
      return;
    }
    
    // Complete reconnection
    if (isReconnecting && reconnectingEdgeId) {
      const oldEdge = graphStore.edges.get(reconnectingEdgeId);
      
      if (snapTarget && oldEdge) {
        // Delete old edge and create new one
        graphStore.deleteEdge(reconnectingEdgeId);
        
        // Create new edge with the new endpoint
        if (reconnectingEndpoint === 'source') {
          // We were dragging the source endpoint, so snap target is the new source
          graphStore.addEdge(
            snapTarget.nodeId, 
            snapTarget.portId, 
            oldEdge.targetNodeId, 
            oldEdge.targetPortId
          );
        } else {
          // We were dragging the target endpoint, so snap target is the new target
          graphStore.addEdge(
            oldEdge.sourceNodeId, 
            oldEdge.sourcePortId, 
            snapTarget.nodeId, 
            snapTarget.portId
          );
        }
      } else {
        // No snap target - delete the edge (dragged into empty space)
        graphStore.deleteEdge(reconnectingEdgeId);
      }
      
      // Reset reconnection state
      isReconnecting = false;
      reconnectingEdgeId = null;
      reconnectingEndpoint = null;
      reconnectFixedEnd = null;
      connectionEndWorld = null;
      snapTarget = null;
      graphStore.selectedEdgeIds = new Set();
      return;
    }
    
    // Finalize marquee selection
    if (mode === 'marquee') {
      mode = 'select';
      marqueeStartWorld = null;
      marqueeStartScreen = null;
      marqueeCurrentWorld = null;
      marqueeCurrentScreen = null;
      marqueeAdditive = false;
      initialSelection = new Set();
      return;
    }
    
    // If we clicked empty space without marquee and without shift, deselect
    if (
      activePointers.size === 0 &&
      !isDragging &&
      marqueeStartScreen &&
      !marqueeCurrentScreen &&
      !e.shiftKey
    ) {
      graphStore.deselectAll();
    }
    
    if (activePointers.size === 0) {
      // Record move action for undo before clearing positions
      if (isDragging && dragNodeStartPositions.size > 0) {
        const moves: Array<{ id: string; fromX: number; fromY: number; toX: number; toY: number }> = [];
        dragNodeStartPositions.forEach((startPos, id) => {
          const node = graphStore.getNodeById(id);
          if (node) {
            moves.push({
              id,
              fromX: startPos.x,
              fromY: startPos.y,
              toX: node.x,
              toY: node.y,
            });
          }
        });
        graphStore.recordMove(moves);
      }
      
      mode = 'select';
      isPanning = false;
      isDragging = false;
      dragNodeStartPositions.clear();
      marqueeStartWorld = null;
      marqueeStartScreen = null;
      marqueeCurrentWorld = null;
      marqueeCurrentScreen = null;
      marqueeAdditive = false;
      initialSelection = new Set();
    }
  }
  
  function handlePointerCancel(e: PointerEvent) {
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      mode = 'select';
      isPanning = false;
      isDragging = false;
      isConnecting = false;
      isReconnecting = false;
      reconnectingEdgeId = null;
      reconnectingEndpoint = null;
      reconnectFixedEnd = null;
      connectionStart = null;
      connectionEndWorld = null;
      snapTarget = null;
      marqueeStartWorld = null;
      marqueeStartScreen = null;
      marqueeCurrentWorld = null;
      marqueeCurrentScreen = null;
      marqueeAdditive = false;
      initialSelection = new Set();
    }
  }
  
  function handleWheel(e: WheelEvent) {
    e.preventDefault();
    
    // Use the same rect for mouse position and dimensions
    const rect = canvasElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    
    // Trackpad pan (no ctrl, has deltaX)
    if (!e.ctrlKey && Math.abs(e.deltaX) > 0) {
      graphStore.setCamera({
        x: graphStore.camera.x - e.deltaX / graphStore.camera.zoom,
        y: graphStore.camera.y - e.deltaY / graphStore.camera.zoom,
      });
      return;
    }
    
    // Zoom (ctrl key or scroll wheel)
    const zoomIntensity = e.ctrlKey ? 0.01 : 0.002;
    const zoomDelta = -e.deltaY * zoomIntensity;
    const zoomFactor = Math.exp(zoomDelta);
    const newZoom = Math.max(0.1, Math.min(5, graphStore.camera.zoom * zoomFactor));
    
    // Zoom towards mouse (top-left anchored)
    // The point under the mouse should stay fixed during zoom
    const cam = graphStore.camera;
    // World position under mouse before zoom
    const worldXBefore = mouseX / cam.zoom - cam.x;
    const worldYBefore = mouseY / cam.zoom - cam.y;
    // After zoom, we want the same world position under mouse
    // mouseX = (worldX + newCamX) * newZoom
    // newCamX = mouseX / newZoom - worldX
    const newCamX = mouseX / newZoom - worldXBefore;
    const newCamY = mouseY / newZoom - worldYBefore;
    
    graphStore.setCamera({
      x: newCamX,
      y: newCamY,
      zoom: newZoom,
    });
  }
  
  function handleContextMenu(e: MouseEvent) {
    e.preventDefault();
  }
  
  function handleMouseMove(e: MouseEvent) {
    // Only track hover when not dragging or panning
    if (isDragging || isPanning || mode === 'marquee' || isConnecting) {
      hoveredNodeId = null;
      hoveredEdgeId = null;
      return;
    }
    
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY, rect.width, rect.height);
    
    // Check for node hover first
    const hitNodeId = hitTestNode(screenX, screenY);
    hoveredNodeId = hitNodeId;
    
    // Check for edge hover if no node hit
    if (!hitNodeId && renderer?.hitTestEdge) {
      const edgeHit = renderer.hitTestEdge(world.x, world.y, graphStore.nodes, graphStore.edges);
      hoveredEdgeId = edgeHit;
    } else {
      hoveredEdgeId = null;
    }
  }
  
  function handleMouseLeave() {
    hoveredNodeId = null;
    hoveredEdgeId = null;
  }
  
  function handleDoubleClick(e: MouseEvent) {
    // Double-click is reserved for future use (e.g., edit node label)
    // Node creation is only via sidebar or Add Node button
    e.preventDefault();
  }
  
  // Drag and drop handlers for images
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if the drag contains files (images), sidebar images, or models
    if (e.dataTransfer?.types.includes('Files') || 
        e.dataTransfer?.types.includes('application/x-sidebar-image') ||
        e.dataTransfer?.types.includes('application/x-sidebar-model')) {
      e.dataTransfer.dropEffect = 'copy';
      isDragOver = true;
    }
  }
  
  function handleDragLeave(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = false;
  }
  
  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    isDragOver = false;
    
    // Get drop position
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const dropWorld = screenToWorld(screenX, screenY);
    
    // Check if it's a sidebar model drop
    const sidebarModelData = e.dataTransfer?.getData('application/x-sidebar-model');
    if (sidebarModelData) {
      try {
        const { path, name, type, size } = JSON.parse(sidebarModelData);
        addModelNode(path, name, type, size, dropWorld.x, dropWorld.y);
      } catch (error) {
        console.error('Error processing sidebar model drop:', error);
      }
      return;
    }
    
    // Check if it's a sidebar image drop
    const sidebarImageData = e.dataTransfer?.getData('application/x-sidebar-image');
    if (sidebarImageData) {
      try {
        const { path, name } = JSON.parse(sidebarImageData);
        await addImageNodeFromPath(path, name, dropWorld.x, dropWorld.y, 0);
      } catch (error) {
        console.error('Error processing sidebar image drop:', error);
      }
      return;
    }
    
    // Handle file drops from desktop
    const files = e.dataTransfer?.files;
    if (!files || files.length === 0) return;
    
    // Process each dropped file
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      if (!file.type.startsWith('image/')) continue;
      
      try {
        // Save file to input directory and get the server path
        const fileInfo = await uploadFile('input', file);
        if (!fileInfo) {
          console.error('Failed to upload file:', file.name);
          continue;
        }
        
        await addImageNodeFromPath(fileInfo.path, fileInfo.name, dropWorld.x, dropWorld.y, index);
        
        // Dispatch event to notify sidebar of new file
        window.dispatchEvent(new CustomEvent('files-changed', { detail: { directory: 'input' } }));
      } catch (error) {
        console.error('Error processing dropped file:', error);
      }
    }
  }
  
  // Helper function to add a model node
  function addModelNode(
    modelPath: string,
    modelName: string,
    modelType: string,
    modelSize: number,
    worldX: number,
    worldY: number
  ) {
    const nodeWidth = NODE_SIZE;
    const nodeHeight = NODE_SIZE * 0.6; // Models are shorter/wider
    
    const x = worldX - nodeWidth / 2;
    const y = worldY - nodeHeight / 2;
    
    const newId = graphStore.addNode(
      'model',
      x,
      y,
      {
        modelPath,
        modelName,
        modelType,
        modelSize,
      },
      nodeWidth,
      nodeHeight
    );
    
    // Track for fade-in animation
    newlyAddedNodeIds = new Set(newlyAddedNodeIds).add(newId);
    
    setTimeout(() => {
      const updated = new Set(newlyAddedNodeIds);
      updated.delete(newId);
      newlyAddedNodeIds = updated;
    }, 100);
    
    graphStore.selectNode(newId, false);
  }
  
  // Helper function to add an image node from a path
  async function addImageNodeFromPath(
    imagePath: string, 
    filename: string, 
    worldX: number, 
    worldY: number, 
    index: number
  ) {
    // Create an image to get dimensions
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = imagePath;
    });
    
    const originalWidth = img.width;
    const originalHeight = img.height;
    const aspectRatio = originalWidth / originalHeight;
    
    // Resize based on orientation
    let nodeWidth: number;
    let nodeHeight: number;
    
    if (originalHeight > originalWidth) {
      // Vertical (portrait) - width matches NODE_SIZE
      nodeWidth = NODE_SIZE;
      nodeHeight = NODE_SIZE / aspectRatio;
    } else {
      // Horizontal (landscape) or square - height matches NODE_SIZE
      nodeHeight = NODE_SIZE;
      nodeWidth = NODE_SIZE * aspectRatio;
    }
    
    // Calculate position centered on drop point, with offset for multiple files
    const offsetX = index * 20;
    const offsetY = index * 20;
    const x = worldX - nodeWidth / 2 + offsetX;
    const y = worldY - nodeHeight / 2 + offsetY;
    
    // Add the image node
    const newId = graphStore.addNode(
      'image',
      x,
      y,
      {
        imageUrl: imagePath,
        filename,
        originalWidth,
        originalHeight,
      },
      nodeWidth,
      nodeHeight
    );
    
    // Track for fade-in animation
    newlyAddedNodeIds = new Set(newlyAddedNodeIds).add(newId);
    
    // Remove from newly added after animation completes
    setTimeout(() => {
      const updated = new Set(newlyAddedNodeIds);
      updated.delete(newId);
      newlyAddedNodeIds = updated;
    }, 100);
    
    // Select the new node
    graphStore.selectNode(newId, index > 0);
  }
  
  // Cursor based on state
  let cursorClass = $derived(
    isPanning
      ? 'panning'
      : isDragging
        ? 'dragging'
        : isConnecting || isReconnecting
          ? 'connecting'
          : mode === 'marquee'
            ? 'marquee'
            : spacePressed
              ? 'pan-ready'
              : hoveredEdgeId
                ? 'edge-hover'
                : ''
  );

  // Screen-space bounds for current selection (used for overlay)
  // Uses renderer's worldToScreen to ensure consistency with rendered node positions
  let selectionBounds = $derived.by(() => {
    if (graphStore.selectedNodeIds.size === 0 || !renderer) return null;
    // Track viewport for reactivity (needed because renderer.resize() doesn't change reference)
    void canvasWidth; void canvasHeight;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    graphStore.selectedNodeIds.forEach(id => {
      const node = graphStore.getNodeById(id);
      if (!node) return;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });
    
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return null;
    }
    
    // Use renderer's worldToScreen to ensure consistency with rendered positions
    const topLeft = renderer.worldToScreen(minX, minY, graphStore.camera);
    const bottomRight = renderer.worldToScreen(maxX, maxY, graphStore.camera);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  });
  
  // Screen-space bounds for hovered node (only if not already selected)
  let hoverBounds = $derived.by(() => {
    if (!hoveredNodeId || !renderer) return null;
    // Track viewport for reactivity (needed because renderer.resize() doesn't change reference)
    void canvasWidth; void canvasHeight;
    // Don't show hover frame if node is already selected
    if (graphStore.selectedNodeIds.has(hoveredNodeId)) return null;
    
    const node = graphStore.getNodeById(hoveredNodeId);
    if (!node) return null;
    
    const topLeft = renderer.worldToScreen(node.x, node.y, graphStore.camera);
    const bottomRight = renderer.worldToScreen(
      node.x + node.width, 
      node.y + node.height, 
      graphStore.camera
    );
    
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  });
  
  // Image nodes rendered as DOM overlays (works with both WebGPU and Canvas2D)
  // Use $state and $effect for explicit reactivity control
  let imageNodes = $state<Array<{
    id: string;
    imageUrl: string;
    screenX: number;
    screenY: number;
    screenWidth: number;
    screenHeight: number;
    borderRadius: number;
    isNew: boolean;
  }>>([]);
  
  // Model nodes rendered as DOM overlays
  let modelNodes = $state<Array<{
    id: string;
    modelName: string;
    modelType: string;
    modelSize: number;
    screenX: number;
    screenY: number;
    screenWidth: number;
    screenHeight: number;
    borderRadius: number;
    isNew: boolean;
  }>>([]);
  
  // Port overlays computed separately to avoid performance issues
  // Only show ports for hovered/selected nodes or when connecting
  
  // Update imageNodes and modelNodes when nodes or camera changes
  $effect(() => {
    // Read version to track changes - must be called before any early returns
    const version = getNodesVersion();
    const cam = graphStore.camera;
    // Track viewport for reactivity (needed because renderer.resize() doesn't change reference)
    void canvasWidth; void canvasHeight;
    
    if (!renderer) {
      imageNodes = [];
      modelNodes = [];
      return;
    }
    
    const allNodes = Array.from(graphStore.nodes.values());
    
    imageNodes = allNodes
      .filter(node => node.type === 'image')
      .map(node => {
        const topLeft = renderer.worldToScreen(node.x, node.y, cam);
        const bottomRight = renderer.worldToScreen(
          node.x + node.width, 
          node.y + node.height, 
          cam
        );
        
        return {
          id: node.id,
          imageUrl: node.params.imageUrl as string,
          screenX: topLeft.x,
          screenY: topLeft.y,
          screenWidth: bottomRight.x - topLeft.x,
          screenHeight: bottomRight.y - topLeft.y,
          borderRadius: 12 * cam.zoom,
          isNew: newlyAddedNodeIds.has(node.id),
        };
      });
    
    modelNodes = allNodes
      .filter(node => node.type === 'model')
      .map(node => {
        const topLeft = renderer.worldToScreen(node.x, node.y, cam);
        const bottomRight = renderer.worldToScreen(
          node.x + node.width, 
          node.y + node.height, 
          cam
        );
        
        return {
          id: node.id,
          modelName: node.params.modelName as string,
          modelType: node.params.modelType as string,
          modelSize: node.params.modelSize as number,
          screenX: topLeft.x,
          screenY: topLeft.y,
          screenWidth: bottomRight.x - topLeft.x,
          screenHeight: bottomRight.y - topLeft.y,
          borderRadius: 12 * cam.zoom,
          isNew: newlyAddedNodeIds.has(node.id),
        };
      });
  });
  
  // Port overlays computed as derived - only for hovered/selected nodes
  let portOverlays = $derived.by(() => {
    if (!renderer) return [];
    // Track viewport for reactivity
    void canvasWidth; void canvasHeight;
    
    const cam = graphStore.camera;
    const selectedIds = graphStore.selectedNodeIds;
    const showAllPorts = isConnecting || isReconnecting;
    
    const ports: Array<{
      nodeId: string;
      portId: string;
      isOutput: boolean;
      type: string;
      screenX: number;
      screenY: number;
      isHighlighted: boolean;
    }> = [];
    
    // Only calculate ports for nodes that need them
    graphStore.nodes.forEach(node => {
      const shouldShowPorts = showAllPorts || selectedIds.has(node.id) || hoveredNodeId === node.id;
      
      if (shouldShowPorts) {
        const positions = getPortPositions(node);
        positions.forEach(port => {
          const screenPos = renderer!.worldToScreen(port.x, port.y, cam);
          ports.push({
            nodeId: port.nodeId,
            portId: port.portId,
            isOutput: port.isOutput,
            type: port.type,
            screenX: screenPos.x,
            screenY: screenPos.y,
            isHighlighted: snapTarget?.nodeId === port.nodeId && snapTarget?.portId === port.portId,
          });
        });
      }
    });
    
    return ports;
  });
  
  // Edge paths for SVG rendering (computed as derived to avoid per-frame recalculation)
  let edgePaths = $derived.by(() => {
    if (!renderer) return [];
    // Track viewport for reactivity
    void canvasWidth; void canvasHeight;
    
    const cam = graphStore.camera;
    const edges = graphStore.edges;
    const nodes = graphStore.nodes;
    
    const paths: Array<{
      id: string;
      d: string;
      isSelected: boolean;
      isHovered: boolean;
    }> = [];
    
    edges.forEach((edge) => {
      const sourceNode = nodes.get(edge.sourceNodeId);
      const targetNode = nodes.get(edge.targetNodeId);
      if (!sourceNode || !targetNode) return;
      
      // Get port positions
      const sourcePort = getPortPosition(sourceNode, edge.sourcePortId, true);
      const targetPort = getPortPosition(targetNode, edge.targetPortId, false);
      
      const x0 = sourcePort?.x ?? (sourceNode.x + sourceNode.width);
      const y0 = sourcePort?.y ?? (sourceNode.y + sourceNode.height / 2);
      const x3 = targetPort?.x ?? targetNode.x;
      const y3 = targetPort?.y ?? (targetNode.y + targetNode.height / 2);
      
      // Convert to screen coordinates
      const start = renderer.worldToScreen(x0, y0, cam);
      const end = renderer.worldToScreen(x3, y3, cam);
      
      // Calculate bezier control points in screen space
      const dx = Math.abs(end.x - start.x);
      const offset = Math.min(Math.max(dx * 0.5, 50), 150);
      
      paths.push({
        id: edge.id,
        d: `M ${start.x} ${start.y} C ${start.x + offset} ${start.y}, ${end.x - offset} ${end.y}, ${end.x} ${end.y}`,
        isSelected: graphStore.selectedEdgeIds.has(edge.id),
        isHovered: hoveredEdgeId === edge.id,
      });
    });
    
    return paths;
  });
  
  // Pending connection path computed as derived
  let pendingConnectionPath = $derived.by(() => {
    if (!renderer) return null;
    // Track viewport for reactivity
    void canvasWidth; void canvasHeight;
    
    const cam = graphStore.camera;
    let startScreen: { x: number; y: number };
    let endScreen: { x: number; y: number };
    
    if (isConnecting && connectionStart && connectionEndWorld) {
      startScreen = renderer.worldToScreen(connectionStart.x, connectionStart.y, cam);
      endScreen = snapTarget 
        ? renderer.worldToScreen(snapTarget.x, snapTarget.y, cam)
        : renderer.worldToScreen(connectionEndWorld.x, connectionEndWorld.y, cam);
    } else if (isReconnecting && reconnectFixedEnd && connectionEndWorld) {
      // For reconnection, show line from fixed end to drag position
      const fixedScreen = renderer.worldToScreen(reconnectFixedEnd.x, reconnectFixedEnd.y, cam);
      const dragScreen = snapTarget 
        ? renderer.worldToScreen(snapTarget.x, snapTarget.y, cam)
        : renderer.worldToScreen(connectionEndWorld.x, connectionEndWorld.y, cam);
      
      if (reconnectingEndpoint === 'target') {
        // Dragging target: fixed end is source
        startScreen = fixedScreen;
        endScreen = dragScreen;
      } else {
        // Dragging source: fixed end is target
        startScreen = dragScreen;
        endScreen = fixedScreen;
      }
    } else {
      return null;
    }
    
    // Calculate bezier control points
    const dx = Math.abs(endScreen.x - startScreen.x);
    const offset = Math.min(Math.max(dx * 0.5, 50), 150);
    
    return {
      d: `M ${startScreen.x} ${startScreen.y} C ${startScreen.x + offset} ${startScreen.y}, ${endScreen.x - offset} ${endScreen.y}, ${endScreen.x} ${endScreen.y}`,
      snapped: snapTarget !== null,
    };
  });
  
  // Update renderer theme when theme changes
  $effect(() => {
    const isDark = theme.isDark;
    if (renderer?.setTheme) {
      renderer.setTheme(isDark);
    }
  });
  
  // Update renderer interaction state
  $effect(() => {
    if (!renderer?.setInteractionState) return;
    
    let pendingConn: { startX: number; startY: number; endX: number; endY: number; isFromOutput: boolean } | null = null;
    
    if (isConnecting && connectionStart && connectionEndWorld) {
      pendingConn = {
        startX: connectionStart.x,
        startY: connectionStart.y,
        endX: snapTarget ? snapTarget.x : connectionEndWorld.x,
        endY: snapTarget ? snapTarget.y : connectionEndWorld.y,
        isFromOutput: connectionStart.isOutput,
      };
    } else if (isReconnecting && reconnectFixedEnd && connectionEndWorld) {
      // For reconnection, show line from fixed end to drag position
      pendingConn = {
        startX: reconnectingEndpoint === 'target' ? reconnectFixedEnd.x : (snapTarget ? snapTarget.x : connectionEndWorld.x),
        startY: reconnectingEndpoint === 'target' ? reconnectFixedEnd.y : (snapTarget ? snapTarget.y : connectionEndWorld.y),
        endX: reconnectingEndpoint === 'target' ? (snapTarget ? snapTarget.x : connectionEndWorld.x) : reconnectFixedEnd.x,
        endY: reconnectingEndpoint === 'target' ? (snapTarget ? snapTarget.y : connectionEndWorld.y) : reconnectFixedEnd.y,
        isFromOutput: reconnectingEndpoint === 'source',
      };
    }
    
    renderer.setInteractionState({
      hoveredNodeId,
      hoveredEdgeId,
      selectedEdgeIds: graphStore.selectedEdgeIds,
      pendingConnection: pendingConn,
    });
  });
</script>

<div 
  class="canvas-container" 
  class:drag-over={isDragOver}
  bind:this={containerElement}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <canvas
    bind:this={canvasElement}
    class={cursorClass}
    tabindex="0"
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
    onpointerleave={handlePointerCancel}
    onwheel={handleWheel}
    oncontextmenu={handleContextMenu}
    ondblclick={handleDoubleClick}
    onmousemove={handleMouseMove}
    onmouseleave={handleMouseLeave}
  ></canvas>
  
  <!-- Image nodes rendered as DOM overlays -->
  {#each imageNodes as img (img.id)}
    <div
      class="image-node-overlay"
      class:fade-in={img.isNew}
      class:empty={!img.imageUrl}
      style={`left: ${img.screenX}px; top: ${img.screenY}px; width: ${img.screenWidth}px; height: ${img.screenHeight}px; border-radius: ${img.borderRadius}px;`}
    >
      {#if img.imageUrl}
        <img 
          src={img.imageUrl} 
          alt="Dropped image"
          draggable="false"
        />
      {:else}
        <div class="image-placeholder">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
          <span>Image</span>
        </div>
      {/if}
    </div>
  {/each}
  
  <!-- Model nodes rendered as DOM overlays -->
  {#each modelNodes as model (model.id)}
    <div
      class="model-node-overlay"
      class:fade-in={model.isNew}
      style={`left: ${model.screenX}px; top: ${model.screenY}px; width: ${model.screenWidth}px; height: ${model.screenHeight}px; border-radius: ${model.borderRadius}px;`}
    >
      <div class="model-node-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L2 7l10 5 10-5-10-5z" />
          <path d="M2 17l10 5 10-5" />
          <path d="M2 12l10 5 10-5" />
        </svg>
      </div>
      <div class="model-node-info">
        <span class="model-node-name">{model.modelName}</span>
        <span class="model-node-type">{model.modelType.toUpperCase()}</span>
      </div>
    </div>
  {/each}
  
  <!-- Port overlays for connection handles -->
  {#each portOverlays as port (`${port.nodeId}-${port.portId}-${port.isOutput}`)}
    <div
      class="port-overlay"
      class:output={port.isOutput}
      class:input={!port.isOutput}
      class:highlighted={port.isHighlighted}
      class:type-image={port.type === 'image'}
      class:type-string={port.type === 'string'}
      class:type-tensor={port.type === 'tensor'}
      class:type-number={port.type === 'number'}
      style={`left: ${port.screenX}px; top: ${port.screenY}px;`}
    ></div>
  {/each}
  
  <!-- Edge connections (as SVG overlay for reliable rendering) -->
  {#if edgePaths.length > 0}
    <svg class="connection-line-overlay">
      {#each edgePaths as edge (edge.id)}
        <path
          d={edge.d}
          class="edge-connection"
          class:selected={edge.isSelected}
          class:hovered={edge.isHovered}
        />
      {/each}
    </svg>
  {/if}
  
  <!-- Pending connection line (as SVG overlay) -->
  {#if pendingConnectionPath}
    <svg class="connection-line-overlay">
      <path
        d={pendingConnectionPath.d}
        class="pending-connection"
        class:snapped={pendingConnectionPath.snapped}
      />
    </svg>
  {/if}
  
  {#if mode === 'marquee' && marqueeStartScreen && marqueeCurrentScreen}
    <div
      class="marquee-rect"
      style={`left: ${Math.min(marqueeStartScreen.x, marqueeCurrentScreen.x)}px; top: ${Math.min(marqueeStartScreen.y, marqueeCurrentScreen.y)}px; width: ${Math.abs(marqueeCurrentScreen.x - marqueeStartScreen.x)}px; height: ${Math.abs(marqueeCurrentScreen.y - marqueeStartScreen.y)}px;`}
    ></div>
  {/if}
  
  {#if hoverBounds}
    <div
      class="hover-bounds"
      style={`left: ${hoverBounds.x}px; top: ${hoverBounds.y}px; width: ${hoverBounds.width}px; height: ${hoverBounds.height}px;`}
    ></div>
  {/if}
  
  {#if selectionBounds}
    <div
      class="selection-bounds"
      style={`left: ${selectionBounds.x}px; top: ${selectionBounds.y}px; width: ${selectionBounds.width}px; height: ${selectionBounds.height}px;`}
    >
      {#each [
        { x: 0, y: 0 },
        { x: 0.5, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 0.5 },
        { x: 1, y: 0.5 },
        { x: 0, y: 1 },
        { x: 0.5, y: 1 },
        { x: 1, y: 1 },
      ] as handle}
        <div
          class="selection-handle"
          style={`left: ${handle.x * 100}%; top: ${handle.y * 100}%; transform: translate(-50%, -50%);`}
        ></div>
      {/each}
    </div>
  {/if}
  
  <div class="canvas-overlay">
    <div class="zoom-indicator">
      {Math.round(graphStore.camera.zoom * 100)}%
    </div>
    {#if rendererType === '2d'}
      <div class="renderer-badge">2D Fallback</div>
    {/if}
  </div>
  
  {#if isDragOver}
    <div class="drop-indicator">
      <div class="drop-icon">📷</div>
      <div class="drop-text">Drop image here</div>
    </div>
  {/if}
</div>

<style>
  .canvas-container {
    flex: 1;
    position: relative;
    overflow: hidden;
    background: var(--bg-primary);
    transition: box-shadow 0.15s ease;
  }
  
  .canvas-container.drag-over {
    box-shadow: inset 0 0 0 3px rgba(99, 102, 241, 0.5);
  }
  
  .canvas-container.drag-over::after {
    content: '';
    position: absolute;
    inset: 0;
    background: rgba(99, 102, 241, 0.08);
    pointer-events: none;
    animation: pulse-overlay 1s ease-in-out infinite;
  }
  
  @keyframes pulse-overlay {
    0%, 100% { opacity: 0.5; }
    50% { opacity: 1; }
  }
  
  canvas {
    display: block;
    touch-action: none;
    cursor: default;
    outline: none;
  }
  
  canvas:focus {
    outline: none;
  }
  
  canvas.dragging {
    cursor: grabbing;
  }
  
  canvas.panning {
    cursor: grabbing;
  }
  
  canvas.pan-ready {
    cursor: grab;
  }
  
  canvas.marquee {
    cursor: crosshair;
  }
  
  canvas.connecting {
    cursor: crosshair;
  }
  
  canvas.edge-hover {
    cursor: pointer;
  }
  
  .port-overlay {
    position: absolute;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 20;
    border: 2px solid var(--bg-primary);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.2);
    transition: transform 0.1s ease, box-shadow 0.1s ease;
  }
  
  .port-overlay.type-image {
    background: #f59e0b;
  }
  
  .port-overlay.type-string {
    background: #10b981;
  }
  
  .port-overlay.type-tensor {
    background: #6366f1;
  }
  
  .port-overlay.type-number {
    background: #3b82f6;
  }
  
  .port-overlay.highlighted {
    background: #ffffff;
    transform: translate(-50%, -50%) scale(1.3);
    box-shadow: 0 0 8px rgba(255, 255, 255, 0.6);
  }
  
  .connection-line-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 15;
  }
  
  .connection-line-overlay {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;
  }
  
  .edge-connection {
    fill: none;
    stroke: rgba(200, 200, 220, 0.6);
    stroke-width: 2;
    stroke-linecap: round;
    pointer-events: visibleStroke;
    cursor: pointer;
    transition: stroke 0.1s ease, stroke-width 0.1s ease;
  }
  
  .edge-connection:hover,
  .edge-connection.hovered {
    stroke: rgba(255, 255, 255, 0.85);
    stroke-width: 2.5;
  }
  
  .edge-connection.selected {
    stroke: #ffffff;
    stroke-width: 3;
  }
  
  .pending-connection {
    fill: none;
    stroke: rgba(255, 255, 255, 0.5);
    stroke-width: 2;
    stroke-dasharray: 8 4;
  }
  
  .pending-connection.snapped {
    stroke: #ffffff;
    stroke-dasharray: none;
  }
  
  .canvas-overlay {
    position: absolute;
    bottom: 16px;
    left: 16px;
    pointer-events: none;
  }
  
  .image-node-overlay {
    position: absolute;
    z-index: 1;
    border-radius: 12px;
    overflow: hidden;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    background: #1a1a1e;
    user-select: none;
    -webkit-user-select: none;
  }
  
  .image-node-overlay img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    pointer-events: none;
  }
  
  .image-node-overlay.empty {
    border: 2px dashed rgba(255, 255, 255, 0.3);
    background: rgba(77, 156, 230, 0.15);
  }
  
  .image-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: rgba(255, 255, 255, 0.5);
  }
  
  .image-placeholder svg {
    width: 48px;
    height: 48px;
    opacity: 0.5;
  }
  
  .image-placeholder span {
    font-size: 12px;
    font-weight: 500;
    opacity: 0.7;
  }
  
  .image-node-overlay.fade-in,
  .model-node-overlay.fade-in {
    animation: node-fade-in 80ms ease-out forwards;
  }
  
  @keyframes node-fade-in {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
  
  .model-node-overlay {
    position: absolute;
    z-index: 1;
    border-radius: 12px;
    overflow: hidden;
    pointer-events: none;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    background: linear-gradient(135deg, #e91e63 0%, #9c27b0 100%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px;
    gap: 8px;
    user-select: none;
    -webkit-user-select: none;
  }
  
  .model-node-icon {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 12px;
  }
  
  .model-node-icon svg {
    width: 28px;
    height: 28px;
    color: white;
  }
  
  .model-node-info {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
    min-width: 0;
    width: 100%;
  }
  
  .model-node-name {
    font-size: 11px;
    font-weight: 600;
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 100%;
    user-select: none;
    -webkit-user-select: none;
  }
  
  .model-node-type {
    font-size: 9px;
    font-weight: 700;
    color: rgba(255, 255, 255, 0.7);
    background: rgba(255, 255, 255, 0.15);
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0.05em;
    user-select: none;
    -webkit-user-select: none;
  }
  
  .marquee-rect {
    position: absolute;
    border: 1px dashed rgba(255, 255, 255, 0.7);
    background: rgba(99, 102, 241, 0.1);
    pointer-events: none;
    border-radius: 4px;
  }
  
  .hover-bounds {
    position: absolute;
    z-index: 9;
    border: 1px solid var(--accent-primary);
    opacity: 0.5;
    pointer-events: none;
    border-radius: 4px;
    animation: hover-frame-in 50ms ease-out forwards;
  }
  
  @keyframes hover-frame-in {
    from {
      opacity: 0;
      transform: scale(0.98);
    }
    to {
      opacity: 0.5;
      transform: scale(1);
    }
  }
  
  .selection-bounds {
    position: absolute;
    z-index: 10;
    border: 1px solid rgba(255, 255, 255, 0.35);
    box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.15);
    pointer-events: none;
  }
  
  .selection-handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: #ffffff;
    border: 1px solid #0f0f11;
    border-radius: 3px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
    pointer-events: none;
  }
  
  .zoom-indicator {
    background: var(--bg-elevated);
    padding: 6px 12px;
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-secondary);
    border: 1px solid var(--border-subtle);
  }
  
  .renderer-badge {
    margin-top: 8px;
    background: rgba(245, 158, 11, 0.15);
    padding: 4px 10px;
    border-radius: var(--radius-sm);
    font-family: var(--font-mono);
    font-size: 10px;
    color: #f59e0b;
    border: 1px solid rgba(245, 158, 11, 0.3);
  }
  
  .drop-indicator {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 32px 48px;
    background: rgba(99, 102, 241, 0.15);
    border: 2px dashed rgba(99, 102, 241, 0.5);
    border-radius: 16px;
    pointer-events: none;
    animation: fade-in 0.15s ease-out;
  }
  
  .drop-icon {
    font-size: 48px;
    opacity: 0.8;
  }
  
  .drop-text {
    font-size: 16px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
    letter-spacing: -0.01em;
  }
  
  @keyframes fade-in {
    from {
      opacity: 0;
      transform: translate(-50%, -50%) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translate(-50%, -50%) scale(1);
    }
  }
</style>
