/**
 * Topological execution engine for the node graph
 * Handles dependency resolution, dirty tracking, and execution scheduling
 */

import type { NodeInstance, Edge } from './types';
import { graphStore } from './store.svelte';
import { nodeRegistry } from './nodes/registry';
import { inferenceManager } from '../inference/manager';

export type ExecutionStatus = 'idle' | 'pending' | 'running' | 'complete' | 'error';

interface ExecutionNode {
  id: string;
  dependencies: string[];
  dependents: string[];
  dirty: boolean;
}

class ExecutionEngine {
  private executionGraph: Map<string, ExecutionNode> = new Map();
  private running = false;
  private queue: string[] = [];
  
  /**
   * Build the execution graph from the current node state
   */
  buildGraph(nodes: Map<string, NodeInstance>, edges: Map<string, Edge>) {
    this.executionGraph.clear();
    
    // Initialize all nodes
    for (const [id] of nodes) {
      this.executionGraph.set(id, {
        id,
        dependencies: [],
        dependents: [],
        dirty: true, // Initially all nodes are dirty
      });
    }
    
    // Build dependency relationships from edges
    for (const edge of edges.values()) {
      const sourceExec = this.executionGraph.get(edge.sourceNodeId);
      const targetExec = this.executionGraph.get(edge.targetNodeId);
      
      if (sourceExec && targetExec) {
        // Target depends on source
        targetExec.dependencies.push(edge.sourceNodeId);
        sourceExec.dependents.push(edge.targetNodeId);
      }
    }
  }
  
  /**
   * Mark a node and all its dependents as dirty
   */
  markDirty(nodeId: string) {
    const visited = new Set<string>();
    const stack = [nodeId];
    
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      
      const execNode = this.executionGraph.get(id);
      if (execNode) {
        execNode.dirty = true;
        stack.push(...execNode.dependents);
      }
    }
  }
  
  /**
   * Topological sort of dirty nodes
   */
  private topologicalSort(): string[] {
    const result: string[] = [];
    const visited = new Set<string>();
    const temp = new Set<string>();
    
    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (temp.has(id)) {
        console.warn('Cycle detected in graph');
        return;
      }
      
      const execNode = this.executionGraph.get(id);
      if (!execNode || !execNode.dirty) return;
      
      temp.add(id);
      
      // Visit dependencies first
      for (const depId of execNode.dependencies) {
        visit(depId);
      }
      
      temp.delete(id);
      visited.add(id);
      result.push(id);
    };
    
    for (const [id, node] of this.executionGraph) {
      if (node.dirty && !visited.has(id)) {
        visit(id);
      }
    }
    
    return result;
  }
  
  /**
   * Execute the graph
   */
  async execute() {
    if (this.running) {
      console.log('Execution already in progress');
      return;
    }
    
    // Rebuild graph
    this.buildGraph(graphStore.nodes, graphStore.edges);
    
    // Get execution order
    const order = this.topologicalSort();
    
    if (order.length === 0) {
      console.log('No dirty nodes to execute');
      return;
    }
    
    console.log('Execution order:', order);
    this.running = true;
    
    try {
      for (const nodeId of order) {
        await this.executeNode(nodeId);
      }
    } finally {
      this.running = false;
    }
  }
  
  /**
   * Execute a single node
   */
  private async executeNode(nodeId: string) {
    const node = graphStore.getNodeById(nodeId);
    if (!node) return;
    
    const def = nodeRegistry[node.type];
    if (!def) return;
    
    // Update status
    graphStore.updateNode(nodeId, { status: 'running', error: undefined });
    
    try {
      // Gather inputs from connected nodes
      const inputs = this.gatherInputs(nodeId);
      
      // Execute based on node type
      let outputs: Record<string, unknown> = {};
      
      switch (node.type) {
        case 'prompt':
          outputs = { text: node.params.text || '' };
          break;
          
        case 'sdxl-turbo':
          outputs = await this.executeSDXLTurbo(node, inputs);
          break;
          
        case 'image-display':
          // Just pass through the image
          outputs = { image: inputs.image };
          break;
          
        default:
          console.warn(`Unknown node type: ${node.type}`);
      }
      
      // Cache outputs
      graphStore.updateNode(nodeId, {
        status: 'complete',
        outputCache: outputs,
      });
      
      // Mark as clean
      const execNode = this.executionGraph.get(nodeId);
      if (execNode) {
        execNode.dirty = false;
      }
      
    } catch (error) {
      console.error(`Error executing node ${nodeId}:`, error);
      graphStore.updateNode(nodeId, {
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  
  /**
   * Gather inputs from connected upstream nodes
   */
  private gatherInputs(nodeId: string): Record<string, unknown> {
    const inputs: Record<string, unknown> = {};
    const edges = graphStore.getInputEdges(nodeId);
    
    for (const edge of edges) {
      const sourceNode = graphStore.getNodeById(edge.sourceNodeId);
      if (sourceNode?.outputCache) {
        inputs[edge.targetPortId] = sourceNode.outputCache[edge.sourcePortId];
      }
    }
    
    return inputs;
  }
  
  /**
   * Execute SDXL Turbo node
   */
  private async executeSDXLTurbo(
    node: NodeInstance,
    inputs: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const prompt = (inputs.prompt as string) || '';
    const negativePrompt = (inputs.negative_prompt as string) || '';
    
    if (!prompt) {
      throw new Error('No prompt provided');
    }
    
    // Run inference
    const result = await inferenceManager.runInference({
      prompt,
      negativePrompt,
      steps: (node.params.steps as number) || 4,
      guidanceScale: (node.params.guidance_scale as number) || 0.0,
      width: (node.params.width as number) || 512,
      height: (node.params.height as number) || 512,
      seed: (node.params.seed as number) || -1,
    });
    
    // Update thumbnail
    if (result.imageUrl) {
      graphStore.updateNode(node.id, { thumbnailUrl: result.imageUrl });
    }
    
    return { image: result.imageData };
  }
  
  /**
   * Execute a single node by ID
   */
  async executeNodeById(nodeId: string) {
    this.markDirty(nodeId);
    await this.execute();
  }
}

export const executionEngine = new ExecutionEngine();
