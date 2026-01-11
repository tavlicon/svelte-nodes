/**
 * Vitest Global Setup
 * 
 * This file runs before each test file to set up the test environment.
 * It mocks browser APIs that aren't available in Node.js/happy-dom.
 */

import { vi } from 'vitest';

// =============================================================================
// Browser API Mocks
// =============================================================================

/**
 * Mock ResizeObserver - not available in happy-dom
 * Used by canvas components for responsive sizing
 */
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

/**
 * Mock IntersectionObserver - not available in happy-dom
 * Used for lazy loading and visibility detection
 */
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
  root: null,
  rootMargin: '',
  thresholds: [],
}));

/**
 * Mock matchMedia - partial implementation in happy-dom
 * Used for theme detection and responsive queries
 */
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// =============================================================================
// Performance API Mocks
// =============================================================================

/**
 * Ensure performance.mark and performance.measure exist
 * Used for timing measurements in execution engine
 */
if (typeof performance.mark !== 'function') {
  performance.mark = vi.fn().mockReturnValue(undefined);
}

if (typeof performance.measure !== 'function') {
  performance.measure = vi.fn().mockReturnValue(undefined);
}

// =============================================================================
// Crypto API Mocks
// =============================================================================

/**
 * Mock crypto.randomUUID if not available
 * Used for generating unique IDs for nodes and edges
 */
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, 'crypto', {
    value: {
      randomUUID: () => {
        // Simple UUID v4 mock
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === 'x' ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      },
      getRandomValues: (arr: Uint8Array) => {
        for (let i = 0; i < arr.length; i++) {
          arr[i] = Math.floor(Math.random() * 256);
        }
        return arr;
      },
    },
    writable: true,
  });
}

// =============================================================================
// Canvas/WebGPU Mocks
// =============================================================================

/**
 * Mock HTMLCanvasElement.getContext
 * Returns a minimal 2D context mock for tests that touch canvas code
 */
HTMLCanvasElement.prototype.getContext = vi.fn().mockImplementation((contextId: string) => {
  if (contextId === '2d') {
    return {
      fillRect: vi.fn(),
      clearRect: vi.fn(),
      getImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
      putImageData: vi.fn(),
      createImageData: vi.fn().mockReturnValue({ data: new Uint8ClampedArray(4) }),
      setTransform: vi.fn(),
      drawImage: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      bezierCurveTo: vi.fn(),
      stroke: vi.fn(),
      fill: vi.fn(),
      arc: vi.fn(),
      closePath: vi.fn(),
      scale: vi.fn(),
      translate: vi.fn(),
      rotate: vi.fn(),
      fillText: vi.fn(),
      measureText: vi.fn().mockReturnValue({ width: 0 }),
      canvas: { width: 800, height: 600 },
    };
  }
  if (contextId === 'webgpu') {
    // WebGPU not available in test environment
    return null;
  }
  return null;
});

/**
 * Mock createImageBitmap
 * Used for validating image data in api-client.ts
 */
global.createImageBitmap = vi.fn().mockImplementation(() => 
  Promise.resolve({
    width: 512,
    height: 512,
    close: vi.fn(),
  })
);

// =============================================================================
// Fetch Mock Setup (Optional - can be overridden per test)
// =============================================================================

/**
 * Default fetch mock - returns 404 for unmocked requests
 * Individual tests should mock specific endpoints as needed
 */
const originalFetch = global.fetch;
global.fetch = vi.fn().mockImplementation((url: string) => {
  console.warn(`[Test Warning] Unmocked fetch to: ${url}`);
  return Promise.resolve({
    ok: false,
    status: 404,
    statusText: 'Not Found',
    json: () => Promise.resolve({ error: 'Not mocked' }),
    text: () => Promise.resolve('Not mocked'),
    blob: () => Promise.resolve(new Blob()),
  });
});

// Expose original fetch for tests that need real network (integration tests)
(global as any).__originalFetch = originalFetch;

// =============================================================================
// Console Configuration
// =============================================================================

/**
 * Suppress expected console output during tests
 * Comment out specific lines if you need to debug
 */
// vi.spyOn(console, 'log').mockImplementation(() => {});
// vi.spyOn(console, 'warn').mockImplementation(() => {});
// vi.spyOn(console, 'error').mockImplementation(() => {});

// =============================================================================
// Cleanup
// =============================================================================

/**
 * Reset mocks between tests
 * This ensures test isolation
 */
beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * Clean up after all tests
 */
afterAll(() => {
  vi.restoreAllMocks();
});
