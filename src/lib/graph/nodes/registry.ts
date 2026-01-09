/**
 * Node type registry - defines all available node types
 */

import type { NodeDefinition } from '../types';

// Default node size constant
export const NODE_SIZE = 200;

export const nodeRegistry: Record<string, NodeDefinition> = {
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
  
  'model': {
    type: 'model',
    name: 'Model',
    category: 'Model',
    inputs: [
      { id: 'prompt', name: 'Prompt', type: 'string' },
      { id: 'image', name: 'Image', type: 'image' },
    ],
    outputs: [
      { id: 'image', name: 'Image', type: 'image' },
    ],
    defaultParams: {
      modelPath: '',
      modelName: '',
      modelType: '',
      modelSize: 0,
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
  };
  
  return colors[type] ?? [0.5, 0.5, 0.5, 1.0];
}
