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
  private cancelled = false;
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
   * Cancel the current execution immediately
   * Aborts in-flight requests and stops execution
   */
  cancel() {
    if (this.running) {
      this.cancelled = true;
      console.log('🛑 Execution cancellation requested - aborting in-flight requests');
      // Immediately abort any in-flight inference requests
      inferenceManager.cancelAll();
    }
  }
  
  /**
   * Check if execution is currently running
   */
  isRunning(): boolean {
    return this.running;
  }
  
  /**
   * Build the execution graph from the current node state
   */
  buildGraph(nodes: Map<string, NodeInstance>, edges: Map<string, Edge>) {
    this.executionGraph.clear();
    
    
    // Initialize all nodes
    for (const [id, node] of nodes) {
      // Only mark as dirty if node hasn't successfully completed with cached output
      const hasValidOutput = node.status === 'complete' && node.outputCache && Object.keys(node.outputCache).length > 0;
      
      
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
    
    
    if (order.length === 0) {
      console.log('No dirty nodes to execute');
      return { success: true };
    }
    
    console.log('Execution order:', order);
    this.running = true;
    this.cancelled = false;
    
    try {
      for (const nodeId of order) {
        // Check for cancellation before each node
        if (this.cancelled) {
          console.log('🛑 Execution cancelled by user');
          return { success: false, error: 'Execution cancelled' };
        }
        await this.executeNode(nodeId);
      }
      return { success: true };
    } catch (error) {
      // Check if this was an abort/cancel
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('🛑 Execution aborted');
        return { success: false, error: 'Execution cancelled' };
      }
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error('Pipeline execution failed:', errorMessage);
      return { 
        success: false, 
        error: errorMessage,
        failedNodeId: order.find(id => graphStore.getNodeById(id)?.status === 'error'),
      };
    } finally {
      this.running = false;
      this.cancelled = false;
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
    
    // -------------------------------------------------------------------------
    // Pre-flight validation: skip or error model/triposr nodes without image input
    // -------------------------------------------------------------------------
    const requiresImageInput = node.type === 'model' || node.type === 'triposr';
    const hasImageInputConnection = inputEdges.some(e => e.targetPortId === 'image');
    if (requiresImageInput && !hasImageInputConnection) {
      // If node has NO input edges at all, skip silently - it's disconnected
      if (inputEdges.length === 0) {
        return; // Skip silently - node is not connected to any pipeline
      }

      // Node has some connections but missing required image input - this is an error
      const msg =
        node.type === 'triposr'
          ? 'No input image connected. Connect an Image node to the TripoSR image input port.'
          : "No input image connected. Connect an Image node to the model's image input port.";

      graphStore.updateNode(nodeId, {
        status: 'error',
        error: msg,
        outputCache: {},
      });

      throw new Error(msg);
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
   * Uses collision-aware placement to avoid overlapping with existing nodes
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
    
    // Preferred position: to the RIGHT of the model node, vertically centered
    const preferredX = modelNode.x + modelNodeWidth + 40;
    const modelCenterY = modelNode.y + (modelNodeHeight / 2);
    const preferredY = modelCenterY - (BASE_OUTPUT_SIZE / 2);
    
    // Find a non-overlapping position near the preferred location
    const { x: outputX, y: outputY } = this.findNonOverlappingPosition(
      preferredX,
      preferredY,
      BASE_OUTPUT_SIZE,
      BASE_OUTPUT_SIZE
    );
    
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
   * Check if a rectangle overlaps with any existing node
   */
  private checkOverlap(x: number, y: number, width: number, height: number, excludeNodeId?: string): boolean {
    const padding = 20; // Minimum gap between nodes
    for (const node of graphStore.nodes.values()) {
      if (excludeNodeId && node.id === excludeNodeId) continue;
      const nodeW = node.width || 200;
      const nodeH = node.height || 200;
      // Check if rectangles overlap (with padding)
      if (
        x < node.x + nodeW + padding &&
        x + width + padding > node.x &&
        y < node.y + nodeH + padding &&
        y + height + padding > node.y
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find a non-overlapping position near the preferred location
   * Prioritizes: right of source, then below, then above
   */
  private findNonOverlappingPosition(
    preferredX: number,
    preferredY: number,
    width: number,
    height: number
  ): { x: number; y: number } {
    // First try the preferred position
    if (!this.checkOverlap(preferredX, preferredY, width, height)) {
      return { x: preferredX, y: preferredY };
    }

    // Search in expanding rings around the preferred position
    // Prioritize: right of source, then below, then above
    const searchStep = 40;
    const maxSearchRadius = 800;

    // Try positions to the right first (maintaining left-to-right flow)
    for (let offsetX = 0; offsetX <= maxSearchRadius; offsetX += searchStep) {
      const testX = preferredX + offsetX;
      
      // Try at the preferred Y first
      if (!this.checkOverlap(testX, preferredY, width, height)) {
        return { x: testX, y: preferredY };
      }
      
      // Then try positions above and below
      for (let offsetY = searchStep; offsetY <= maxSearchRadius; offsetY += searchStep) {
        // Try below
        if (!this.checkOverlap(testX, preferredY + offsetY, width, height)) {
          return { x: testX, y: preferredY + offsetY };
        }
        // Try above
        if (!this.checkOverlap(testX, preferredY - offsetY, width, height)) {
          return { x: testX, y: preferredY - offsetY };
        }
      }
    }

    // Fallback: just use the preferred position
    return { x: preferredX, y: preferredY };
  }

  /**
   * Create a new output node for each generation (no wire connection)
   * Uses collision-aware placement to avoid overlapping with existing nodes
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
    
    const modelNodeWidth = modelNode.width || 200;
    const modelNodeHeight = modelNode.height || 200;
    
    // Calculate output node size based on actual image dimensions (maintain aspect ratio)
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
    
    // Preferred position: to the RIGHT of the model node, vertically centered
    const preferredX = modelNode.x + modelNodeWidth + 40; // 40px gap to the right
    const modelCenterY = modelNode.y + (modelNodeHeight / 2);
    const preferredY = modelCenterY - (outputNodeHeight / 2);
    
    // Find a non-overlapping position near the preferred location
    const { x: outputX, y: outputY } = this.findNonOverlappingPosition(
      preferredX,
      preferredY,
      outputNodeWidth,
      outputNodeHeight
    );
    
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
