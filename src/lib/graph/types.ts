/**
 * Core types for the node graph system
 */

export type PortType = 'string' | 'image' | 'tensor' | 'number' | 'mesh' | 'any';

export interface Port {
  id: string;
  name: string;
  type: PortType;
}

export interface NodeDefinition {
  type: string;
  name: string;
  category: string;
  inputs: Port[];
  outputs: Port[];
  defaultParams: Record<string, unknown>;
}

export interface NodeInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  width: number;
  height: number;
  params: Record<string, unknown>;
  
  // Runtime state
  status: 'idle' | 'pending' | 'running' | 'complete' | 'error';
  error?: string;
  outputCache?: Record<string, unknown>;
  thumbnailUrl?: string;
}

export interface Edge {
  id: string;
  sourceNodeId: string;
  sourcePortId: string;
  targetNodeId: string;
  targetPortId: string;
}

export interface GroupSection {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  memberIds: string[];
}

export interface GraphState {
  nodes: Map<string, NodeInstance>;
  edges: Map<string, Edge>;
  groups: Map<string, GroupSection>;
  selectedNodeIds: Set<string>;
  selectedEdgeIds: Set<string>;
}

export interface Camera {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasState {
  camera: Camera;
  isPanning: boolean;
  isConnecting: boolean;
  connectionStart?: {
    nodeId: string;
    portId: string;
    isOutput: boolean;
  };
  connectionEnd?: { x: number; y: number };
}

// Port compatibility rules
export function arePortsCompatible(outputType: PortType, inputType: PortType): boolean {
  if (inputType === 'any' || outputType === 'any') return true;
  return outputType === inputType;
}

// Generate unique IDs
export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}
