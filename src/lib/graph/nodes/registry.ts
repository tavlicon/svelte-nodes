/**
 * Node type registry - defines all available node types
 */

import type { NodeDefinition } from '../types';

// Default node size constant
export const NODE_SIZE = 200;

// Parameter metadata for rich UI rendering
export interface ParameterMeta {
  type: 'number' | 'string' | 'boolean' | 'select' | 'slider' | 'textarea';
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string | number; label: string }>;
  placeholder?: string;
  group?: 'prompts' | 'sampler' | 'model' | 'output';
}

export interface ExtendedNodeDefinition extends NodeDefinition {
  parameterMeta?: Record<string, ParameterMeta>;
}

export const nodeRegistry: Record<string, ExtendedNodeDefinition> = {
  prompt: {
    type: 'prompt',
    name: 'Text Prompt',
    category: 'Input',
    inputs: [],
    outputs: [
      { id: 'text', name: 'Text', type: 'string' },
    ],
    defaultParams: {
      text: '',
    },
  },
  
  'sdxl-turbo': {
    type: 'sdxl-turbo',
    name: 'SDXL Turbo',
    category: 'Generate',
    inputs: [
      { id: 'prompt', name: 'Prompt', type: 'string' },
      { id: 'negative_prompt', name: 'Negative', type: 'string' },
    ],
    outputs: [
      { id: 'image', name: 'Image', type: 'image' },
    ],
    defaultParams: {
      steps: 4,
      guidance_scale: 0.0,
      width: 512,
      height: 512,
      seed: -1,
    },
  },
  
  'image-display': {
    type: 'image-display',
    name: 'Image Display',
    category: 'Output',
    inputs: [
      { id: 'image', name: 'Image', type: 'image' },
    ],
    outputs: [],
    defaultParams: {
      scale: 1.0,
    },
  },
  
  'image': {
    type: 'image',
    name: 'Image',
    category: 'Input',
    inputs: [],
    outputs: [
      { id: 'image', name: 'Image', type: 'image' },
    ],
    defaultParams: {
      imageUrl: '',
      originalWidth: 0,
      originalHeight: 0,
    },
  },
  
  'output': {
    type: 'output',
    name: 'Output',
    category: 'Output',
    inputs: [
      { id: 'image', name: 'Image', type: 'image' },
    ],
    outputs: [
      { id: 'image', name: 'Image', type: 'image' }, // Allow chaining to another model
    ],
    defaultParams: {
      imageUrl: '',
      outputPath: '',
      timeTaken: 0,
      generationParams: null, // Stores: { prompt, negativePrompt, steps, cfg, denoise, seed, sampler, scheduler, modelName }
    },
    parameterMeta: {
      outputPath: {
        type: 'string',
        label: 'Output Path',
        group: 'output',
      },
      timeTaken: {
        type: 'number',
        label: 'Time (ms)',
        group: 'output',
      },
      generationParams: {
        type: 'string',
        label: 'Generation Params',
        group: 'output',
      },
    },
  },
  
  'model': {
    type: 'model',
    name: 'SD 1.5 img2img',
    category: 'Model',
    inputs: [
      { id: 'image', name: 'Image', type: 'image' },
    ],
    outputs: [
      { id: 'image', name: 'Image', type: 'image' },
    ],
    defaultParams: {
      // Model info
      modelPath: '',
      modelName: '',
      // Prompts (displayed at top)
      positive_prompt: 'a beautiful, photograph',
      negative_prompt: 'blurry',
      // KSampler parameters
      seed: 42,
      control_after_generate: 'fixed',
      steps: 3,
      cfg: 2.0,
      sampler_name: 'lcm',
      scheduler: 'normal',
      denoise: 0.75,
    },
    parameterMeta: {
      // Prompts group
      positive_prompt: {
        type: 'textarea',
        label: 'Positive Prompt',
        placeholder: 'Describe what you want to see...',
        group: 'prompts',
      },
      negative_prompt: {
        type: 'textarea',
        label: 'Negative Prompt',
        placeholder: 'Describe what to avoid...',
        group: 'prompts',
      },
      // Sampler group
      seed: {
        type: 'number',
        label: 'Seed',
        min: -1,
        max: 2147483647,
        step: 1,
        group: 'sampler',
      },
      control_after_generate: {
        type: 'select',
        label: 'Control After Generate',
        options: [
          { value: 'fixed', label: 'Fixed' },
          { value: 'increment', label: 'Increment' },
          { value: 'decrement', label: 'Decrement' },
          { value: 'randomize', label: 'Randomize' },
        ],
        group: 'sampler',
      },
      steps: {
        type: 'slider',
        label: 'Steps',
        min: 1,
        max: 50,
        step: 1,
        group: 'sampler',
      },
      cfg: {
        type: 'slider',
        label: 'CFG Scale',
        min: 0,
        max: 20,
        step: 0.1,
        group: 'sampler',
      },
      sampler_name: {
        type: 'select',
        label: 'Sampler',
        options: [
          { value: 'lcm', label: 'LCM' },
          { value: 'euler', label: 'Euler' },
          { value: 'euler_a', label: 'Euler Ancestral' },
          { value: 'dpmpp_2m', label: 'DPM++ 2M' },
          { value: 'dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
          { value: 'dpmpp_sde', label: 'DPM++ SDE' },
          { value: 'ddim', label: 'DDIM' },
          { value: 'uni_pc', label: 'UniPC' },
        ],
        group: 'sampler',
      },
      scheduler: {
        type: 'select',
        label: 'Scheduler',
        options: [
          { value: 'normal', label: 'Normal' },
          { value: 'karras', label: 'Karras' },
          { value: 'exponential', label: 'Exponential' },
          { value: 'sgm_uniform', label: 'SGM Uniform' },
          { value: 'simple', label: 'Simple' },
        ],
        group: 'sampler',
      },
      denoise: {
        type: 'slider',
        label: 'Denoise',
        min: 0,
        max: 1,
        step: 0.01,
        group: 'sampler',
      },
      // Hidden model params
      modelPath: { type: 'string', group: 'model' },
      modelName: { type: 'string', group: 'model' },
    },
  },
  
  'triposr': {
    type: 'triposr',
    name: 'TripoSR',
    category: 'Model',
    inputs: [
      { id: 'image', name: 'Image', type: 'image' },
    ],
    outputs: [
      { id: 'mesh', name: 'Mesh', type: 'mesh' },
    ],
    defaultParams: {
      // Model info
      modelPath: '',
      modelName: 'TripoSR Base',
      // Generation parameters
      foreground_ratio: 0.85,
      mc_resolution: 256,
      remove_background: true,
    },
    parameterMeta: {
      // Mesh generation parameters
      foreground_ratio: {
        type: 'slider',
        label: 'Foreground Ratio',
        min: 0.5,
        max: 1.0,
        step: 0.05,
        group: 'sampler',
      },
      mc_resolution: {
        type: 'select',
        label: 'Mesh Resolution',
        options: [
          { value: 128, label: '128 (Fast)' },
          { value: 256, label: '256 (Balanced)' },
          { value: 512, label: '512 (High Quality)' },
        ],
        group: 'sampler',
      },
      remove_background: {
        type: 'boolean',
        label: 'Auto Remove Background',
        group: 'sampler',
      },
      // Hidden model params
      modelPath: { type: 'string', group: 'model' },
      modelName: { type: 'string', group: 'model' },
    },
  },
  
  'mesh-output': {
    type: 'mesh-output',
    name: '3D Output',
    category: 'Output',
    inputs: [
      { id: 'mesh', name: 'Mesh', type: 'mesh' },
    ],
    outputs: [
      { id: 'mesh', name: 'Mesh', type: 'mesh' }, // Allow chaining
    ],
    defaultParams: {
      meshUrl: '',
      previewUrl: '',
      outputPath: '',
      timeTaken: 0,
      vertices: 0,
      faces: 0,
      generationParams: null,
    },
    parameterMeta: {
      outputPath: {
        type: 'string',
        label: 'Output Path',
        group: 'output',
      },
      timeTaken: {
        type: 'number',
        label: 'Time (ms)',
        group: 'output',
      },
      vertices: {
        type: 'number',
        label: 'Vertices',
        group: 'output',
      },
      faces: {
        type: 'number',
        label: 'Faces',
        group: 'output',
      },
    },
  },
};

export function getNodeDefinition(type: string): NodeDefinition | undefined {
  return nodeRegistry[type];
}

export function getNodeColor(type: string): [number, number, number, number] {
  const colors: Record<string, [number, number, number, number]> = {
    prompt: [0.4, 0.8, 0.6, 1.0],      // Green - Input
    'sdxl-turbo': [0.6, 0.4, 0.9, 1.0], // Purple - Generate
    'image-display': [0.9, 0.6, 0.3, 1.0], // Orange - Output
    'image': [0.3, 0.7, 0.9, 1.0],     // Blue - Image Input
    'model': [0.9, 0.4, 0.6, 1.0],     // Pink - Model
    'output': [0.2, 0.8, 0.4, 1.0],    // Green - Output result
    'triposr': [0.4, 0.7, 0.9, 1.0],   // Cyan - 3D Model
    'mesh-output': [0.3, 0.9, 0.7, 1.0], // Teal - 3D Output result
  };
  
  return colors[type] ?? [0.5, 0.5, 0.5, 1.0];
}
