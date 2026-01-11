/**
 * Inference Types
 * Shared type definitions for the inference system
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
  width?: number; // Generated image width
  height?: number; // Generated image height
}

export interface InferenceProgress {
  step: number;
  totalSteps: number;
  latentPreview?: string;
  status?: string;
}

export type ProgressCallback = (progress: InferenceProgress) => void;
