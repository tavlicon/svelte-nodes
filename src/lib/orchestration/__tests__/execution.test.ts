/**
 * Tests for the execution engine
 * 
 * Tests DAG execution, dependency resolution, and error handling.
 * The inference manager is mocked to avoid actual API calls.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the inference manager before importing execution engine
vi.mock('../../inference/manager', () => ({
  inferenceManager: {
    runInference: vi.fn().mockResolvedValue({
      imageData: null,
      imageUrl: 'data:image/png;base64,mockoutput',
      timeTaken: 1000,
    }),
    runImg2Img: vi.fn().mockResolvedValue({
      imageData: null,
      imageUrl: 'data:image/png;base64,mockoutput',
      timeTaken: 1500,
      outputPath: '/data/output/test.png',
      width: 512,
      height: 512,
    }),
  },
}));

describe('ExecutionEngine', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  // ===========================================================================
  // Basic Execution
  // ===========================================================================
  
  describe('execute', () => {
    it('executes graph without errors for simple pipeline', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      
      // Simple pipeline: image -> model
      const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
      const modelId = graphStore.addNode('model', 200, 0, {
        positive_prompt: 'test prompt',
        negative_prompt: '',
      });
      graphStore.addEdge(imageId, 'image', modelId, 'image');
      
      const result = await executionEngine.execute();
      
      expect(result.success).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('returns success for empty graph', async () => {
      const { executionEngine } = await import('../execution');
      
      const result = await executionEngine.execute();
      
      // No dirty nodes = success (nothing to execute)
      expect(result.success).toBe(true);
    });

    it('updates node status during execution', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      
      const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
      
      // Before execution
      expect(graphStore.getNodeById(imageId)?.status).toBe('idle');
      
      await executionEngine.execute();
      
      // After execution
      expect(graphStore.getNodeById(imageId)?.status).toBe('complete');
    });
  });

  // ===========================================================================
  // Dependency Resolution
  // ===========================================================================
  
  describe('dependency resolution', () => {
    it('executes nodes in correct dependency order', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      
      // Pipeline: image -> model -> output
      const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
      const modelId = graphStore.addNode('model', 200, 0, {
        positive_prompt: 'test',
      });
      graphStore.addEdge(imageId, 'image', modelId, 'image');
      
      const executionOrder: string[] = [];
      
      // Spy on updateNode to track execution order
      const originalUpdate = graphStore.updateNode.bind(graphStore);
      vi.spyOn(graphStore, 'updateNode').mockImplementation((id, updates) => {
        if (updates.status === 'running') {
          executionOrder.push(id);
        }
        return originalUpdate(id, updates);
      });
      
      await executionEngine.execute();
      
      // Image must execute before model
      const imageIndex = executionOrder.indexOf(imageId);
      const modelIndex = executionOrder.indexOf(modelId);
      
      expect(imageIndex).toBeLessThan(modelIndex);
    });

    it('handles nodes without dependencies', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      
      // Two independent image nodes (no edges)
      const image1 = graphStore.addNode('image', 0, 0, { imageUrl: '/test1.png' });
      const image2 = graphStore.addNode('image', 200, 0, { imageUrl: '/test2.png' });
      
      const result = await executionEngine.execute();
      
      expect(result.success).toBe(true);
      expect(graphStore.getNodeById(image1)?.status).toBe('complete');
      expect(graphStore.getNodeById(image2)?.status).toBe('complete');
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================
  
  describe('error handling', () => {
    it('sets node to error state on failure', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      const { inferenceManager } = await import('../../inference/manager');
      
      // Make inference fail
      vi.mocked(inferenceManager.runImg2Img).mockRejectedValueOnce(
        new Error('GPU out of memory')
      );
      
      const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
      const modelId = graphStore.addNode('model', 200, 0, {
        positive_prompt: 'test',
      });
      graphStore.addEdge(imageId, 'image', modelId, 'image');
      
      const result = await executionEngine.execute();
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('GPU out of memory');
      
      const modelNode = graphStore.getNodeById(modelId);
      expect(modelNode?.status).toBe('error');
      expect(modelNode?.error).toBe('GPU out of memory');
    });

    it('reports missing input image error', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      
      // Model node without connected image
      const modelId = graphStore.addNode('model', 0, 0, {
        positive_prompt: 'test',
      });
      
      const result = await executionEngine.execute();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('input image');
    });

    it('reports missing prompt error', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      
      const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
      const modelId = graphStore.addNode('model', 200, 0, {
        positive_prompt: '', // Empty prompt
      });
      graphStore.addEdge(imageId, 'image', modelId, 'image');
      
      const result = await executionEngine.execute();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('prompt');
    });
  });

  // ===========================================================================
  // Callbacks
  // ===========================================================================
  
  describe('callbacks', () => {
    it('calls onModelJobComplete when model node completes', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      
      const onComplete = vi.fn();
      executionEngine.setCallbacks({ onModelJobComplete: onComplete });
      
      const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
      const modelId = graphStore.addNode('model', 200, 0, {
        positive_prompt: 'test prompt',
      });
      graphStore.addEdge(imageId, 'image', modelId, 'image');
      
      await executionEngine.execute();
      
      expect(onComplete).toHaveBeenCalledWith(
        modelId,
        expect.any(String) // outputNodeId - the auto-created output node
      );
    });

    it('creates output node on successful model execution', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      
      const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
      const modelId = graphStore.addNode('model', 200, 0, {
        positive_prompt: 'test prompt',
      });
      graphStore.addEdge(imageId, 'image', modelId, 'image');
      
      const initialNodeCount = graphStore.nodes.size;
      
      await executionEngine.execute();
      
      // An output node should have been created
      expect(graphStore.nodes.size).toBeGreaterThan(initialNodeCount);
      
      // Find the output node
      const outputNode = Array.from(graphStore.nodes.values()).find(
        n => n.type === 'output'
      );
      expect(outputNode).toBeDefined();
      expect(outputNode?.params.imageUrl).toBeDefined();
    });
  });

  // ===========================================================================
  // Concurrent Execution Prevention
  // ===========================================================================
  
  describe('concurrent execution', () => {
    it('prevents concurrent executions', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      const { inferenceManager } = await import('../../inference/manager');
      
      // Make inference slow
      vi.mocked(inferenceManager.runImg2Img).mockImplementation(
        () => new Promise(resolve => setTimeout(() => resolve({
          imageData: null,
          imageUrl: 'data:image/png;base64,test',
          timeTaken: 100,
          outputPath: '/test.png',
          width: 512,
          height: 512,
        }), 100))
      );
      
      const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
      const modelId = graphStore.addNode('model', 200, 0, {
        positive_prompt: 'test',
      });
      graphStore.addEdge(imageId, 'image', modelId, 'image');
      
      // Start first execution
      const firstExecution = executionEngine.execute();
      
      // Try to start second execution immediately
      const secondResult = await executionEngine.execute();
      
      // Second should fail immediately
      expect(secondResult.success).toBe(false);
      expect(secondResult.error).toContain('already in progress');
      
      // Wait for first to complete
      const firstResult = await firstExecution;
      expect(firstResult.success).toBe(true);
    });
  });

  // ===========================================================================
  // markDirty
  // ===========================================================================
  
  describe('markDirty', () => {
    it('marks node and dependents as dirty', async () => {
      const { graphStore } = await import('../../graph/store.svelte');
      const { executionEngine } = await import('../execution');
      
      // Create pipeline
      const imageId = graphStore.addNode('image', 0, 0, { imageUrl: '/test.png' });
      const modelId = graphStore.addNode('model', 200, 0, {
        positive_prompt: 'test',
      });
      graphStore.addEdge(imageId, 'image', modelId, 'image');
      
      // First execution
      await executionEngine.execute();
      
      // Reset node status to simulate being clean
      graphStore.updateNode(imageId, { status: 'complete' });
      graphStore.updateNode(modelId, { status: 'complete' });
      
      // Mark image as dirty
      executionEngine.markDirty(imageId);
      
      // Execute again - both should re-execute
      await executionEngine.execute();
      
      // Both should be complete again
      expect(graphStore.getNodeById(imageId)?.status).toBe('complete');
      expect(graphStore.getNodeById(modelId)?.status).toBe('complete');
    });
  });
});
