/**
 * WebGPU Canvas Renderer
 * Renders the node graph with instanced drawing for efficiency
 */

import type { NodeInstance, Edge, Camera } from '../graph/types';
import { getNodeColor } from '../graph/nodes/registry';
import { getPortPosition, getBezierControlPoints } from './ports';
import { getShaderNodeRadius } from './node-style';
import nodesWGSL from './nodes.wgsl?raw';
import wiresWGSL from './wires.wgsl?raw';
import gridWGSL from './grid.wgsl?raw';

interface NodeInstanceGPU {
  x: number;
  y: number;
  width: number;
  height: number;
  r: number;
  g: number;
  b: number;
  a: number;
  borderRadius: number;
  selected: number;
  status: number;
  _pad: number;
}

interface WireInstanceGPU {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export class CanvasRenderer {
  private canvas: HTMLCanvasElement;
  private context: GPUCanvasContext | null = null;
  private device: GPUDevice | null = null;
  private format: GPUTextureFormat = 'bgra8unorm';
  
  // Pipelines
  private nodePipeline: GPURenderPipeline | null = null;
  private wirePipeline: GPURenderPipeline | null = null;
  private gridPipeline: GPURenderPipeline | null = null;
  
  // Buffers
  private cameraBuffer: GPUBuffer | null = null;
  private nodeBuffer: GPUBuffer | null = null;
  private wireBuffer: GPUBuffer | null = null;
  private quadBuffer: GPUBuffer | null = null;
  
  // Bind groups
  private nodeBindGroup: GPUBindGroup | null = null;
  private wireBindGroup: GPUBindGroup | null = null;
  private gridBindGroup: GPUBindGroup | null = null;
  
  // State
  private width = 0;
  private height = 0;
  private maxNodes = 1024;
  private maxWires = 2048;
  private currentZoom = 1;
  
  // Theme colors (rgba)
  private clearColor = { r: 0.98, g: 0.98, b: 0.98, a: 1.0 }; // Light mode default
  private gridColorBuffer: GPUBuffer | null = null;
  private isDarkTheme = false;
  
  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
  }
  
  setTheme(isDark: boolean) {
    this.isDarkTheme = isDark;
    if (isDark) {
      // Dark theme
      this.clearColor = { r: 0.06, g: 0.06, b: 0.07, a: 1.0 };
    } else {
      // Light theme
      this.clearColor = { r: 0.98, g: 0.98, b: 0.98, a: 1.0 };
    }
    this.updateGridColor();
  }
  
  private updateGridColor() {
    if (!this.device || !this.gridColorBuffer) return;
    
    // Grid dot color depends on theme
    let gridColor: Float32Array;
    if (this.isDarkTheme) {
      // Dark theme: light gray dots
      gridColor = new Float32Array([0.25, 0.25, 0.28, 0.6]);
    } else {
      // Light theme: dark gray dots
      gridColor = new Float32Array([0.0, 0.0, 0.0, 0.12]);
    }
    
    this.device.queue.writeBuffer(this.gridColorBuffer, 0, gridColor);
  }
  
  async initialize(): Promise<boolean> {
    if (!navigator.gpu) {
      console.error('WebGPU not supported');
      return false;
    }
    
    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    });
    
    if (!adapter) {
      console.error('No WebGPU adapter found');
      return false;
    }
    
    this.device = await adapter.requestDevice({
      requiredFeatures: [],
      requiredLimits: {},
    });
    
    if (!this.device) {
      console.error('Failed to get WebGPU device');
      return false;
    }
    
    this.context = this.canvas.getContext('webgpu');
    if (!this.context) {
      console.error('Failed to get WebGPU context');
      return false;
    }
    
    this.format = navigator.gpu.getPreferredCanvasFormat();
    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: 'premultiplied',
    });
    
    // Create buffers
    this.createBuffers();
    
    // Create pipelines
    await this.createPipelines();
    
    return true;
  }
  
  private createBuffers() {
    if (!this.device) return;
    
    // Camera uniform buffer (mat4 + viewport)
    this.cameraBuffer = this.device.createBuffer({
      size: 80, // 64 bytes for mat4 + 16 bytes for viewport
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    
    // Node instance buffer
    this.nodeBuffer = this.device.createBuffer({
      size: this.maxNodes * 48, // NodeInstanceGPU is 48 bytes
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    
    // Wire instance buffer
    this.wireBuffer = this.device.createBuffer({
      size: this.maxWires * 48, // WireInstanceGPU is 48 bytes
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    
    // Quad vertex buffer (2 triangles forming a quad)
    const quadVertices = new Float32Array([
      // Triangle 1
      0, 0,
      1, 0,
      0, 1,
      // Triangle 2
      1, 0,
      1, 1,
      0, 1,
    ]);
    
    this.quadBuffer = this.device.createBuffer({
      size: quadVertices.byteLength,
      usage: GPUBufferUsage.VERTEX,
      mappedAtCreation: true,
    });
    new Float32Array(this.quadBuffer.getMappedRange()).set(quadVertices);
    this.quadBuffer.unmap();
  }
  
  private async createPipelines() {
    if (!this.device) return;
    
    // Node shader module
    const nodeModule = this.device.createShaderModule({
      label: 'Node shader',
      code: nodesWGSL,
    });
    
    // Wire shader module
    const wireModule = this.device.createShaderModule({
      label: 'Wire shader',
      code: wiresWGSL,
    });
    
    // Bind group layout for nodes
    const nodeBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    
    // Bind group layout for wires
    const wireBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'read-only-storage' },
        },
      ],
    });
    
    // Create node pipeline
    this.nodePipeline = this.device.createRenderPipeline({
      label: 'Node pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [nodeBindGroupLayout],
      }),
      vertex: {
        module: nodeModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [
              { format: 'float32x2', offset: 0, shaderLocation: 0 },
            ],
          },
        ],
      },
      fragment: {
        module: nodeModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
    
    // Create wire pipeline
    this.wirePipeline = this.device.createRenderPipeline({
      label: 'Wire pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [wireBindGroupLayout],
      }),
      vertex: {
        module: wireModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [
              { format: 'float32x2', offset: 0, shaderLocation: 0 },
            ],
          },
        ],
      },
      fragment: {
        module: wireModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
    
    // Grid shader module
    const gridModule = this.device.createShaderModule({
      label: 'Grid shader',
      code: gridWGSL,
    });
    
    // Create grid config buffer for theme colors
    this.gridColorBuffer = this.device.createBuffer({
      size: 16, // vec4f (rgba)
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // Initialize with light theme color
    this.updateGridColor();
    
    // Bind group layout for grid (camera + grid config)
    const gridBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
      ],
    });
    
    // Create grid pipeline
    this.gridPipeline = this.device.createRenderPipeline({
      label: 'Grid pipeline',
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [gridBindGroupLayout],
      }),
      vertex: {
        module: gridModule,
        entryPoint: 'vs_main',
        buffers: [
          {
            arrayStride: 8,
            stepMode: 'vertex',
            attributes: [
              { format: 'float32x2', offset: 0, shaderLocation: 0 },
            ],
          },
        ],
      },
      fragment: {
        module: gridModule,
        entryPoint: 'fs_main',
        targets: [
          {
            format: this.format,
            blend: {
              color: {
                srcFactor: 'src-alpha',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
              alpha: {
                srcFactor: 'one',
                dstFactor: 'one-minus-src-alpha',
                operation: 'add',
              },
            },
          },
        ],
      },
      primitive: {
        topology: 'triangle-list',
      },
    });
    
    // Create bind groups
    this.nodeBindGroup = this.device.createBindGroup({
      layout: nodeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer! } },
        { binding: 1, resource: { buffer: this.nodeBuffer! } },
      ],
    });
    
    this.wireBindGroup = this.device.createBindGroup({
      layout: wireBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer! } },
        { binding: 1, resource: { buffer: this.wireBuffer! } },
      ],
    });
    
    this.gridBindGroup = this.device.createBindGroup({
      layout: gridBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraBuffer! } },
        { binding: 1, resource: { buffer: this.gridColorBuffer! } },
      ],
    });
  }
  
  resize(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
  
  private updateCameraBuffer(camera: Camera) {
    if (!this.device || !this.cameraBuffer) return;
    
    const dpr = window.devicePixelRatio;
    const w = this.width * dpr;
    const h = this.height * dpr;
    
    // Create view-projection matrix (top-left anchored)
    // Maps world coordinates so that camera position appears at top-left of screen
    const effectiveZoom = camera.zoom * dpr;
    const scaleX = (2 * effectiveZoom) / w;
    const scaleY = (2 * effectiveZoom) / h;
    // Offset by -1 for X and +1 for Y to anchor to top-left instead of center
    const translateX = camera.x * scaleX - 1;
    const translateY = -camera.y * scaleY + 1;
    
    // Column-major 4x4 matrix
    const matrix = new Float32Array([
      scaleX, 0, 0, 0,
      0, -scaleY, 0, 0, // Flip Y for canvas coordinates
      0, 0, 1, 0,
      translateX, translateY, 0, 1,
    ]);
    
    // Viewport data
    const viewport = new Float32Array([w, h, camera.zoom, 0]);
    
    this.device.queue.writeBuffer(this.cameraBuffer, 0, matrix);
    this.device.queue.writeBuffer(this.cameraBuffer, 64, viewport);
  }
  
  private updateNodeBuffer(nodes: Map<string, NodeInstance>, selectedIds: Set<string>) {
    if (!this.device || !this.nodeBuffer) return;
    
    // Filter out image and model nodes (they're rendered as DOM overlays)
    const nodeArray = Array.from(nodes.values()).filter(n => n.type !== 'image' && n.type !== 'model');
    const count = Math.min(nodeArray.length, this.maxNodes);
    
    const data = new Float32Array(count * 12); // 12 floats per node
    
    for (let i = 0; i < count; i++) {
      const node = nodeArray[i];
      const color = getNodeColor(node.type);
      const isSelected = selectedIds.has(node.id) ? 1 : 0;
      const statusCode = this.getStatusCode(node.status);
      
      const offset = i * 12;
      data[offset + 0] = node.x;
      data[offset + 1] = node.y;
      data[offset + 2] = node.width;
      data[offset + 3] = node.height;
      data[offset + 4] = color[0];
      data[offset + 5] = color[1];
      data[offset + 6] = color[2];
      data[offset + 7] = color[3];
      data[offset + 8] = getShaderNodeRadius(this.currentZoom); // Border radius
      data[offset + 9] = isSelected;
      data[offset + 10] = statusCode;
      data[offset + 11] = 0; // Padding
    }
    
    this.device.queue.writeBuffer(this.nodeBuffer, 0, data);
    
    return count;
  }
  
  private getStatusCode(status: string): number {
    switch (status) {
      case 'idle': return 0;
      case 'pending': return 1;
      case 'running': return 2;
      case 'complete': return 3;
      case 'error': return 4;
      default: return 0;
    }
  }
  
  private updateWireBuffer(
    edges: Map<string, Edge>,
    nodes: Map<string, NodeInstance>
  ) {
    if (!this.device || !this.wireBuffer) return;
    
    const edgeArray = Array.from(edges.values());
    const count = Math.min(edgeArray.length, this.maxWires);
    
    const data = new Float32Array(count * 12); // 12 floats per wire
    
    for (let i = 0; i < count; i++) {
      const edge = edgeArray[i];
      const sourceNode = nodes.get(edge.sourceNodeId);
      const targetNode = nodes.get(edge.targetNodeId);
      
      if (!sourceNode || !targetNode) continue;
      
      // Get port positions using the port utility
      const sourcePort = getPortPosition(sourceNode, edge.sourcePortId, true);
      const targetPort = getPortPosition(targetNode, edge.targetPortId, false);
      
      // Fall back to default positions if ports not found
      const x0 = sourcePort?.x ?? (sourceNode.x + sourceNode.width);
      const y0 = sourcePort?.y ?? (sourceNode.y + sourceNode.height / 2);
      const x3 = targetPort?.x ?? targetNode.x;
      const y3 = targetPort?.y ?? (targetNode.y + targetNode.height / 2);
      
      // Get bezier control points
      const { cp1x, cp1y, cp2x, cp2y } = getBezierControlPoints(x0, y0, x3, y3);
      
      const offset = i * 12;
      data[offset + 0] = x0;
      data[offset + 1] = y0;
      data[offset + 2] = cp1x;
      data[offset + 3] = cp1y;
      data[offset + 4] = cp2x;
      data[offset + 5] = cp2y;
      data[offset + 6] = x3;
      data[offset + 7] = y3;
      // Wire color (white with some transparency)
      data[offset + 8] = 0.8;
      data[offset + 9] = 0.8;
      data[offset + 10] = 0.9;
      data[offset + 11] = 0.7;
    }
    
    this.device.queue.writeBuffer(this.wireBuffer, 0, data);
    
    return count;
  }
  
  render(
    nodes: Map<string, NodeInstance>,
    edges: Map<string, Edge>,
    camera: Camera,
    selectedIds: Set<string>
  ) {
    if (!this.device || !this.context || !this.nodePipeline || !this.wirePipeline || !this.gridPipeline) {
      return;
    }
    
    // Store current zoom for use in buffer updates
    this.currentZoom = camera.zoom;
    
    // Update buffers
    this.updateCameraBuffer(camera);
    const nodeCount = this.updateNodeBuffer(nodes, selectedIds) ?? 0;
    const wireCount = this.updateWireBuffer(edges, nodes) ?? 0;
    
    // Get current texture
    const textureView = this.context.getCurrentTexture().createView();
    
    // Create command encoder
    const encoder = this.device.createCommandEncoder();
    
    // Begin render pass
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: textureView,
          clearValue: this.clearColor,
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
    });
    
    // Draw grid first (background)
    pass.setPipeline(this.gridPipeline);
    pass.setBindGroup(0, this.gridBindGroup!);
    pass.setVertexBuffer(0, this.quadBuffer!);
    pass.draw(6, 1); // Single full-screen quad
    
    // Wires are now rendered as SVG overlay in Canvas.svelte for reliability
    // (prevents coordinate misalignment and ghost rendering on resize)
    
    // Draw nodes
    if (nodeCount > 0) {
      pass.setPipeline(this.nodePipeline);
      pass.setBindGroup(0, this.nodeBindGroup!);
      pass.setVertexBuffer(0, this.quadBuffer!);
      pass.draw(6, nodeCount);
    }
    
    pass.end();
    
    // Submit
    this.device.queue.submit([encoder.finish()]);
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
    
    // Convert screen coordinates to world coordinates
    const worldX = (screenX - w / 2) / camera.zoom - camera.x;
    const worldY = (screenY - h / 2) / camera.zoom - camera.y;
    
    // Test nodes in reverse order (top to bottom in z-order)
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
  
  destroy() {
    this.cameraBuffer?.destroy();
    this.nodeBuffer?.destroy();
    this.wireBuffer?.destroy();
    this.quadBuffer?.destroy();
  }
  
  // Convert world coordinates to screen (CSS) coordinates
  // Top-left anchored: no center offset for stable positions on resize
  worldToScreen(worldX: number, worldY: number, camera: Camera): { x: number; y: number } {
    return {
      x: (worldX + camera.x) * camera.zoom,
      y: (worldY + camera.y) * camera.zoom,
    };
  }
  
  // Get the current viewport dimensions
  getViewportSize(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
  
  // Interaction state (used by Canvas2D renderer, stub for WebGPU)
  // TODO: Implement proper interaction state rendering in WebGPU
  setInteractionState(_state: {
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
    // WebGPU renderer currently doesn't use this, but connection rendering
    // is handled by the wire buffer. Future improvement: add hover/selection states.
  }
  
  // Hit test for edges
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
      
      if (!sourcePort || !targetPort) {
        // Fallback to center
        const x0 = sourceNode.x + sourceNode.width;
        const y0 = sourceNode.y + sourceNode.height / 2;
        const x3 = targetNode.x;
        const y3 = targetNode.y + targetNode.height / 2;
        
        if (this.isPointNearBezier(worldX, worldY, x0, y0, x3, y3, threshold)) {
          return edgeId;
        }
        continue;
      }
      
      if (this.isPointNearBezier(
        worldX, worldY,
        sourcePort.x, sourcePort.y,
        targetPort.x, targetPort.y,
        threshold
      )) {
        return edgeId;
      }
    }
    
    return null;
  }
  
  private isPointNearBezier(
    worldX: number, worldY: number,
    x0: number, y0: number,
    x3: number, y3: number,
    threshold: number
  ): boolean {
    const { cp1x, cp1y, cp2x, cp2y } = getBezierControlPoints(x0, y0, x3, y3);
    
    const samples = 20;
    for (let i = 0; i <= samples; i++) {
      const t = i / samples;
      const point = this.getBezierPoint(x0, y0, cp1x, cp1y, cp2x, cp2y, x3, y3, t);
      
      const dx = worldX - point.x;
      const dy = worldY - point.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance <= threshold) {
        return true;
      }
    }
    
    return false;
  }
  
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
}
