/**
 * Service Worker for model weight caching
 * Caches ONNX model files for faster subsequent loads
 */

/// <reference lib="webworker" />

declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = 'generative-studio-v1';
const MODEL_CACHE_NAME = 'model-weights-v1';

// URLs to cache on install
const STATIC_ASSETS = [
  '/',
  '/index.html',
];

// Model file patterns to cache
const MODEL_PATTERNS = [
  /\/models\/.*\.onnx$/,
  /\/models\/.*\.json$/,
  /huggingface\.co.*\.onnx/,
  /huggingface\.co.*onnx.*\.json/,
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS);
    })
  );
  
  // Activate immediately
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then((cacheNames) => {
        return Promise.all(
          cacheNames
            .filter((name) => name !== CACHE_NAME && name !== MODEL_CACHE_NAME)
            .map((name) => caches.delete(name))
        );
      }),
      // Take control of all clients
      self.clients.claim(),
    ])
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  
  // Check if this is a model file request
  const isModelFile = MODEL_PATTERNS.some((pattern) => pattern.test(url.href));
  
  if (isModelFile) {
    event.respondWith(handleModelRequest(event.request));
    return;
  }
  
  // Standard cache-first strategy for static assets
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      
      return fetch(event.request).then((response) => {
        // Don't cache non-successful responses
        if (!response || response.status !== 200) {
          return response;
        }
        
        // Clone the response
        const responseToCache = response.clone();
        
        caches.open(CACHE_NAME).then((cache) => {
          cache.put(event.request, responseToCache);
        });
        
        return response;
      });
    })
  );
});

async function handleModelRequest(request: Request): Promise<Response> {
  const cache = await caches.open(MODEL_CACHE_NAME);
  
  // Check if we have a cached response
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    console.log('[SW] Model cache hit:', request.url);
    return cachedResponse;
  }
  
  console.log('[SW] Model cache miss, fetching:', request.url);
  
  try {
    // Fetch the model file
    const response = await fetch(request);
    
    if (!response || response.status !== 200) {
      return response;
    }
    
    // Clone and cache the response
    const responseToCache = response.clone();
    await cache.put(request, responseToCache);
    
    console.log('[SW] Cached model file:', request.url);
    
    return response;
  } catch (error) {
    console.error('[SW] Failed to fetch model:', error);
    throw error;
  }
}

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data.type === 'CLEAR_MODEL_CACHE') {
    caches.delete(MODEL_CACHE_NAME).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
  
  if (event.data.type === 'GET_CACHE_SIZE') {
    getCacheSize().then((size) => {
      event.ports[0].postMessage({ size });
    });
  }
});

async function getCacheSize(): Promise<number> {
  const cache = await caches.open(MODEL_CACHE_NAME);
  const keys = await cache.keys();
  
  let totalSize = 0;
  for (const request of keys) {
    const response = await cache.match(request);
    if (response) {
      const blob = await response.blob();
      totalSize += blob.size;
    }
  }
  
  return totalSize;
}
