/**
 * Fallback Handler
 * Manages the web worker fallback when backend is unavailable
 */

import type { InferenceRequest, Img2ImgRequest, InferenceResult, InferenceProgress, ProgressCallback } from './types';

/**
 * Fallback inference handler using web worker simulation
 */
export class FallbackHandler {
  private worker: Worker | null = null;
  private modelLoaded = false;
  private loadingModel = false;
  
  /**
   * Initialize the fallback worker
   */
  initialize(): void {
    if (this.worker) return;
    
    this.worker = new Worker(
      new URL('../workers/inference.worker.ts', import.meta.url),
      { type: 'module' }
    );
    
    this.worker.onmessage = (e) => {
      const { type } = e.data;
      if (type === 'model-loaded') {
        this.modelLoaded = true;
        this.loadingModel = false;
      }
    };
  }
  
  /**
   * Run img2img inference using the web worker (simulation mode)
   */
  runImg2Img(
    request: Img2ImgRequest,
    onProgress?: ProgressCallback
  ): Promise<InferenceResult> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.initialize();
      }
      
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }
      
      const handleMessage = (e: MessageEvent) => {
        const { type, payload } = e.data;
        
        switch (type) {
          case 'inference-progress':
            if (onProgress) {
              onProgress(payload);
            }
            break;
            
          case 'inference-complete':
            this.worker?.removeEventListener('message', handleMessage);
            resolve({
              imageData: payload.imageData,
              imageUrl: payload.imageUrl,
              timeTaken: payload.timeTaken,
            });
            break;
            
          case 'inference-error':
            this.worker?.removeEventListener('message', handleMessage);
            reject(new Error(payload.error));
            break;
        }
      };
      
      this.worker.addEventListener('message', handleMessage);
      
      // Convert to internal request format
      this.worker.postMessage({
        type: 'run-inference',
        payload: {
          type: 'img2img',
          ...request,
        },
      });
    });
  }
  
  /**
   * Run text-to-image inference using the web worker
   */
  runInference(
    request: InferenceRequest,
    onProgress?: ProgressCallback
  ): Promise<InferenceResult> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.initialize();
      }
      
      if (!this.worker) {
        reject(new Error('Worker not initialized'));
        return;
      }
      
      const handleMessage = (e: MessageEvent) => {
        const { type, payload } = e.data;
        
        switch (type) {
          case 'inference-progress':
            if (onProgress) {
              onProgress(payload);
            }
            break;
            
          case 'inference-complete':
            this.worker?.removeEventListener('message', handleMessage);
            resolve({
              imageData: payload.imageData,
              imageUrl: payload.imageUrl,
              timeTaken: payload.timeTaken,
            });
            break;
            
          case 'inference-error':
            this.worker?.removeEventListener('message', handleMessage);
            reject(new Error(payload.error));
            break;
        }
      };
      
      this.worker.addEventListener('message', handleMessage);
      
      this.worker.postMessage({
        type: 'run-inference',
        payload: request,
      });
    });
  }
  
  /**
   * Load model in the worker
   */
  loadModel(): void {
    if (this.modelLoaded || this.loadingModel) return;
    
    this.loadingModel = true;
    this.worker?.postMessage({ type: 'load-model' });
  }
  
  isModelLoaded(): boolean {
    return this.modelLoaded;
  }
  
  isLoading(): boolean {
    return this.loadingModel;
  }
  
  /**
   * Destroy the worker
   */
  destroy(): void {
    this.worker?.terminate();
    this.worker = null;
    this.modelLoaded = false;
    this.loadingModel = false;
  }
}
