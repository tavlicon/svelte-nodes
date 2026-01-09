/**
 * Inference Manager
 * Coordinates inference requests across workers and models
 */

export interface InferenceRequest {
  prompt: string;
  negativePrompt?: string;
  steps: number;
  guidanceScale: number;
  width: number;
  height: number;
  seed: number;
}

export interface InferenceResult {
  imageData: ImageData | null;
  imageUrl: string | null;
  timeTaken: number;
}

export interface InferenceProgress {
  step: number;
  totalSteps: number;
  latentPreview?: string;
}

type ProgressCallback = (progress: InferenceProgress) => void;

class InferenceManager {
  private worker: Worker | null = null;
  private modelLoaded = false;
  private loadingModel = false;
  private requestQueue: Array<{
    request: InferenceRequest;
    resolve: (result: InferenceResult) => void;
    reject: (error: Error) => void;
    onProgress?: ProgressCallback;
  }> = [];
  private currentRequest: typeof this.requestQueue[0] | null = null;
  
  constructor() {
    this.initWorker();
  }
  
  private initWorker() {
    // Create worker
    this.worker = new Worker(
      new URL('../workers/inference.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    this.worker.onmessage = (e) => this.handleWorkerMessage(e);
    this.worker.onerror = (e) => this.handleWorkerError(e);
  }
  
  private handleWorkerMessage(e: MessageEvent) {
    const { type, payload } = e.data;
    
    switch (type) {
      case 'model-loaded':
        this.modelLoaded = true;
        this.loadingModel = false;
        console.log('Model loaded successfully');
        this.processQueue();
        break;
        
      case 'model-load-error':
        this.loadingModel = false;
        console.error('Failed to load model:', payload.error);
        // Reject current request if any
        if (this.currentRequest) {
          this.currentRequest.reject(new Error(payload.error));
          this.currentRequest = null;
        }
        break;
        
      case 'model-load-progress':
        console.log(`Loading model: ${payload.progress}%`);
        break;
        
      case 'inference-progress':
        if (this.currentRequest?.onProgress) {
          this.currentRequest.onProgress(payload);
        }
        break;
        
      case 'inference-complete':
        if (this.currentRequest) {
          this.currentRequest.resolve({
            imageData: payload.imageData,
            imageUrl: payload.imageUrl,
            timeTaken: payload.timeTaken,
          });
          this.currentRequest = null;
          this.processQueue();
        }
        break;
        
      case 'inference-error':
        if (this.currentRequest) {
          this.currentRequest.reject(new Error(payload.error));
          this.currentRequest = null;
          this.processQueue();
        }
        break;
    }
  }
  
  private handleWorkerError(e: ErrorEvent) {
    console.error('Worker error:', e);
    if (this.currentRequest) {
      this.currentRequest.reject(new Error('Worker error'));
      this.currentRequest = null;
      this.processQueue();
    }
  }
  
  async loadModel(): Promise<void> {
    if (this.modelLoaded || this.loadingModel) return;
    
    this.loadingModel = true;
    this.worker?.postMessage({ type: 'load-model' });
  }
  
  async runInference(
    request: InferenceRequest,
    onProgress?: ProgressCallback
  ): Promise<InferenceResult> {
    return new Promise((resolve, reject) => {
      this.requestQueue.push({ request, resolve, reject, onProgress });
      this.processQueue();
    });
  }
  
  private async processQueue() {
    // If already processing or no requests, return
    if (this.currentRequest || this.requestQueue.length === 0) return;
    
    // If model not loaded, load it first
    if (!this.modelLoaded) {
      await this.loadModel();
      return; // Will be called again when model is loaded
    }
    
    // Get next request
    this.currentRequest = this.requestQueue.shift()!;
    
    // Send to worker
    this.worker?.postMessage({
      type: 'run-inference',
      payload: this.currentRequest.request,
    });
  }
  
  isModelLoaded(): boolean {
    return this.modelLoaded;
  }
  
  isLoading(): boolean {
    return this.loadingModel;
  }
  
  destroy() {
    this.worker?.terminate();
    this.worker = null;
  }
}

export const inferenceManager = new InferenceManager();
