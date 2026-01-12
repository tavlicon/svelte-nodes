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

export interface TripoSRRequest {
  inputImage: string; // URL or base64 of input image
  foregroundRatio?: number; // 0.5-1.0: Object size in frame (default: 0.85)
  mcResolution?: number; // 64-512: Marching cubes grid resolution (default: 256)
  removeBackground?: boolean; // Whether to auto-remove background (default: true)
  chunkSize?: number; // 1024-16384: Evaluation chunk size for VRAM/speed tradeoff (default: 8192)
  bakeTexture?: boolean; // Whether to bake UV texture instead of vertex colors (default: false)
  textureResolution?: number; // 512-4096: Texture atlas size if baking (default: 2048)
  renderVideo?: boolean; // Whether to generate turntable MP4 preview (default: false)
  renderNViews?: number; // 15-60: Number of frames for video (default: 30 = 1 second)
  renderResolution?: number; // 128-512: Resolution for video frames (default: 256)
}

export interface InferenceResult {
  imageData: ImageData | null;
  imageUrl: string | null;
  timeTaken: number;
  outputPath?: string; // File path where image was saved
  width?: number; // Generated image width
  height?: number; // Generated image height
}

export interface TripoSRResult {
  meshPath: string; // URL to the GLB file
  videoUrl: string | null; // URL to turntable MP4 video preview
  previewUrl: string | null; // URL to static preview image
  outputPath: string; // Full file path
  timeTaken: number;
  meshTime: number; // Time for mesh generation only
  videoTime: number | null; // Time for video rendering (if enabled)
  vertices: number;
  faces: number;
}

export interface InferenceProgress {
  step: number;
  totalSteps: number;
  latentPreview?: string;
  status?: string;
}

export type ProgressCallback = (progress: InferenceProgress) => void;
