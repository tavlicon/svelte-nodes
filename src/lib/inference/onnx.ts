/**
 * ONNX Runtime Web Wrapper
 * Provides utilities for loading and running ONNX models with WebGPU
 */

import * as ort from 'onnxruntime-web';

// Configure ONNX Runtime for optimal performance
export function configureONNXRuntime() {
  // Use WebGPU execution provider
  ort.env.wasm.numThreads = navigator.hardwareConcurrency || 4;
  ort.env.wasm.simd = true;
  
  // Set log level
  ort.env.logLevel = 'warning';
  
  console.log('ONNX Runtime configured with WebGPU');
}

export interface ModelLoadOptions {
  executionProviders?: string[];
  graphOptimizationLevel?: 'disabled' | 'basic' | 'extended' | 'all';
  enableMemPattern?: boolean;
  enableCpuMemArena?: boolean;
  onProgress?: (progress: number) => void;
}

export async function loadModel(
  modelPath: string,
  options: ModelLoadOptions = {}
): Promise<ort.InferenceSession> {
  const {
    executionProviders = ['webgpu', 'wasm'],
    graphOptimizationLevel = 'all',
    enableMemPattern = true,
    enableCpuMemArena = true,
  } = options;
  
  const sessionOptions: ort.InferenceSession.SessionOptions = {
    executionProviders: executionProviders.map(ep => {
      if (ep === 'webgpu') {
        return {
          name: 'webgpu',
          preferredLayout: 'NHWC',
        };
      }
      return ep;
    }),
    graphOptimizationLevel,
    enableMemPattern,
    enableCpuMemArena,
  };
  
  try {
    const session = await ort.InferenceSession.create(modelPath, sessionOptions);
    console.log(`Model loaded: ${modelPath}`);
    console.log('Input names:', session.inputNames);
    console.log('Output names:', session.outputNames);
    return session;
  } catch (error) {
    console.error(`Failed to load model ${modelPath}:`, error);
    throw error;
  }
}

export async function runInference(
  session: ort.InferenceSession,
  inputs: Record<string, ort.Tensor>
): Promise<Record<string, ort.Tensor>> {
  try {
    const results = await session.run(inputs);
    return results;
  } catch (error) {
    console.error('Inference failed:', error);
    throw error;
  }
}

// Tensor utilities
export function createTensor(
  data: Float32Array | Int32Array | Uint8Array,
  dims: number[],
  type: ort.Tensor.Type = 'float32'
): ort.Tensor {
  return new ort.Tensor(type, data, dims);
}

export function tensorToImageData(
  tensor: ort.Tensor,
  width: number,
  height: number
): ImageData {
  const data = tensor.data as Float32Array;
  const imageData = new ImageData(width, height);
  const pixels = imageData.data;
  
  // Assuming tensor is in NCHW format with values 0-1
  const channels = 3;
  const channelSize = width * height;
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const pixelIdx = i * 4;
      
      // Convert from CHW to HWC
      pixels[pixelIdx] = Math.round(Math.min(255, Math.max(0, data[i] * 255))); // R
      pixels[pixelIdx + 1] = Math.round(Math.min(255, Math.max(0, data[channelSize + i] * 255))); // G
      pixels[pixelIdx + 2] = Math.round(Math.min(255, Math.max(0, data[2 * channelSize + i] * 255))); // B
      pixels[pixelIdx + 3] = 255; // A
    }
  }
  
  return imageData;
}

export function imageDataToTensor(
  imageData: ImageData,
  normalize = true
): ort.Tensor {
  const { width, height, data } = imageData;
  const channels = 3;
  const channelSize = width * height;
  const tensorData = new Float32Array(channels * channelSize);
  
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const pixelIdx = i * 4;
      
      // Convert from HWC to CHW
      const r = data[pixelIdx];
      const g = data[pixelIdx + 1];
      const b = data[pixelIdx + 2];
      
      if (normalize) {
        tensorData[i] = r / 255;
        tensorData[channelSize + i] = g / 255;
        tensorData[2 * channelSize + i] = b / 255;
      } else {
        tensorData[i] = r;
        tensorData[channelSize + i] = g;
        tensorData[2 * channelSize + i] = b;
      }
    }
  }
  
  return new ort.Tensor('float32', tensorData, [1, channels, height, width]);
}

// Check WebGPU availability
export async function checkWebGPUSupport(): Promise<boolean> {
  if (!navigator.gpu) {
    return false;
  }
  
  try {
    const adapter = await navigator.gpu.requestAdapter();
    return adapter !== null;
  } catch {
    return false;
  }
}
