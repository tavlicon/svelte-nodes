/**
 * Backend API Client
 * Handles all HTTP communication with the Python inference backend
 */

import type { Img2ImgRequest, InferenceResult, InferenceProgress } from './types';

const BACKEND_URL = 'http://localhost:8000';

export interface BackendStatus {
  modelLoaded: boolean;
  device: string;
  modelName: string;
}

type ProgressCallback = (progress: InferenceProgress) => void;

/**
 * Check if the Python backend is available and get its status
 */
export async function checkBackendStatus(): Promise<BackendStatus | null> {
  try {
    const response = await fetch(`${BACKEND_URL}/api/model/info`);
    if (response.ok) {
      const data = await response.json();

      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/abe54877-15bd-4ed2-bfd1-f461dfe66d18', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'debug-session',
          runId: 'pre-fix',
          hypothesisId: 'H2',
          location: 'src/lib/inference/api-client.ts:checkBackendStatus',
          message: 'Backend status fetch success',
          data: { status: response.status, loaded: data.loaded, device: data.device },
          timestamp: Date.now(),
        }),
      }).catch(() => {});
      // #endregion

      console.log(`Backend available: model ${data.loaded ? 'loaded' : 'not loaded'} on ${data.device}`);
      return {
        modelLoaded: data.loaded,
        device: data.device,
        modelName: data.model_name,
      };
    }
  } catch (error) {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/abe54877-15bd-4ed2-bfd1-f461dfe66d18', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'pre-fix',
        hypothesisId: 'H2',
        location: 'src/lib/inference/api-client.ts:checkBackendStatus',
        message: 'Backend status fetch failed',
        data: { error: error instanceof Error ? error.message : String(error) },
        timestamp: Date.now(),
      }),
    }).catch(() => {});
    // #endregion

    console.log('Backend not available, falling back to simulation mode');
  }
  
  return null;
}

/**
 * Convert image URL to Blob for FormData upload
 * Throws descriptive error if URL is invalid or image can't be loaded
 */
export async function imageUrlToBlob(url: string): Promise<Blob> {
  // Validate input
  if (!url || url.trim() === '') {
    throw new Error('No input image provided. Please connect an image node to the model input.');
  }
  
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
      
      const response = await fetch(fetchUrl);
      
      if (!response.ok) {
        throw new Error(`Failed to load image from URL (${response.status}): ${response.statusText}`);
      }
      
      // Check content type from response
      const contentType = response.headers.get('content-type') || '';
      
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
    
    // Validate that we got a blob with content
    if (blob.size === 0) {
      throw new Error('Image file is empty or could not be loaded');
    }
    
    // Validate it's actually image data by trying to create an ImageBitmap
    try {
      const imageBitmap = await createImageBitmap(blob);
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
export async function runImg2ImgBackend(
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
    const imageBlob = await imageUrlToBlob(request.inputImage);
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
      return runImg2ImgWithProgress(formData, onProgress, startTime);
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
      width: result.width,
      height: result.height,
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
 * Run img2img with progress streaming (simulated since SSE isn't fully implemented)
 */
async function runImg2ImgWithProgress(
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
      width: result.width,
      height: result.height,
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
