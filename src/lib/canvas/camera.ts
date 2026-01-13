/**
 * Camera system for the infinite canvas
 * Handles pan, zoom, and coordinate transformations
 */

import { MIN_ZOOM, MAX_ZOOM } from './node-style';

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

export class Camera {
  private _x = 0;
  private _y = 0;
  private _zoom = 1;
  
  // Limits (from centralized node-style.ts)
  private minZoom = MIN_ZOOM;
  private maxZoom = MAX_ZOOM;
  
  // Viewport dimensions
  private viewportWidth = 0;
  private viewportHeight = 0;
  
  get x(): number { return this._x; }
  get y(): number { return this._y; }
  get zoom(): number { return this._zoom; }
  
  get state(): CameraState {
    return { x: this._x, y: this._y, zoom: this._zoom };
  }
  
  setViewport(width: number, height: number) {
    this.viewportWidth = width;
    this.viewportHeight = height;
  }
  
  pan(dx: number, dy: number) {
    this._x += dx / this._zoom;
    this._y += dy / this._zoom;
  }
  
  zoomAt(factor: number, screenX: number, screenY: number) {
    const newZoom = Math.max(this.minZoom, Math.min(this.maxZoom, this._zoom * factor));
    
    if (newZoom === this._zoom) return;
    
    // Calculate world position under cursor before zoom
    const worldX = this.screenToWorldX(screenX);
    const worldY = this.screenToWorldY(screenY);
    
    // Apply new zoom
    const oldZoom = this._zoom;
    this._zoom = newZoom;
    
    // Adjust position to keep world point under cursor
    const newWorldX = this.screenToWorldX(screenX);
    const newWorldY = this.screenToWorldY(screenY);
    
    this._x += newWorldX - worldX;
    this._y += newWorldY - worldY;
  }
  
  setZoom(zoom: number) {
    this._zoom = Math.max(this.minZoom, Math.min(this.maxZoom, zoom));
  }
  
  setPosition(x: number, y: number) {
    this._x = x;
    this._y = y;
  }
  
  reset() {
    this._x = 0;
    this._y = 0;
    this._zoom = 1;
  }
  
  // Coordinate transformations
  screenToWorldX(screenX: number): number {
    return (screenX - this.viewportWidth / 2) / this._zoom - this._x;
  }
  
  screenToWorldY(screenY: number): number {
    return (screenY - this.viewportHeight / 2) / this._zoom - this._y;
  }
  
  worldToScreenX(worldX: number): number {
    return (worldX + this._x) * this._zoom + this.viewportWidth / 2;
  }
  
  worldToScreenY(worldY: number): number {
    return (worldY + this._y) * this._zoom + this.viewportHeight / 2;
  }
  
  // Get the view-projection matrix for WebGPU
  getViewProjectionMatrix(): Float32Array {
    const dpr = window.devicePixelRatio;
    const w = this.viewportWidth * dpr;
    const h = this.viewportHeight * dpr;
    
    const scaleX = (2 * this._zoom) / w;
    const scaleY = (2 * this._zoom) / h;
    const translateX = this._x * scaleX;
    const translateY = this._y * scaleY;
    
    // Column-major 4x4 matrix
    return new Float32Array([
      scaleX, 0, 0, 0,
      0, -scaleY, 0, 0,
      0, 0, 1, 0,
      translateX, -translateY, 0, 1,
    ]);
  }
  
  // Fit a bounding box in view
  fitBounds(minX: number, minY: number, maxX: number, maxY: number, padding = 50) {
    const boundsWidth = maxX - minX + padding * 2;
    const boundsHeight = maxY - minY + padding * 2;
    
    const zoomX = this.viewportWidth / boundsWidth;
    const zoomY = this.viewportHeight / boundsHeight;
    
    this._zoom = Math.min(zoomX, zoomY, this.maxZoom);
    this._x = -(minX + (maxX - minX) / 2);
    this._y = -(minY + (maxY - minY) / 2);
  }
}
