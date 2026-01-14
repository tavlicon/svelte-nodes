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
import { inferenceManager, type Img2ImgRequest, type TripoSRRequest } from '../inference/manager';

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
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'execution.ts:buildGraph',message:'Building graph',data:{nodeCount:nodes.size,edgeCount:edges.size,nodeTypes:Array.from(nodes.values()).map(n=>({id:n.id.slice(-6),type:n.type})),edges:Array.from(edges.values()).map(e=>({src:e.sourceNodeId.slice(-6),tgt:e.targetNodeId.slice(-6)}))},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1'})}).catch(()=>{});
    // #endregion
    
    // Initialize all nodes
    for (const [id, node] of nodes) {
      // Only mark as dirty if node hasn't successfully completed with cached output
      const hasValidOutput = node.status === 'complete' && node.outputCache && Object.keys(node.outputCache).length > 0;
      
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'execution.ts:buildGraph:initNode',message:'Init node dirty status',data:{nodeId:id.slice(-6),type:node.type,status:node.status,hasValidOutput,willBeDirty:!hasValidOutput},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX'})}).catch(()=>{});
      // #endregion
      
      this.executionGraph.set(id, {
        id,
        dependencies: [],
        dependents: [],
        dirty: !hasValidOutput, // Only dirty if no valid cached output
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
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'execution.ts:execute',message:'Execution order',data:{orderCount:order.length,order:order.map(id=>{const n=graphStore.getNodeById(id);return{id:id.slice(-6),type:n?.type};})},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H3'})}).catch(()=>{});
    // #endregion
    
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
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'execution.ts:execute',message:'Execution completed successfully',data:{nodesExecuted:order.length},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'execution.ts:execute',message:'Execution failed with error',data:{error:errorMessage},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H5'})}).catch(()=>{});
      // #endregion
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
    
    const inputEdges = graphStore.getInputEdges(nodeId);
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'execution.ts:executeNode',message:'Executing node',data:{nodeId:nodeId.slice(-6),type:node.type,inputEdgeCount:inputEdges.length,hasImageInput:inputEdges.some(e=>e.targetPortId==='image')},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H4'})}).catch(()=>{});
    // #endregion
    
    // Skip model/triposr nodes that have no input connections - they can't run without input
    const requiresImageInput = ['model', 'triposr'].includes(node.type);
    const hasImageInputConnection = inputEdges.some(e => e.targetPortId === 'image');
    
    if (requiresImageInput && !hasImageInputConnection) {
      // #region agent log
      fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'execution.ts:executeNode',message:'SKIPPING unconnected model node',data:{nodeId:nodeId.slice(-6),type:node.type},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'FIX2'})}).catch(()=>{});
      // #endregion
      console.log(`Skipping ${node.type} node ${nodeId.slice(-6)} - no image input connected`);
      // Mark as clean so it doesn't run again until connected
      const execNode = this.executionGraph.get(nodeId);
      if (execNode) execNode.dirty = false;
      return;
    }
    
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
          
        case 'triposr':
          outputs = await this.executeTripoSR(node, inputs);
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
          
        case 'mesh-output':
          // Mesh output node receives and displays the 3D mesh
          const meshUrl = (inputs.mesh as string) || (node.params.meshUrl as string) || '';
          const previewUrl = (node.params.previewUrl as string) || '';
          if (inputs.mesh) {
            const thumbnailForMesh = previewUrl || (inputs.mesh as string);
            graphStore.updateNode(nodeId, {
              thumbnailUrl: thumbnailForMesh,
              params: {
                ...node.params,
                meshUrl: inputs.mesh as string,
              },
            });
          }
          // Output the mesh so it can chain to another node
          outputs = { mesh: meshUrl };
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
      if ((node.type === 'model' || node.type === 'triposr') && outputs._outputNodeId) {
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
    
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'execution.ts:executeImg2Img',message:'Img2Img called',data:{nodeId:node.id.slice(-6),hasInputImage:!!inputImage,inputKeys:Object.keys(inputs)},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'H1,H4'})}).catch(()=>{});
    // #endregion
    
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
   * Execute TripoSR 3D mesh generation
   */
  private async executeTripoSR(
    node: NodeInstance,
    inputs: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    // Get input image (from connected image node)
    let inputImage = inputs.image as string | undefined;
    
    // NOTE: Removed fallback that grabbed ANY image node - only use connected inputs
    // This ensures only connected pipelines execute
    
    if (!inputImage || inputImage.trim() === '') {
      throw new Error('No input image connected. Connect an Image node to the TripoSR image input port.');
    }
    
    // Validate input image URL/data
    if (!inputImage.startsWith('data:') && !inputImage.startsWith('http') && !inputImage.startsWith('/')) {
      throw new Error(`Invalid image input: "${inputImage.substring(0, 50)}...". Expected a URL or base64 data.`);
    }
    
    // Build TripoSR request with all parameters
    const request: TripoSRRequest = {
      inputImage,
      foregroundRatio: (node.params.foreground_ratio as number) ?? 0.85,
      mcResolution: (node.params.mc_resolution as number) ?? 256,
      removeBackground: (node.params.remove_background as boolean) ?? true,
      chunkSize: (node.params.chunk_size as number) ?? 8192,
      bakeTexture: (node.params.bake_texture as boolean) ?? false,
      textureResolution: (node.params.texture_resolution as number) ?? 2048,
      // Video preview parameters
      renderVideo: (node.params.render_video as boolean) ?? true,
      renderNViews: (node.params.render_n_views as number) ?? 30,
      renderResolution: (node.params.render_resolution as number) ?? 256,
    };
    
    // Run TripoSR inference
    const result = await inferenceManager.runTripoSR(request, (progress) => {
      console.log(`TripoSR progress: ${progress.status} (${progress.step}/${progress.totalSteps})`);
    });
    
    // Update thumbnail with preview
    if (result.previewUrl) {
      graphStore.updateNode(node.id, { thumbnailUrl: result.previewUrl });
    }
    
    // Create mesh output node
    const outputNodeId = this.createOrUpdateMeshOutputNode(node, result);
    
    return { mesh: result.meshPath, _outputNodeId: outputNodeId };
  }
  
  /**
   * Create a new mesh output node for TripoSR generations
   */
  private createOrUpdateMeshOutputNode(
    modelNode: NodeInstance,
    result: { meshPath: string; videoUrl: string | null; previewUrl: string | null; outputPath: string; timeTaken: number; meshTime: number; videoTime: number | null; vertices: number; faces: number }
  ): string {
    // Extract generation parameters from model node
    const generationParams = {
      foregroundRatio: modelNode.params.foreground_ratio as number || 0.85,
      mcResolution: modelNode.params.mc_resolution as number || 256,
      removeBackground: modelNode.params.remove_background as boolean || true,
      chunkSize: modelNode.params.chunk_size as number || 8192,
      bakeTexture: modelNode.params.bake_texture as boolean || false,
      textureResolution: modelNode.params.texture_resolution as number || 2048,
      renderVideo: modelNode.params.render_video as boolean || true,
      modelName: modelNode.params.modelName as string || 'TripoSR Base',
    };
    
    // Calculate output node position
    const modelNodeWidth = modelNode.width || 200;
    const modelNodeHeight = modelNode.height || 200;
    const BASE_OUTPUT_SIZE = 200;
    
    // Position output to the RIGHT of the model node
    const outputX = modelNode.x + modelNodeWidth + 40;
    const modelCenterY = modelNode.y + (modelNodeHeight / 2);
    
    // Find existing mesh-output nodes to the right of the model
    const outputNodes = Array.from(graphStore.nodes.values())
      .filter(node => node.type === 'mesh-output')
      .filter(node => node.x >= modelNode.x + modelNodeWidth)
      .sort((a, b) => (a.y + (a.height || 200)) - (b.y + (b.height || 200)));
    
    // Calculate Y position
    let outputY: number;
    if (outputNodes.length === 0) {
      outputY = modelCenterY - (BASE_OUTPUT_SIZE / 2);
    } else {
      const lowestOutput = outputNodes[outputNodes.length - 1];
      const lowestOutputHeight = lowestOutput.height || 200;
      outputY = lowestOutput.y + lowestOutputHeight + 20;
    }
    
    // Create mesh output node
    const outputNodeId = graphStore.addNode('mesh-output', outputX, outputY, {
      meshUrl: result.meshPath,
      videoUrl: result.videoUrl || '',
      previewUrl: result.previewUrl || '',
      outputPath: result.outputPath,
      timeTaken: Math.round(result.timeTaken),
      meshTime: Math.round(result.meshTime),
      videoTime: result.videoTime ? Math.round(result.videoTime) : null,
      vertices: result.vertices,
      faces: result.faces,
      generationParams,
    }, BASE_OUTPUT_SIZE, BASE_OUTPUT_SIZE);
    
    // Set thumbnail (prefer video for animated preview, fallback to static)
    graphStore.updateNode(outputNodeId, {
      thumbnailUrl: result.previewUrl || '',
    });
    
    return outputNodeId;
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
