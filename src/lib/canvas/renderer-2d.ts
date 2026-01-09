/**
 * Canvas 2D Fallback Renderer
 * Used when WebGPU is not available
 */

import type { NodeInstance, Edge, Camera } from '../graph/types';
import { getNodeColor, nodeRegistry } from '../graph/nodes/registry';
import { getPortPositions, getPortPosition, getBezierControlPoints, PORT_HANDLE_RADIUS } from './ports';

// Theme colors interface
interface ThemeColors {
  bgPrimary: string;
  bgSecondary: string;
  bgTertiary: string;
  bgElevated: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  borderSubtle: string;
  borderDefault: string;
  gridDot: string;
}

// Default dark theme colors
const darkTheme: ThemeColors = {
  bgPrimary: '#0f0f11',
  bgSecondary: '#141416',
  bgTertiary: '#1c1c1f',
  bgElevated: '#242428',
  textPrimary: '#f0f0f2',
  textSecondary: '#a0a0a8',
  textMuted: '#606068',
  borderSubtle: 'rgba(255, 255, 255, 0.06)',
  borderDefault: 'rgba(255, 255, 255, 0.1)',
  gridDot: 'rgba(100, 100, 110, 0.4)',
};

// Light theme colors
const lightTheme: ThemeColors = {
  bgPrimary: '#fafafa',
  bgSecondary: '#f5f5f5',
  bgTertiary: '#ebebeb',
  bgElevated: '#ffffff',
  textPrimary: '#1a1a1a',
  textSecondary: '#525252',
  textMuted: '#9a9a9a',
  borderSubtle: 'rgba(0, 0, 0, 0.06)',
  borderDefault: 'rgba(0, 0, 0, 0.12)',
  gridDot: 'rgba(0, 0, 0, 0.12)',
};

export class Canvas2DRenderer {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null = null;
  private width = 0;
  private height = 0;
  private dpr = 1;
  private theme: ThemeColors = lightTheme;
  
  // Image cache for dropped images
  private imageCache = new Map<string, HTMLImageElement>();
  // Track node opacity for fade-in animation
  private nodeOpacity = new Map<string, { opacity: number; startTime: number }>();
  private readonly FADE_DURATION = 80; // ms
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }
  
  setTheme(isDark: boolean) {
    this.theme = isDark ? darkTheme : lightTheme;
  }
  
  async initialize(): Promise<boolean> {
    this.ctx = this.canvas.getContext('2d');
    if (!this.ctx) {
      console.error('Failed to get 2D context');
      return false;
    }
    
    this.dpr = window.devicePixelRatio;
    console.log('Canvas 2D renderer initialized (WebGPU fallback)');
    return true;
  }
  
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  
  // Interaction state for rendering
  private hoveredNodeId: string | null = null;
  private hoveredEdgeId: string | null = null;
  private selectedEdgeIds: Set<string> = new Set();
  private pendingConnection: {
    startX: number;
    startY: number;
    endX: number;
    endY: number;
    isFromOutput: boolean;
  } | null = null;
  
  setInteractionState(state: {
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
  }) {
    if (state.hoveredNodeId !== undefined) this.hoveredNodeId = state.hoveredNodeId;
    if (state.hoveredEdgeId !== undefined) this.hoveredEdgeId = state.hoveredEdgeId;
    if (state.selectedEdgeIds !== undefined) this.selectedEdgeIds = state.selectedEdgeIds;
    if (state.pendingConnection !== undefined) this.pendingConnection = state.pendingConnection;
  }
  
  render(
    nodes: Map<string, NodeInstance>,
    edges: Map<string, Edge>,
    camera: Camera,
    selectedIds: Set<string>
  ) {
    if (!this.ctx) return;
    
    const ctx = this.ctx;
    const w = this.width * this.dpr;
    const h = this.height * this.dpr;
    
    // Clear canvas with background color
    ctx.fillStyle = this.theme.bgPrimary;
    ctx.fillRect(0, 0, w, h);
    
    // Save state and apply camera transform
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(camera.zoom * this.dpr, camera.zoom * this.dpr);
    ctx.translate(camera.x, camera.y);
    
    // Draw grid
    this.drawGrid(ctx, camera);
    
    // Edges are now rendered as SVG overlay in Canvas.svelte for reliability
    
    // Draw pending connection line
    if (this.pendingConnection) {
      this.drawPendingConnection(ctx, this.pendingConnection);
    }
    
    // Draw nodes (skip image and model nodes - they're rendered as DOM overlays)
    nodes.forEach((node) => {
      if (node.type !== 'image' && node.type !== 'model') {
        const isSelected = selectedIds.has(node.id);
        const isHovered = this.hoveredNodeId === node.id && !isSelected;
        this.drawNode(ctx, node, isSelected, isHovered);
      }
    });
    
    // Draw ports for all nodes (including image/model nodes since they need ports)
    nodes.forEach((node) => {
      const isSelected = selectedIds.has(node.id);
      const isHovered = this.hoveredNodeId === node.id;
      this.drawPorts(ctx, node, isSelected || isHovered);
    });
    
    ctx.restore();
    
    // Draw UI overlay (zoom indicator)
    this.drawOverlay(ctx, camera);
  }
  
  private drawGrid(ctx: CanvasRenderingContext2D, camera: Camera) {
    // Adaptive grid spacing based on zoom
    let spacing = 40;
    if (camera.zoom < 0.3) {
      spacing = 160;
    } else if (camera.zoom < 0.6) {
      spacing = 80;
    } else if (camera.zoom > 2) {
      spacing = 20;
    }
    
    // Calculate visible area in world coordinates
    const viewportW = this.width / camera.zoom;
    const viewportH = this.height / camera.zoom;
    const startX = Math.floor((-camera.x - viewportW / 2) / spacing) * spacing;
    const endX = Math.ceil((-camera.x + viewportW / 2) / spacing) * spacing;
    const startY = Math.floor((-camera.y - viewportH / 2) / spacing) * spacing;
    const endY = Math.ceil((-camera.y + viewportH / 2) / spacing) * spacing;
    
    // Dot size
    const dotRadius = 1.5;
    
    // Fade factor for extreme zoom levels
    let alpha = 1;
    if (camera.zoom < 0.2) {
      alpha = camera.zoom / 0.2;
    }
    
    // Parse the grid dot color and apply alpha
    const dotColor = this.theme.gridDot;
    if (dotColor.startsWith('rgba')) {
      // Extract existing alpha and multiply
      const match = dotColor.match(/rgba\(([^)]+)\)/);
      if (match) {
        const parts = match[1].split(',');
        const existingAlpha = parseFloat(parts[3] || '1');
        ctx.fillStyle = `rgba(${parts[0]},${parts[1]},${parts[2]}, ${existingAlpha * alpha})`;
      } else {
        ctx.fillStyle = dotColor;
      }
    } else {
      ctx.fillStyle = dotColor;
    }
    
    // Draw dots
    for (let x = startX; x <= endX; x += spacing) {
      for (let y = startY; y <= endY; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  
  private drawNode(ctx: CanvasRenderingContext2D, node: NodeInstance, selected: boolean, hovered: boolean = false) {
    const { x, y, width, height, type, status, id } = node;
    const [r, g, b] = getNodeColor(type);
    const radius = 12;
    
    // Calculate opacity for fade-in animation
    let opacity = 1;
    if (!this.nodeOpacity.has(id)) {
      this.nodeOpacity.set(id, { opacity: 0, startTime: performance.now() });
    }
    const opacityData = this.nodeOpacity.get(id)!;
    const elapsed = performance.now() - opacityData.startTime;
    if (elapsed < this.FADE_DURATION) {
      opacity = Math.min(1, elapsed / this.FADE_DURATION);
      opacityData.opacity = opacity;
    } else {
      opacity = 1;
    }
    
    ctx.save();
    ctx.globalAlpha = opacity;
    
    // Draw shadow
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    this.roundRect(ctx, x + 4, y + 4, width, height, radius);
    ctx.fill();
    
    // Handle image nodes specially
    if (type === 'image' && node.params.imageUrl) {
      this.drawImageNode(ctx, node, selected, radius);
    } else {
      // Draw regular node body
      const gradient = ctx.createLinearGradient(x, y, x, y + height);
      gradient.addColorStop(0, `rgba(${r * 255}, ${g * 255}, ${b * 255}, 1)`);
      gradient.addColorStop(1, `rgba(${r * 200}, ${g * 200}, ${b * 200}, 1)`);
      ctx.fillStyle = gradient;
      this.roundRect(ctx, x, y, width, height, radius);
      ctx.fill();
      
      // Draw node title
      const def = nodeRegistry[type];
      if (def) {
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px Sora, system-ui, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(def.name, x + 12, y + 12);
        
        // Draw category
        ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
        ctx.font = '10px Sora, system-ui, sans-serif';
        ctx.fillText(def.category.toUpperCase(), x + 12, y + 30);
      }
    }
    
    // Draw border
    ctx.strokeStyle = selected ? '#ffffff' : hovered ? 'rgba(255, 255, 255, 0.5)' : 'rgba(255, 255, 255, 0.15)';
    ctx.lineWidth = selected ? 2.5 : hovered ? 1.5 : 1;
    this.roundRect(ctx, x, y, width, height, radius);
    ctx.stroke();
    
    // Draw selection glow (white)
    if (selected) {
      ctx.shadowColor = 'rgba(255, 255, 255, 0.5)';
      ctx.shadowBlur = 15;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      this.roundRect(ctx, x, y, width, height, radius);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    
    // Draw status indicator (only for non-image nodes)
    if (type !== 'image') {
      this.drawStatusIndicator(ctx, x + width - 16, y + 12, status);
    }
    
    ctx.restore();
  }
  
  private drawImageNode(ctx: CanvasRenderingContext2D, node: NodeInstance, selected: boolean, radius: number) {
    const { x, y, width, height, id } = node;
    const imageUrl = node.params.imageUrl as string;
    
    // Get or load the image
    let img = this.imageCache.get(imageUrl);
    if (!img) {
      img = new Image();
      img.src = imageUrl;
      this.imageCache.set(imageUrl, img);
    }
    
    // Draw dark background first
    ctx.fillStyle = '#1a1a1e';
    this.roundRect(ctx, x, y, width, height, radius);
    ctx.fill();
    
    // Draw the image if loaded
    if (img.complete && img.naturalWidth > 0) {
      ctx.save();
      
      // Clip to rounded rect
      this.roundRect(ctx, x, y, width, height, radius);
      ctx.clip();
      
      // Draw the image scaled to fit
      ctx.drawImage(img, x, y, width, height);
      
      ctx.restore();
    } else {
      // Show loading placeholder
      ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.font = '12px Sora, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('Loading...', x + width / 2, y + height / 2);
      ctx.textAlign = 'left';
    }
  }
  
  private drawPorts(ctx: CanvasRenderingContext2D, node: NodeInstance, showHandles: boolean = false) {
    const positions = getPortPositions(node);
    if (positions.length === 0) return;
    
    const portRadius = PORT_HANDLE_RADIUS;
    
    positions.forEach((port) => {
      const { x, y, type, isOutput } = port;
      
      // Draw port background/ring
      ctx.fillStyle = this.theme.bgPrimary;
      ctx.beginPath();
      ctx.arc(x, y, portRadius + 2, 0, Math.PI * 2);
      ctx.fill();
      
      // Draw port fill
      const portColor = showHandles ? '#ffffff' : this.getPortColor(type);
      ctx.fillStyle = portColor;
      ctx.beginPath();
      ctx.arc(x, y, portRadius, 0, Math.PI * 2);
      ctx.fill();
      
      // Add subtle border
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(x, y, portRadius, 0, Math.PI * 2);
      ctx.stroke();
    });
  }
  
  private getPortColor(type: string): string {
    switch (type) {
      case 'string': return '#10b981';
      case 'image': return '#f59e0b';
      case 'tensor': return '#6366f1';
      case 'number': return '#3b82f6';
      default: return '#a0a0a8';
    }
  }
  
  private drawStatusIndicator(ctx: CanvasRenderingContext2D, x: number, y: number, status: string) {
    const colors: Record<string, string> = {
      idle: '#606068',
      pending: '#f59e0b',
      running: '#6366f1',
      complete: '#10b981',
      error: '#ef4444',
    };
    
    ctx.fillStyle = colors[status] || colors.idle;
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  
  private drawEdge(
    ctx: CanvasRenderingContext2D, 
    edge: Edge,
    source: NodeInstance, 
    target: NodeInstance,
    isSelected: boolean = false,
    isHovered: boolean = false
  ) {
    // Get port positions
    const sourcePort = getPortPosition(source, edge.sourcePortId, true);
    const targetPort = getPortPosition(target, edge.targetPortId, false);
    
    // Use port positions or fallback to center edges
    const x0 = sourcePort?.x ?? (source.x + source.width);
    const y0 = sourcePort?.y ?? (source.y + source.height / 2);
    const x3 = targetPort?.x ?? target.x;
    const y3 = targetPort?.y ?? (target.y + target.height / 2);
    
    this.drawBezierConnection(ctx, x0, y0, x3, y3, isSelected, isHovered);
  }
  
  private drawBezierConnection(
    ctx: CanvasRenderingContext2D,
    x0: number, y0: number,
    x3: number, y3: number,
    isSelected: boolean = false,
    isHovered: boolean = false
  ) {
    const { cp1x, cp1y, cp2x, cp2y } = getBezierControlPoints(x0, y0, x3, y3);
    
    // Debug: draw visible circles at the endpoints
    ctx.save();
    ctx.fillStyle = '#ff0000';
    ctx.beginPath();
    ctx.arc(x0, y0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#00ff00';
    ctx.beginPath();
    ctx.arc(x3, y3, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    
    // Determine colors based on state
    let lineColor = 'rgba(200, 200, 220, 0.6)';
    let glowColor = 'rgba(200, 200, 220, 0.15)';
    let lineWidth = 2;
    let glowWidth = 6;
    
    if (isSelected) {
      lineColor = '#ffffff';
      glowColor = 'rgba(255, 255, 255, 0.3)';
      lineWidth = 2.5;
      glowWidth = 10;
    } else if (isHovered) {
      lineColor = 'rgba(255, 255, 255, 0.85)';
      glowColor = 'rgba(255, 255, 255, 0.2)';
      lineWidth = 2.5;
      glowWidth = 8;
    }
    
    // Draw glow
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = glowWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x3, y3);
    ctx.stroke();
    
    // Draw main wire
    ctx.strokeStyle = lineColor;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x3, y3);
    ctx.stroke();
  }
  
  private drawPendingConnection(
    ctx: CanvasRenderingContext2D, 
    connection: {
      startX: number;
      startY: number;
      endX: number;
      endY: number;
      isFromOutput: boolean;
    }
  ) {
    const { startX, startY, endX, endY, isFromOutput } = connection;
    
    // Swap if dragging from input
    const x0 = isFromOutput ? startX : endX;
    const y0 = isFromOutput ? startY : endY;
    const x3 = isFromOutput ? endX : startX;
    const y3 = isFromOutput ? endY : startY;
    
    const { cp1x, cp1y, cp2x, cp2y } = getBezierControlPoints(x0, y0, x3, y3);
    
    // Draw with dashed style for pending
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, x3, y3);
    ctx.stroke();
    ctx.setLineDash([]);
    
    // Draw endpoint circle
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x3, y3, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  
  private drawOverlay(ctx: CanvasRenderingContext2D, camera: Camera) {
    const padding = 16 * this.dpr;
    const boxWidth = 70 * this.dpr;
    const boxHeight = 28 * this.dpr;
    
    // Zoom indicator background
    ctx.fillStyle = this.theme.bgElevated;
    this.roundRect(ctx, padding, this.height * this.dpr - padding - boxHeight, boxWidth, boxHeight, 8 * this.dpr);
    ctx.fill();
    
    // Zoom text
    ctx.fillStyle = this.theme.textSecondary;
    ctx.font = `${12 * this.dpr}px JetBrains Mono, monospace`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${Math.round(camera.zoom * 100)}%`, padding + 12 * this.dpr, this.height * this.dpr - padding - boxHeight / 2);
  }
  
  private roundRect(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    width: number, height: number,
    radius: number
  ) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }
  
  hitTest(
    screenX: number,
    screenY: number,
    nodes: Map<string, NodeInstance>,
    camera: Camera,
    viewportWidth?: number,
    viewportHeight?: number
  ): NodeInstance | null {
    // Use provided dimensions or fall back to stored (fresh dimensions preferred)
    const w = viewportWidth ?? this.width;
    const h = viewportHeight ?? this.height;
    
    const worldX = (screenX - w / 2) / camera.zoom - camera.x;
    const worldY = (screenY - h / 2) / camera.zoom - camera.y;
    
    const nodeArray = Array.from(nodes.values()).reverse();
    
    for (const node of nodeArray) {
      if (
        worldX >= node.x &&
        worldX <= node.x + node.width &&
        worldY >= node.y &&
        worldY <= node.y + node.height
      ) {
        return node;
      }
    }
    
    return null;
  }
  
  // Convert world coordinates to screen (CSS) coordinates
  // Uses the renderer's internal dimensions to ensure consistency with rendering
  worldToScreen(worldX: number, worldY: number, camera: Camera): { x: number; y: number } {
    return {
      x: (worldX + camera.x) * camera.zoom + this.width / 2,
      y: (worldY + camera.y) * camera.zoom + this.height / 2,
    };
  }
  
  // Get the current viewport dimensions
  getViewportSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
  
  // Hit test for edges - checks if point is near a bezier curve
  hitTestEdge(
    worldX: number,
    worldY: number,
    nodes: Map<string, NodeInstance>,
    edges: Map<string, Edge>,
    threshold: number = 8
  ): string | null {
    for (const [edgeId, edge] of edges) {
      const sourceNode = nodes.get(edge.sourceNodeId);
      const targetNode = nodes.get(edge.targetNodeId);
      if (!sourceNode || !targetNode) continue;
      
      const sourcePort = getPortPosition(sourceNode, edge.sourcePortId, true);
      const targetPort = getPortPosition(targetNode, edge.targetPortId, false);
      
      if (!sourcePort || !targetPort) continue;
      
      const { cp1x, cp1y, cp2x, cp2y } = getBezierControlPoints(
        sourcePort.x, sourcePort.y,
        targetPort.x, targetPort.y
      );
      
      // Sample points along the bezier curve and check distance
      const samples = 20;
      for (let i = 0; i <= samples; i++) {
        const t = i / samples;
        const point = this.getBezierPoint(
          sourcePort.x, sourcePort.y,
          cp1x, cp1y,
          cp2x, cp2y,
          targetPort.x, targetPort.y,
          t
        );
        
        const dx = worldX - point.x;
        const dy = worldY - point.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance <= threshold) {
          return edgeId;
        }
      }
    }
    
    return null;
  }
  
  // Get point on bezier curve at parameter t
  private getBezierPoint(
    x0: number, y0: number,
    cp1x: number, cp1y: number,
    cp2x: number, cp2y: number,
    x3: number, y3: number,
    t: number
  ): { x: number; y: number } {
    const mt = 1 - t;
    const mt2 = mt * mt;
    const mt3 = mt2 * mt;
    const t2 = t * t;
    const t3 = t2 * t;
    
    return {
      x: mt3 * x0 + 3 * mt2 * t * cp1x + 3 * mt * t2 * cp2x + t3 * x3,
      y: mt3 * y0 + 3 * mt2 * t * cp1y + 3 * mt * t2 * cp2y + t3 * y3,
    };
  }
  
  destroy() {
    // Clean up caches
    this.imageCache.clear();
    this.nodeOpacity.clear();
  }
}
