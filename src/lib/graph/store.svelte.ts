/**
 * Yjs-backed reactive store for the node graph
 */

import * as Y from 'yjs';
import { 
  type NodeInstance, 
  type Edge, 
  type GraphState, 
  type Camera,
  type CanvasState,
  generateId 
} from './types';
import { nodeRegistry } from './nodes/registry';

// Create Yjs document for CRDT support
const ydoc = new Y.Doc();

// Yjs shared types
const yNodes = ydoc.getMap<NodeInstance>('nodes');
const yEdges = ydoc.getMap<Edge>('edges');

// Reactive state using Svelte 5 runes
let nodes = $state<Map<string, NodeInstance>>(new Map());
let edges = $state<Map<string, Edge>>(new Map());
let selectedNodeIds = $state<Set<string>>(new Set());
let selectedEdgeIds = $state<Set<string>>(new Set());
let camera = $state<Camera>({ x: 0, y: 0, zoom: 1 });
let canvasState = $state<CanvasState>({
  camera: { x: 0, y: 0, zoom: 1 },
  isPanning: false,
  isConnecting: false,
});

// Version counter to force reactivity updates (declared early for syncFromYjs)
let nodesVersion = $state(0);

// Undo/Redo system - limited to 5 actions
const MAX_HISTORY = 5;

type Action = 
  | { type: 'add_node'; node: NodeInstance }
  | { type: 'delete_node'; node: NodeInstance; connectedEdges: Edge[] }
  | { type: 'move_nodes'; moves: Array<{ id: string; fromX: number; fromY: number; toX: number; toY: number }> }
  | { type: 'add_edge'; edge: Edge }
  | { type: 'delete_edge'; edge: Edge };

let undoStack = $state<Action[]>([]);
let redoStack = $state<Action[]>([]);

// Flag to prevent recording actions during undo/redo
let isUndoRedo = false;

function pushAction(action: Action) {
  if (isUndoRedo) return;
  
  undoStack = [...undoStack.slice(-(MAX_HISTORY - 1)), action];
  redoStack = []; // Clear redo stack on new action
}

function undo() {
  if (undoStack.length === 0) return;
  
  const action = undoStack[undoStack.length - 1];
  undoStack = undoStack.slice(0, -1);
  
  isUndoRedo = true;
  
  switch (action.type) {
    case 'add_node':
      // Undo add = delete the node
      ydoc.transact(() => {
        yNodes.delete(action.node.id);
      });
      break;
      
    case 'delete_node':
      // Undo delete = restore the node and its edges
      ydoc.transact(() => {
        yNodes.set(action.node.id, action.node);
        for (const edge of action.connectedEdges) {
          yEdges.set(edge.id, edge);
        }
      });
      break;
      
    case 'move_nodes':
      // Undo move = restore original positions
      ydoc.transact(() => {
        for (const move of action.moves) {
          const existing = yNodes.get(move.id);
          if (existing) {
            yNodes.set(move.id, { ...existing, x: move.fromX, y: move.fromY });
          }
        }
      });
      break;
      
    case 'add_edge':
      // Undo add edge = delete the edge
      ydoc.transact(() => {
        yEdges.delete(action.edge.id);
      });
      break;
      
    case 'delete_edge':
      // Undo delete edge = restore the edge
      ydoc.transact(() => {
        yEdges.set(action.edge.id, action.edge);
      });
      break;
  }
  
  isUndoRedo = false;
  redoStack = [...redoStack, action];
}

function redo() {
  if (redoStack.length === 0) return;
  
  const action = redoStack[redoStack.length - 1];
  redoStack = redoStack.slice(0, -1);
  
  isUndoRedo = true;
  
  switch (action.type) {
    case 'add_node':
      // Redo add = add the node back
      ydoc.transact(() => {
        yNodes.set(action.node.id, action.node);
      });
      break;
      
    case 'delete_node':
      // Redo delete = delete the node again
      ydoc.transact(() => {
        yNodes.delete(action.node.id);
        for (const edge of action.connectedEdges) {
          yEdges.delete(edge.id);
        }
      });
      break;
      
    case 'move_nodes':
      // Redo move = apply the move again
      ydoc.transact(() => {
        for (const move of action.moves) {
          const existing = yNodes.get(move.id);
          if (existing) {
            yNodes.set(move.id, { ...existing, x: move.toX, y: move.toY });
          }
        }
      });
      break;
      
    case 'add_edge':
      // Redo add edge = add the edge back
      ydoc.transact(() => {
        yEdges.set(action.edge.id, action.edge);
      });
      break;
      
    case 'delete_edge':
      // Redo delete edge = delete the edge again
      ydoc.transact(() => {
        yEdges.delete(action.edge.id);
      });
      break;
  }
  
  isUndoRedo = false;
  undoStack = [...undoStack, action];
}

// Sync Yjs to reactive state
function syncFromYjs() {
  const newNodes = new Map<string, NodeInstance>();
  yNodes.forEach((node, id) => {
    newNodes.set(id, { ...node });
  });
  nodes = newNodes;
  nodesVersion++; // Trigger reactivity
  
  const newEdges = new Map<string, Edge>();
  yEdges.forEach((edge, id) => {
    newEdges.set(id, { ...edge });
  });
  edges = newEdges;
}

// Set up observers
yNodes.observe(() => syncFromYjs());
yEdges.observe(() => syncFromYjs());

// Node size constant - square nodes like FigJam
const NODE_SIZE = 200;

// Export for use in other modules
export { NODE_SIZE };

// Graph manipulation functions
function addNode(
  type: string, 
  x: number, 
  y: number, 
  params: Record<string, unknown> = {},
  customWidth?: number,
  customHeight?: number
): string {
  const id = generateId();
  
  // Get default params from registry and merge with provided params
  const defaultParams = nodeRegistry[type]?.defaultParams ?? {};
  const mergedParams = { ...defaultParams, ...params };
  
  const node: NodeInstance = {
    id,
    type,
    x,
    y,
    width: customWidth ?? NODE_SIZE,
    height: customHeight ?? NODE_SIZE,
    params: mergedParams,
    status: 'idle',
  };
  
  // Optimistically update local state for immediate feedback
  nodes = new Map(nodes).set(id, node);
  nodesVersion++; // Trigger reactivity
  
  ydoc.transact(() => {
    yNodes.set(id, node);
  });
  
  // Record action for undo
  pushAction({ type: 'add_node', node });
  
  return id;
}

function updateNode(id: string, updates: Partial<NodeInstance>) {
  const existing = yNodes.get(id);
  if (existing) {
    const updated = { ...existing, ...updates };
    // Update local reactive map immediately so drag feels responsive
    nodes = new Map(nodes).set(id, updated);
    nodesVersion++; // Trigger reactivity
    ydoc.transact(() => {
      yNodes.set(id, updated);
    });
  }
}

function deleteNode(id: string) {
  // Capture node and connected edges for undo
  const node = yNodes.get(id);
  const connectedEdges: Edge[] = [];
  yEdges.forEach((edge) => {
    if (edge.sourceNodeId === id || edge.targetNodeId === id) {
      connectedEdges.push({ ...edge });
    }
  });
  
  ydoc.transact(() => {
    yNodes.delete(id);
    
    // Delete connected edges
    yEdges.forEach((edge, edgeId) => {
      if (edge.sourceNodeId === id || edge.targetNodeId === id) {
        yEdges.delete(edgeId);
      }
    });
  });
  
  // Keep local maps in sync immediately
  const nextNodes = new Map(nodes);
  nextNodes.delete(id);
  nodes = nextNodes;
  
  selectedNodeIds.delete(id);
  
  // Record action for undo
  if (node) {
    pushAction({ type: 'delete_node', node: { ...node }, connectedEdges });
  }
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
  
  // Optimistically update local state for immediate feedback
  edges = new Map(edges).set(id, edge);
  
  ydoc.transact(() => {
    yEdges.set(id, edge);
  });
  
  // Record action for undo
  pushAction({ type: 'add_edge', edge });
  
  return id;
}

function deleteEdge(id: string) {
  // Capture edge for undo
  const edge = yEdges.get(id);
  
  // Optimistically update local state for immediate feedback
  const nextEdges = new Map(edges);
  nextEdges.delete(id);
  edges = nextEdges;
  
  ydoc.transact(() => {
    yEdges.delete(id);
  });
  selectedEdgeIds.delete(id);
  
  // Record action for undo
  if (edge) {
    pushAction({ type: 'delete_edge', edge: { ...edge } });
  }
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

/**
 * Duplicate all selected nodes, offset by 20px
 * Returns the IDs of the newly created nodes
 */
function duplicateSelectedNodes(): string[] {
  const newIds: string[] = [];
  const offset = 20;
  
  selectedNodeIds.forEach(nodeId => {
    const node = nodes.get(nodeId);
    if (!node) return;
    
    // Create a copy of the node with a new position
    const newId = addNode(
      node.type,
      node.x + offset,
      node.y + offset,
      { ...node.params }, // Deep copy params
      node.width,
      node.height
    );
    
    // Copy thumbnail if present
    if (node.thumbnailUrl) {
      updateNode(newId, { thumbnailUrl: node.thumbnailUrl });
    }
    
    newIds.push(newId);
  });
  
  // Select the newly created nodes
  if (newIds.length > 0) {
    selectedNodeIds = new Set(newIds);
    selectedEdgeIds = new Set();
  }
  
  return newIds;
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
    selectedNodeIds,
    selectedEdgeIds,
  };
}

// Helper to get nodes with proper reactivity tracking
function getNodesReactive(): Map<string, NodeInstance> {
  // Access version to create dependency
  const _ = nodesVersion;
  return nodes;
}

// Record a move action for undo (called when drag ends)
function recordMove(moves: Array<{ id: string; fromX: number; fromY: number; toX: number; toY: number }>) {
  if (moves.length > 0 && !isUndoRedo) {
    // Only record if there was actual movement
    const hasMoved = moves.some(m => m.fromX !== m.toX || m.fromY !== m.toY);
    if (hasMoved) {
      pushAction({ type: 'move_nodes', moves });
    }
  }
}

// Export the reactive version counter directly for Svelte 5 reactivity
export function getNodesVersion() {
  return nodesVersion;
}

// Export reactive store
export const graphStore = {
  get nodes() { return nodes; },
  get edges() { return edges; },
  get selectedNodeIds() { return selectedNodeIds; },
  set selectedNodeIds(value: Set<string>) { selectedNodeIds = value; },
  get selectedEdgeIds() { return selectedEdgeIds; },
  set selectedEdgeIds(value: Set<string>) { selectedEdgeIds = value; },
  get camera() { return camera; },
  get canvasState() { return canvasState; },
  
  // Undo/Redo reactive state
  get canUndo() { return undoStack.length > 0; },
  get canRedo() { return redoStack.length > 0; },
  get undoStackSize() { return undoStack.length; },
  get redoStackSize() { return redoStack.length; },
  
  getNodesReactive,
  
  addNode,
  updateNode,
  deleteNode,
  addEdge,
  deleteEdge,
  selectNode,
  deselectAll,
  duplicateSelectedNodes,
  setCamera,
  updateCanvasState,
  getNodeById,
  getEdgesForNode,
  getInputEdges,
  getOutputEdges,
  getYDoc,
  getState,
  
  // Undo/Redo
  undo,
  redo,
  recordMove,
};
