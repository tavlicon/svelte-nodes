/**
 * Yjs IndexedDB Adapter
 * Syncs Yjs document state to IndexedDB for persistence
 */

import * as Y from 'yjs';
import { saveSnapshot, loadLatestSnapshot } from './db';

export class YjsIndexedDBAdapter {
  private doc: Y.Doc;
  private projectId: string;
  private saveDebounceTimer: number | null = null;
  private saveDebounceMs = 1000;
  private unsubscribe: (() => void) | null = null;
  
  constructor(doc: Y.Doc, projectId: string) {
    this.doc = doc;
    this.projectId = projectId;
  }
  
  /**
   * Start syncing the document to IndexedDB
   */
  async start(): Promise<void> {
    // Load existing state
    const update = await loadLatestSnapshot(this.projectId);
    if (update) {
      Y.applyUpdate(this.doc, update);
      console.log('Loaded graph state from IndexedDB');
    }
    
    // Subscribe to updates
    const updateHandler = () => {
      this.scheduleSave();
    };
    
    this.doc.on('update', updateHandler);
    this.unsubscribe = () => {
      this.doc.off('update', updateHandler);
    };
  }
  
  /**
   * Stop syncing
   */
  stop(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
  
  /**
   * Schedule a save (debounced)
   */
  private scheduleSave(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    this.saveDebounceTimer = window.setTimeout(() => {
      this.save();
    }, this.saveDebounceMs);
  }
  
  /**
   * Immediately save the current state
   */
  async save(): Promise<void> {
    try {
      await saveSnapshot(this.projectId, this.doc);
      console.log('Saved graph state to IndexedDB');
    } catch (error) {
      console.error('Failed to save graph state:', error);
    }
  }
  
  /**
   * Force an immediate save
   */
  async forceSave(): Promise<void> {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
      this.saveDebounceTimer = null;
    }
    await this.save();
  }
}
