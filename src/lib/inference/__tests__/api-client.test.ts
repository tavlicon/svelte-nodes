/**
 * Tests for the backend API client
 * 
 * Tests image loading, backend status checking, and error handling.
 * All fetch calls are mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { imageUrlToBlob, checkBackendStatus } from '../api-client';

// Get the mocked fetch from setup.ts
const mockFetch = vi.mocked(global.fetch);

describe('imageUrlToBlob', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.mocked(global.createImageBitmap).mockReset();
  });

  describe('input validation', () => {
    it('throws error for empty URL', async () => {
      await expect(imageUrlToBlob('')).rejects.toThrow('No input image provided');
    });

    it('throws error for whitespace-only URL', async () => {
      await expect(imageUrlToBlob('   ')).rejects.toThrow('No input image provided');
    });
  });

  describe('base64 data URLs', () => {
    it('converts base64 data URL to blob', async () => {
      const dataUrl = 'data:image/png;base64,iVBORw0KGgo=';
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      } as Response);
      
      vi.mocked(global.createImageBitmap).mockResolvedValueOnce({
        width: 100,
        height: 100,
        close: vi.fn(),
      } as unknown as ImageBitmap);
      
      const blob = await imageUrlToBlob(dataUrl);
      
      expect(blob).toBeInstanceOf(Blob);
      expect(blob.size).toBeGreaterThan(0);
    });

    it('throws error for invalid base64 data', async () => {
      const dataUrl = 'data:image/png;base64,invalid';
      
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
      } as Response);
      
      await expect(imageUrlToBlob(dataUrl)).rejects.toThrow('Failed to parse base64');
    });
  });

  describe('URL fetching', () => {
    it('handles relative URLs by prepending origin', async () => {
      // Mock window.location
      const originalWindow = global.window;
      (global as any).window = {
        location: { origin: 'http://localhost:5173' },
      };
      
      const mockBlob = new Blob(['test'], { type: 'image/png' });
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/png']]) as unknown as Headers,
        blob: () => Promise.resolve(mockBlob),
      } as unknown as Response);
      
      vi.mocked(global.createImageBitmap).mockResolvedValueOnce({
        width: 100,
        height: 100,
        close: vi.fn(),
      } as unknown as ImageBitmap);
      
      await imageUrlToBlob('/data/input/test.png');
      
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:5173/data/input/test.png');
      
      // Restore
      global.window = originalWindow;
    });

    it('throws descriptive error for 404', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      } as Response);
      
      await expect(imageUrlToBlob('http://example.com/missing.png'))
        .rejects.toThrow('Failed to load image from URL (404)');
    });

    it('throws descriptive error for 500', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      } as Response);
      
      await expect(imageUrlToBlob('http://example.com/error.png'))
        .rejects.toThrow('Failed to load image from URL (500)');
    });
  });

  describe('content type validation', () => {
    it('detects HTML error pages returned instead of images', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'text/html']]) as unknown as Headers,
        text: () => Promise.resolve('<!DOCTYPE html><html><body>Error</body></html>'),
      } as unknown as Response);
      
      await expect(imageUrlToBlob('http://example.com/bad-url'))
        .rejects.toThrow('URL returned HTML instead of image');
    });

    it('throws error for non-image content types', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'application/json']]) as unknown as Headers,
        text: () => Promise.resolve('{"error": "not found"}'),
      } as unknown as Response);
      
      await expect(imageUrlToBlob('http://example.com/api'))
        .rejects.toThrow('non-image content type');
    });
  });

  describe('image validation', () => {
    it('validates image can be decoded', async () => {
      const mockBlob = new Blob(['not-really-an-image'], { type: 'image/png' });
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/png']]) as unknown as Headers,
        blob: () => Promise.resolve(mockBlob),
      } as unknown as Response);
      
      vi.mocked(global.createImageBitmap).mockRejectedValueOnce(
        new Error('Invalid image format')
      );
      
      await expect(imageUrlToBlob('http://example.com/corrupt.png'))
        .rejects.toThrow('Invalid image data');
    });

    it('throws error for empty image files', async () => {
      const emptyBlob = new Blob([], { type: 'image/png' });
      
      mockFetch.mockResolvedValueOnce({
        ok: true,
        headers: new Map([['content-type', 'image/png']]) as unknown as Headers,
        blob: () => Promise.resolve(emptyBlob),
      } as unknown as Response);
      
      await expect(imageUrlToBlob('http://example.com/empty.png'))
        .rejects.toThrow('Image file is empty');
    });
  });
});

describe('checkBackendStatus', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // The api-client has debug logging that makes additional fetch calls
    // Mock to return a valid response by default for all calls
    mockFetch.mockImplementation((url: string) => {
      // Debug logging endpoint - just return success
      if (url.includes('127.0.0.1:7242')) {
        return Promise.resolve({ ok: true } as Response);
      }
      // Default fallback
      return Promise.resolve({
        ok: false,
        status: 404,
      } as Response);
    });
  });

  it('returns status when backend is available', async () => {
    mockFetch.mockImplementation((url: string) => {
      // Debug logging endpoint
      if (url.includes('127.0.0.1:7242')) {
        return Promise.resolve({ ok: true } as Response);
      }
      // Main API call
      if (url.includes('localhost:8000')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            loaded: true,
            device: 'mps',
            model_name: 'sd-1.5',
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    
    const status = await checkBackendStatus();
    
    expect(status).not.toBeNull();
    expect(status?.modelLoaded).toBe(true);
    expect(status?.device).toBe('mps');
    expect(status?.modelName).toBe('sd-1.5');
  });

  it('returns status when model not loaded', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('127.0.0.1:7242')) {
        return Promise.resolve({ ok: true } as Response);
      }
      if (url.includes('localhost:8000')) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            loaded: false,
            device: 'cpu',
            model_name: '',
          }),
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    
    const status = await checkBackendStatus();
    
    expect(status).not.toBeNull();
    expect(status?.modelLoaded).toBe(false);
  });

  it('returns null when backend is unavailable', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('127.0.0.1:7242')) {
        return Promise.resolve({ ok: true } as Response);
      }
      // Main API call fails
      return Promise.reject(new Error('ECONNREFUSED'));
    });
    
    const status = await checkBackendStatus();
    
    expect(status).toBeNull();
  });

  it('returns null for non-ok response', async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes('127.0.0.1:7242')) {
        return Promise.resolve({ ok: true } as Response);
      }
      if (url.includes('localhost:8000')) {
        return Promise.resolve({
          ok: false,
          status: 503,
        } as Response);
      }
      return Promise.resolve({ ok: false, status: 404 } as Response);
    });
    
    const status = await checkBackendStatus();
    
    expect(status).toBeNull();
  });
});
