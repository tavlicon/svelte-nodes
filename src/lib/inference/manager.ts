/**
 * Inference Manager
 * Coordinates inference requests between the Python backend and fallback handler
 * 
 * This is the main entry point for inference operations. It:
 * - Checks backend availability
 * - Routes requests to backend API or fallback handler
 * - Manages status state
 */

import { checkBackendStatus, runImg2ImgBackend, checkTripoSRStatus, runTripoSRBackend, type BackendStatus, type TripoSRStatus } from './api-client';
import { FallbackHandler } from './fallback-handler';
import type { InferenceRequest, Img2ImgRequest, InferenceResult, ProgressCallback, TripoSRRequest, TripoSRResult } from './types';

// Re-export types for consumers
export type { InferenceRequest, Img2ImgRequest, InferenceResult, InferenceProgress, ProgressCallback, TripoSRRequest, TripoSRResult } from './types';

class InferenceManager {
  private backendAvailable = false;
  private modelLoaded = false;
  private currentDevice = 'unknown';
  
  // TripoSR status
  private triposrAvailable = false;
  private triposrLoaded = false;
  
  // Fallback handler for when backend is not available
  private fallbackHandler = new FallbackHandler();
  
  // AbortController for cancelling in-flight requests
  private abortController: AbortController | null = null;
  
  constructor() {
    this.refreshStatus();
  }
  
  /**
   * Get an abort signal for the current operation
   * Creates a new AbortController if needed
   */
  private getAbortSignal(): AbortSignal {
    if (!this.abortController) {
      this.abortController = new AbortController();
    }
    return this.abortController.signal;
  }
  
  /**
   * Cancel all in-flight inference requests immediately
   */
  cancelAll(): void {
    if (this.abortController) {
      console.log('🛑 Cancelling all inference requests');
      this.abortController.abort();
      this.abortController = null;
    }
  }
  
  /**
   * Reset the abort controller for a new operation
   */
  resetAbort(): void {
    this.abortController = new AbortController();
  }
  
  /**
   * Check backend status and update internal state
   */
  async refreshStatus(): Promise<BackendStatus> {
    const status = await checkBackendStatus();
    
    if (status) {
      this.backendAvailable = true;
      this.modelLoaded = status.modelLoaded;
      this.currentDevice = status.device;
      return status;
    }
    
    // Backend not available - initialize fallback
    this.backendAvailable = false;
    this.fallbackHandler.initialize();
    
    return {
      modelLoaded: false,
      device: 'none',
      modelName: '',
    };
  }
  
  /**
   * Run img2img inference
   * Routes to backend or fallback based on availability
   */
  async runImg2Img(
    request: Img2ImgRequest,
    onProgress?: ProgressCallback
  ): Promise<InferenceResult> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'missing-image-v1',hypothesisId:'H2',location:'src/lib/inference/manager.ts:runImg2Img',message:'runImg2Img called',data:{hasInputImage:!!request?.inputImage},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Check backend status first
    const status = await this.refreshStatus();
    
    console.log('🎨 runImg2Img called');
    console.log('  Backend available:', this.backendAvailable);
    console.log('  Model loaded:', this.modelLoaded);
    console.log('  Status:', status);
    
    // Reset abort controller for new operation
    this.resetAbort();
    const signal = this.getAbortSignal();
    
    if (this.backendAvailable && this.modelLoaded) {
      console.log('✅ Using Python backend for inference');
      return runImg2ImgBackend(request, onProgress, signal);
    } else {
      console.warn('⚠️ Backend not ready, using simulation mode');
      console.warn('  Reason:', !this.backendAvailable ? 'Backend unavailable' : 'Model not loaded');
      return this.fallbackHandler.runImg2Img(request, onProgress);
    }
  }
  
  /**
   * Run text-to-image inference (for SDXL Turbo node)
   * Currently uses fallback worker
   */
  async runInference(
    request: InferenceRequest,
    onProgress?: ProgressCallback
  ): Promise<InferenceResult> {
    return this.fallbackHandler.runInference(request, onProgress);
  }
  
  /**
   * Load model (for fallback handler)
   */
  async loadModel(): Promise<void> {
    if (this.backendAvailable) {
      // Backend loads model on startup
      return;
    }
    
    this.fallbackHandler.loadModel();
  }
  
  /**
   * Alias for refreshStatus (backwards compatibility)
   */
  async checkBackendStatus(): Promise<BackendStatus> {
    return this.refreshStatus();
  }
  
  isModelLoaded(): boolean {
    return this.modelLoaded || this.fallbackHandler.isModelLoaded();
  }
  
  isLoading(): boolean {
    return this.fallbackHandler.isLoading();
  }
  
  isBackendAvailable(): boolean {
    return this.backendAvailable;
  }
  
  getDevice(): string {
    return this.currentDevice;
  }
  
  /**
   * Check TripoSR availability
   */
  async checkTripoSRStatus(): Promise<TripoSRStatus | null> {
    const status = await checkTripoSRStatus();
    if (status) {
      this.triposrAvailable = true;
      this.triposrLoaded = status.loaded;
    }
    return status;
  }
  
  /**
   * Run TripoSR 3D mesh generation
   */
  async runTripoSR(
    request: TripoSRRequest,
    onProgress?: ProgressCallback
  ): Promise<TripoSRResult> {
    // #region agent log
    fetch('http://127.0.0.1:7243/ingest/be99b28b-f9df-46c7-a353-9718949942ef',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sessionId:'debug-session',runId:'missing-image-v1',hypothesisId:'H2',location:'src/lib/inference/manager.ts:runTripoSR',message:'runTripoSR called',data:{hasInputImage:!!request?.inputImage},timestamp:Date.now()})}).catch(()=>{});
    // #endregion

    // Check backend status first
    await this.refreshStatus();
    
    console.log('🔺 runTripoSR called');
    console.log('  Backend available:', this.backendAvailable);
    
    if (!this.backendAvailable) {
      throw new Error('Backend not available. Please start the Python backend server.');
    }
    
    // Reset abort controller for new operation
    this.resetAbort();
    const signal = this.getAbortSignal();
    
    // TripoSR runs on backend only (no fallback)
    console.log('✅ Using Python backend for TripoSR inference');
    return runTripoSRBackend(request, onProgress, signal);
  }
  
  isTripoSRAvailable(): boolean {
    return this.triposrAvailable;
  }
  
  isTripoSRLoaded(): boolean {
    return this.triposrLoaded;
  }
  
  destroy(): void {
    this.fallbackHandler.destroy();
  }
}

export const inferenceManager = new InferenceManager();
