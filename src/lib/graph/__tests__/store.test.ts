/**
 * Tests for the graph store
 * 
 * Tests node/edge CRUD operations, selection, and undo/redo functionality.
 * The store uses Yjs CRDT under the hood, but we test the public API.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('graphStore', () => {
  // Reset the store module before each test to ensure isolation
  beforeEach(async () => {
    vi.resetModules();
  });

  // ===========================================================================
  // Node Operations
  // ===========================================================================
  
  describe('addNode', () => {
    it('creates a node with correct properties', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('image', 100, 200, { imageUrl: '/test.png' });
      
      expect(nodeId).toBeDefined();
      expect(typeof nodeId).toBe('string');
      
      const node = graphStore.getNodeById(nodeId);
      expect(node).toBeDefined();
      expect(node?.type).toBe('image');
      expect(node?.x).toBe(100);
      expect(node?.y).toBe(200);
      expect(node?.status).toBe('idle');
      expect(node?.params.imageUrl).toBe('/test.png');
    });

    it('merges default params from registry', async () => {
      const { graphStore } = await import('../store.svelte');
      
      // Add model node without providing all params
      const nodeId = graphStore.addNode('model', 0, 0, {});
      
      const node = graphStore.getNodeById(nodeId);
      
      // Should have default params from registry
      expect(node?.params.positive_prompt).toBe('a beautiful, photograph');
      expect(node?.params.negative_prompt).toBe('blurry');
      expect(node?.params.steps).toBe(3);
      expect(node?.params.cfg).toBe(2.0);
    });

    it('overrides default params with provided values', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('model', 0, 0, { 
        positive_prompt: 'custom prompt',
        steps: 20,
      });
      
      const node = graphStore.getNodeById(nodeId);
      
      expect(node?.params.positive_prompt).toBe('custom prompt');
      expect(node?.params.steps).toBe(20);
      // Other defaults should remain
      expect(node?.params.negative_prompt).toBe('blurry');
    });

    it('allows custom dimensions', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('image', 0, 0, {}, 300, 400);
      
      const node = graphStore.getNodeById(nodeId);
      expect(node?.width).toBe(300);
      expect(node?.height).toBe(400);
    });

    it('uses default NODE_SIZE when dimensions not provided', async () => {
      const { graphStore, NODE_SIZE } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('image', 0, 0, {});
      
      const node = graphStore.getNodeById(nodeId);
      expect(node?.width).toBe(NODE_SIZE);
      expect(node?.height).toBe(NODE_SIZE);
    });
  });

  describe('updateNode', () => {
    it('updates node properties', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('image', 0, 0);
      
      graphStore.updateNode(nodeId, { x: 500, y: 600 });
      
      const node = graphStore.getNodeById(nodeId);
      expect(node?.x).toBe(500);
      expect(node?.y).toBe(600);
    });

    it('updates status correctly', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('model', 0, 0);
      
      graphStore.updateNode(nodeId, { status: 'running' });
      expect(graphStore.getNodeById(nodeId)?.status).toBe('running');
      
      graphStore.updateNode(nodeId, { status: 'complete' });
      expect(graphStore.getNodeById(nodeId)?.status).toBe('complete');
      
      graphStore.updateNode(nodeId, { status: 'error', error: 'Test error' });
      expect(graphStore.getNodeById(nodeId)?.status).toBe('error');
      expect(graphStore.getNodeById(nodeId)?.error).toBe('Test error');
    });

    it('does nothing for non-existent node', async () => {
      const { graphStore } = await import('../store.svelte');
      
      // Should not throw
      graphStore.updateNode('nonexistent-id', { x: 100 });
      
      expect(graphStore.getNodeById('nonexistent-id')).toBeUndefined();
    });
  });

  describe('deleteNode', () => {
    it('removes the node', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('image', 0, 0);
      expect(graphStore.nodes.size).toBe(1);
      
      graphStore.deleteNode(nodeId);
      
      expect(graphStore.nodes.size).toBe(0);
      expect(graphStore.getNodeById(nodeId)).toBeUndefined();
    });

    it('removes connected edges when node is deleted', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const sourceId = graphStore.addNode('image', 0, 0);
      const targetId = graphStore.addNode('model', 300, 0);
      graphStore.addEdge(sourceId, 'image', targetId, 'image');
      
      expect(graphStore.edges.size).toBe(1);
      
      graphStore.deleteNode(sourceId);
      
      // Edge should be cleaned up
      expect(graphStore.edges.size).toBe(0);
    });
  });

  // ===========================================================================
  // Edge Operations
  // ===========================================================================
  
  describe('addEdge', () => {
    it('creates an edge between nodes', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const sourceId = graphStore.addNode('image', 0, 0);
      const targetId = graphStore.addNode('model', 300, 0);
      
      const edgeId = graphStore.addEdge(sourceId, 'image', targetId, 'image');
      
      expect(edgeId).not.toBeNull();
      expect(graphStore.edges.size).toBe(1);
      
      const edge = graphStore.edges.get(edgeId!);
      expect(edge?.sourceNodeId).toBe(sourceId);
      expect(edge?.sourcePortId).toBe('image');
      expect(edge?.targetNodeId).toBe(targetId);
      expect(edge?.targetPortId).toBe('image');
    });

    it('prevents duplicate edges', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const sourceId = graphStore.addNode('image', 0, 0);
      const targetId = graphStore.addNode('model', 300, 0);
      
      const edgeId1 = graphStore.addEdge(sourceId, 'image', targetId, 'image');
      const edgeId2 = graphStore.addEdge(sourceId, 'image', targetId, 'image');
      
      expect(edgeId1).not.toBeNull();
      expect(edgeId2).toBeNull(); // Duplicate rejected
      expect(graphStore.edges.size).toBe(1);
    });

    it('replaces existing edge to same input port', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const source1 = graphStore.addNode('image', 0, 0);
      const source2 = graphStore.addNode('image', 0, 200);
      const target = graphStore.addNode('model', 300, 100);
      
      graphStore.addEdge(source1, 'image', target, 'image');
      graphStore.addEdge(source2, 'image', target, 'image');
      
      // Only one edge should exist (second replaced first)
      expect(graphStore.edges.size).toBe(1);
      
      // The remaining edge should be from source2
      const edge = Array.from(graphStore.edges.values())[0];
      expect(edge.sourceNodeId).toBe(source2);
    });
  });

  describe('deleteEdge', () => {
    it('removes the edge', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const sourceId = graphStore.addNode('image', 0, 0);
      const targetId = graphStore.addNode('model', 300, 0);
      const edgeId = graphStore.addEdge(sourceId, 'image', targetId, 'image');
      
      expect(graphStore.edges.size).toBe(1);
      
      graphStore.deleteEdge(edgeId!);
      
      expect(graphStore.edges.size).toBe(0);
    });
  });

  describe('getEdgesForNode', () => {
    it('returns all edges connected to a node', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const node1 = graphStore.addNode('image', 0, 0);
      const node2 = graphStore.addNode('model', 300, 0);
      const node3 = graphStore.addNode('output', 600, 0);
      
      graphStore.addEdge(node1, 'image', node2, 'image');
      graphStore.addEdge(node2, 'image', node3, 'image');
      
      const edges = graphStore.getEdgesForNode(node2);
      
      // Node2 has one incoming and one outgoing edge
      expect(edges).toHaveLength(2);
    });
  });

  describe('getInputEdges', () => {
    it('returns only incoming edges', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const node1 = graphStore.addNode('image', 0, 0);
      const node2 = graphStore.addNode('model', 300, 0);
      const node3 = graphStore.addNode('output', 600, 0);
      
      graphStore.addEdge(node1, 'image', node2, 'image');
      graphStore.addEdge(node2, 'image', node3, 'image');
      
      const inputEdges = graphStore.getInputEdges(node2);
      
      expect(inputEdges).toHaveLength(1);
      expect(inputEdges[0].sourceNodeId).toBe(node1);
    });
  });

  // ===========================================================================
  // Selection
  // ===========================================================================
  
  describe('selection', () => {
    it('selects a single node', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const id1 = graphStore.addNode('image', 0, 0);
      const id2 = graphStore.addNode('image', 200, 0);
      
      graphStore.selectNode(id1);
      
      expect(graphStore.selectedNodeIds.has(id1)).toBe(true);
      expect(graphStore.selectedNodeIds.has(id2)).toBe(false);
      expect(graphStore.selectedNodeIds.size).toBe(1);
    });

    it('replaces selection when addToSelection is false', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const id1 = graphStore.addNode('image', 0, 0);
      const id2 = graphStore.addNode('image', 200, 0);
      
      graphStore.selectNode(id1);
      graphStore.selectNode(id2, false);
      
      expect(graphStore.selectedNodeIds.has(id1)).toBe(false);
      expect(graphStore.selectedNodeIds.has(id2)).toBe(true);
      expect(graphStore.selectedNodeIds.size).toBe(1);
    });

    it('adds to selection when addToSelection is true', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const id1 = graphStore.addNode('image', 0, 0);
      const id2 = graphStore.addNode('image', 200, 0);
      
      graphStore.selectNode(id1);
      graphStore.selectNode(id2, true);
      
      expect(graphStore.selectedNodeIds.has(id1)).toBe(true);
      expect(graphStore.selectedNodeIds.has(id2)).toBe(true);
      expect(graphStore.selectedNodeIds.size).toBe(2);
    });

    it('deselectAll clears all selections', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const id1 = graphStore.addNode('image', 0, 0);
      const id2 = graphStore.addNode('image', 200, 0);
      
      graphStore.selectNode(id1);
      graphStore.selectNode(id2, true);
      
      graphStore.deselectAll();
      
      expect(graphStore.selectedNodeIds.size).toBe(0);
      expect(graphStore.selectedEdgeIds.size).toBe(0);
    });
  });

  // ===========================================================================
  // Undo/Redo
  // ===========================================================================
  
  describe('undo/redo', () => {
    it('can undo node addition', async () => {
      const { graphStore } = await import('../store.svelte');
      
      expect(graphStore.canUndo).toBe(false);
      
      graphStore.addNode('image', 100, 200);
      
      expect(graphStore.nodes.size).toBe(1);
      expect(graphStore.canUndo).toBe(true);
      
      graphStore.undo();
      
      expect(graphStore.nodes.size).toBe(0);
      expect(graphStore.canUndo).toBe(false);
    });

    it('can redo after undo', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('image', 100, 200);
      graphStore.undo();
      
      expect(graphStore.nodes.size).toBe(0);
      expect(graphStore.canRedo).toBe(true);
      
      graphStore.redo();
      
      expect(graphStore.nodes.size).toBe(1);
      expect(graphStore.canRedo).toBe(false);
      
      // Node should have same properties
      const node = Array.from(graphStore.nodes.values())[0];
      expect(node.type).toBe('image');
      expect(node.x).toBe(100);
      expect(node.y).toBe(200);
    });

    it('can undo node deletion', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('image', 100, 200, { imageUrl: '/test.png' });
      graphStore.deleteNode(nodeId);
      
      expect(graphStore.nodes.size).toBe(0);
      
      graphStore.undo();
      
      expect(graphStore.nodes.size).toBe(1);
      const restoredNode = graphStore.getNodeById(nodeId);
      expect(restoredNode?.params.imageUrl).toBe('/test.png');
    });

    it('can undo edge addition', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const sourceId = graphStore.addNode('image', 0, 0);
      const targetId = graphStore.addNode('model', 300, 0);
      graphStore.addEdge(sourceId, 'image', targetId, 'image');
      
      expect(graphStore.edges.size).toBe(1);
      
      graphStore.undo();
      
      expect(graphStore.edges.size).toBe(0);
    });

    it('clears redo stack on new action', async () => {
      const { graphStore } = await import('../store.svelte');
      
      graphStore.addNode('image', 0, 0);
      graphStore.undo();
      
      expect(graphStore.canRedo).toBe(true);
      
      // New action should clear redo stack
      graphStore.addNode('image', 100, 100);
      
      expect(graphStore.canRedo).toBe(false);
    });

    it('limits undo stack to MAX_HISTORY (5)', async () => {
      const { graphStore } = await import('../store.svelte');
      
      // Add 10 nodes
      for (let i = 0; i < 10; i++) {
        graphStore.addNode('image', i * 100, 0);
      }
      
      // Should only be able to undo 5 times
      expect(graphStore.undoStackSize).toBe(5);
      
      // Undo all 5
      for (let i = 0; i < 5; i++) {
        graphStore.undo();
      }
      
      // Should have 5 nodes remaining (10 - 5)
      expect(graphStore.nodes.size).toBe(5);
      expect(graphStore.canUndo).toBe(false);
    });
  });

  // ===========================================================================
  // Duplicate
  // ===========================================================================
  
  describe('duplicateSelectedNodes', () => {
    it('duplicates selected nodes with offset', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const nodeId = graphStore.addNode('image', 100, 100, { imageUrl: '/test.png' });
      graphStore.selectNode(nodeId);
      
      const newIds = graphStore.duplicateSelectedNodes();
      
      expect(newIds).toHaveLength(1);
      expect(graphStore.nodes.size).toBe(2);
      
      const newNode = graphStore.getNodeById(newIds[0]);
      expect(newNode?.type).toBe('image');
      expect(newNode?.x).toBe(120); // 100 + 20 offset
      expect(newNode?.y).toBe(120); // 100 + 20 offset
      expect(newNode?.params.imageUrl).toBe('/test.png');
    });

    it('selects duplicated nodes after duplication', async () => {
      const { graphStore } = await import('../store.svelte');
      
      const originalId = graphStore.addNode('image', 100, 100);
      graphStore.selectNode(originalId);
      
      const newIds = graphStore.duplicateSelectedNodes();
      
      // Original should no longer be selected
      expect(graphStore.selectedNodeIds.has(originalId)).toBe(false);
      // New node should be selected
      expect(graphStore.selectedNodeIds.has(newIds[0])).toBe(true);
    });
  });
});
