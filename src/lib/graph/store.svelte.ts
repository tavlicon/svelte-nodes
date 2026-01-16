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
import { nodeRegistry } from './nodes/registry';

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

// Version counters to force reactivity updates (declared early for syncFromYjs)
let nodesVersion = $state(0);
let groupsVersion = $state(0);

// Undo/Redo system - limited to 5 actions
const MAX_HISTORY = 5;

type Action = 
  | { type: 'add_node'; node: NodeInstance }
  | { type: 'delete_node'; node: NodeInstance; connectedEdges: Edge[] }
  | { type: 'move_nodes'; moves: Array<{ id: string; fromX: number; fromY: number; toX: number; toY: number }> }
  | { type: 'add_edge'; edge: Edge }
  | { type: 'delete_edge'; edge: Edge }
  | { type: 'add_group'; group: GroupSection }
  | { type: 'delete_group'; group: GroupSection }
  | { type: 'update_group'; groupId: string; from: GroupSection; to: GroupSection };

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
      
    case 'add_group':
      ydoc.transact(() => {
        yGroups.delete(action.group.id);
      });
      break;
      
    case 'delete_group':
      ydoc.transact(() => {
        yGroups.set(action.group.id, action.group);
      });
      break;
      
    case 'update_group':
      ydoc.transact(() => {
        yGroups.set(action.groupId, action.from);
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
      
    case 'add_group':
      ydoc.transact(() => {
        yGroups.set(action.group.id, action.group);
      });
      break;
      
    case 'delete_group':
      ydoc.transact(() => {
        yGroups.delete(action.group.id);
      });
      break;
      
    case 'update_group':
      ydoc.transact(() => {
        yGroups.set(action.groupId, action.to);
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

  const newGroups = new Map<string, GroupSection>();
  yGroups.forEach((group, id) => {
    newGroups.set(id, { ...group });
  });
  groups = newGroups;
  groupsVersion++;
}

// Set up observers
yNodes.observe(() => syncFromYjs());
yEdges.observe(() => syncFromYjs());
yGroups.observe(() => syncFromYjs());

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

function addGroup(
  x: number,
  y: number,
  width: number,
  height: number,
  memberIds: string[],
  name = 'Group'
): string {
  const id = generateId();
  const uniqueMembers = Array.from(new Set(memberIds));
  const group: GroupSection = {
    id,
    name,
    x,
    y,
    width,
    height,
    memberIds: uniqueMembers,
  };
  
  // Optimistically update local state for immediate feedback
  groups = new Map(groups).set(id, group);
  groupsVersion++;
  
  ydoc.transact(() => {
    yGroups.set(id, group);
  });
  
  pushAction({ type: 'add_group', group });
  
  return id;
}

function updateGroup(id: string, updates: Partial<GroupSection>) {
  const existing = yGroups.get(id);
  if (existing) {
    const updated = { ...existing, ...updates };
    groups = new Map(groups).set(id, updated);
    groupsVersion++;
    ydoc.transact(() => {
      yGroups.set(id, updated);
    });
  }
}

function setGroupMembers(id: string, memberIds: string[]) {
  const existing = yGroups.get(id);
  if (existing) {
    const uniqueMembers = Array.from(new Set(memberIds));
    const updated = { ...existing, memberIds: uniqueMembers };
    groups = new Map(groups).set(id, updated);
    groupsVersion++;
    ydoc.transact(() => {
      yGroups.set(id, updated);
    });
  }
}

function deleteGroup(id: string) {
  const existing = yGroups.get(id);
  if (existing) {
    ydoc.transact(() => {
      yGroups.delete(id);
    });
    groups = new Map(groups);
    groups.delete(id);
    groupsVersion++;
    pushAction({ type: 'delete_group', group: existing });
  }
}

function recordGroupChange(groupId: string, from: GroupSection, to: GroupSection) {
  if (isUndoRedo) return;
  const hasChanged =
    from.x !== to.x ||
    from.y !== to.y ||
    from.width !== to.width ||
    from.height !== to.height ||
    from.name !== to.name ||
    from.memberIds.join(',') !== to.memberIds.join(',');
  if (hasChanged) {
    pushAction({ type: 'update_group', groupId, from, to });
  }
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
    groups,
    selectedNodeIds,
    selectedEdgeIds,
  };
}

// ============================================================================
// TIDY CONFIGURATION
// ============================================================================
// Gap between nodes when tidying (in pixels)
// Change this value to adjust the spacing between tidied nodes
const TIDY_GAP = 20;

// Padding inside group border (in pixels)
const GROUP_PADDING = 24;

// Container width constraints for row-based packing
const TIDY_MIN_WIDTH = 300;   // Minimum container width
const TIDY_MAX_WIDTH = 1600;  // Maximum container width

// Tolerance for "already tidy" check (in pixels)
const TIDY_TOLERANCE = 5;
// ============================================================================

/**
 * Check if a group is already tidy (nodes uniformly distributed with correct gaps,
 * and group bounds fit tightly around content).
 * 
 * @param groupId - The group to check
 * @returns true if already tidy, false if tidy would make changes
 */
function isGroupTidy(groupId: string): boolean {
  const group = groups.get(groupId);
  if (!group) return true;
  
  // Get image nodes that are members of this group
  const imageNodes = group.memberIds
    .map(id => nodes.get(id))
    .filter((n): n is NodeInstance => n !== undefined && n.type === 'image');
  
  // No nodes = already tidy (nothing to do)
  if (imageNodes.length === 0) return true;
  
  // Calculate actual content bounds
  const minX = Math.min(...imageNodes.map(n => n.x));
  const maxX = Math.max(...imageNodes.map(n => n.x + n.width));
  const minY = Math.min(...imageNodes.map(n => n.y));
  const maxY = Math.max(...imageNodes.map(n => n.y + n.height));
  
  // Check if group bounds match content + padding (within tolerance)
  const expectedGroupX = minX - GROUP_PADDING;
  const expectedGroupY = minY - GROUP_PADDING;
  const expectedGroupWidth = (maxX - minX) + GROUP_PADDING * 2;
  const expectedGroupHeight = (maxY - minY) + GROUP_PADDING * 2;
  
  const groupFits = 
    Math.abs(group.x - expectedGroupX) <= TIDY_TOLERANCE &&
    Math.abs(group.y - expectedGroupY) <= TIDY_TOLERANCE &&
    Math.abs(group.width - expectedGroupWidth) <= TIDY_TOLERANCE &&
    Math.abs(group.height - expectedGroupHeight) <= TIDY_TOLERANCE;
  
  if (!groupFits) return false;
  
  // For single node, just check group bounds (already checked above)
  if (imageNodes.length === 1) return true;
  
  // Sort nodes by Y first (to group into rows), then by X within each row
  const sorted = [...imageNodes].sort((a, b) => {
    // Group by Y position (within tolerance = same row)
    if (Math.abs(a.y - b.y) > TIDY_TOLERANCE) {
      return a.y - b.y;
    }
    // Within same row, sort by X
    return a.x - b.x;
  });
  
  // Group nodes into rows (nodes with same Y within tolerance)
  const rows: NodeInstance[][] = [];
  let currentRow: NodeInstance[] = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const node = sorted[i];
    const lastNodeInRow = currentRow[currentRow.length - 1];
    
    // Same row if Y is within tolerance
    if (Math.abs(node.y - lastNodeInRow.y) <= TIDY_TOLERANCE) {
      currentRow.push(node);
    } else {
      // New row
      rows.push(currentRow);
      currentRow = [node];
    }
  }
  rows.push(currentRow); // Don't forget the last row
  
  // Check each row has uniform horizontal gaps
  for (const row of rows) {
    // Sort row by X position
    row.sort((a, b) => a.x - b.x);
    
    // Check horizontal gaps within row
    for (let i = 0; i < row.length - 1; i++) {
      const current = row[i];
      const next = row[i + 1];
      const gap = next.x - (current.x + current.width);
      if (Math.abs(gap - TIDY_GAP) > TIDY_TOLERANCE) {
        return false;
      }
    }
    
    // Check all nodes in row start at same X (left-aligned to row start)
    // First node should be at minX (the anchor)
    if (row.length > 0 && Math.abs(row[0].x - minX) > TIDY_TOLERANCE) {
      return false;
    }
  }
  
  // Check vertical gaps between rows
  if (rows.length > 1) {
    for (let i = 0; i < rows.length - 1; i++) {
      const currentRowMaxY = Math.max(...rows[i].map(n => n.y + n.height));
      const nextRowMinY = Math.min(...rows[i + 1].map(n => n.y));
      const rowGap = nextRowMinY - currentRowMaxY;
      if (Math.abs(rowGap - TIDY_GAP) > TIDY_TOLERANCE) {
        return false;
      }
    }
  }
  
  return true;
}

/**
 * Row-based shelf packing algorithm for tidying image nodes in a group.
 * 
 * Preserves left-to-right visual order while packing nodes into rows
 * that fit within the container width. Similar to how FigJam/Miro tidy.
 * 
 * Algorithm:
 * 1. Sort nodes left-to-right by X position (preserve visual order)
 * 2. Use current group width as container (clamped to min/max)
 * 3. Pack nodes into rows: fill row left-to-right, wrap to new row when full
 * 4. Each row is top-aligned, rows stack vertically with gaps
 * 5. Resize group to fit the packed nodes
 * 
 * @param groupId - The group to tidy
 */
function tidyGroupNodes(groupId: string): void {
  const group = groups.get(groupId);
  if (!group) return;
  
  // Get image nodes that are members of this group
  const imageNodes = group.memberIds
    .map(id => nodes.get(id))
    .filter((n): n is NodeInstance => n !== undefined && n.type === 'image');
  
  // Need at least 1 node to tidy/resize-to-fit
  if (imageNodes.length < 1) return;
  
  // Sort nodes left-to-right by X position (preserves visual order)
  const sorted = [...imageNodes].sort((a, b) => a.x - b.x);
  
  // Calculate container width from current group (minus padding), clamped
  const currentContentWidth = group.width - GROUP_PADDING * 2;
  const containerWidth = Math.max(TIDY_MIN_WIDTH, Math.min(TIDY_MAX_WIDTH, currentContentWidth));
  
  // Anchor point: top-left of content area
  const anchorX = Math.min(...imageNodes.map(n => n.x));
  const anchorY = Math.min(...imageNodes.map(n => n.y));
  
  // Row-based shelf packing
  // Each row: { y: number, height: number, nodes: placement[] }
  interface Placement {
    node: NodeInstance;
    x: number;
    y: number;
  }
  
  const placements: Placement[] = [];
  let currentRowY = anchorY;
  let currentRowX = anchorX;
  let currentRowHeight = 0;
  
  for (const node of sorted) {
    const nodeWidth = node.width;
    const nodeHeight = node.height;
    
    // Check if node fits in current row
    const wouldExceedWidth = (currentRowX - anchorX) + nodeWidth > containerWidth;
    const isFirstInRow = currentRowX === anchorX;
    
    // If doesn't fit and not first in row, start new row
    if (wouldExceedWidth && !isFirstInRow) {
      // Move to next row
      currentRowY += currentRowHeight + TIDY_GAP;
      currentRowX = anchorX;
      currentRowHeight = 0;
    }
    
    // Place node at current position
    placements.push({
      node,
      x: Math.round(currentRowX),
      y: Math.round(currentRowY),
    });
    
    // Update row tracking
    currentRowHeight = Math.max(currentRowHeight, nodeHeight);
    currentRowX += nodeWidth + TIDY_GAP;
  }
  
  // Record original positions for undo
  const moves: Array<{ id: string; fromX: number; fromY: number; toX: number; toY: number }> = [];
  
  // Single Yjs transaction for all node updates
  ydoc.transact(() => {
    for (const placement of placements) {
      const { node, x: toX, y: toY } = placement;
      const fromX = node.x;
      const fromY = node.y;
      
      // Only update if position changed
      if (toX !== fromX || toY !== fromY) {
        const updated = { ...node, x: toX, y: toY };
        yNodes.set(node.id, updated);
        moves.push({ id: node.id, fromX, fromY, toX, toY });
      }
    }
  });
  
  // Update local state for immediate reactivity
  if (moves.length > 0) {
    const newNodes = new Map(nodes);
    for (const move of moves) {
      const existing = newNodes.get(move.id);
      if (existing) {
        newNodes.set(move.id, { ...existing, x: move.toX, y: move.toY });
      }
    }
    nodes = newNodes;
    nodesVersion++;
    
    // Record move for undo (single action for entire operation)
    pushAction({ type: 'move_nodes', moves });
  }
  
  // Resize the group to fit the tidied nodes
  const updatedImageNodes = group.memberIds
    .map(id => nodes.get(id))
    .filter((n): n is NodeInstance => n !== undefined && n.type === 'image');
  
  const newMinX = Math.min(...updatedImageNodes.map(n => n.x));
  const newMaxX = Math.max(...updatedImageNodes.map(n => n.x + n.width));
  const newMinY = Math.min(...updatedImageNodes.map(n => n.y));
  const newMaxY = Math.max(...updatedImageNodes.map(n => n.y + n.height));
  
  // Update group bounds with padding
  const newGroupX = newMinX - GROUP_PADDING;
  const newGroupY = newMinY - GROUP_PADDING;
  const newGroupWidth = (newMaxX - newMinX) + GROUP_PADDING * 2;
  const newGroupHeight = (newMaxY - newMinY) + GROUP_PADDING * 2;
  
  // Store original group for undo
  const originalGroup = { ...group };
  
  // Update group
  const updatedGroup: GroupSection = {
    ...group,
    x: newGroupX,
    y: newGroupY,
    width: newGroupWidth,
    height: newGroupHeight,
  };
  
  groups = new Map(groups).set(groupId, updatedGroup);
  groupsVersion++;
  
  ydoc.transact(() => {
    yGroups.set(groupId, updatedGroup);
  });
  
  // Record group change for undo
  recordGroupChange(groupId, originalGroup, updatedGroup);
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

export function getGroupsVersion() {
  return groupsVersion;
}

// Export reactive store
export const graphStore = {
  get nodes() { return nodes; },
  get edges() { return edges; },
  get groups() { return groups; },
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
  addGroup,
  updateGroup,
  setGroupMembers,
  deleteGroup,
  recordGroupChange,
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
  
  // Tidy group nodes
  isGroupTidy,
  tidyGroupNodes,
};
