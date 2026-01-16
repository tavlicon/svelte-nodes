<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { tweened } from 'svelte/motion';
  import { cubicOut } from 'svelte/easing';
  import { CanvasRenderer } from '../canvas/renderer';
  import { Canvas2DRenderer } from '../canvas/renderer-2d';
  import { getNodesInRect, getEdgesInRect } from '../canvas/interaction';
  import { graphStore, getNodesVersion, getGroupsVersion } from '../graph/store.svelte';
  import { executionEngine } from '../orchestration/execution';
  import { theme } from './theme.svelte';
  import { sidebarState, ICON_SIDEBAR_WIDTH } from './sidebarState.svelte';
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
  import { generateGLBThumbnail } from './glb-thumbnail';
  import { getDOMNodeRadius, getDOMBorderWidth, MIN_ZOOM, MAX_ZOOM } from '../canvas/node-style';
  import MeshViewer from './MeshViewer.svelte';
  import CanvasMenu from './CanvasMenu.svelte';
  import GroupMenu from './GroupMenu.svelte';
  
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
  let lastMarqueeBoundsWorld = $state<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  
  // Drag state - stores initial positions
  let dragStartWorld = { x: 0, y: 0 };
  let dragNodeStartPositions = new Map<string, { x: number; y: number }>();
  
  // Grouping state
  type GroupMenuAnchor = { type: 'selection' } | { type: 'group'; groupId: string };
  let groupMenuOpen = $state(false);
  let groupMenuAnchor = $state<GroupMenuAnchor | null>(null);
  let groupMenuPosition = $state({ x: 0, y: 0 });
  let hoveredGroupId = $state<string | null>(null);
  let groupMenuHovered = $state(false);
  let selectedGroupId = $state<string | null>(null);
  let groupDragId = $state<string | null>(null);
  let groupDragStartWorld = { x: 0, y: 0 };
  let groupDragStartScreen = { x: 0, y: 0 };
  let groupDragMoved = $state(false);
  let groupDragStartBounds: { x: number; y: number; width: number; height: number } | null = null;
  let groupMemberStartPositions = new Map<string, { x: number; y: number }>();
  let groupResizeId = $state<string | null>(null);
  let groupResizeStartWorld = { x: 0, y: 0 };
  let groupResizeStartBounds: { x: number; y: number; width: number; height: number } | null = null;
  let groupHoverResizeId = $state<string | null>(null);
  let groupHoveringResize = $state(false);
  
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
  let isOverConnectorIcon = $state<string | null>(null); // Track which node's connector we're hovering
  
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
  
  // Canvas menu state (for connector icon click)
  let menuOpen = $state(false);
  let menuPosition = $state<{ x: number; y: number }>({ x: 0, y: 0 });
  let menuSourceNodeId = $state<string | null>(null);
  let menuSourcePortType = $state<'image' | 'mesh'>('image');
  
  // Default node size for image resizing
  const NODE_SIZE = 200;
  const GROUP_MIN_SIZE = 160;
  const GROUP_DRAG_THRESHOLD = 4;
  const GROUP_TITLE_HEIGHT = 32;
  
  // Click-to-add offset counter - tracks where to place next clicked item
  let clickAddOffset = $state(0);
  const CLICK_ADD_OFFSET_INCREMENT = 30; // Pixels to offset each new item diagonally
  
  onMount(() => {
    initRenderer();
    // Use capture phase to intercept before browser handles ⌘Z
    document.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    
    // Set up tweened camera subscription for smooth zoom animations
    unsubscribeTweenedCamera = tweenedCamera.subscribe(cam => {
      if (isAnimatingCamera) {
        graphStore.setCamera(cam);
      }
    });
    
    // Listen for sidebar click-to-add events
    window.addEventListener('sidebar-add-image', handleSidebarAddImage as EventListener);
    window.addEventListener('sidebar-add-model', handleSidebarAddModel as EventListener);
    window.addEventListener('sidebar-add-triposr', handleSidebarAddTripoSR as EventListener);
    window.addEventListener('sidebar-add-mesh', handleSidebarAddMesh as EventListener);
    
    // Set up execution engine callbacks for UI behaviors
    // This keeps UI logic (timeouts, node selection) in the UI layer
    executionEngine.setCallbacks({
      onModelJobComplete: (modelNodeId: string, outputNodeId: string) => {
        // After showing the "complete" state for 1 second:
        // 1. Reset the model node back to idle state
        // 2. Select the newly created output image node
        setTimeout(() => {
          graphStore.updateNode(modelNodeId, { status: 'idle' });
          graphStore.selectNode(outputNodeId, false);
        }, 1000);
      },
    });
    
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
    
    // Add an image node on the left with a real input image
    const imageId = graphStore.addNode(
      'image',
      -300, -100,
      {
        imageUrl: '/data/input/nike-air-vapormax-platinumjpg-512.jpg',
        filename: 'nike-air-vapormax-platinumjpg-512.jpg',
        originalWidth: 512,
        originalHeight: 512,
      },
      200, 200
    );
    
    // Add a model node on the right
    const modelId = graphStore.addNode(
      'model',
      100, -100,
      {
        modelPath: '/data/models/v1-5-pruned-emaonly-fp16.safetensors',
        modelName: 'SD 1.5',
        modelType: 'safetensors',
        modelSize: 2133874944,
        modelTitle: 'Stable Diffusion v1.5',
        // Add prompts for the test
        positive_prompt: 'a futuristic sneaker, cyberpunk style, neon lights',
        negative_prompt: 'blurry, low quality',
      },
      NODE_SIZE, NODE_SIZE
    );
    
    // Connect image output to model image input
    graphStore.addEdge(imageId, 'image', modelId, 'image');
    
    console.log('✅ Test nodes created and connected');
    console.log('  Image node:', imageId);
    console.log('  Model node:', modelId);
  }
  
  onDestroy(() => {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    unsubscribeTweenedCamera?.();
    resizeObserver?.disconnect();
    renderer?.destroy();
    document.removeEventListener('keydown', handleKeyDown, true);
    window.removeEventListener('keyup', handleKeyUp);
    window.removeEventListener('sidebar-add-image', handleSidebarAddImage as EventListener);
    window.removeEventListener('sidebar-add-model', handleSidebarAddModel as EventListener);
    window.removeEventListener('sidebar-add-triposr', handleSidebarAddTripoSR as EventListener);
    window.removeEventListener('sidebar-add-mesh', handleSidebarAddMesh as EventListener);
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
    
    // Calculate zoom to fit content (cap between MIN_ZOOM and 1.5 for comfortable viewing)
    const zoomX = viewportWidth / contentWidth;
    const zoomY = viewportHeight / contentHeight;
    const finalZoom = Math.max(MIN_ZOOM, Math.min(zoomX, zoomY, 1.5));
    
    // For top-left anchored coordinates: screenX = (worldX + camX) * zoom
    // To center content: the content's center should appear at viewport center
    // Content center = (minX + maxX) / 2, (minY + maxY) / 2
    // We want: (contentCenterX + camX) * zoom = viewportWidth / 2
    // Solving: camX = viewportWidth / (2 * zoom) - contentCenterX
    const contentCenterX = (minX + maxX) / 2;
    const contentCenterY = (minY + maxY) / 2;
    const camX = viewportWidth / (2 * finalZoom) - contentCenterX;
    const camY = viewportHeight / (2 * finalZoom) - contentCenterY;
    
    animateCameraTo({ x: camX, y: camY, zoom: finalZoom }, 400);
  }
  
  // Svelte tweened store for smooth keyboard zoom animations
  const tweenedCamera = tweened(
    { x: 0, y: 0, zoom: 1 },
    { duration: 200, easing: cubicOut }
  );
  
  let isAnimatingCamera = false;
  let unsubscribeTweenedCamera: (() => void) | null = null;
  
  // Animated camera transition for smooth zoom
  function animateCameraTo(
    target: { x?: number; y?: number; zoom?: number },
    duration = 200
  ) {
    const current = {
      x: graphStore.camera.x,
      y: graphStore.camera.y,
      zoom: graphStore.camera.zoom,
    };
    
    isAnimatingCamera = true;
    
    // Initialize to current position first
    tweenedCamera.set(current, { duration: 0 });
    
    // Then animate to target
    tweenedCamera.set(
      {
        x: target.x ?? current.x,
        y: target.y ?? current.y,
        zoom: target.zoom ?? current.zoom,
      },
      { duration }
    ).then(() => {
      isAnimatingCamera = false;
    });
  }
  
  // Hit test nodes (returns topmost hit)
  // extendForHover: when true, extends hit area to right for image/output nodes (for hover detection)
  //                 when false, uses exact node bounds (for click/drag detection)
  function hitTestNode(screenX: number, screenY: number, extendForHover: boolean = true): string | null {
    const world = screenToWorld(screenX, screenY);
    
    // Test in reverse order (top-most first)
    const nodeArray = Array.from(graphStore.nodes.values()).reverse();
    
    for (const node of nodeArray) {
      // Image/output nodes have extended hover area to include connector icon zone
      // But for clicks/drags, we only use the actual node bounds
      const extendRight = extendForHover && (node.type === 'image' || node.type === 'output') ? 40 : 0;
      
      if (
        world.x >= node.x &&
        world.x <= node.x + node.width + extendRight &&
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
      animateCameraTo({ zoom: Math.min(5, graphStore.camera.zoom * 1.2) }, 200);
      return;
    }
    
    // Zoom out: Cmd/Ctrl + -
    if (e.key === '-' && (e.metaKey || e.ctrlKey) && !isInInput) {
      e.preventDefault();
      e.stopPropagation();
      animateCameraTo({ zoom: Math.max(MIN_ZOOM, graphStore.camera.zoom * 0.8) }, 200);
      return;
    }
    
    // Reset zoom: Cmd/Ctrl + 0
    if (e.key === '0' && (e.metaKey || e.ctrlKey) && !isInInput) {
      e.preventDefault();
      e.stopPropagation();
      animateCameraTo({ zoom: 1 }, 250);
      return;
    }
    
    // Toggle left assets sidebar: Cmd/Ctrl + K
    if (e.key === 'k' && (e.metaKey || e.ctrlKey) && !isInInput) {
      e.preventDefault();
      e.stopPropagation();
      sidebarState.isOpen = !sidebarState.isOpen;
      return;
    }
    
    // Duplicate: Cmd/Ctrl + D
    if (e.key === 'd' && (e.metaKey || e.ctrlKey) && !isInInput) {
      e.preventDefault();
      e.stopPropagation();
      if (graphStore.selectedNodeIds.size > 0) {
        graphStore.duplicateSelectedNodes();
      }
      return;
    }
    
    if (e.code === 'Space' && !spacePressed && !isInInput) {
      spacePressed = true;
      e.preventDefault();
    }
    if (e.key === 'Escape') {
      // Close sidebar if open, otherwise deselect all
      if (sidebarState.isOpen) {
        sidebarState.isOpen = false;
      } else {
        graphStore.deselectAll();
        selectedGroupId = null;
        groupMenuOpen = false;
        groupMenuAnchor = null;
      }
      isDragging = false;
      isOverConnectorIcon = null;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !isInInput) {
      if (selectedGroupId) {
        graphStore.deleteGroup(selectedGroupId);
        selectedGroupId = null;
      }
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
    
    // Close menu and block interactions when clicking canvas while menu open
    if (menuOpen) {
      handleMenuClose();
      return;
    }
    
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    
    // Check if click is inside any group bounds
    const groupsAtClick: string[] = [];
    for (const gs of groupSections) {
      if (screenX >= gs.screenX && screenX <= gs.screenX + gs.screenWidth && screenY >= gs.screenY && screenY <= gs.screenY + gs.screenHeight) {
        groupsAtClick.push(gs.id);
      }
    }
    
    if (groupMenuOpen && groupMenuAnchor?.type === 'selection') {
      groupMenuOpen = false;
      groupMenuAnchor = null;
    }
    // Only clear selectedGroupId if clicking outside the group
    if (groupsAtClick.length === 0) {
      selectedGroupId = null;
      groupMenuAnchor = null;
    }
    lastMarqueeBoundsWorld = null;
    
    // Use the same rect dimensions for coordinate conversions to ensure consistency
    const viewWidth = rect.width;
    const viewHeight = rect.height;
    const world = screenToWorld(screenX, screenY, viewWidth, viewHeight);
    
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    containerElement.setPointerCapture(e.pointerId);
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
      const portHit = hitTestPort(world.x, world.y, node, 12);
      if (portHit) {
        // Image/output nodes use the plus icon for OUTPUT connections,
        // so skip output port hits on these nodes - only allow input port hits
        if ((node.type === 'image' || node.type === 'output') && portHit.isOutput) {
          continue; // Skip - the plus icon handles output connections for these nodes
        }
        
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
    // Use exact node bounds (extendForHover=false) so clicks in the connector zone
    // don't trigger node drag - only clicks on the actual node do
    const hitNodeId = hitTestNode(screenX, screenY, false);
    
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
      
      // Close left sidebar when clicking on empty canvas
      if (sidebarState.isOpen) {
        sidebarState.isOpen = false;
      }
    }
  }

  function handleGroupSelect(groupId: string) {
    const group = graphStore.groups.get(groupId);
    if (!group) return;
    selectedGroupId = groupId;
    graphStore.deselectAll();
  }


  function handleGroupPointerDown(e: PointerEvent, groupId: string) {
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const hitNodeId = hitTestNode(screenX, screenY, false);
    if (hitNodeId) {
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    const group = graphStore.groups.get(groupId);
    if (!group) return;
    
    handleGroupSelect(groupId);
    
    groupDragStartScreen = { x: screenX, y: screenY };
    groupDragStartWorld = screenToWorld(screenX, screenY);
    groupDragStartBounds = { x: group.x, y: group.y, width: group.width, height: group.height };
    groupDragId = groupId;
    groupDragMoved = false;
    
    groupMemberStartPositions.clear();
    group.memberIds.forEach(id => {
      const node = graphStore.getNodeById(id);
      if (node) {
        groupMemberStartPositions.set(id, { x: node.x, y: node.y });
      }
    });
    
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    containerElement.setPointerCapture(e.pointerId);
  }

  function handleGroupResizeStart(e: PointerEvent, groupId: string) {
    e.preventDefault();
    e.stopPropagation();
    
    const group = graphStore.groups.get(groupId);
    if (!group) return;
    handleGroupSelect(groupId);
    
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    groupResizeStartWorld = screenToWorld(screenX, screenY);
    groupResizeStartBounds = { x: group.x, y: group.y, width: group.width, height: group.height };
    groupResizeId = groupId;
    
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    containerElement.setPointerCapture(e.pointerId);
  }

  function handleGroupPointerMove(e: PointerEvent, groupId: string) {
    const target = e.currentTarget as HTMLDivElement;
    const rect = target.getBoundingClientRect();
    const edgeThreshold = 6;
    const offsetX = e.clientX - rect.left;
    const offsetY = e.clientY - rect.top;
    const nearEdge =
      offsetX <= edgeThreshold ||
      offsetY <= edgeThreshold ||
      rect.width - offsetX <= edgeThreshold ||
      rect.height - offsetY <= edgeThreshold;
    
    groupHoverResizeId = groupId;
    groupHoveringResize = nearEdge;
    canvasElement.style.cursor = nearEdge ? 'nwse-resize' : 'grab';
  }

  function handleGroupPointerLeave(groupId: string) {
    if (groupHoverResizeId === groupId) {
      groupHoverResizeId = null;
      groupHoveringResize = false;
      canvasElement.style.cursor = '';
    }
  }

  function handleCreateGroup() {
    const selectedImageIds = getSelectedImageIds();
    if (selectedImageIds.length < 2) {
      groupMenuOpen = false;
      groupMenuAnchor = null;
      return;
    }
    
    const groupMembers = lastMarqueeBoundsWorld
      ? getImageNodesInBounds(lastMarqueeBoundsWorld)
      : selectedImageIds;
    
    if (groupMembers.length < 2) {
      groupMenuOpen = false;
      groupMenuAnchor = null;
      return;
    }
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    groupMembers.forEach(id => {
      const node = graphStore.getNodeById(id);
      if (!node) return;
      minX = Math.min(minX, node.x);
      minY = Math.min(minY, node.y);
      maxX = Math.max(maxX, node.x + node.width);
      maxY = Math.max(maxY, node.y + node.height);
    });
    
    if (!isFinite(minX) || !isFinite(minY) || !isFinite(maxX) || !isFinite(maxY)) {
      return;
    }
    
    const padding = 16;
    const name = `Group ${graphStore.groups.size + 1}`;
    const groupId = graphStore.addGroup(
      minX - padding,
      minY - padding,
      maxX - minX + padding * 2,
      maxY - minY + padding * 2,
      groupMembers,
      name
    );
    
    selectedGroupId = groupId;
    graphStore.deselectAll();
    groupMenuAnchor = null;
    groupMenuOpen = false;
    lastMarqueeBoundsWorld = null;
  }

  function handleUngroup() {
    if (!selectedGroupId) return;
    graphStore.deleteGroup(selectedGroupId);
    selectedGroupId = null;
    groupMenuOpen = false;
    groupMenuAnchor = null;
    hoveredGroupId = null;
  }

  function handleGroupMenuClose() {
    groupMenuOpen = false;
    if (groupMenuAnchor?.type === 'selection') {
      groupMenuAnchor = null;
    }
  }
  
  function handlePointerMove(e: PointerEvent) {
    if (!activePointers.has(e.pointerId)) return;
    
    // Handle connector icon drag (detect threshold to start connection)
    if (connectorDragStart && connectionStart && !isConnecting) {
      const dx = e.clientX - connectorDragStart.x;
      const dy = e.clientY - connectorDragStart.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance > DRAG_THRESHOLD) {
        // Start connection mode
        isConnecting = true;
        graphStore.deselectAll();
      }
      return; // Don't process other move logic until drag threshold exceeded
    }
    
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    // Use the same rect dimensions for coordinate conversions
    const viewWidth = rect.width;
    const viewHeight = rect.height;
    const world = screenToWorld(screenX, screenY, viewWidth, viewHeight);

    if (groupResizeId && groupResizeStartBounds) {
      const deltaX = world.x - groupResizeStartWorld.x;
      const deltaY = world.y - groupResizeStartWorld.y;
      const nextWidth = Math.max(GROUP_MIN_SIZE, groupResizeStartBounds.width + deltaX);
      const nextHeight = Math.max(GROUP_MIN_SIZE, groupResizeStartBounds.height + deltaY);
      graphStore.updateGroup(groupResizeId, {
        width: nextWidth,
        height: nextHeight,
      });
      return;
    }
    
    if (groupDragId && groupDragStartBounds) {
      const distance = Math.hypot(
        screenX - groupDragStartScreen.x,
        screenY - groupDragStartScreen.y
      );
      if (!groupDragMoved && distance < GROUP_DRAG_THRESHOLD) {
        return;
      }
      groupDragMoved = true;
      const deltaX = world.x - groupDragStartWorld.x;
      const deltaY = world.y - groupDragStartWorld.y;
      
      graphStore.updateGroup(groupDragId, {
        x: groupDragStartBounds.x + deltaX,
        y: groupDragStartBounds.y + deltaY,
      });
      
      groupMemberStartPositions.forEach((startPos, nodeId) => {
        graphStore.updateNode(nodeId, {
          x: startPos.x + deltaX,
          y: startPos.y + deltaY,
        });
      });
      return;
    }
    
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

    if (!isDragging && !isConnecting && !groupDragId && !groupResizeId) {
      hoveredGroupId = getHoveredGroupId(screenX, screenY);
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
      const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, graphStore.camera.zoom * zoomFactor));
      
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
    
    // Update marquee selection live (nodes and edges)
    if (mode === 'marquee' && marqueeStartWorld) {
      marqueeCurrentScreen = { x: screenX, y: screenY };
      marqueeCurrentWorld = screenToWorld(screenX, screenY, viewWidth, viewHeight);
      
      // Select nodes in rect
      const nodeIds = getNodesInRect(
        marqueeStartWorld.x,
        marqueeStartWorld.y,
        marqueeCurrentWorld.x,
        marqueeCurrentWorld.y,
        graphStore.nodes
      );
      
      // Select edges in rect
      const edgeIds = getEdgesInRect(
        marqueeStartWorld.x,
        marqueeStartWorld.y,
        marqueeCurrentWorld.x,
        marqueeCurrentWorld.y,
        graphStore.edges,
        graphStore.nodes
      );
      
      const newNodeSelection = marqueeAdditive ? new Set(initialSelection) : new Set<string>();
      nodeIds.forEach(id => newNodeSelection.add(id));
      graphStore.selectedNodeIds = newNodeSelection;
      
      // For edges, we don't track initial edge selection for additive mode currently
      graphStore.selectedEdgeIds = new Set(edgeIds);
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
    containerElement.releasePointerCapture(e.pointerId);

    if (groupResizeId) {
      if (groupResizeStartBounds) {
        const group = graphStore.groups.get(groupResizeId);
        if (group) {
          graphStore.recordGroupChange(
            groupResizeId,
            { ...group, ...groupResizeStartBounds },
            group
          );
        }
      }
      groupResizeId = null;
      groupResizeStartBounds = null;
      canvasElement.style.cursor = '';
      return;
    }
    
    if (groupDragId) {
      if (groupDragMoved && groupDragStartBounds) {
        const group = graphStore.groups.get(groupDragId);
        if (group) {
          graphStore.recordGroupChange(
            groupDragId,
            { ...group, ...groupDragStartBounds },
            group
          );
        }
      }
      groupDragId = null;
      groupDragStartBounds = null;
      groupMemberStartPositions.clear();
      groupDragMoved = false;
      canvasElement.style.cursor = '';
      return;
    }
    
    // Handle connector icon click (didn't drag far enough to start connection)
    if (connectorDragStart && !isConnecting) {
      const dx = e.clientX - connectorDragStart.x;
      const dy = e.clientY - connectorDragStart.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= DRAG_THRESHOLD) {
        // It was a click - open the menu
        const node = graphStore.getNodeById(connectorDragStart.nodeId);
        if (node) {
          const rect = containerElement.getBoundingClientRect();
          menuPosition = { 
            x: e.clientX - rect.left + 8, 
            y: e.clientY - rect.top - 28
          };
          menuSourceNodeId = connectorDragStart.nodeId;
          menuSourcePortType = connectorDragStart.portType;
          menuOpen = true;
          graphStore.deselectAll();
        }
      }
      
      // Clean up connector state
      connectorDragStart = null;
      connectionStart = null;
      connectionEndWorld = null;
      return;
    }
    
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
      
      // Reset connection state (including connector state if it was a connector-initiated drag)
      connectorDragStart = null;
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
      if (marqueeStartWorld && marqueeCurrentWorld) {
        lastMarqueeBoundsWorld = {
          minX: Math.min(marqueeStartWorld.x, marqueeCurrentWorld.x),
          minY: Math.min(marqueeStartWorld.y, marqueeCurrentWorld.y),
          maxX: Math.max(marqueeStartWorld.x, marqueeCurrentWorld.x),
          maxY: Math.max(marqueeStartWorld.y, marqueeCurrentWorld.y),
        };
      }
      
      const selectedImageIds = getSelectedImageIds();
      
      // Check which groups the marquee overlaps
      const groupsInMarquee: string[] = [];
      if (lastMarqueeBoundsWorld) {
        graphStore.groups.forEach(g => {
          const overlaps = !(g.x + g.width < lastMarqueeBoundsWorld!.minX || g.x > lastMarqueeBoundsWorld!.maxX || g.y + g.height < lastMarqueeBoundsWorld!.minY || g.y > lastMarqueeBoundsWorld!.maxY);
          if (overlaps) groupsInMarquee.push(g.id);
        });
      }
      
      // If marquee overlaps a group and no image nodes are selected, select the group
      if (selectedImageIds.length === 0 && groupsInMarquee.length > 0) {
        // Select the first overlapping group
        selectedGroupId = groupsInMarquee[0];
        groupMenuOpen = true;
        groupMenuAnchor = { type: 'group', groupId: groupsInMarquee[0] };
        lastMarqueeBoundsWorld = null;
      } else if (selectedImageIds.length >= 2) {
        groupMenuOpen = true;
        groupMenuAnchor = { type: 'selection' };
        selectedGroupId = null;
      } else {
        groupMenuOpen = false;
        groupMenuAnchor = null;
        lastMarqueeBoundsWorld = null;
      }
      
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
        const movedIds: string[] = [];
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
            movedIds.push(id);
          }
        });
        graphStore.recordMove(moves);
        addDraggedNodesToGroups(movedIds);
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
      groupDragId = null;
      groupResizeId = null;
      groupDragStartBounds = null;
      groupResizeStartBounds = null;
      groupMemberStartPositions.clear();
      groupDragMoved = false;
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
    
    // Block zoom/pan when menu is open
    if (menuOpen || groupMenuOpen) return;
    
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
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, graphStore.camera.zoom * zoomFactor));
    
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
  
  
  /**
   * Handle mouse entering a connector icon - maintains hover state
   */
  function handleConnectorMouseEnter(nodeId: string) {
    isOverConnectorIcon = nodeId;
    hoveredNodeId = nodeId;
  }
  
  /**
   * Handle mouse leaving a connector icon
   */
  function handleConnectorMouseLeave() {
    isOverConnectorIcon = null;
    // Don't clear hoveredNodeId here - let handleMouseMove handle it
  }
  
  // Track connector drag state for distinguishing click vs drag
  let connectorDragStart = $state<{ x: number; y: number; nodeId: string; portType: 'image' | 'mesh' } | null>(null);
  const DRAG_THRESHOLD = 5; // pixels - if moved more than this, it's a drag, not a click
  
  /**
   * Handle pointer down on connector icon - prepares for either drag (connection) or click (menu)
   */
  function handleConnectorPointerDown(e: PointerEvent, nodeId: string, portType: 'image' | 'mesh' = 'image') {
    e.preventDefault();
    e.stopPropagation();
    
    const node = graphStore.getNodeById(nodeId);
    if (!node) return;
    
    // Store starting position to detect drag vs click
    connectorDragStart = { x: e.clientX, y: e.clientY, nodeId, portType };
    
    // Capture pointer on container element so we receive move/up events
    // (connector icon and container are siblings, events don't naturally bubble)
    containerElement.setPointerCapture(e.pointerId);
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    
    // Get output port position for potential connection start
    const portPositions = getPortPositions(node);
    const portId = portType === 'mesh' ? 'mesh' : 'image';
    const outputPort = portPositions.find(p => p.portId === portId && p.isOutput);
    
    if (outputPort) {
      // Prepare connection start (but don't activate until drag detected)
      connectionStart = outputPort;
      connectionEndWorld = { x: outputPort.x, y: outputPort.y };
    }
  }
  
  /**
   * Handle click on connector icon - opens menu (fallback for environments where pointerdown/up don't work as expected)
   */
  function handleConnectorClick(e: MouseEvent, nodeId: string, portType: 'image' | 'mesh' = 'image') {
    e.preventDefault();
    e.stopPropagation();
    
    // If connection mode was started (drag exceeded threshold), skip - let handlePointerUp handle it
    if (isConnecting) {
      return;
    }
    
    // Clear any pending connector drag state (in case pointerdown was triggered but not handled properly)
    if (connectorDragStart) {
      connectorDragStart = null;
      connectionStart = null;
      connectionEndWorld = null;
    }
    
    const node = graphStore.getNodeById(nodeId);
    if (!node) return;
    
    const rect = containerElement.getBoundingClientRect();
    menuPosition = { 
      x: e.clientX - rect.left + 8, 
      y: e.clientY - rect.top - 28
    };
    menuSourceNodeId = nodeId;
    menuSourcePortType = portType;
    menuOpen = true;
    isOverConnectorIcon = null;
    graphStore.deselectAll();
  }
  
  /**
   * Clean up all connector drag state
   */
  function cleanupConnectorDrag() {
    connectorDragStart = null;
    connectionStart = null;
    connectionEndWorld = null;
    isConnecting = false;
    snapTarget = null;
    isOverConnectorIcon = null;
  }
  
  function handleMenuClose() {
    menuOpen = false;
    menuSourceNodeId = null;
  }
  
  function handleMenuSelect(nodeType: string) {
    if (!menuSourceNodeId) {
      handleMenuClose();
      return;
    }
    
    const sourceNode = graphStore.getNodeById(menuSourceNodeId);
    if (!sourceNode) {
      handleMenuClose();
      return;
    }
    
    // Calculate position for new node (to the right of source node with gap)
    const gap = 60;
    const newX = sourceNode.x + sourceNode.width + gap;
    
    // Find existing model/triposr nodes to the right of the source to stack below them
    const modelNodeTypes = ['model', 'triposr'];
    const existingModelNodes = Array.from(graphStore.nodes.values())
      .filter(n => modelNodeTypes.includes(n.type))
      .filter(n => n.x >= sourceNode.x + sourceNode.width) // To the right of source
      .sort((a, b) => (a.y + (a.height || NODE_SIZE)) - (b.y + (b.height || NODE_SIZE))); // Sort by bottom edge
    
    // Calculate Y position - align with source or stack below existing model nodes
    let newY: number;
    if (existingModelNodes.length === 0) {
      // First model node - align vertically with source node center
      newY = sourceNode.y + (sourceNode.height / 2) - (NODE_SIZE / 2);
    } else {
      // Stack below the lowest existing model node
      const lowestNode = existingModelNodes[existingModelNodes.length - 1];
      const lowestNodeHeight = lowestNode.height || NODE_SIZE;
      newY = lowestNode.y + lowestNodeHeight + 50; // 50px gap to account for node labels
    }
    
    let newNodeId: string;
    
    if (nodeType === 'triposr') {
      // Create TripoSR node
      newNodeId = graphStore.addNode(
        'triposr',
        newX,
        newY,
        {},
        NODE_SIZE,
        NODE_SIZE
      );
    } else if (nodeType === 'model') {
      // Create SD 1.5 img2img model node
      newNodeId = graphStore.addNode(
        'model',
        newX,
        newY,
        {
          modelPath: '/data/models/v1-5-pruned-emaonly-fp16.safetensors',
          modelName: 'SD 1.5',
          modelType: 'safetensors',
        },
        NODE_SIZE,
        NODE_SIZE
      );
    } else {
      handleMenuClose();
      return;
    }
    
    // Create edge from source node output to new node input
    const sourcePortId = menuSourcePortType === 'mesh' ? 'mesh' : 'image';
    const targetPortId = menuSourcePortType === 'mesh' ? 'mesh' : 'image';
    graphStore.addEdge(menuSourceNodeId, sourcePortId, newNodeId, targetPortId);
    
    // Track for fade-in animation
    newlyAddedNodeIds = new Set(newlyAddedNodeIds).add(newNodeId);
    setTimeout(() => {
      const updated = new Set(newlyAddedNodeIds);
      updated.delete(newNodeId);
      newlyAddedNodeIds = updated;
    }, 100);
    
    // Select the new node
    graphStore.selectNode(newNodeId, false);
    
    // Close the menu
    handleMenuClose();
  }
  
  function handleMouseMove(e: MouseEvent) {
    // Only track hover when not dragging or panning
    if (isDragging || isPanning || mode === 'marquee' || isConnecting) {
      hoveredNodeId = null;
      hoveredEdgeId = null;
      isOverConnectorIcon = null;
      return;
    }
    
    // If we're over a connector icon (set by mouseenter on the icon),
    // maintain the hover state - the canvas doesn't receive mousemove when over the icon
    if (isOverConnectorIcon) {
      hoveredNodeId = isOverConnectorIcon;
      hoveredEdgeId = null;
      return;
    }
    
    const rect = canvasElement.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const screenY = e.clientY - rect.top;
    const world = screenToWorld(screenX, screenY, rect.width, rect.height);
    
    // Check for node hover first (includes extended area for connector)
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
    isOverConnectorIcon = null;
  }
  
  function handleDoubleClick(e: MouseEvent) {
    // Double-click is reserved for future use (e.g., edit node label)
    // Node creation is only via sidebar or Add Node button
    e.preventDefault();
  }
  
  // Drag and drop handlers for images, models, and meshes
  function handleDragOver(e: DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    
    // Check if the drag contains files (images), sidebar images, models, or meshes
    if (e.dataTransfer?.types.includes('Files') || 
        e.dataTransfer?.types.includes('application/x-sidebar-image') ||
        e.dataTransfer?.types.includes('application/x-sidebar-model') ||
        e.dataTransfer?.types.includes('application/x-sidebar-mesh')) {
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
        const { path, name, type, size, metadata } = JSON.parse(sidebarModelData);
        // Handle different model types
        if (type === 'triposr') {
          addTripoSRNode(dropWorld.x, dropWorld.y);
        } else {
          addModelNode(path, name, type, size, dropWorld.x, dropWorld.y, metadata);
        }
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
    
    // Check if it's a sidebar mesh drop (GLB/GLTF)
    const sidebarMeshData = e.dataTransfer?.getData('application/x-sidebar-mesh');
    if (sidebarMeshData) {
      try {
        const { path, name, videoUrl } = JSON.parse(sidebarMeshData);
        addMeshOutputNode(path, name, dropWorld.x, dropWorld.y, videoUrl);
      } catch (error) {
        console.error('Error processing sidebar mesh drop:', error);
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
    worldY: number,
    metadata?: { title?: string; hash?: string; date?: string; resolution?: string; architecture?: string; license?: string }
  ) {
    const nodeWidth = NODE_SIZE;
    const nodeHeight = NODE_SIZE; // Square shape, same as shortest side of image nodes
    
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
        // Metadata from safetensors
        modelTitle: metadata?.title,
        modelHash: metadata?.hash,
        modelDate: metadata?.date,
        modelResolution: metadata?.resolution,
        modelArchitecture: metadata?.architecture,
        modelLicense: metadata?.license,
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
  
  // Helper function to add a TripoSR node
  function addTripoSRNode(worldX: number, worldY: number) {
    const nodeWidth = NODE_SIZE;
    const nodeHeight = NODE_SIZE;
    
    const x = worldX - nodeWidth / 2;
    const y = worldY - nodeHeight / 2;
    
    const newId = graphStore.addNode(
      'triposr',
      x,
      y,
      {},
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
  
  // Helper function to add a mesh output node (for GLB files from sidebar)
  function addMeshOutputNode(meshPath: string, filename: string, worldX: number, worldY: number, videoUrl?: string | null) {
    const nodeWidth = NODE_SIZE;
    const nodeHeight = NODE_SIZE;
    
    const x = worldX - nodeWidth / 2;
    const y = worldY - nodeHeight / 2;
    
    const newId = graphStore.addNode(
      'mesh-output',
      x,
      y,
      {
        meshUrl: meshPath,
        videoUrl: videoUrl || '',
        outputPath: meshPath,
        filename: filename,
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
  
  // Calculate the center of the visible canvas in world coordinates
  // Accounts for the left sidebar width when open
  function getVisibleCenterWorld(): { x: number; y: number } {
    const cam = graphStore.camera;
    const viewport = renderer?.getViewportSize() ?? { width: canvasWidth, height: canvasHeight };
    
    // Account for sidebar width - the canvas starts at the sidebar edge
    // but the viewable area is offset by the sidebar width
    const sidebarWidth = sidebarState.width;
    
    // The visible area starts after the sidebar and ends at the right edge
    // For simplicity, we just offset the center by half the sidebar width
    // This centers nodes in the viewable area (right of sidebar)
    const visibleWidth = viewport.width;
    const centerScreenX = (visibleWidth + sidebarWidth - ICON_SIDEBAR_WIDTH) / 2;
    const centerScreenY = viewport.height / 2;
    
    const centerWorldX = centerScreenX / cam.zoom - cam.x;
    const centerWorldY = centerScreenY / cam.zoom - cam.y;
    
    return { x: centerWorldX, y: centerWorldY };
  }
  
  // Handle sidebar click-to-add image event
  async function handleSidebarAddImage(e: CustomEvent) {
    const { path, name } = e.detail;
    
    // Calculate position at center of visible canvas with offset
    const center = getVisibleCenterWorld();
    const worldX = center.x + clickAddOffset - NODE_SIZE / 2;
    const worldY = center.y + clickAddOffset - NODE_SIZE / 2;
    
    // Increment offset for next item
    clickAddOffset += CLICK_ADD_OFFSET_INCREMENT;
    
    // Add the image node
    await addImageNodeFromPath(path, name, worldX, worldY, 0);
  }
  
  // Handle sidebar click-to-add model event
  function handleSidebarAddModel(e: CustomEvent) {
    const { path, name, type, size, metadata } = e.detail;
    
    // Calculate position at center of visible canvas with offset
    const center = getVisibleCenterWorld();
    const worldX = center.x + clickAddOffset - NODE_SIZE / 2;
    const worldY = center.y + clickAddOffset - NODE_SIZE / 2;
    
    // Increment offset for next item
    clickAddOffset += CLICK_ADD_OFFSET_INCREMENT;
    
    // Add the model node with metadata
    addModelNode(path, name, type, size, worldX, worldY, metadata);
  }
  
  // Handle sidebar click-to-add TripoSR event
  function handleSidebarAddTripoSR(e: CustomEvent) {
    // Calculate position at center of visible canvas with offset
    const center = getVisibleCenterWorld();
    const worldX = center.x + clickAddOffset - NODE_SIZE / 2;
    const worldY = center.y + clickAddOffset - NODE_SIZE / 2;
    
    // Increment offset for next item
    clickAddOffset += CLICK_ADD_OFFSET_INCREMENT;
    
    // Add the TripoSR node
    addTripoSRNode(worldX, worldY);
  }
  
  // Handle sidebar click-to-add mesh (GLB) event
  function handleSidebarAddMesh(e: CustomEvent) {
    const { path, name, videoUrl } = e.detail;
    
    // Calculate position at center of visible canvas with offset
    const center = getVisibleCenterWorld();
    const worldX = center.x + clickAddOffset - NODE_SIZE / 2;
    const worldY = center.y + clickAddOffset - NODE_SIZE / 2;
    
    // Increment offset for next item
    clickAddOffset += CLICK_ADD_OFFSET_INCREMENT;
    
    // Add the mesh output node with video preview
    addMeshOutputNode(path, name, worldX, worldY, videoUrl);
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
      borderRadius: getDOMNodeRadius(graphStore.camera.zoom),
      borderWidth: getDOMBorderWidth(graphStore.camera.zoom, true, false),
    };
  });

  function getSelectedImageIds(): string[] {
    const ids: string[] = [];
    graphStore.selectedNodeIds.forEach(id => {
      const node = graphStore.getNodeById(id);
      if (node?.type === 'image') ids.push(id);
    });
    return ids;
  }

  function getImageNodesFullyInBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): string[] {
    const ids: string[] = [];
    for (const [id, node] of graphStore.nodes) {
      if (node.type !== 'image') continue;
      const fullyInside =
        node.x >= bounds.minX &&
        node.y >= bounds.minY &&
        node.x + node.width <= bounds.maxX &&
        node.y + node.height <= bounds.maxY;
      if (fullyInside) ids.push(id);
    }
    return ids;
  }

  function getImageNodesInBounds(bounds: { minX: number; minY: number; maxX: number; maxY: number }): string[] {
    const ids = getNodesInRect(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, graphStore.nodes);
    return ids.filter(id => graphStore.getNodeById(id)?.type === 'image');
  }

  function getHoveredGroupId(screenX: number, screenY: number): string | null {
    for (const group of groupSections) {
      const inX = screenX >= group.screenX && screenX <= group.screenX + group.screenWidth;
      const inY = screenY >= group.screenY && screenY <= group.screenY + group.screenHeight;
      const inHeader =
        screenX >= group.screenX &&
        screenX <= group.screenX + group.screenWidth &&
        screenY >= group.screenY - GROUP_TITLE_HEIGHT &&
        screenY <= group.screenY;
      if ((inX && inY) || inHeader) {
        return group.id;
      }
    }
    return null;
  }

  function addDraggedNodesToGroups(movedNodeIds: string[]) {
    if (movedNodeIds.length === 0) return;
    graphStore.groups.forEach(group => {
      const groupBounds = {
        minX: group.x,
        minY: group.y,
        maxX: group.x + group.width,
        maxY: group.y + group.height,
      };
      const inGroup = getImageNodesInBounds(groupBounds);
      // Filter out moved nodes that are no longer inside the group bounds
      const movedSet = new Set(movedNodeIds);
      const remainingMembers = group.memberIds.filter(id => !movedSet.has(id) || inGroup.includes(id));
      // Add any new nodes that were dragged into the group
      const updatedMembers = Array.from(new Set([...remainingMembers, ...inGroup]));
      if (updatedMembers.length !== group.memberIds.length || updatedMembers.some((id, i) => id !== group.memberIds[i])) {
        graphStore.recordGroupChange(group.id, group, { ...group, memberIds: updatedMembers });
        graphStore.setGroupMembers(group.id, updatedMembers);
      }
    });
  }

  let groupSelectionBounds = $derived.by(() => {
    if (!renderer) return null;
    const version = getNodesVersion();
    void version;
    // Track viewport for reactivity (needed because renderer.resize() doesn't change reference)
    void canvasWidth; void canvasHeight;
    const selectedImageIds = getSelectedImageIds();
    if (selectedImageIds.length < 2) return null;
    
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    
    selectedImageIds.forEach(id => {
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
    
    const topLeft = renderer.worldToScreen(minX, minY, graphStore.camera);
    const bottomRight = renderer.worldToScreen(maxX, maxY, graphStore.camera);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
      borderRadius: getDOMNodeRadius(graphStore.camera.zoom),
      borderWidth: getDOMBorderWidth(graphStore.camera.zoom, true, false),
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
  
  // Group sections rendered as DOM overlays
  let groupSections = $state<Array<{
    id: string;
    name: string;
    screenX: number;
    screenY: number;
    screenWidth: number;
    screenHeight: number;
    borderRadius: number;
    isSelected: boolean;
  }>>([]);
  
  // Image nodes rendered as DOM overlays (works with both WebGPU and Canvas2D)
  // Use $state and $effect for explicit reactivity control
  let imageNodes = $state<Array<{
    id: string;
    imageUrl: string;
    filename: string;
    screenX: number;
    screenY: number;
    screenWidth: number;
    screenHeight: number;
    borderRadius: number;
    borderWidth: number;
    isNew: boolean;
    isSelected: boolean;
    isHovered: boolean;
    status: string;
    error: string | null;
  }>>([]);
  
  // Model nodes rendered as DOM overlays (SD and TripoSR)
  let modelNodes = $state<Array<{
    id: string;
    nodeType: string;
    modelName: string;
    modelType: string;
    modelSize: number;
    modelTitle?: string;
    modelArchitecture?: string;
    modelResolution?: string;
    modelLicense?: string;
    // Custom meta lines for display
    metaLine1?: string;
    metaLine2?: string;
    metaLine3?: string;
    metaLine4?: string;
    metaLine5?: string;
    screenX: number;
    screenY: number;
    screenWidth: number;
    screenHeight: number;
    borderRadius: number;
    borderWidth: number;
    isNew: boolean;
    isSelected: boolean;
    isHovered: boolean;
    status: string;
    error: string | null;
  }>>([]);
  
  // Output nodes rendered as DOM overlays (show generated images)
  let outputNodes = $state<Array<{
    id: string;
    imageUrl: string;
    outputPath: string;
    filename: string;
    screenX: number;
    screenY: number;
    screenWidth: number;
    screenHeight: number;
    borderRadius: number;
    borderWidth: number;
    isNew: boolean;
    isSelected: boolean;
    isHovered: boolean;
    status: string;
    error: string | null;
  }>>([]);
  
  // Mesh output nodes rendered as DOM overlays (show generated 3D meshes)
  let meshOutputNodes = $state<Array<{
    id: string;
    meshUrl: string;
    videoUrl: string;
    previewUrl: string;
    thumbnailUrl: string; // Generated from GLB using Three.js
    outputPath: string;
    filename: string;
    screenX: number;
    screenY: number;
    screenWidth: number;
    screenHeight: number;
    borderRadius: number;
    borderWidth: number;
    isNew: boolean;
    isSelected: boolean;
    isHovered: boolean;
    status: string;
    error: string | null;
    vertices: number;
    faces: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
  }>>([]);
  
  // Cache for generated GLB thumbnails
  let glbThumbnailCache = $state<Map<string, string>>(new Map());
  
  // Track which mesh nodes have been activated (had 3D viewer shown)
  // This prevents remounting/reloading on hover toggle
  let activatedMeshNodes = $state<Set<string>>(new Set());
  
  // Port overlays computed separately to avoid performance issues
  // Only show ports for hovered/selected nodes or when connecting
  
  // Update group sections when groups or camera changes
  $effect(() => {
    const version = getGroupsVersion();
    const cam = graphStore.camera;
    const selectedGroup = selectedGroupId;
    void version;
    // Track viewport for reactivity (needed because renderer.resize() doesn't change reference)
    void canvasWidth; void canvasHeight;
    
    if (!renderer) {
      groupSections = [];
      return;
    }
    
    groupSections = Array.from(graphStore.groups.values()).map(group => {
      const topLeft = renderer.worldToScreen(group.x, group.y, cam);
      const bottomRight = renderer.worldToScreen(
        group.x + group.width,
        group.y + group.height,
        cam
      );
      return {
        id: group.id,
        name: group.name,
        screenX: topLeft.x,
        screenY: topLeft.y,
        screenWidth: bottomRight.x - topLeft.x,
        screenHeight: bottomRight.y - topLeft.y,
        borderRadius: getDOMNodeRadius(cam.zoom),
        isSelected: selectedGroup === group.id,
      };
    });
  });

  let activeGroupAnchor = $derived.by(() => {
    if (groupMenuAnchor?.type === 'selection') return groupMenuAnchor;
    if (hoveredGroupId) return { type: 'group', groupId: hoveredGroupId } as const;
    if (selectedGroupId) return { type: 'group', groupId: selectedGroupId } as const;
    return null;
  });
  
  let groupMenuVisible = $derived.by(() => {
    if (activeGroupAnchor?.type === 'selection') return groupMenuOpen;
    // For group type, only show if explicitly opened OR hovering over the group/menu
    if (activeGroupAnchor?.type === 'group') {
      return groupMenuOpen || hoveredGroupId === activeGroupAnchor.groupId || groupMenuHovered;
    }
    return false;
  });
  
  $effect(() => {
    if (!activeGroupAnchor) return;
    
    if (activeGroupAnchor.type === 'selection') {
      if (!groupSelectionBounds) return;
      groupMenuPosition = {
        x: groupSelectionBounds.x + groupSelectionBounds.width + 12,
        y: groupSelectionBounds.y + groupSelectionBounds.height / 2 - 24,
      };
      return;
    }
    
    const group = groupSections.find(section => section.id === activeGroupAnchor.groupId);
    if (!group) return;
    const offset = group.isSelected ? 12 : 48;
    groupMenuPosition = {
      x: group.screenX + group.screenWidth + offset,
      y: group.screenY + group.screenHeight / 2 - 24,
    };
  });
  
  // Update imageNodes and modelNodes when nodes or camera changes
  $effect(() => {
    // Read version to track changes - must be called before any early returns
    const version = getNodesVersion();
    const cam = graphStore.camera;
    const selectedIds = graphStore.selectedNodeIds;
    const hovered = hoveredNodeId; // Track hover state for reactivity
    // Track viewport for reactivity (needed because renderer.resize() doesn't change reference)
    void canvasWidth; void canvasHeight;
    
    if (!renderer) {
      imageNodes = [];
      modelNodes = [];
      outputNodes = [];
      meshOutputNodes = [];
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
          filename: (node.params.filename as string) || 'Untitled',
          screenX: topLeft.x,
          screenY: topLeft.y,
          screenWidth: bottomRight.x - topLeft.x,
          screenHeight: bottomRight.y - topLeft.y,
          borderRadius: getDOMNodeRadius(cam.zoom),
          borderWidth: getDOMBorderWidth(cam.zoom, graphStore.selectedNodeIds.has(node.id), hoveredNodeId === node.id),
          isNew: newlyAddedNodeIds.has(node.id),
          isSelected: graphStore.selectedNodeIds.has(node.id),
          isHovered: hoveredNodeId === node.id,
          status: node.status || 'idle',
          error: node.error || null,
        };
      });
    
    modelNodes = allNodes
      .filter(node => node.type === 'model' || node.type === 'triposr')
      .map(node => {
        const topLeft = renderer.worldToScreen(node.x, node.y, cam);
        const bottomRight = renderer.worldToScreen(
          node.x + node.width, 
          node.y + node.height, 
          cam
        );
        
        // Determine model info based on node type
        const isTripoSR = node.type === 'triposr';
        
        return {
          id: node.id,
          nodeType: node.type,
          modelName: isTripoSR 
            ? (node.params.modelName as string || 'TripoSR Base')
            : (node.params.modelName as string),
          modelType: isTripoSR ? '3D' : (node.params.modelType as string),
          modelSize: node.params.modelSize as number,
          modelTitle: isTripoSR 
            ? 'TripoSR' 
            : (node.params.modelTitle as string | undefined),
          modelArchitecture: isTripoSR 
            ? 'Transformer + NeRF' 
            : (node.params.modelArchitecture as string | undefined),
          modelResolution: isTripoSR 
            ? '512' 
            : (node.params.modelResolution as string | undefined),
          modelLicense: node.params.modelLicense as string | undefined,
          // TripoSR-specific metadata lines
          metaLine1: isTripoSR ? 'TripoSR Base' : (node.params.modelArchitecture as string || node.params.modelName as string || 'model'),
          metaLine2: isTripoSR ? '(3D RECONSTRUCTION)' : `(${(node.params.modelType as string)?.toUpperCase() || 'MODEL'})`,
          metaLine3: isTripoSR ? 'Single image to mesh' : 'Neural network weights',
          metaLine4: isTripoSR ? 'Triplane NeRF decoder' : 'Image denoising core',
          metaLine5: isTripoSR ? 'Marching cubes extraction' : 'Encodes/decodes latent space',
          screenX: topLeft.x,
          screenY: topLeft.y,
          screenWidth: bottomRight.x - topLeft.x,
          screenHeight: bottomRight.y - topLeft.y,
          borderRadius: getDOMNodeRadius(cam.zoom),
          borderWidth: getDOMBorderWidth(cam.zoom, graphStore.selectedNodeIds.has(node.id), hoveredNodeId === node.id),
          isNew: newlyAddedNodeIds.has(node.id),
          isSelected: graphStore.selectedNodeIds.has(node.id),
          isHovered: hoveredNodeId === node.id,
          status: node.status || 'idle',
          error: node.error || null,
        };
      });
    
    outputNodes = allNodes
      .filter(node => node.type === 'output')
      .map(node => {
        const topLeft = renderer.worldToScreen(node.x, node.y, cam);
        const bottomRight = renderer.worldToScreen(
          node.x + node.width, 
          node.y + node.height, 
          cam
        );
        
        // Extract filename from outputPath
        const outputPath = node.params.outputPath as string;
        const filename = outputPath ? outputPath.split('/').pop() || 'Output' : 'Output';
        
        return {
          id: node.id,
          imageUrl: (node.thumbnailUrl || node.params.imageUrl) as string,
          outputPath,
          filename,
          screenX: topLeft.x,
          screenY: topLeft.y,
          screenWidth: bottomRight.x - topLeft.x,
          screenHeight: bottomRight.y - topLeft.y,
          borderRadius: getDOMNodeRadius(cam.zoom),
          borderWidth: getDOMBorderWidth(cam.zoom, graphStore.selectedNodeIds.has(node.id), hoveredNodeId === node.id),
          isNew: newlyAddedNodeIds.has(node.id),
          isSelected: graphStore.selectedNodeIds.has(node.id),
          isHovered: hoveredNodeId === node.id,
          status: node.status || 'idle',
          error: node.error || null,
        };
      });
    
    // Mesh output nodes (generated 3D meshes from TripoSR)
    meshOutputNodes = allNodes
      .filter(node => node.type === 'mesh-output')
      .map(node => {
        const topLeft = renderer.worldToScreen(node.x, node.y, cam);
        const bottomRight = renderer.worldToScreen(
          node.x + node.width, 
          node.y + node.height, 
          cam
        );
        
        // Extract filename from outputPath
        const outputPath = node.params.outputPath as string;
        const filename = outputPath ? outputPath.split('/').pop() || '3D Output' : '3D Output';
        const meshUrl = (node.params.meshUrl) as string || '';
        const rotationX = (node.params.rotationX as number) ?? 0;
        const rotationY = (node.params.rotationY as number) ?? 0;
        const rotationZ = (node.params.rotationZ as number) ?? 0;
        
        // Cache key includes rotation so thumbnails update when rotation changes
        const cacheKey = `${meshUrl}|rx:${rotationX}|ry:${rotationY}|rz:${rotationZ}`;
        
        return {
          id: node.id,
          meshUrl,
          videoUrl: (node.params.videoUrl) as string || '',
          previewUrl: (node.thumbnailUrl || node.params.previewUrl) as string || '',
          thumbnailUrl: glbThumbnailCache.get(cacheKey) || '', // Use cached thumbnail with rotation
          outputPath,
          filename,
          screenX: topLeft.x,
          screenY: topLeft.y,
          screenWidth: bottomRight.x - topLeft.x,
          screenHeight: bottomRight.y - topLeft.y,
          borderRadius: getDOMNodeRadius(cam.zoom),
          borderWidth: getDOMBorderWidth(cam.zoom, graphStore.selectedNodeIds.has(node.id), hoveredNodeId === node.id),
          isNew: newlyAddedNodeIds.has(node.id),
          isSelected: graphStore.selectedNodeIds.has(node.id),
          isHovered: hoveredNodeId === node.id,
          status: node.status || 'idle',
          error: node.error || null,
          vertices: (node.params.vertices as number) || 0,
          faces: (node.params.faces as number) || 0,
          rotationX,
          rotationY,
          rotationZ,
        };
      });
  });
  
  // Generate GLB thumbnails for mesh output nodes that don't have video
  $effect(() => {
    const allNodes = Array.from(graphStore.nodes.values());
    const meshNodes = allNodes.filter(node => node.type === 'mesh-output');
    
    for (const node of meshNodes) {
      const meshUrl = (node.params.meshUrl) as string || '';
      const videoUrl = (node.params.videoUrl) as string || '';
      const rotationX = (node.params.rotationX as number) ?? 0;
      const rotationY = (node.params.rotationY as number) ?? 0;
      const rotationZ = (node.params.rotationZ as number) ?? 0;
      
      // Include rotation in cache key so thumbnails regenerate when rotation changes
      const cacheKey = `${meshUrl}|rx:${rotationX}|ry:${rotationY}|rz:${rotationZ}`;
      
      // Generate thumbnail if we have a mesh URL but no video and no cached thumbnail
      if (meshUrl && !videoUrl && !glbThumbnailCache.has(cacheKey)) {
        // Set a placeholder to prevent multiple generations
        glbThumbnailCache.set(cacheKey, 'loading');
        
        // Generate thumbnail asynchronously with rotation
        generateGLBThumbnail(meshUrl, { 
          width: 256, 
          height: 256,
          rotationX,
          rotationY,
          rotationZ,
        })
          .then(dataUrl => {
            glbThumbnailCache = new Map(glbThumbnailCache).set(cacheKey, dataUrl);
          })
          .catch(err => {
            console.error('Failed to generate GLB thumbnail:', err);
            // Remove the loading placeholder on error
            const newCache = new Map(glbThumbnailCache);
            newCache.delete(cacheKey);
            glbThumbnailCache = newCache;
          });
      }
    }
  });
  
  // Track activated mesh nodes (ones that have been hovered/selected)
  // This prevents MeshViewer from being destroyed and recreated on hover toggle
  $effect(() => {
    for (const meshNode of meshOutputNodes) {
      if ((meshNode.isSelected || meshNode.isHovered) && meshNode.meshUrl) {
        if (!activatedMeshNodes.has(meshNode.id)) {
          activatedMeshNodes = new Set(activatedMeshNodes).add(meshNode.id);
        }
      }
    }
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
    // Image and output nodes use custom connector icon instead of port overlay
    graphStore.nodes.forEach(node => {
      // Skip port overlay for image/output nodes - they use custom connector icon
      const useCustomConnector = node.type === 'image' || node.type === 'output';
      
      // Show ports when connecting (for all nodes) or when hovering (for non-image/output)
      const shouldShowPorts = showAllPorts || (hoveredNodeId === node.id && !useCustomConnector);
      
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
  role="application"
  aria-label="Canvas"
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
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
>
  <canvas
    bind:this={canvasElement}
    class={cursorClass}
    tabindex="0"
  ></canvas>
  
  {#if groupSelectionBounds}
    <div
      class="group-selection-bounds"
      style={`left: ${groupSelectionBounds.x}px; top: ${groupSelectionBounds.y}px; width: ${groupSelectionBounds.width}px; height: ${groupSelectionBounds.height}px; border-radius: ${groupSelectionBounds.borderRadius}px; border-width: ${groupSelectionBounds.borderWidth}px;`}
    ></div>
  {/if}
  
  {#each groupSections as group (group.id)}
    <div
      class="group-section"
      class:selected={group.isSelected}
      class:hover-resize={groupHoveringResize && groupHoverResizeId === group.id}
      style={`left: ${group.screenX}px; top: ${group.screenY}px; width: ${group.screenWidth}px; height: ${group.screenHeight}px; border-radius: ${group.borderRadius}px;`}
      onpointerdown={(e) => handleGroupPointerDown(e, group.id)}
      onpointermove={(e) => handleGroupPointerMove(e, group.id)}
      onpointerleave={() => handleGroupPointerLeave(group.id)}
      role="presentation"
    >
      <button
        class="group-title"
        type="button"
        onpointerdown={(e) => { e.stopPropagation(); handleGroupPointerDown(e, group.id); }}
        onclick={(e) => { e.stopPropagation(); handleGroupSelect(group.id); }}
      >
        {group.name}
      </button>
      <div
        class="group-resize-handle"
        onpointerdown={(e) => handleGroupResizeStart(e, group.id)}
        role="presentation"
      ></div>
    </div>
  {/each}
  
  <!-- Image nodes rendered as DOM overlays -->
  {#each imageNodes as img (img.id)}
    <div
      class="image-node-wrapper"
      class:selected={img.isSelected}
      class:hovered={img.isHovered}
      style={`left: ${img.screenX}px; top: ${img.screenY}px;`}
    >
      <div
        class="image-node-overlay"
        class:fade-in={img.isNew}
        class:empty={!img.imageUrl}
        class:selected={img.isSelected}
        class:error={img.status === 'error'}
        style={`width: ${img.screenWidth}px; height: ${img.screenHeight}px; border-radius: ${img.borderRadius}px; ${img.isSelected || img.isHovered ? `border-width: ${img.borderWidth}px;` : ''}`}
      >
        {#if img.imageUrl}
          <img 
            src={img.imageUrl} 
            alt={img.filename || 'Dropped'}
            draggable="false"
          />
          <!-- Hover overlay -->
          {#if img.isHovered && !img.isSelected}
            <div class="image-hover-overlay"></div>
          {/if}
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
        {#if img.status === 'error'}
          <div class="node-error-badge" title={img.error || 'Error'}>!</div>
        {/if}
      </div>
      <!-- Connector icon - positioned outside overlay to avoid overflow:hidden clipping -->
      {#if img.imageUrl}
        <button 
          type="button"
          class="node-connector-icon" 
          class:visible={img.isHovered}
          class:dragging={isConnecting && connectionStart?.nodeId === img.id}
          style={`height: ${img.screenHeight}px;`}
          onpointerdown={(e) => handleConnectorPointerDown(e, img.id, 'image')}
          onclick={(e) => handleConnectorClick(e, img.id, 'image')}
          onmouseenter={() => handleConnectorMouseEnter(img.id)}
          onmouseleave={handleConnectorMouseLeave}
          aria-label="Open connector menu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
        </button>
      {/if}
      <!-- Error tooltip for image node -->
      {#if img.status === 'error' && img.error && img.isHovered}
        <div class="node-error-tooltip" style={`max-width: ${Math.max(img.screenWidth, 200)}px;`}>
          <span class="error-icon">⚠️</span>
          <span class="error-text">{img.error}</span>
        </div>
      {/if}
      <!-- Filename label - always present, fades in on hover -->
      <div class="node-filename" class:visible={img.isHovered} style={`max-width: ${img.screenWidth}px;`}>{img.filename}</div>
    </div>
  {/each}
  
  <!-- Model nodes rendered as DOM overlays -->
  {#each modelNodes as model (model.id)}
    <div
      class="model-node-wrapper"
      class:selected={model.isSelected}
      class:hovered={model.isHovered}
      style={`left: ${model.screenX}px; top: ${model.screenY}px;`}
    >
    <div
      class="model-node-overlay"
      class:fade-in={model.isNew}
        class:selected={model.isSelected}
        class:running={model.status === 'running'}
        class:error={model.status === 'error'}
        class:complete={model.status === 'complete'}
        style={`width: ${model.screenWidth}px; height: ${model.screenHeight}px; border-radius: ${model.borderRadius}px; ${model.isSelected || model.isHovered ? `border-width: ${model.borderWidth}px;` : ''}`}
    >
        {#if model.status === 'running'}
          <div class="model-status-indicator running">
            <!-- Custom volt loader -->
            <svg class="volt-loader" width="69" height="69" viewBox="0 0 69 69" fill="none">
              <circle cx="34.5" cy="34.5" r="33.1337" stroke="white" stroke-opacity="0.12" stroke-width="2.73267"/>
              <path class="volt-arc" d="M34.5 1.36634C40.3162 1.36634 46.0299 2.89732 51.0668 5.80541C56.1038 8.7135 60.2865 12.8962 63.1946 17.9332C66.1027 22.9701 67.6337 28.6838 67.6337 34.5C67.6337 40.3162 66.1027 46.0299 63.1946 51.0668" stroke="#BDFB72" stroke-width="2.73267"/>
            </svg>
          </div>
        {:else if model.status === 'error'}
          <div class="model-status-indicator error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10" />
              <path d="M12 8v4M12 16h.01" />
            </svg>
          </div>
        {:else if model.status === 'complete'}
          <div class="model-status-indicator complete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
        {:else}
          <!-- Model metadata content -->
          <div class="model-metadata-content" class:triposr={model.nodeType === 'triposr'}>
            <div class="model-meta-line">{model.metaLine1 || model.modelName || 'model'}</div>
            <div class="model-meta-line">{model.metaLine2 || `(${model.modelType?.toUpperCase() || 'MODEL'})`}</div>
            <div class="model-meta-line">{model.metaLine3 || ''}</div>
            <div class="model-meta-line">{model.metaLine4 || ''}</div>
            <div class="model-meta-line">{model.metaLine5 || ''}</div>
            {#if model.modelResolution && model.nodeType !== 'triposr'}
              <div class="model-meta-line">Resolution ({model.modelResolution})</div>
            {/if}
            {#if model.modelLicense}
              <div class="model-meta-line model-meta-license">{model.modelLicense}</div>
            {/if}
          </div>
        {/if}
        {#if model.status === 'error' && model.error}
          <div class="model-error-badge" title={model.error}>!</div>
        {/if}
      </div>
      <!-- Error message tooltip - shows on hover when in error state -->
      {#if model.status === 'error' && model.error && model.isHovered}
        <div class="node-error-tooltip" style={`max-width: ${Math.max(model.screenWidth, 200)}px;`}>
          <span class="error-icon">⚠️</span>
          <span class="error-text">{model.error}</span>
        </div>
      {/if}
      <!-- Model title label - appears below node on hover/selection (like image filename) -->
      <div class="model-title-label" class:visible={model.isHovered || model.isSelected} style={`max-width: ${model.screenWidth}px;`}>
        {model.modelTitle || model.modelName}
      </div>
    </div>
  {/each}
  
  <!-- Output nodes rendered as DOM overlays (show generated images) -->
  {#each outputNodes as output (output.id)}
    <div
      class="image-node-wrapper"
      class:selected={output.isSelected}
      class:hovered={output.isHovered}
      style={`left: ${output.screenX}px; top: ${output.screenY}px;`}
    >
      <div
        class="output-node-overlay"
        class:fade-in={output.isNew}
        class:empty={!output.imageUrl}
        class:selected={output.isSelected}
        class:error={output.status === 'error'}
        style={`width: ${output.screenWidth}px; height: ${output.screenHeight}px; border-radius: ${output.borderRadius}px; ${output.isSelected || output.isHovered ? `border-width: ${output.borderWidth}px;` : ''}`}
      >
        {#if output.imageUrl}
          <img 
            src={output.imageUrl} 
            alt="Generated output"
            draggable="false"
          />
          <!-- Hover overlay -->
          {#if output.isHovered && !output.isSelected}
            <div class="image-hover-overlay"></div>
          {/if}
        {:else}
          <div class="output-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M3 16l5-5 4 4 5-5 4 4" />
            </svg>
            <span>Output</span>
          </div>
        {/if}
        {#if output.status === 'error'}
          <div class="node-error-badge" title={output.error || 'Error'}>!</div>
        {/if}
      </div>
      <!-- Connector icon - positioned outside overlay to avoid overflow:hidden clipping -->
      {#if output.imageUrl}
        <button 
          type="button"
          class="node-connector-icon" 
          class:visible={output.isHovered}
          class:dragging={isConnecting && connectionStart?.nodeId === output.id}
          style={`height: ${output.screenHeight}px;`}
          onpointerdown={(e) => handleConnectorPointerDown(e, output.id, 'image')}
          onclick={(e) => handleConnectorClick(e, output.id, 'image')}
          onmouseenter={() => handleConnectorMouseEnter(output.id)}
          onmouseleave={handleConnectorMouseLeave}
          aria-label="Open connector menu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
        </button>
      {/if}
      <!-- Error tooltip for output node -->
      {#if output.status === 'error' && output.error && output.isHovered}
        <div class="node-error-tooltip" style={`max-width: ${Math.max(output.screenWidth, 200)}px;`}>
          <span class="error-icon">⚠️</span>
          <span class="error-text">{output.error}</span>
        </div>
      {/if}
      <!-- Filename label - always present, fades in on hover -->
      <div class="node-filename" class:visible={output.isHovered} style={`max-width: ${output.screenWidth}px;`}>{output.filename}</div>
    </div>
  {/each}

  <!-- Mesh output nodes rendered as DOM overlays (show generated 3D meshes) -->
  {#each meshOutputNodes as meshNode (meshNode.id)}
    <div
      class="image-node-wrapper"
      class:selected={meshNode.isSelected}
      class:hovered={meshNode.isHovered}
      style={`left: ${meshNode.screenX}px; top: ${meshNode.screenY}px;`}
    >
      <div
        class="mesh-node-overlay"
        class:fade-in={meshNode.isNew}
        class:empty={!meshNode.meshUrl && !meshNode.previewUrl}
        class:selected={meshNode.isSelected}
        class:error={meshNode.status === 'error'}
        style={`width: ${meshNode.screenWidth}px; height: ${meshNode.screenHeight}px; border-radius: ${meshNode.borderRadius}px; ${meshNode.isSelected || meshNode.isHovered ? `border-width: ${meshNode.borderWidth}px;` : ''}`}
      >
        {#if meshNode.meshUrl}
          <!-- Static thumbnail - always rendered, hidden when 3D viewer is active -->
          {#if meshNode.thumbnailUrl && meshNode.thumbnailUrl !== 'loading'}
            <img 
              src={meshNode.thumbnailUrl} 
              alt="3D mesh preview"
              draggable="false"
              class="mesh-thumbnail"
              class:hidden={meshNode.isSelected || meshNode.isHovered}
            />
          {:else}
            <div class="mesh-placeholder" class:hidden={meshNode.isSelected || meshNode.isHovered}>
              <div class="thumbnail-loading-spinner"></div>
              <span>Loading preview...</span>
            </div>
          {/if}
          <!-- Embedded 3D viewer - stays mounted once activated, visibility toggled -->
          {#if activatedMeshNodes.has(meshNode.id)}
            <div 
              class="mesh-viewer-container"
              class:visible={meshNode.isSelected || meshNode.isHovered}
            >
              <MeshViewer 
                meshUrl={meshNode.meshUrl}
                width={Math.round(meshNode.screenWidth)}
                height={Math.round(meshNode.screenHeight)}
                autoRotate={true}
                rotationX={meshNode.rotationX}
                rotationY={meshNode.rotationY}
                rotationZ={meshNode.rotationZ}
                showLoading={false}
                paused={isDragging}
                visible={meshNode.isSelected || meshNode.isHovered}
              />
            </div>
          {/if}
          <!-- 3D badge -->
          <div class="mesh-badge">3D</div>
        {:else if meshNode.previewUrl}
          <!-- Static image preview (fallback when no mesh URL) -->
          <img 
            src={meshNode.previewUrl} 
            alt="3D mesh preview"
            draggable="false"
          />
          <!-- 3D badge -->
          <div class="mesh-badge">3D</div>
        {:else}
          <div class="mesh-placeholder">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <span>3D Mesh</span>
          </div>
        {/if}
        {#if meshNode.status === 'running'}
          <div class="mesh-loading-overlay">
            <!-- Custom volt loader -->
            <svg class="volt-loader" width="69" height="69" viewBox="0 0 69 69" fill="none">
              <circle cx="34.5" cy="34.5" r="33.1337" stroke="white" stroke-opacity="0.12" stroke-width="2.73267"/>
              <path class="volt-arc" d="M34.5 1.36634C40.3162 1.36634 46.0299 2.89732 51.0668 5.80541C56.1038 8.7135 60.2865 12.8962 63.1946 17.9332C66.1027 22.9701 67.6337 28.6838 67.6337 34.5C67.6337 40.3162 66.1027 46.0299 63.1946 51.0668" stroke="#BDFB72" stroke-width="2.73267"/>
            </svg>
            <span>Generating mesh...</span>
          </div>
        {/if}
        {#if meshNode.status === 'error'}
          <div class="node-error-badge" title={meshNode.error || 'Error'}>!</div>
        {/if}
      </div>
      <!-- Connector icon - positioned outside overlay to avoid overflow:hidden clipping -->
      {#if meshNode.meshUrl || meshNode.videoUrl || meshNode.thumbnailUrl || meshNode.previewUrl}
        <button 
          type="button"
          class="node-connector-icon" 
          class:visible={meshNode.isHovered}
          class:dragging={isConnecting && connectionStart?.nodeId === meshNode.id}
          style={`height: ${meshNode.screenHeight}px;`}
          onpointerdown={(e) => handleConnectorPointerDown(e, meshNode.id, 'mesh')}
          onclick={(e) => handleConnectorClick(e, meshNode.id, 'mesh')}
          onmouseenter={() => handleConnectorMouseEnter(meshNode.id)}
          onmouseleave={handleConnectorMouseLeave}
          aria-label="Open connector menu"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v8M8 12h8" />
          </svg>
        </button>
      {/if}
      <!-- Error tooltip for mesh node -->
      {#if meshNode.status === 'error' && meshNode.error && meshNode.isHovered}
        <div class="node-error-tooltip" style={`max-width: ${Math.max(meshNode.screenWidth, 200)}px;`}>
          <span class="error-icon">⚠️</span>
          <span class="error-text">{meshNode.error}</span>
        </div>
      {/if}
      <!-- Filename label - always present, fades in on hover -->
      <div class="node-filename" class:visible={meshNode.isHovered} style={`max-width: ${meshNode.screenWidth}px;`}>{meshNode.filename}</div>
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
      class:type-mesh={port.type === 'mesh'}
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
      style={`left: ${selectionBounds.x}px; top: ${selectionBounds.y}px; width: ${selectionBounds.width}px; height: ${selectionBounds.height}px; border-radius: ${selectionBounds.borderRadius}px; border-width: ${selectionBounds.borderWidth}px;`}
    ></div>
  {/if}
  
  <div class="canvas-overlay">
    <div class="zoom-indicator">
      {Math.round(graphStore.camera.zoom * 100)}%
    </div>
  </div>
  
  {#if isDragOver}
    <div class="drop-indicator">
      <div class="drop-icon">📷</div>
      <div class="drop-text">Drop image here</div>
    </div>
  {/if}
  
  {#if menuOpen}
    <CanvasMenu
      x={menuPosition.x}
      y={menuPosition.y}
      sourcePortType={menuSourcePortType}
      onselect={handleMenuSelect}
      onclose={handleMenuClose}
    />
  {/if}
  
  {#if activeGroupAnchor}
    <GroupMenu
      x={groupMenuPosition.x}
      y={groupMenuPosition.y}
      visible={groupMenuVisible}
      showGroup={activeGroupAnchor.type === 'selection'}
      showUngroup={activeGroupAnchor.type === 'group'}
      onGroup={handleCreateGroup}
      onUngroup={handleUngroup}
      onclose={handleGroupMenuClose}
      onHoverChange={(hovered) => groupMenuHovered = hovered}
    />
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
    width: 10px;
    height: 10px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    z-index: 20;
    background: rgba(255, 255, 255, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.5);
    transition: transform 0.1s ease, background 0.1s ease, opacity 0.1s ease;
    opacity: 0.6;
  }
  
  .port-overlay.type-image {
    background: rgba(245, 158, 11, 0.4);
    border-color: rgba(245, 158, 11, 0.7);
  }
  
  .port-overlay.type-string {
    background: rgba(16, 185, 129, 0.4);
    border-color: rgba(16, 185, 129, 0.7);
  }
  
  .port-overlay.type-tensor {
    background: rgba(99, 102, 241, 0.4);
    border-color: rgba(99, 102, 241, 0.7);
  }
  
  .port-overlay.type-number {
    background: rgba(59, 130, 246, 0.4);
    border-color: rgba(59, 130, 246, 0.7);
  }
  
  .port-overlay.type-mesh {
    background: rgba(77, 166, 255, 0.4);
    border-color: rgba(77, 166, 255, 0.7);
  }
  
  .port-overlay.highlighted {
    background: #ffffff;
    border-color: #ffffff;
    transform: translate(-50%, -50%) scale(1.4);
    opacity: 1;
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
  
  /* Image node wrapper - contains image + connector + filename */
  .image-node-wrapper {
    position: absolute;
    z-index: 20; /* Above connection-line-overlay (z-index: 15) so connector icon is clickable */
    pointer-events: none;
    background: transparent;
    will-change: left, top, width, height; /* GPU hint for smooth animations */
  }
  
  .image-node-overlay {
    position: relative;
    /* border-radius set via inline style for dynamic zoom scaling */
    overflow: hidden; /* Clip image to border-radius */
    pointer-events: none;
    background: #1a1a1e;
    user-select: none;
    -webkit-user-select: none;
    transition: border 0.15s ease;
    border: 1px solid transparent;
  }
  
  /* Selected state - use box-shadow instead of border to avoid corner gaps */
  .image-node-overlay.selected {
    border-color: transparent;
    box-shadow: 0 0 0 1px #9E9EA0, 0 0 0 2px rgba(158, 158, 160, 0.2);
  }
  
  /* Error state for image nodes */
  .image-node-overlay.error {
    border: 2px solid #ef4444;
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.3);
  }
  
  /* Error badge for image/output nodes */
  .node-error-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 20px;
    height: 20px;
    background: #ef4444;
    border-radius: 50%;
    color: white;
    font-weight: 700;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
    z-index: 10;
  }
  
  .image-node-overlay img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    border-radius: inherit; /* Inherit from parent container */
    pointer-events: none;
  }
  
  .image-node-overlay.empty {
    border: 2px dashed rgba(255, 255, 255, 0.3);
    background: rgba(77, 156, 230, 0.15);
  }
  
  /* Hover overlay - removed dark filter per Figma design */
  .image-hover-overlay {
    display: none;
  }
  
  /* Connector icon - positioned at middle-right edge, replaces port */
  .node-connector-icon {
    position: absolute;
    right: -26px;
    top: 0;
    transform: translateX(-6px);
    width: 24px;
    /* height set via inline style to match node height */
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    background: none;
    padding: 0;
    pointer-events: none;
    z-index: 100;
    opacity: 0;
    transition: opacity 180ms ease-out, transform 180ms ease-out;
    cursor: crosshair;
  }
  
  .node-connector-icon.visible {
    opacity: 1;
    transform: translateX(0);
    pointer-events: auto;
  }
  
  .node-connector-icon svg {
    width: 20px;
    height: 20px;
    color: rgba(158, 158, 160, 1);
    transition: color 0.1s ease;
  }
  
  .node-connector-icon:hover svg,
  .node-connector-icon:active svg,
  .node-connector-icon.dragging svg {
    color: rgba(244, 244, 244, 1);
  }
  
  /* Filename label - Kode Mono font, positioned below image, wraps to node width */
  .node-filename {
    font-family: 'Kode Mono', 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
    font-size: 12px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.65);
    background: transparent;
    margin-top: 8px;
    text-align: left;
    word-wrap: break-word;
    overflow-wrap: break-word;
    hyphens: auto;
    pointer-events: none;
    opacity: 0;
    transition: opacity 140ms cubic-bezier(0.0, 0, 0.2, 1);
  }
  
  .node-filename.visible {
    opacity: 1;
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
  
  /* Model node wrapper - contains model + error tooltip */
  .model-node-wrapper {
    position: absolute;
    z-index: 20; /* Above connection-line-overlay (z-index: 15) so connector icon is clickable */
    pointer-events: none;
    background: transparent;
    will-change: left, top, width, height; /* GPU hint for smooth animations */
  }
  
  .model-node-overlay {
    position: relative;
    /* border-radius set via inline style for dynamic zoom scaling */
    overflow: hidden; /* Clip content to border-radius */
    pointer-events: none;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
    background: linear-gradient(270deg, #373534 0%, #424140 100%);
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    padding: 10px;
    gap: 0;
    user-select: none;
    -webkit-user-select: none;
    border: 2px solid transparent;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }
  
  .model-node-overlay.selected {
    border-color: transparent;
    box-shadow: 0 0 0 1px #9E9EA0, 0 0 0 2px rgba(158, 158, 160, 0.2), 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  
  .model-node-overlay.running {
    border-color: transparent;
    box-shadow: 0 0 0 1px #9E9EA0, 0 0 0 2px rgba(158, 158, 160, 0.2), 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  
  .model-node-overlay.error {
    border-color: transparent;
    box-shadow: 0 0 0 1px #ef4444, 0 0 12px rgba(239, 68, 68, 0.4), 0 2px 8px rgba(0, 0, 0, 0.15);
    background: linear-gradient(270deg, #4a2020 0%, #5c2828 100%);
  }
  
  .model-node-overlay.complete {
    border-color: transparent;
    box-shadow: 0 0 0 1px #22c55e, 0 0 0 2px rgba(34, 197, 94, 0.2), 0 2px 8px rgba(0, 0, 0, 0.15);
  }
  
  /* Model metadata content - Kode Mono styling */
  .model-metadata-content {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    justify-content: flex-start;
    width: 100%;
    height: 100%;
    gap: 0;
    /* No padding here - parent has padding: 10px */
  }
  
  /* TripoSR variant styling */
  .model-metadata-content.triposr {
    /* Same styling as SD for consistency */
  }
  
  .model-meta-line {
    font-family: 'Kode Mono', 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
    font-size: 12px;
    font-style: normal;
    font-weight: 400;
    line-height: 150%;
    color: var(--60, #999);
    user-select: none;
    -webkit-user-select: none;
  }
  
  .model-meta-license {
    margin-top: 8px;
  }
  
  /* Model title label - appears below node on hover/selection */
  .model-title-label {
    font-family: 'Kode Mono', 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
    font-size: 12px;
    font-weight: 400;
    color: rgba(255, 255, 255, 0.65);
    background: transparent;
    margin-top: 8px;
    text-align: left;
    word-wrap: break-word;
    overflow-wrap: break-word;
    hyphens: auto;
    pointer-events: none;
    opacity: 0;
    transition: opacity 140ms cubic-bezier(0.0, 0, 0.2, 1);
  }
  
  .model-title-label.visible {
    opacity: 1;
  }
  
  /* Model status indicators */
  .model-status-indicator {
    width: 48px;
    height: 48px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    margin: auto;
  }
  
  .model-status-indicator.running {
    background: transparent; /* No overlay - just show the loader */
  }
  
  .model-status-indicator.error {
    background: rgba(239, 68, 68, 0.3);
  }
  
  .model-status-indicator.complete {
    background: rgba(34, 197, 94, 0.3);
  }
  
  .model-status-indicator svg {
    width: 24px;
    height: 24px;
    color: white;
  }
  
  /* Volt loader - custom loading spinner */
  .volt-loader {
    width: 80px;
    height: 80px;
    animation: spin 1.2s linear infinite;
  }
  
  .volt-arc {
    stroke: #BDFB72;
  }
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  
  /* Error badge - shows ! in corner when error */
  .model-error-badge {
    position: absolute;
    top: -6px;
    right: -6px;
    width: 20px;
    height: 20px;
    background: #ef4444;
    border-radius: 50%;
    color: white;
    font-weight: 700;
    font-size: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.3);
  }
  
  /* Error tooltip - shows detailed error message on hover */
  .node-error-tooltip {
    position: absolute;
    top: 100%;
    left: 0;
    margin-top: 8px;
    padding: 10px 12px;
    background: #1f1f23;
    border: 1px solid #ef4444;
    border-radius: 8px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    z-index: 100;
    pointer-events: none;
    animation: tooltip-fade-in 0.15s ease-out;
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  
  @keyframes tooltip-fade-in {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  .node-error-tooltip .error-icon {
    font-size: 14px;
    flex-shrink: 0;
  }
  
  .node-error-tooltip .error-text {
    font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Mono', monospace;
    font-size: 11px;
    color: #fca5a5;
    line-height: 1.4;
    word-break: break-word;
  }
  
  /* Output node overlay - shows generated images */
  .output-node-overlay {
    position: relative;
    /* border-radius set via inline style for dynamic zoom scaling */
    overflow: hidden; /* Clip image to border-radius */
    pointer-events: none;
    background: #1a1a1e;
    user-select: none;
    -webkit-user-select: none;
    transition: border 0.15s ease;
    border: 0.509px solid transparent;
  }
  
  /* Selected state - use box-shadow instead of border to avoid corner gaps */
  .output-node-overlay.selected {
    border-color: transparent;
    box-shadow: 0 0 0 1px #9E9EA0, 0 0 0 2px rgba(158, 158, 160, 0.2);
  }
  
  /* Error state for output nodes */
  .output-node-overlay.error {
    border: 2px solid #ef4444;
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.3);
  }
  
  .output-node-overlay img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    pointer-events: none;
    border-radius: inherit; /* Inherit from parent container */
  }
  
  .output-node-overlay.empty {
    border: 2px dashed rgba(52, 211, 153, 0.5);
    background: rgba(52, 211, 153, 0.1);
  }
  
  .output-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    color: rgba(52, 211, 153, 0.7);
  }
  
  .output-placeholder svg {
    width: 48px;
    height: 48px;
    opacity: 0.5;
  }
  
  .output-placeholder span {
    font-size: 12px;
    font-weight: 500;
    opacity: 0.7;
  }
  
  .output-node-overlay.fade-in {
    animation: node-fade-in 80ms ease-out forwards;
  }
  
  /* Mesh output node overlay (3D meshes) */
  .mesh-node-overlay {
    position: relative;
    /* border-radius set via inline style for dynamic zoom scaling */
    overflow: hidden; /* Clip content to border-radius */
    pointer-events: none;
    background: #eeeeee; /* Match MeshViewer and thumbnail background */
    user-select: none;
    -webkit-user-select: none;
    transition: border 0.15s ease;
    border: 0.509px solid transparent;
  }
  
  .mesh-node-overlay.selected {
    border-color: transparent;
    box-shadow: 0 0 0 1px #9E9EA0, 0 0 0 2px rgba(158, 158, 160, 0.2);
  }
  
  .mesh-node-overlay.error {
    border: 2px solid #ef4444;
    box-shadow: 0 0 12px rgba(239, 68, 68, 0.3);
  }
  
  .mesh-node-overlay img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
    user-select: none;
    -webkit-user-select: none;
    -webkit-user-drag: none;
    border-radius: inherit;
  }
  
  .mesh-badge {
    position: absolute;
    top: 8px;
    right: 8px;
    padding: 2px 6px;
    background: rgba(77, 166, 255, 0.9);
    color: white;
    font-size: 9px;
    font-weight: 700;
    border-radius: 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    pointer-events: none;
    z-index: 2;
  }
  
  /* Video preview for mesh output nodes */
  .mesh-video-preview {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
    background: #1a1a1f;
    pointer-events: none;
  }
  
  /* Embedded MeshViewer container - hidden by default, shown on hover/select */
  .mesh-viewer-container {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border-radius: inherit;
    overflow: hidden;
    pointer-events: none;
    opacity: 0;
    transition: opacity 0.03s ease-out;
    /* No visibility:hidden - keep rendering for smooth cross-fade */
  }
  
  .mesh-viewer-container.visible {
    opacity: 1;
  }
  
  .mesh-viewer-container :global(canvas) {
    border-radius: inherit !important;
    pointer-events: none;
  }
  
  /* Cross-fade thumbnail when 3D viewer is active */
  .mesh-thumbnail,
  .mesh-placeholder {
    transition: opacity 0.2s ease-out;
  }
  
  .mesh-thumbnail.hidden,
  .mesh-placeholder.hidden {
    opacity: 0;
    /* No visibility:hidden - keep in DOM for smooth cross-fade */
  }
  
  .mesh-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: #eeeeee; /* Match MeshViewer background */
    color: rgba(0, 0, 0, 0.5);
  }
  
  .mesh-placeholder svg {
    width: 48px;
    height: 48px;
    opacity: 0.5;
  }
  
  .mesh-placeholder span {
    font-size: 12px;
    font-weight: 500;
    opacity: 0.7;
  }
  
  .mesh-loading-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    background: rgba(238, 238, 238, 0.95); /* Match MeshViewer background */
    color: rgba(0, 0, 0, 0.6);
    font-size: 11px;
    border-radius: inherit;
  }
  
  .mesh-spinner {
    width: 24px;
    height: 24px;
    border: 2px solid rgba(0, 0, 0, 0.1);
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  .thumbnail-loading-spinner {
    width: 32px;
    height: 32px;
    border: 2px solid rgba(0, 0, 0, 0.1);
    border-top-color: #6366f1;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  
  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
  
  .mesh-node-overlay.fade-in {
    animation: node-fade-in 80ms ease-out forwards;
  }
  
  .marquee-rect {
    position: absolute;
    border: 1px dashed rgba(255, 255, 255, 0.7);
    background: rgba(99, 102, 241, 0.1);
    pointer-events: none;
    border-radius: 4px;
  }

  .group-selection-bounds {
    position: absolute;
    border-style: solid;
    border-color: rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.03);
    pointer-events: none;
    z-index: 12;
  }
  
  /* Hover bounds - hidden for new design (handled by node overlay) */
  .hover-bounds {
    display: none;
  }
  
  /* Selection bounds - only show for multi-node selection */
  .selection-bounds {
    display: none;
  }

  .group-section {
    position: absolute;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.15);
    z-index: 12;
    pointer-events: auto;
  }
  
  .group-section.selected {
    border-color: rgba(255, 255, 255, 0.6);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  }
  
  .group-section:hover {
    cursor: grab;
  }
  
  .group-section.hover-resize {
    cursor: nwse-resize;
  }
  
  .group-title {
    position: absolute;
    top: -28px;
    left: 8px;
    padding: 2px 8px;
    background: #1a1a1e;
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 10px;
    font-size: 11px;
    color: rgba(244, 244, 244, 0.9);
    pointer-events: auto;
    cursor: grab;
    font-family: 'Helvetica Now Display', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    text-align: left;
    appearance: none;
  }

  .group-title:active {
    cursor: grabbing;
  }
  
  .group-resize-handle {
    position: absolute;
    right: 6px;
    bottom: 6px;
    width: 12px;
    height: 12px;
    border-radius: 4px;
    border: 1px solid rgba(255, 255, 255, 0.6);
    background: rgba(255, 255, 255, 0.2);
    cursor: se-resize;
    pointer-events: auto;
  }
  
  .selection-handle {
    display: none; /* Handles removed for cleaner look */
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
