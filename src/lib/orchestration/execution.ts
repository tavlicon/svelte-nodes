/**
 * Topological execution engine for the node graph
 * Handles dependency resolution, dirty tracking, and execution scheduling
 * 
 * Note: This engine reports events via callbacks and does NOT directly
 * manipulate UI state. UI behaviors (like selecting nodes after completion)
 * should be handled by the callback handlers in the UI layer.
 */

import type { NodeInstance, Edge } from '../graph/types';
import { graphStore } from '../graph/store.svelte';
import { nodeRegistry } from '../graph/nodes/registry';
import { inferenceManager, type Img2ImgRequest } from '../inference/manager';

export type ExecutionStatus = 'idle' | 'pending' | 'running' | 'complete' | 'error';

/**
 * Callbacks for execution events - allows UI layer to respond to execution lifecycle
 * This keeps UI logic out of the execution engine (separation of concerns)
 */
export interface ExecutionCallbacks {
  /** Called when a model node completes successfully and creates an output node */
  onModelJobComplete?: (modelNodeId: string, outputNodeId: string) => void;
}

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
  private callbacks: ExecutionCallbacks = {};
  
  /**
   * Set callbacks for execution events
   * This allows the UI layer to respond to execution lifecycle events
   */
  setCallbacks(callbacks: ExecutionCallbacks) {
    this.callbacks = callbacks;
  }
  
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
   * Returns true if execution completed successfully, false if any node failed
   */
  async execute(): Promise<{ success: boolean; error?: string; failedNodeId?: string }> {
    if (this.running) {
      console.log('Execution already in progress');
      return { success: false, error: 'Execution already in progress' };
    }
    
    // Rebuild graph
    this.buildGraph(graphStore.nodes, graphStore.edges);
    
    // Get execution order
    const order = this.topologicalSort();
    
    if (order.length === 0) {
      console.log('No dirty nodes to execute');
      return { success: true };
    }
    
    console.log('Execution order:', order);
    this.running = true;
    
    try {
      for (const nodeId of order) {
        await this.executeNode(nodeId);
      }
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Pipeline execution failed:', errorMessage);
      return { 
        success: false, 
        error: errorMessage,
        failedNodeId: order.find(id => graphStore.getNodeById(id)?.status === 'error'),
      };
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
          
        case 'model':
          outputs = await this.executeImg2Img(node, inputs);
          break;
          
        case 'image':
          // Image node outputs its image URL
          outputs = { image: node.params.imageUrl || '' };
          break;
          
        case 'image-display':
          // Just pass through the image
          outputs = { image: inputs.image };
          break;
          
        case 'output':
          // Output node receives and displays the image, AND outputs it for chaining
          // This allows output nodes to connect to model nodes for iterative generation
          const outputImageUrl = (inputs.image as string) || node.params.imageUrl || node.thumbnailUrl || '';
          if (inputs.image) {
            graphStore.updateNode(nodeId, {
              thumbnailUrl: inputs.image as string,
              params: {
                ...node.params,
                imageUrl: inputs.image as string,
              },
            });
          }
          // Output the image so it can chain to another model
          outputs = { image: outputImageUrl };
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
      
      // For model nodes: notify UI layer via callback so it can handle post-completion behavior
      // (UI logic like timeouts, node selection, etc. should be handled by the callback handler)
      if (node.type === 'model' && outputs._outputNodeId) {
        const outputNodeId = outputs._outputNodeId as string;
        this.callbacks.onModelJobComplete?.(nodeId, outputNodeId);
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Error executing node ${nodeId}:`, errorMessage);
      
      // Set node to error state with detailed message
      graphStore.updateNode(nodeId, {
        status: 'error',
        error: errorMessage,
        outputCache: {}, // Clear any partial outputs
      });
      
      // Re-throw to stop pipeline execution on error
      throw error;
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
   * Execute img2img model node (SD 1.5 style)
   */
  private async executeImg2Img(
    node: NodeInstance,
    inputs: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Get input image (from connected image node)
    const inputImage = inputs.image as string | undefined;
    
    if (!inputImage || inputImage.trim() === '') {
      throw new Error('No input image connected. Connect an Image node to the model\'s image input port.');
    }
    
    // Validate input image URL/data
    if (!inputImage.startsWith('data:') && !inputImage.startsWith('http') && !inputImage.startsWith('/')) {
      throw new Error(`Invalid image input: "${inputImage.substring(0, 50)}...". Expected a URL or base64 data.`);
    }
    
    // Get prompts from node params
    const positivePrompt = (node.params.positive_prompt as string) || '';
    const negativePrompt = (node.params.negative_prompt as string) || '';
    
    if (!positivePrompt || positivePrompt.trim() === '') {
      throw new Error('No positive prompt provided. Enter a prompt in the model node\'s parameters.');
    }
    
    // Build img2img request with KSampler params
    const request: Img2ImgRequest = {
      inputImage,
      positivePrompt,
      negativePrompt,
      // KSampler parameters
      seed: (node.params.seed as number) ?? 42,
      steps: (node.params.steps as number) ?? 3,
      cfg: (node.params.cfg as number) ?? 2.0,
      samplerName: (node.params.sampler_name as string) ?? 'lcm',
      scheduler: (node.params.scheduler as string) ?? 'normal',
      denoise: (node.params.denoise as number) ?? 0.75,
      // Model info
      modelPath: (node.params.modelPath as string) || '',
    };
    
    // Run img2img inference
    const result = await inferenceManager.runImg2Img(request, (progress) => {
      // Update node status with progress
      console.log(`Img2Img progress: step ${progress.step}/${progress.totalSteps}`);
    });
    
    // Handle seed control after generate
    const controlAfterGenerate = node.params.control_after_generate as string;
    if (controlAfterGenerate !== 'fixed') {
      let newSeed = node.params.seed as number;
      switch (controlAfterGenerate) {
        case 'increment':
          newSeed += 1;
          break;
        case 'decrement':
          newSeed -= 1;
          break;
        case 'randomize':
          newSeed = Math.floor(Math.random() * 2147483647);
          break;
      }
      graphStore.updateNode(node.id, {
        params: { ...node.params, seed: newSeed },
      });
    }
    
    // Update thumbnail
    if (result.imageUrl) {
      graphStore.updateNode(node.id, { thumbnailUrl: result.imageUrl });
    }
    
    // Create or update output node
    const outputNodeId = this.createOrUpdateOutputNode(node, result);
    
    return { image: result.imageUrl || result.imageData, _outputNodeId: outputNodeId };
  }
  
  /**
   * Create a new output node for each generation (no wire connection)
   * Stacks outputs vertically below previous ones
   * Returns the output node ID
   */
  private createOrUpdateOutputNode(
    modelNode: NodeInstance,
    result: { imageUrl: string | null; outputPath?: string; timeTaken: number; width?: number; height?: number }
  ): string {
    // Extract generation parameters from model node
    const generationParams = {
      prompt: modelNode.params.positive_prompt as string || '',
      negativePrompt: modelNode.params.negative_prompt as string || '',
      steps: modelNode.params.steps as number || 0,
      cfg: modelNode.params.cfg as number || 0,
      denoise: modelNode.params.denoise as number || 0,
      seed: modelNode.params.seed as number || 0,
      sampler: modelNode.params.sampler_name as string || '',
      scheduler: modelNode.params.scheduler as string || '',
      modelName: modelNode.params.modelName as string || 'SD 1.5',
    };
    
    // Find all existing output nodes to the right of the model
    // This allows us to stack below the lowest one
    const modelNodeWidth = modelNode.width || 200;
    const modelNodeHeight = modelNode.height || 200;
    
    // Calculate output node size based on actual image dimensions (maintain aspect ratio)
    // Match the input image node sizing logic so they appear the same size
    const BASE_OUTPUT_SIZE = 200;
    const imgWidth = result.width || 512;
    const imgHeight = result.height || 512;
    const aspectRatio = imgWidth / imgHeight;
    
    let outputNodeWidth: number;
    let outputNodeHeight: number;
    
    if (imgHeight > imgWidth) {
      // Portrait - width matches base, height grows
      outputNodeWidth = BASE_OUTPUT_SIZE;
      outputNodeHeight = Math.round(BASE_OUTPUT_SIZE / aspectRatio);
    } else {
      // Landscape or square - height matches base, width grows
      outputNodeHeight = BASE_OUTPUT_SIZE;
      outputNodeWidth = Math.round(BASE_OUTPUT_SIZE * aspectRatio);
    }
    
    // Position output to the RIGHT of the model node
    const outputX = modelNode.x + modelNodeWidth + 40; // 40px gap to the right
    
    // Vertical center of model node
    const modelCenterY = modelNode.y + (modelNodeHeight / 2);
    
    // Find output nodes that are to the right of the model (within the output column)
    const outputNodes = Array.from(graphStore.nodes.values())
      .filter(node => node.type === 'output')
      .filter(node => node.x >= modelNode.x + modelNodeWidth) // To the right of model
      .sort((a, b) => (a.y + (a.height || 200)) - (b.y + (b.height || 200))); // Sort by bottom edge
    
    // Calculate Y position - align vertical center with model, or stack below previous outputs
    let outputY: number;
    
    if (outputNodes.length === 0) {
      // First output - vertically center with model node
      outputY = modelCenterY - (outputNodeHeight / 2);
    } else {
      // Stack below the lowest output node (by bottom edge) with a small gap
      const lowestOutput = outputNodes[outputNodes.length - 1];
      const lowestOutputHeight = lowestOutput.height || 200;
      outputY = lowestOutput.y + lowestOutputHeight + 20; // 20px gap between outputs
    }
    
    // Always create a new output node (no wire connection) with proper dimensions
    const outputNodeId = graphStore.addNode('output', outputX, outputY, {
      imageUrl: result.imageUrl || '',
      outputPath: result.outputPath || '',
      timeTaken: Math.round(result.timeTaken),
      generationParams,
      imageWidth: imgWidth,
      imageHeight: imgHeight,
    }, outputNodeWidth, outputNodeHeight);
    
    // Set thumbnail - must be set separately as it's a top-level property
    graphStore.updateNode(outputNodeId, {
      thumbnailUrl: result.imageUrl || '',
    });
    
    return outputNodeId;
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
