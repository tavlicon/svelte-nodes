import { type Plugin } from 'vite';
import fs from 'fs/promises';
import path from 'path';

const DATA_DIR = path.resolve(process.cwd(), 'data');

interface FileInfo {
  name: string;
  path: string;
  size: number;
  modified: string;
  type: string;
}

async function ensureDir(dir: string): Promise<void> {
  try {
    await fs.access(dir);
  } catch {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function listFiles(directory: string): Promise<FileInfo[]> {
  const dir = path.join(DATA_DIR, directory);
  await ensureDir(dir);
  
  // Determine allowed file types based on directory
  let allowedExtensions: string[];
  switch (directory) {
    case 'canvases':
      allowedExtensions = ['.json'];
      break;
    case 'models':
      allowedExtensions = ['.safetensors', '.onnx', '.pt', '.pth', '.bin', '.ckpt'];
      break;
    default:
      allowedExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'];
  }
  
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files: FileInfo[] = [];
    
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith('.')) {
        const filePath = path.join(dir, entry.name);
        const stats = await fs.stat(filePath);
        const ext = path.extname(entry.name).toLowerCase();
        
        // Check file type based on directory
        if (allowedExtensions.includes(ext)) {
          files.push({
            name: entry.name,
            path: `/data/${directory}/${entry.name}`,
            size: stats.size,
            modified: stats.mtime.toISOString(),
            type: ext.slice(1),
          });
        }
      }
    }
    
    // Sort by modified date, newest first
    files.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
    return files;
  } catch (error) {
    console.error(`Error listing files in ${directory}:`, error);
    return [];
  }
}

async function saveFile(directory: string, filename: string, data: Buffer): Promise<FileInfo> {
  const dir = path.join(DATA_DIR, directory);
  await ensureDir(dir);
  
  // Sanitize filename
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(dir, safeName);
  
  await fs.writeFile(filePath, data);
  const stats = await fs.stat(filePath);
  const ext = path.extname(safeName).toLowerCase();
  
  return {
    name: safeName,
    path: `/data/${directory}/${safeName}`,
    size: stats.size,
    modified: stats.mtime.toISOString(),
    type: ext.slice(1),
  };
}

async function deleteFile(directory: string, filename: string): Promise<boolean> {
  const filePath = path.join(DATA_DIR, directory, filename);
  
  try {
    await fs.unlink(filePath);
    return true;
  } catch {
    return false;
  }
}

export function fileApiPlugin(): Plugin {
  return {
    name: 'file-api',
    configureServer(server) {
      // Serve static files from data directory
      server.middlewares.use('/data', async (req, res, next) => {
        if (req.method === 'GET' && req.url) {
          const filePath = path.join(DATA_DIR, decodeURIComponent(req.url));
          try {
            const data = await fs.readFile(filePath);
            const ext = path.extname(filePath).toLowerCase();
            const mimeTypes: Record<string, string> = {
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.gif': 'image/gif',
              '.webp': 'image/webp',
              '.svg': 'image/svg+xml',
              '.avif': 'image/avif',
            };
            res.setHeader('Content-Type', mimeTypes[ext] || 'application/octet-stream');
            res.end(data);
          } catch {
            next();
          }
        } else {
          next();
        }
      });

      // API endpoints
      server.middlewares.use('/api/files', async (req, res, next) => {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        
        // GET /api/files?dir=input - List files
        if (req.method === 'GET') {
          const dir = url.searchParams.get('dir') || 'input';
          const files = await listFiles(dir);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify(files));
          return;
        }
        
        // POST /api/files - Upload file
        if (req.method === 'POST') {
          const dir = url.searchParams.get('dir') || 'input';
          const filename = url.searchParams.get('name') || `upload-${Date.now()}.png`;
          
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(chunk));
          req.on('end', async () => {
            try {
              const data = Buffer.concat(chunks);
              const fileInfo = await saveFile(dir, filename, data);
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(fileInfo));
            } catch (error) {
              res.statusCode = 500;
              res.end(JSON.stringify({ error: 'Failed to save file' }));
            }
          });
          return;
        }
        
        // DELETE /api/files?dir=input&name=file.png - Delete file
        if (req.method === 'DELETE') {
          const dir = url.searchParams.get('dir') || 'input';
          const filename = url.searchParams.get('name');
          
          if (!filename) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: 'Missing filename' }));
            return;
          }
          
          const success = await deleteFile(dir, filename);
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success }));
          return;
        }
        
        next();
      });
    },
  };
}
