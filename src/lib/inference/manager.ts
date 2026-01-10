/**
 * Inference Manager
 * Coordinates inference requests with the Python backend
 */

const BACKEND_URL = 'http://localhost:8000';

export interface InferenceRequest {
  prompt: string;
  negativePrompt?: string;
  steps: number;
  guidanceScale: number;
  width: number;
  height: number;
  seed: number;
}

export interface Img2ImgRequest {
  inputImage: string; // URL or base64 of input image
  positivePrompt: string;
  negativePrompt?: string;
  // KSampler parameters
  seed: number;
  steps: number;
  cfg: number;
  samplerName: string; // 'lcm', 'euler', 'euler_a', 'dpmpp_2m', etc.
  scheduler: string; // 'normal', 'karras', 'exponential', etc.
  denoise: number; // 0.0 - 1.0
  // Model info
  modelPath?: string;
}

export interface InferenceResult {
  imageData: ImageData | null;
  imageUrl: string | null;
  timeTaken: number;
  outputPath?: string; // File path where image was saved
}

export interface InferenceProgress {
  step: number;
  totalSteps: number;
  latentPreview?: string;
  status?: string;
}

type ProgressCallback = (progress: InferenceProgress) => void;

interface BackendStatus {
  modelLoaded: boolean;
  device: string;
  modelName: string;
}

class InferenceManager {
  private backendAvailable = false;
  private modelLoaded = false;
  private loadingModel = false;
  private currentDevice = 'unknown';
  
  // Fallback worker for when backend is not available
  private worker: Worker | null = null;
  
  constructor() {
    this.checkBackendStatus();
  }
  
  /**
   * Check if the Python backend is available and model is loaded
   */
  async checkBackendStatus(): Promise<BackendStatus> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/model/info`);
      if (response.ok) {
        const data = await response.json();
        this.backendAvailable = true;
        this.modelLoaded = data.loaded;
        this.currentDevice = data.device;
        console.log(`Backend available: model ${data.loaded ? 'loaded' : 'not loaded'} on ${data.device}`);
        return {
          modelLoaded: data.loaded,
          device: data.device,
          modelName: data.model_name,
        };
      }
    } catch (error) {
      console.log('Backend not available, falling back to simulation mode');
      this.backendAvailable = false;
    }
    
    // Initialize fallback worker if backend not available
    if (!this.backendAvailable && !this.worker) {
      this.initFallbackWorker();
    }
    
    return {
      modelLoaded: false,
      device: 'none',
      modelName: '',
    };
  }
  
  private initFallbackWorker() {
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
   * Convert image URL to base64
   */
  private async imageUrlToBase64(url: string): Promise<string> {
    // If already base64, return as-is
    if (url.startsWith('data:')) {
      return url;
    }
    
    // Fetch the image and convert to base64
    const response = await fetch(url);
    const blob = await response.blob();
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }
  
  /**
   * Convert image URL to Blob for FormData
   * Throws descriptive error if URL is invalid or image can't be loaded
   */
  private async imageUrlToBlob(url: string): Promise<Blob> {
    // Validate input
    if (!url || url.trim() === '') {
      throw new Error('No input image provided. Please connect an image node to the model input.');
    }
    
    // Debug: console.log('📷 Converting image URL to blob:', url.substring(0, 100));
    
    try {
      let blob: Blob;
      
      if (url.startsWith('data:')) {
        // Convert base64 to blob
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error('Failed to parse base64 image data');
        }
        blob = await response.blob();
      } else {
        // Fetch from URL - make sure it's an absolute URL
        let fetchUrl = url;
        if (url.startsWith('/')) {
          // Relative URL - prepend the origin
          fetchUrl = `${window.location.origin}${url}`;
        }
        
        // Debug: console.log('  Fetching from:', fetchUrl);
        const response = await fetch(fetchUrl);
        
        if (!response.ok) {
          throw new Error(`Failed to load image from URL (${response.status}): ${response.statusText}`);
        }
        
        // Check content type from response
        const contentType = response.headers.get('content-type') || '';
        // Debug: console.log('  Response content-type:', contentType);
        
        if (!contentType.startsWith('image/') && !contentType.includes('octet-stream')) {
          // Server might have returned an error page
          const text = await response.text();
          if (text.includes('<!DOCTYPE') || text.includes('<html')) {
            throw new Error(`URL returned HTML instead of image. The file may not exist at: ${url}`);
          }
          throw new Error(`URL returned non-image content type: ${contentType}`);
        }
        
        blob = await response.blob();
      }
      
      // Debug: console.log('  Blob size:', blob.size, 'bytes, type:', blob.type);
      
      // Validate that we got a blob with content
      if (blob.size === 0) {
        throw new Error('Image file is empty or could not be loaded');
      }
      
      // Validate it's actually image data by trying to create an ImageBitmap
      try {
        const imageBitmap = await createImageBitmap(blob);
        // Debug: console.log('  ✅ Valid image:', imageBitmap.width, 'x', imageBitmap.height);
        imageBitmap.close(); // Clean up
      } catch (e) {
        throw new Error(`Invalid image data: the file could not be decoded as an image. Check if the file exists at: ${url}`);
      }
      
      return blob;
      
    } catch (error) {
      console.error('❌ Image loading error:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Failed to load input image: ${error}`);
    }
  }
  
  /**
   * Run img2img inference using the Python backend
   */
  async runImg2Img(
    request: Img2ImgRequest,
    onProgress?: ProgressCallback
  ): Promise<InferenceResult> {
    // Check backend status first
    const status = await this.checkBackendStatus();
    
    console.log('🎨 runImg2Img called');
    console.log('  Backend available:', this.backendAvailable);
    console.log('  Model loaded:', this.modelLoaded);
    console.log('  Status:', status);
    
    if (this.backendAvailable && this.modelLoaded) {
      console.log('✅ Using Python backend for inference');
      return this.runImg2ImgBackend(request, onProgress);
    } else {
      console.warn('⚠️ Backend not ready, using simulation mode');
      console.warn('  Reason:', !this.backendAvailable ? 'Backend unavailable' : 'Model not loaded');
      return this.runImg2ImgFallback(request, onProgress);
    }
  }
  
  /**
   * Run img2img using the Python backend with SSE progress
   */
  private async runImg2ImgBackend(
    request: Img2ImgRequest,
    onProgress?: ProgressCallback
  ): Promise<InferenceResult> {
    const startTime = performance.now();
    
    console.log('🚀 Starting backend img2img request');
    console.log('  Input image:', request.inputImage.substring(0, 50) + '...');
    console.log('  Prompt:', request.positivePrompt);
    console.log('  Steps:', request.steps, 'CFG:', request.cfg, 'Denoise:', request.denoise);
    
    try {
      // Convert image to blob for upload
      console.log('📦 Converting image to blob...');
      const imageBlob = await this.imageUrlToBlob(request.inputImage);
      console.log('  Blob size:', imageBlob.size, 'bytes');
      
      // Create form data
      const formData = new FormData();
      formData.append('image', imageBlob, 'input.png');
      formData.append('positive_prompt', request.positivePrompt);
      formData.append('negative_prompt', request.negativePrompt || '');
      formData.append('seed', String(request.seed));
      formData.append('steps', String(request.steps));
      formData.append('cfg', String(request.cfg));
      formData.append('sampler_name', request.samplerName);
      formData.append('scheduler', request.scheduler);
      formData.append('denoise', String(request.denoise));
      
      // Use SSE endpoint for progress updates
      if (onProgress) {
        return this.runImg2ImgWithProgress(formData, onProgress, startTime);
      }
      
      // Simple request without progress
      console.log('📡 Sending request to backend...');
      const response = await fetch(`${BACKEND_URL}/api/img2img`, {
        method: 'POST',
        body: formData,
      });
      
      console.log('📬 Response status:', response.status);
      
      if (!response.ok) {
        let errorMessage = `Backend error (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorMessage;
          console.error('❌ Backend error:', errorData);
        } catch {
          // If JSON parsing fails, try text
          try {
            const errorText = await response.text();
            if (errorText) errorMessage = errorText;
          } catch {
            // Use status-based message
          }
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      console.log('✅ Backend response received');
      console.log('  Time taken:', result.time_taken, 's');
      console.log('  Output size:', result.width, 'x', result.height);
      if (result.output_path) {
        console.log('  Saved to:', result.output_path);
      }
      
      return {
        imageData: null,
        imageUrl: result.image,
        timeTaken: result.time_taken * 1000, // Convert to ms
        outputPath: result.output_path,
      };
      
    } catch (error) {
      console.error('❌ Backend img2img error:', error);
      // Re-throw with cleaner message for display
      if (error instanceof Error) {
        throw error;
      }
      throw new Error(`Inference failed: ${error}`);
    }
  }
  
  /**
   * Run img2img with SSE progress streaming
   */
  private async runImg2ImgWithProgress(
    formData: FormData,
    onProgress: ProgressCallback,
    startTime: number
  ): Promise<InferenceResult> {
    // Simulate progress updates while waiting
    let currentStep = 0;
    const totalSteps = parseInt(formData.get('steps') as string) || 20;
    let progressInterval: ReturnType<typeof setInterval> | null = null;
    
    const startProgress = () => {
      progressInterval = setInterval(() => {
        if (currentStep < totalSteps - 1) {
          currentStep++;
          onProgress({
            step: currentStep,
            totalSteps: totalSteps,
            status: 'generating',
          });
        }
      }, 500);
    };
    
    const stopProgress = () => {
      if (progressInterval) {
        clearInterval(progressInterval);
        progressInterval = null;
      }
    };
    
    startProgress();
    
    try {
      const response = await fetch(`${BACKEND_URL}/api/img2img`, {
        method: 'POST',
        body: formData,
      });
      
      if (!response.ok) {
        let errorMessage = `Backend error (${response.status})`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorMessage;
        } catch {
          try {
            const errorText = await response.text();
            if (errorText) errorMessage = errorText;
          } catch {
            // Use status-based message
          }
        }
        throw new Error(errorMessage);
      }
      
      const result = await response.json();
      
      // Send final progress
      onProgress({
        step: result.steps || totalSteps,
        totalSteps: result.steps || totalSteps,
        status: 'complete',
      });
      
      return {
        imageData: null,
        imageUrl: result.image,
        timeTaken: result.time_taken * 1000,
        outputPath: result.output_path,
      };
      
    } catch (error) {
      // Send error progress
      onProgress({
        step: currentStep,
        totalSteps: totalSteps,
        status: 'error',
      });
      throw error;
    } finally {
      stopProgress();
    }
  }
  
  /**
   * Fallback img2img using web worker simulation
   */
  private async runImg2ImgFallback(
    request: Img2ImgRequest,
    onProgress?: ProgressCallback
  ): Promise<InferenceResult> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.initFallbackWorker();
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
   * Original text-to-image inference (for SDXL Turbo node)
   */
  async runInference(
    request: InferenceRequest,
    onProgress?: ProgressCallback
  ): Promise<InferenceResult> {
    // For now, use fallback worker
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        this.initFallbackWorker();
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
   * Load model (for fallback worker)
   */
  async loadModel(): Promise<void> {
    if (this.backendAvailable) {
      // Backend loads model on startup
      return;
    }
    
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
  
  isBackendAvailable(): boolean {
    return this.backendAvailable;
  }
  
  getDevice(): string {
    return this.currentDevice;
  }
  
  destroy() {
    this.worker?.terminate();
    this.worker = null;
  }
}

export const inferenceManager = new InferenceManager();
