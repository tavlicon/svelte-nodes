import App from './App.svelte';
import { mount } from 'svelte';

// Check for WebGPU support
async function checkWebGPU(): Promise<boolean> {
  if (!navigator.gpu) {
    return false;
  }
  
  try {
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      return false;
    }
    
    const device = await adapter.requestDevice();
    if (!device) {
      return false;
    }
    
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const hasWebGPU = await checkWebGPU();
  
  if (!hasWebGPU) {
    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = `
        <div style="
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100vh;
          color: #e0e0e0;
          text-align: center;
          padding: 2rem;
        ">
          <h1 style="font-size: 2rem; margin-bottom: 1rem; color: #ff6b6b;">WebGPU Not Available</h1>
          <p style="font-size: 1.1rem; max-width: 500px; line-height: 1.6;">
            This application requires WebGPU for GPU-accelerated rendering and inference.
            Please use a browser that supports WebGPU (Chrome 113+, Edge 113+, or Safari 18+).
          </p>
        </div>
      `;
    }
    return;
  }
  
  mount(App, {
    target: document.getElementById('app')!,
  });
}

main();
