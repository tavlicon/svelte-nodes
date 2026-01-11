/**
 * File service for interacting with the data directory API
 */

export interface ModelMetadata {
  title?: string;
  hash?: string;
  date?: string;
  author?: string;
  description?: string;
  architecture?: string;
  resolution?: string;
  license?: string;
}

export interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified: string;
  type: string;
  metadata?: ModelMetadata; // Safetensors metadata for model files
}

export type Directory = 'input' | 'output' | 'models' | 'canvases';

/**
 * List all files in a directory
 */
export async function listFiles(directory: Directory): Promise<FileInfo[]> {
  try {
    const response = await fetch(`/api/files?dir=${directory}`);
    if (!response.ok) {
      throw new Error(`Failed to list files: ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error(`Error listing files in ${directory}:`, error);
    return [];
  }
}

/**
 * Upload a file to a directory
 */
export async function uploadFile(
  directory: Directory,
  file: File | Blob,
  filename?: string
): Promise<FileInfo | null> {
  try {
    const name = filename || (file instanceof File ? file.name : `upload-${Date.now()}.png`);
    const response = await fetch(`/api/files?dir=${directory}&name=${encodeURIComponent(name)}`, {
      method: 'POST',
      body: file,
    });
    
    if (!response.ok) {
      throw new Error(`Failed to upload file: ${response.statusText}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error(`Error uploading file to ${directory}:`, error);
    return null;
  }
}

/**
 * Upload a file from a data URL
 */
export async function uploadDataUrl(
  directory: Directory,
  dataUrl: string,
  filename: string
): Promise<FileInfo | null> {
  try {
    // Convert data URL to blob
    const response = await fetch(dataUrl);
    const blob = await response.blob();
    return await uploadFile(directory, blob, filename);
  } catch (error) {
    console.error(`Error uploading data URL to ${directory}:`, error);
    return null;
  }
}

/**
 * Delete a file from a directory
 */
export async function deleteFile(directory: Directory, filename: string): Promise<boolean> {
  try {
    const response = await fetch(
      `/api/files?dir=${directory}&name=${encodeURIComponent(filename)}`,
      { method: 'DELETE' }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to delete file: ${response.statusText}`);
    }
    
    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error(`Error deleting file from ${directory}:`, error);
    return false;
  }
}

/**
 * Get the full URL for a file
 */
export function getFileUrl(fileInfo: FileInfo): string {
  return fileInfo.path;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
