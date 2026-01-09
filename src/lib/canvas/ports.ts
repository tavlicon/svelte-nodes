/**
 * Port utilities for calculating port positions and handling connections
 */

import type { NodeInstance, Port } from '../graph/types';
import { getNodeDefinition } from '../graph/nodes/registry';

export interface PortPosition {
  nodeId: string;
  portId: string;
  isOutput: boolean;
  x: number;
  y: number;
  type: string;
}

/**
 * Calculate port positions for a node in world coordinates
 * Inputs on left, outputs on right
 */
export function getPortPositions(node: NodeInstance): PortPosition[] {
  const definition = getNodeDefinition(node.type);
  if (!definition) return [];
  
  const positions: PortPosition[] = [];
  
  // Input ports on left side
  const inputCount = definition.inputs.length;
  definition.inputs.forEach((port, index) => {
    const spacing = node.height / (inputCount + 1);
    positions.push({
      nodeId: node.id,
      portId: port.id,
      isOutput: false,
      x: node.x,
      y: node.y + spacing * (index + 1),
      type: port.type,
    });
  });
  
  // Output ports on right side
  const outputCount = definition.outputs.length;
  definition.outputs.forEach((port, index) => {
    const spacing = node.height / (outputCount + 1);
    positions.push({
      nodeId: node.id,
      portId: port.id,
      isOutput: true,
      x: node.x + node.width,
      y: node.y + spacing * (index + 1),
      type: port.type,
    });
  });
  
  return positions;
}

/**
 * Get a specific port position
 */
export function getPortPosition(
  node: NodeInstance, 
  portId: string, 
  isOutput: boolean
): { x: number; y: number } | null {
  const positions = getPortPositions(node);
  const port = positions.find(p => p.portId === portId && p.isOutput === isOutput);
  return port ? { x: port.x, y: port.y } : null;
}

/**
 * Get all ports for a node from its definition
 */
export function getNodePorts(node: NodeInstance): { inputs: Port[]; outputs: Port[] } {
  const definition = getNodeDefinition(node.type);
  if (!definition) return { inputs: [], outputs: [] };
  return {
    inputs: definition.inputs,
    outputs: definition.outputs,
  };
}

/**
 * Hit test for ports - returns port info if click is within radius
 */
export function hitTestPort(
  worldX: number,
  worldY: number,
  node: NodeInstance,
  hitRadius: number = 12
): PortPosition | null {
  const positions = getPortPositions(node);
  
  for (const port of positions) {
    const dx = worldX - port.x;
    const dy = worldY - port.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    if (distance <= hitRadius) {
      return port;
    }
  }
  
  return null;
}

/**
 * Find the nearest port to a world position across all nodes
 */
export function findNearestPort(
  worldX: number,
  worldY: number,
  nodes: Map<string, NodeInstance>,
  isOutput: boolean,
  excludeNodeId?: string,
  maxDistance: number = 30
): PortPosition | null {
  let nearestPort: PortPosition | null = null;
  let nearestDistance = maxDistance;
  
  nodes.forEach(node => {
    if (node.id === excludeNodeId) return;
    
    const positions = getPortPositions(node).filter(p => p.isOutput === isOutput);
    
    for (const port of positions) {
      const dx = worldX - port.x;
      const dy = worldY - port.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestPort = port;
      }
    }
  });
  
  return nearestPort;
}

/**
 * Calculate bezier curve control points for a connection
 * Creates smooth S-curve that starts horizontal from output and ends horizontal at input
 */
export function getBezierControlPoints(
  startX: number,
  startY: number,
  endX: number,
  endY: number
): { cp1x: number; cp1y: number; cp2x: number; cp2y: number } {
  // Calculate horizontal distance
  const dx = endX - startX;
  
  // Control point offset - proportional to horizontal distance
  // but clamped for very short or very long connections
  const offset = Math.min(Math.max(Math.abs(dx) * 0.5, 50), 150);
  
  return {
    cp1x: startX + offset,
    cp1y: startY,
    cp2x: endX - offset,
    cp2y: endY,
  };
}

/**
 * Port handle radius
 */
export const PORT_HANDLE_RADIUS = 6;
export const PORT_HIT_RADIUS = 12;
