/**
 * IndexedDB persistence layer
 * Stores graph snapshots and generated images
 */

import { openDB, type IDBPDatabase } from 'idb';
import * as Y from 'yjs';

const DB_NAME = 'generative-studio';
const DB_VERSION = 1;

interface ProjectMeta {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  thumbnailUrl?: string;
}

interface GraphSnapshot {
  id: string;
  projectId: string;
  timestamp: Date;
  stateVector: Uint8Array;
  update: Uint8Array;
}

interface GeneratedAsset {
  id: string;
  projectId: string;
  nodeId: string;
  createdAt: Date;
  blob: Blob;
  metadata: {
    prompt?: string;
    width: number;
    height: number;
    params: Record<string, unknown>;
  };
}

interface StudioDB {
  projects: ProjectMeta;
  snapshots: GraphSnapshot;
  assets: GeneratedAsset;
  settings: { key: string; value: unknown };
}

let db: IDBPDatabase<StudioDB> | null = null;

async function getDB(): Promise<IDBPDatabase<StudioDB>> {
  if (db) return db;
  
  db = await openDB<StudioDB>(DB_NAME, DB_VERSION, {
    upgrade(database) {
      // Projects store
      if (!database.objectStoreNames.contains('projects')) {
        const projectStore = database.createObjectStore('projects', { keyPath: 'id' });
        projectStore.createIndex('updatedAt', 'updatedAt');
      }
      
      // Snapshots store
      if (!database.objectStoreNames.contains('snapshots')) {
        const snapshotStore = database.createObjectStore('snapshots', { keyPath: 'id' });
        snapshotStore.createIndex('projectId', 'projectId');
        snapshotStore.createIndex('timestamp', 'timestamp');
      }
      
      // Assets store
      if (!database.objectStoreNames.contains('assets')) {
        const assetStore = database.createObjectStore('assets', { keyPath: 'id' });
        assetStore.createIndex('projectId', 'projectId');
        assetStore.createIndex('nodeId', 'nodeId');
        assetStore.createIndex('createdAt', 'createdAt');
      }
      
      // Settings store
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
    },
  });
  
  return db;
}

// Project operations
export async function createProject(name: string): Promise<ProjectMeta> {
  const database = await getDB();
  
  const project: ProjectMeta = {
    id: crypto.randomUUID(),
    name,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  await database.put('projects', project);
  return project;
}

export async function getProject(id: string): Promise<ProjectMeta | undefined> {
  const database = await getDB();
  return database.get('projects', id);
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const database = await getDB();
  return database.getAllFromIndex('projects', 'updatedAt');
}

export async function updateProject(id: string, updates: Partial<ProjectMeta>): Promise<void> {
  const database = await getDB();
  const project = await database.get('projects', id);
  if (!project) throw new Error(`Project ${id} not found`);
  
  await database.put('projects', {
    ...project,
    ...updates,
    updatedAt: new Date(),
  });
}

export async function deleteProject(id: string): Promise<void> {
  const database = await getDB();
  
  // Delete all snapshots for this project
  const snapshots = await database.getAllFromIndex('snapshots', 'projectId', id);
  for (const snapshot of snapshots) {
    await database.delete('snapshots', snapshot.id);
  }
  
  // Delete all assets for this project
  const assets = await database.getAllFromIndex('assets', 'projectId', id);
  for (const asset of assets) {
    await database.delete('assets', asset.id);
  }
  
  // Delete the project
  await database.delete('projects', id);
}

// Snapshot operations
export async function saveSnapshot(
  projectId: string,
  ydoc: Y.Doc
): Promise<GraphSnapshot> {
  const database = await getDB();
  
  const snapshot: GraphSnapshot = {
    id: crypto.randomUUID(),
    projectId,
    timestamp: new Date(),
    stateVector: Y.encodeStateVector(ydoc),
    update: Y.encodeStateAsUpdate(ydoc),
  };
  
  await database.put('snapshots', snapshot);
  
  // Update project timestamp
  await updateProject(projectId, {});
  
  return snapshot;
}

export async function loadLatestSnapshot(projectId: string): Promise<Uint8Array | null> {
  const database = await getDB();
  const snapshots = await database.getAllFromIndex('snapshots', 'projectId', projectId);
  
  if (snapshots.length === 0) return null;
  
  // Get the most recent snapshot
  snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return snapshots[0].update;
}

export async function loadSnapshot(snapshotId: string): Promise<Uint8Array | null> {
  const database = await getDB();
  const snapshot = await database.get('snapshots', snapshotId);
  return snapshot?.update ?? null;
}

export async function listSnapshots(projectId: string): Promise<GraphSnapshot[]> {
  const database = await getDB();
  const snapshots = await database.getAllFromIndex('snapshots', 'projectId', projectId);
  snapshots.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return snapshots;
}

// Asset operations
export async function saveAsset(
  projectId: string,
  nodeId: string,
  blob: Blob,
  metadata: GeneratedAsset['metadata']
): Promise<GeneratedAsset> {
  const database = await getDB();
  
  const asset: GeneratedAsset = {
    id: crypto.randomUUID(),
    projectId,
    nodeId,
    createdAt: new Date(),
    blob,
    metadata,
  };
  
  await database.put('assets', asset);
  return asset;
}

export async function getAsset(id: string): Promise<GeneratedAsset | undefined> {
  const database = await getDB();
  return database.get('assets', id);
}

export async function getAssetsByNode(nodeId: string): Promise<GeneratedAsset[]> {
  const database = await getDB();
  return database.getAllFromIndex('assets', 'nodeId', nodeId);
}

export async function deleteAsset(id: string): Promise<void> {
  const database = await getDB();
  await database.delete('assets', id);
}

// Settings operations
export async function setSetting(key: string, value: unknown): Promise<void> {
  const database = await getDB();
  await database.put('settings', { key, value });
}

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const database = await getDB();
  const result = await database.get('settings', key);
  return result?.value as T | undefined;
}

// Cleanup
export async function closeDB(): Promise<void> {
  if (db) {
    db.close();
    db = null;
  }
}
