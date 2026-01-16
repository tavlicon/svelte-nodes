/**
 * Yjs-backed reactive store for the node graph
 */

import * as Y from 'yjs';
import { 
  type NodeInstance, 
  type Edge, 
  type GraphState, 
  type GroupSection,
  type Camera,
  type CanvasState,
  generateId 
} from './types';

// Create Yjs document for CRDT support
const ydoc = new Y.Doc();

// Yjs shared types
const yNodes = ydoc.getMap<NodeInstance>('nodes');
const yEdges = ydoc.getMap<Edge>('edges');
const yGroups = ydoc.getMap<GroupSection>('groups');

// Reactive state using Svelte 5 runes
let nodes = $state<Map<string, NodeInstance>>(new Map());
let edges = $state<Map<string, Edge>>(new Map());
let groups = $state<Map<string, GroupSection>>(new Map());
let selectedNodeIds = $state<Set<string>>(new Set());
let selectedEdgeIds = $state<Set<string>>(new Set());
let camera = $state<Camera>({ x: 0, y: 0, zoom: 1 });
let canvasState = $state<CanvasState>({
  camera: { x: 0, y: 0, zoom: 1 },
  isPanning: false,
  isConnecting: false,
});

// Sync Yjs to reactive state
function syncFromYjs() {
  const newNodes = new Map<string, NodeInstance>();
  yNodes.forEach((node, id) => {
    newNodes.set(id, { ...node });
  });
  nodes = newNodes;
  
  const newEdges = new Map<string, Edge>();
  yEdges.forEach((edge, id) => {
    newEdges.set(id, { ...edge });
  });
  edges = newEdges;

  const newGroups = new Map<string, GroupSection>();
  yGroups.forEach((group, id) => {
    newGroups.set(id, { ...group });
  });
  groups = newGroups;
}

// Set up observers
yNodes.observe(() => syncFromYjs());
yEdges.observe(() => syncFromYjs());
yGroups.observe(() => syncFromYjs());

// Graph manipulation functions
function addNode(type: string, x: number, y: number, params: Record<string, unknown> = {}): string {
  const id = generateId();
  const node: NodeInstance = {
    id,
    type,
    x,
    y,
    width: 220,
    height: 120,
    params,
    status: 'idle',
  };
  
  ydoc.transact(() => {
    yNodes.set(id, node);
  });
  
  return id;
}

function updateNode(id: string, updates: Partial<NodeInstance>) {
  const existing = yNodes.get(id);
  if (existing) {
    ydoc.transact(() => {
      yNodes.set(id, { ...existing, ...updates });
    });
  }
}

function deleteNode(id: string) {
  ydoc.transact(() => {
    yNodes.delete(id);
    
    // Delete connected edges
    yEdges.forEach((edge, edgeId) => {
      if (edge.sourceNodeId === id || edge.targetNodeId === id) {
        yEdges.delete(edgeId);
      }
    });
  });
  
  selectedNodeIds.delete(id);
}

function addEdge(
  sourceNodeId: string, 
  sourcePortId: string, 
  targetNodeId: string, 
  targetPortId: string
): string | null {
  // Check if edge already exists
  let exists = false;
  yEdges.forEach((edge) => {
    if (
      edge.sourceNodeId === sourceNodeId &&
      edge.sourcePortId === sourcePortId &&
      edge.targetNodeId === targetNodeId &&
      edge.targetPortId === targetPortId
    ) {
      exists = true;
    }
  });
  
  if (exists) return null;
  
  // Remove existing edges to the same input port
  ydoc.transact(() => {
    yEdges.forEach((edge, edgeId) => {
      if (edge.targetNodeId === targetNodeId && edge.targetPortId === targetPortId) {
        yEdges.delete(edgeId);
      }
    });
  });
  
  const id = generateId();
  const edge: Edge = {
    id,
    sourceNodeId,
    sourcePortId,
    targetNodeId,
    targetPortId,
  };
  
  ydoc.transact(() => {
    yEdges.set(id, edge);
  });
  
  return id;
}

function deleteEdge(id: string) {
  ydoc.transact(() => {
    yEdges.delete(id);
  });
  selectedEdgeIds.delete(id);
}

function selectNode(id: string, addToSelection = false) {
  if (!addToSelection) {
    selectedNodeIds = new Set([id]);
    selectedEdgeIds = new Set();
  } else {
    const newSet = new Set(selectedNodeIds);
    newSet.add(id);
    selectedNodeIds = newSet;
  }
}

function deselectAll() {
  selectedNodeIds = new Set();
  selectedEdgeIds = new Set();
}

function setCamera(newCamera: Partial<Camera>) {
  camera = { ...camera, ...newCamera };
  canvasState = { ...canvasState, camera: { ...camera, ...newCamera } };
}

function updateCanvasState(updates: Partial<CanvasState>) {
  canvasState = { ...canvasState, ...updates };
}

function getNodeById(id: string): NodeInstance | undefined {
  return nodes.get(id);
}

function getEdgesForNode(nodeId: string): Edge[] {
  const result: Edge[] = [];
  edges.forEach((edge) => {
    if (edge.sourceNodeId === nodeId || edge.targetNodeId === nodeId) {
      result.push(edge);
    }
  });
  return result;
}

function getInputEdges(nodeId: string): Edge[] {
  const result: Edge[] = [];
  edges.forEach((edge) => {
    if (edge.targetNodeId === nodeId) {
      result.push(edge);
    }
  });
  return result;
}

function getOutputEdges(nodeId: string): Edge[] {
  const result: Edge[] = [];
  edges.forEach((edge) => {
    if (edge.sourceNodeId === nodeId) {
      result.push(edge);
    }
  });
  return result;
}

// Get Yjs doc for persistence
function getYDoc(): Y.Doc {
  return ydoc;
}

// Bulk state getter for serialization
function getState(): GraphState {
  return {
    nodes,
    edges,
    groups,
    selectedNodeIds,
    selectedEdgeIds,
  };
}

// Export reactive store
export const graphStore = {
  get nodes() { return nodes; },
  get edges() { return edges; },
  get groups() { return groups; },
  get selectedNodeIds() { return selectedNodeIds; },
  get selectedEdgeIds() { return selectedEdgeIds; },
  get camera() { return camera; },
  get canvasState() { return canvasState; },
  
  addNode,
  updateNode,
  deleteNode,
  addEdge,
  deleteEdge,
  selectNode,
  deselectAll,
  setCamera,
  updateCanvasState,
  getNodeById,
  getEdgesForNode,
  getInputEdges,
  getOutputEdges,
  getYDoc,
  getState,
};
