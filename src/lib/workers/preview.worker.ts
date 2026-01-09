/**
 * Preview Worker
 * Generates thumbnails using OffscreenCanvas
 */

interface ThumbnailRequest {
  id: string;
  imageData: ImageData;
  maxSize: number;
}

interface ThumbnailResult {
  id: string;
  thumbnailUrl: string;
  width: number;
  height: number;
}

function generateThumbnail(request: ThumbnailRequest): ThumbnailResult {
  const { id, imageData, maxSize } = request;
  
  // Calculate thumbnail dimensions
  const scale = Math.min(maxSize / imageData.width, maxSize / imageData.height, 1);
  const width = Math.round(imageData.width * scale);
  const height = Math.round(imageData.height * scale);
  
  // Create offscreen canvas
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  
  if (!ctx) {
    throw new Error('Failed to get 2D context');
  }
  
  // Create temporary canvas for source image
  const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
  const srcCtx = srcCanvas.getContext('2d');
  
  if (!srcCtx) {
    throw new Error('Failed to get source 2D context');
  }
  
  srcCtx.putImageData(imageData, 0, 0);
  
  // Draw scaled image
  ctx.drawImage(srcCanvas, 0, 0, width, height);
  
  // Convert to blob
  const blob = canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
  
  // Return result (will be converted to URL on main thread)
  return {
    id,
    thumbnailUrl: '', // Will be set after blob conversion
    width,
    height,
  };
}

async function processThumbnailRequest(request: ThumbnailRequest): Promise<void> {
  try {
    const { id, imageData, maxSize } = request;
    
    // Calculate thumbnail dimensions
    const scale = Math.min(maxSize / imageData.width, maxSize / imageData.height, 1);
    const width = Math.round(imageData.width * scale);
    const height = Math.round(imageData.height * scale);
    
    // Create offscreen canvas
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    
    if (!ctx) {
      throw new Error('Failed to get 2D context');
    }
    
    // Create temporary canvas for source image
    const srcCanvas = new OffscreenCanvas(imageData.width, imageData.height);
    const srcCtx = srcCanvas.getContext('2d');
    
    if (!srcCtx) {
      throw new Error('Failed to get source 2D context');
    }
    
    srcCtx.putImageData(imageData, 0, 0);
    
    // Draw scaled image with smoothing
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, 0, 0, width, height);
    
    // Convert to blob
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
    const url = URL.createObjectURL(blob);
    
    self.postMessage({
      type: 'thumbnail-complete',
      payload: { id, thumbnailUrl: url, width, height },
    });
  } catch (error) {
    self.postMessage({
      type: 'thumbnail-error',
      payload: {
        id: request.id,
        error: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

// Message handler
self.onmessage = (e: MessageEvent) => {
  const { type, payload } = e.data;
  
  switch (type) {
    case 'generate-thumbnail':
      processThumbnailRequest(payload);
      break;
  }
};
