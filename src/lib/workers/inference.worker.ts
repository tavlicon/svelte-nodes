/**
 * Inference Worker
 * Runs ONNX Runtime inference off the main thread
 */

import * as ort from 'onnxruntime-web';

// Configure ONNX Runtime for WebGPU
ort.env.wasm.numThreads = 4;

interface InferenceRequest {
  prompt: string;
  negativePrompt?: string;
  steps: number;
  guidanceScale: number;
  width: number;
  height: number;
  seed: number;
}

let session: ort.InferenceSession | null = null;
let textEncoderSession: ort.InferenceSession | null = null;
let vaeDecoderSession: ort.InferenceSession | null = null;

// Simple tokenizer (will be replaced with proper CLIP tokenizer)
function simpleTokenize(text: string, maxLength = 77): Float32Array {
  const tokens = new Float32Array(maxLength).fill(49407); // End token
  tokens[0] = 49406; // Start token
  
  // Very basic tokenization - in production use proper BPE tokenizer
  const words = text.toLowerCase().split(/\s+/).slice(0, maxLength - 2);
  for (let i = 0; i < words.length; i++) {
    // Use a simple hash as placeholder
    tokens[i + 1] = (words[i].charCodeAt(0) * 1000 + words[i].length) % 49405 + 1;
  }
  
  return tokens;
}

// Generate random latents
function generateLatents(
  batchSize: number,
  height: number,
  width: number,
  seed: number
): Float32Array {
  const channels = 4;
  const latentHeight = Math.floor(height / 8);
  const latentWidth = Math.floor(width / 8);
  const size = batchSize * channels * latentHeight * latentWidth;
  
  const latents = new Float32Array(size);
  
  // Simple seeded random (replace with proper implementation)
  let s = seed < 0 ? Math.floor(Math.random() * 1000000) : seed;
  for (let i = 0; i < size; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    // Box-Muller transform for normal distribution
    const u1 = (s & 0xffff) / 65536;
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    const u2 = (s & 0xffff) / 65536;
    latents[i] = Math.sqrt(-2 * Math.log(u1 + 1e-10)) * Math.cos(2 * Math.PI * u2);
  }
  
  return latents;
}

// Placeholder inference function
// In production, this would run the actual SDXL Turbo pipeline
async function runSDXLTurboPipeline(
  request: InferenceRequest,
  onProgress: (step: number, totalSteps: number) => void
): Promise<ImageData> {
  const { prompt, width, height, steps, seed } = request;
  
  console.log(`Running inference: "${prompt}" (${width}x${height}, ${steps} steps)`);
  
  // Simulate the inference process
  for (let step = 1; step <= steps; step++) {
    onProgress(step, steps);
    
    // Simulate processing time per step
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  
  // Generate a placeholder image with gradient based on prompt hash
  const imageData = new ImageData(width, height);
  const data = imageData.data;
  
  // Create a unique pattern based on prompt
  let hash = 0;
  for (let i = 0; i < prompt.length; i++) {
    hash = ((hash << 5) - hash) + prompt.charCodeAt(i);
    hash = hash & hash;
  }
  
  const r1 = Math.abs(hash % 256);
  const g1 = Math.abs((hash >> 8) % 256);
  const b1 = Math.abs((hash >> 16) % 256);
  const r2 = 255 - r1;
  const g2 = 255 - g1;
  const b2 = 255 - b1;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const t = (x / width + y / height) / 2;
      
      // Gradient with noise
      const noise = (Math.sin(x * 0.1 + hash) + Math.cos(y * 0.1 + hash)) * 20;
      
      data[idx] = Math.min(255, Math.max(0, r1 + (r2 - r1) * t + noise));
      data[idx + 1] = Math.min(255, Math.max(0, g1 + (g2 - g1) * t + noise));
      data[idx + 2] = Math.min(255, Math.max(0, b1 + (b2 - b1) * t + noise));
      data[idx + 3] = 255;
    }
  }
  
  return imageData;
}

// Convert ImageData to data URL
function imageDataToDataURL(imageData: ImageData): string {
  const canvas = new OffscreenCanvas(imageData.width, imageData.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to get canvas context');
  
  ctx.putImageData(imageData, 0, 0);
  
  // Convert to blob and then to data URL
  // Note: In a real implementation, we'd use canvas.convertToBlob()
  // For now, we'll return a placeholder
  return `data:image/png;base64,placeholder_${Date.now()}`;
}

async function loadModel() {
  try {
    self.postMessage({ type: 'model-load-progress', payload: { progress: 10 } });
    
    // In production, load actual ONNX models:
    // const textEncoderUrl = '/models/sdxl-turbo/text_encoder.onnx';
    // const unetUrl = '/models/sdxl-turbo/unet.onnx';
    // const vaeUrl = '/models/sdxl-turbo/vae_decoder.onnx';
    
    // For now, we'll simulate loading
    await new Promise(resolve => setTimeout(resolve, 500));
    self.postMessage({ type: 'model-load-progress', payload: { progress: 50 } });
    
    await new Promise(resolve => setTimeout(resolve, 500));
    self.postMessage({ type: 'model-load-progress', payload: { progress: 100 } });
    
    self.postMessage({ type: 'model-loaded' });
  } catch (error) {
    self.postMessage({
      type: 'model-load-error',
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

async function runInference(request: InferenceRequest) {
  const startTime = performance.now();
  
  try {
    const imageData = await runSDXLTurboPipeline(request, (step, totalSteps) => {
      self.postMessage({
        type: 'inference-progress',
        payload: { step, totalSteps },
      });
    });
    
    // Convert to blob for efficient transfer
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get canvas context');
    ctx.putImageData(imageData, 0, 0);
    
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const imageUrl = URL.createObjectURL(blob);
    
    const timeTaken = performance.now() - startTime;
    
    self.postMessage({
      type: 'inference-complete',
      payload: {
        imageData,
        imageUrl,
        timeTaken,
      },
    });
  } catch (error) {
    self.postMessage({
      type: 'inference-error',
      payload: { error: error instanceof Error ? error.message : String(error) },
    });
  }
}

// Message handler
self.onmessage = async (e: MessageEvent) => {
  const { type, payload } = e.data;
  
  switch (type) {
    case 'load-model':
      await loadModel();
      break;
      
    case 'run-inference':
      await runInference(payload);
      break;
  }
};
