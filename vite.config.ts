import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { fileApiPlugin } from './server/file-api';

export default defineConfig({
  plugins: [svelte(), fileApiPlugin()],
  
  // Enable top-level await for ONNX Runtime
  esbuild: {
    target: 'esnext',
  },
  
  build: {
    target: 'esnext',
  },
  
  optimizeDeps: {
    exclude: ['onnxruntime-web'],
  },
  
  worker: {
    format: 'es',
  },
  
  server: {
    headers: {
      // Required for SharedArrayBuffer (used by ONNX Runtime)
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  
  // Handle .wgsl shader files
  assetsInclude: ['**/*.wgsl'],
});
