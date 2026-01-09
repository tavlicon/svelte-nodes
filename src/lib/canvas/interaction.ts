/**
 * Interaction handling for the canvas
 * Hit testing, selection, and drag operations
 */

import type { NodeInstance, Edge, Camera } from '../graph/types';
import { nodeRegistry } from '../graph/nodes/registry';

export interface HitTestResult {
  type: 'node' | 'port' | 'edge' | 'empty';
  nodeId?: string;
  portId?: string;
  isOutput?: boolean;
  edgeId?: string;
}

export interface PortBounds {
  nodeId: string;
  portId: string;
  isOutput: boolean;
  x: number;
  y: number;
  radius: number;
}

const PORT_RADIUS = 8;
const PORT_OFFSET = 16;

export function getPortBounds(node: NodeInstance): PortBounds[] {
  const def = nodeRegistry[node.type];
  if (!def) return [];
  
  const ports: PortBounds[] = [];
  
  // Input ports (left side)
  const inputCount = def.inputs.length;
  def.inputs.forEach((port, i) => {
    const y = node.y + (i + 1) * (node.height / (inputCount + 1));
    ports.push({
      nodeId: node.id,
      portId: port.id,
      isOutput: false,
      x: node.x,
      y,
      radius: PORT_RADIUS,
    });
  });
  
  // Output ports (right side)
  const outputCount = def.outputs.length;
  def.outputs.forEach((port, i) => {
    const y = node.y + (i + 1) * (node.height / (outputCount + 1));
    ports.push({
      nodeId: node.id,
      portId: port.id,
      isOutput: true,
      x: node.x + node.width,
      y,
      radius: PORT_RADIUS,
    });
  });
  
  return ports;
}

export function hitTestNodes(
  worldX: number,
  worldY: number,
  nodes: Map<string, NodeInstance>
): HitTestResult {
  // Test nodes in reverse order (top to bottom in z-order)
  const nodeArray = Array.from(nodes.values()).reverse();
  
  for (const node of nodeArray) {
    // First check ports
    const ports = getPortBounds(node);
    for (const port of ports) {
      const dx = worldX - port.x;
      const dy = worldY - port.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= port.radius + 4) { // Add some tolerance
        return {
          type: 'port',
          nodeId: port.nodeId,
          portId: port.portId,
          isOutput: port.isOutput,
        };
      }
    }
    
    // Then check node body
    if (
      worldX >= node.x &&
      worldX <= node.x + node.width &&
      worldY >= node.y &&
      worldY <= node.y + node.height
    ) {
      return {
        type: 'node',
        nodeId: node.id,
      };
    }
  }
  
  return { type: 'empty' };
}

export function hitTestEdges(
  worldX: number,
  worldY: number,
  edges: Map<string, Edge>,
  nodes: Map<string, NodeInstance>,
  tolerance = 8
): HitTestResult {
  for (const [edgeId, edge] of edges) {
    const sourceNode = nodes.get(edge.sourceNodeId);
    const targetNode = nodes.get(edge.targetNodeId);
    
    if (!sourceNode || !targetNode) continue;
    
    // Get edge endpoints
    const x0 = sourceNode.x + sourceNode.width;
    const y0 = sourceNode.y + sourceNode.height / 2;
    const x3 = targetNode.x;
    const y3 = targetNode.y + targetNode.height / 2;
    
    // Bezier control points
    const dx = Math.abs(x3 - x0) * 0.5;
    const x1 = x0 + dx;
    const y1 = y0;
    const x2 = x3 - dx;
    const y2 = y3;
    
    // Sample the curve and check distance
    const samples = 32;
    for (let i = 0; i < samples; i++) {
      const t = i / (samples - 1);
      const point = evaluateBezier(t, x0, y0, x1, y1, x2, y2, x3, y3);
      const dist = Math.sqrt(
        Math.pow(worldX - point.x, 2) + Math.pow(worldY - point.y, 2)
      );
      
      if (dist <= tolerance) {
        return {
          type: 'edge',
          edgeId,
        };
      }
    }
  }
  
  return { type: 'empty' };
}

function evaluateBezier(
  t: number,
  x0: number, y0: number,
  x1: number, y1: number,
  x2: number, y2: number,
  x3: number, y3: number
): { x: number; y: number } {
  const t2 = t * t;
  const t3 = t2 * t;
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  
  return {
    x: mt3 * x0 + 3 * mt2 * t * x1 + 3 * mt * t2 * x2 + t3 * x3,
    y: mt3 * y0 + 3 * mt2 * t * y1 + 3 * mt * t2 * y2 + t3 * y3,
  };
}

// Selection rectangle helper
export function getNodesInRect(
  x1: number, y1: number,
  x2: number, y2: number,
  nodes: Map<string, NodeInstance>
): string[] {
  const minX = Math.min(x1, x2);
  const maxX = Math.max(x1, x2);
  const minY = Math.min(y1, y2);
  const maxY = Math.max(y1, y2);
  
  const selected: string[] = [];
  
  for (const [id, node] of nodes) {
    // Check if node intersects with selection rectangle
    if (
      node.x + node.width >= minX &&
      node.x <= maxX &&
      node.y + node.height >= minY &&
      node.y <= maxY
    ) {
      selected.push(id);
    }
  }
  
  return selected;
}
