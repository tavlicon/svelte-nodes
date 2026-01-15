# Architecture Overview

A comprehensive guide to the Generative Design Studio architecture.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           UI LAYER (Svelte 5)                          │
├─────────────────────────────────────────────────────────────────────────┤
│  Canvas.svelte  │  Sidebar.svelte  │  Toolbar.svelte  │  NodePanel     │
│  (interaction,  │  (asset browser, │  (zoom, undo,    │  (properties,  │
│   overlays)     │   file cards)    │   theme toggle)  │   parameters)  │
└────────┬────────┴────────┬─────────┴────────┬─────────┴────────┬───────┘
         │                 │                  │                  │
         ▼                 ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                       RENDERING LAYER                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  WebGPU Renderer        │  Canvas2D Fallback   │  DOM Overlays (images,│
│  (renderer.ts)          │  (renderer-2d.ts)    │   models, ports, SVG  │
│  • Grid (grid.wgsl)     │  • Grid drawing      │   edges)              │
│  • Nodes (nodes.wgsl)   │  • Node rectangles   │                       │
│  • Wires (wires.wgsl)   │  • Ports, selection  │                       │
└────────┬────────────────┴────────────────────┴──────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      STATE MANAGEMENT                                   │
├─────────────────────────────────────────────────────────────────────────┤
│  Graph Store (store.svelte.ts)              │  Theme Store             │
│  • Yjs CRDT Document (collaborative-ready)  │  (theme.svelte.ts)       │
│  • Nodes Map, Edges Map                     │  • Light/Dark toggle     │
│  • Selection state                          │                          │
│  • Undo/Redo (5-level history)              │                          │
│  • Camera position & zoom                   │                          │
└────────┬────────────────────────────────────┴──────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ORCHESTRATION LAYER                                │
├─────────────────────────────────────────────────────────────────────────┤
│  Execution Engine (execution.ts)            │  Node Registry           │
│  • Topological sort of dirty nodes          │  (nodes/registry.ts)     │
│  • Dependency resolution (DAG)              │  • Node definitions      │
│  • Input gathering from connected nodes     │  • Port types & colors   │
│  • Status tracking (idle→running→complete)  │  • Default parameters    │
│  • Output caching                           │                          │
└────────┬────────────────────────────────────┴──────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      INFERENCE LAYER                                    │
├─────────────────────────────────────────────────────────────────────────┤
│  Inference Manager (inference/manager.ts)   │  ONNX Runtime            │
│  • Request queue                            │  (onnxruntime-web)       │
│  • Progress callbacks                       │  • WebGPU acceleration   │
│  • Worker communication                     │  • WASM fallback         │
│                                             │                          │
│  Web Worker (workers/inference.worker.ts)   │  Model Loader            │
│  • Off-main-thread inference                │  (sdxl-turbo.ts - stub)  │
│  • ONNX session management                  │  • Pipeline orchestration│
└────────┬────────────────────────────────────┴──────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      PERSISTENCE LAYER                                  │
├─────────────────────────────────────────────────────────────────────────┤
│  File Service (services/file-service.ts)    │  IndexedDB (db.ts)       │
│  • REST API client                          │  • Projects              │
│  • List/Upload/Delete files                 │  • Snapshots (Yjs state) │
│                                             │  • Generated assets      │
│  File API Plugin (server/file-api.ts)       │  • Settings              │
│  • Vite dev server middleware               │                          │
│  • Static file serving from /data           │  Yjs Adapter             │
│  • CRUD operations                          │  (yjs-adapter.ts)        │
└────────┬────────────────────────────────────┴──────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      FILE SYSTEM                                        │
├─────────────────────────────────────────────────────────────────────────┤
│  data/                                                                  │
│  ├── input/      → Uploaded images (.png, .jpg, .webp, etc.)           │
│  ├── models/     → AI models (.safetensors, .onnx, .pt, .ckpt)         │
│  │   ├── sd-v1-5-local/  → Stable Diffusion 1.5 (Diffusers format)     │
│  │   ├── triposr-base/   → TripoSR model (single-image to 3D)          │
│  │   └── dino-vitb16/    → DINOv2 encoder for TripoSR                  │
│  ├── output/     → Generated images (.png) and 3D meshes (.glb)        │
│  └── canvases/   → Saved workflows (.json)                             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Layer Details

### 1. UI Layer (Svelte 5 + Runes)

The UI is built with Svelte 5 using the new runes API (`$state`, `$derived`, `$effect`).

| Component | File | Purpose |
|-----------|------|---------|
| **Canvas** | `Canvas.svelte` | Main canvas with pointer events, DOM overlays (images, meshes), SVG edges, zoom/pan |
| **Sidebar** | `Sidebar.svelte` | Asset browser (images, models, GLB meshes) with drag-drop, click-to-add, 3D preview modal |
| **Toolbar** | `Toolbar.svelte` | Zoom controls, undo/redo buttons, theme toggle |
| **NodePanel** | `NodePanel.svelte` | Properties panel for selected node (includes 3D preview for mesh outputs) |
| **ParameterEditor** | `ParameterEditor.svelte` | Dynamic form for node parameters |
| **MeshViewer** | `MeshViewer.svelte` | Three.js-based GLB viewer with orbit controls, auto-rotate |

#### Key Patterns

- **Reactive state** via `$state` runes
- **Derived values** via `$derived.by()` for computed overlays
- **Effects** via `$effect` for side effects (rendering, event listeners)
- **Version counters** (`nodesVersion`) to force reactivity on Map mutations

---

### 2. Rendering Layer

Dual-renderer architecture with automatic fallback.

#### WebGPU Renderer (`renderer.ts`)

- GPU-accelerated instanced rendering
- WGSL shaders for:
  - `grid.wgsl` – Dot grid pattern
  - `nodes.wgsl` – Node rectangles with SDF corners
  - `wires.wgsl` – Bezier curve connections
- Uses `effectiveZoom = camera.zoom * dpr` for HiDPI

#### Canvas2D Fallback (`renderer-2d.ts`)

- Used when WebGPU unavailable
- Same API surface as WebGPU renderer
- Simpler but still performant for typical graphs

#### DOM Overlays

- **Image/Model nodes** – Positioned `<div>` elements with `<img>` inside
- **Port handles** – Circular buttons on hover
- **SVG edges** – Bezier paths for reliable cross-browser rendering
- **Selection bounds** – Subtle border around selected nodes

---

### 3. State Management

#### Graph Store (`store.svelte.ts`)

Built on Yjs CRDT for future collaborative editing.

```typescript
// Core state
let nodes = $state<Map<string, NodeInstance>>(new Map());
let edges = $state<Map<string, Edge>>(new Map());
let selectedNodeIds = $state<Set<string>>(new Set());
let camera = $state<Camera>({ x: 0, y: 0, zoom: 1 });

// Undo/Redo (5-level history)
let undoStack = $state<Action[]>([]);
let redoStack = $state<Action[]>([]);
```

#### Key Operations

| Method | Purpose |
|--------|---------|
| `addNode()` | Create node, push to undo stack |
| `deleteSelectedNodes()` | Remove nodes + connected edges |
| `addEdge()` | Connect ports, validate compatibility |
| `undo()` / `redo()` | Traverse action history |
| `recordMoveStart()` / `recordMoveEnd()` | Batch position changes |

---

### 4. Orchestration Layer

#### Execution Engine (`execution.ts`)

Handles dependency resolution and execution scheduling.

```typescript
class ExecutionEngine {
  // Build dependency graph from edges
  buildGraph(nodes, edges) { ... }
  
  // Mark node + dependents as dirty
  markDirty(nodeId) { ... }
  
  // Topological sort for execution order
  topologicalSort(): string[] { ... }
  
  // Execute all dirty nodes in order
  async execute() { ... }
}
```

#### Node Registry (`nodes/registry.ts`)

Defines available node types:

| Type | Category | Inputs | Outputs |
|------|----------|--------|---------|
| `prompt` | Input | — | `text: string` |
| `image` | Input | — | `image: image` |
| `model` | Model | `prompt`, `image` | `image` |
| `triposr` | Model | `image` | `mesh` |
| `sdxl-turbo` | Generate | `prompt`, `negative_prompt` | `image` |
| `image-display` | Output | `image` | — |
| `mesh-output` | Output | `mesh` | — |

#### Port Types

```typescript
type PortType = 'string' | 'image' | 'tensor' | 'number' | 'mesh' | 'any';

// Compatibility check
function arePortsCompatible(outputType, inputType): boolean {
  if (inputType === 'any' || outputType === 'any') return true;
  return outputType === inputType;
}
```

---

### 5. Inference Layer

#### Inference Manager (`inference/manager.ts`)

Coordinates inference requests across workers and backend APIs.

```typescript
// SD 1.5 img2img request
interface Img2ImgRequest {
  prompt: string;
  negativePrompt?: string;
  steps: number;
  guidanceScale: number;
  width: number;
  height: number;
  seed: number;
}

// TripoSR 3D mesh request
interface TripoSRRequest {
  inputImage: string;       // Data URL or file path
  device?: string;          // 'mps' | 'cuda' | 'cpu'
  mcResolution?: number;    // Marching cubes resolution (256/512)
  removeBackground?: boolean;
  foregroundRatio?: number; // 0.0-1.0
}

class InferenceManager {
  // Run SD 1.5 img2img
  async runImg2Img(request, onProgress?): Promise<Img2ImgResult>
  
  // Run TripoSR 3D generation
  async runTripoSR(request, onProgress?): Promise<TripoSRResult>
  
  // Load models
  async loadModel(): Promise<void>
  async loadTripoSR(): Promise<void>
  
  // Check status
  isModelLoaded(): boolean
  isTripoSRLoaded(): boolean
}
```

#### Web Worker (`workers/inference.worker.ts`)

- Off-main-thread execution
- ONNX Runtime with WebGPU/WASM
- Message-based communication:
  - `load-model` → `model-loaded` / `model-load-error`
  - `run-inference` → `inference-progress` → `inference-complete`

---

### 6. Persistence Layer

#### File Service (`services/file-service.ts`)

REST client for file operations:

```typescript
listFiles(directory: 'input' | 'output' | 'models' | 'canvases')
uploadFile(directory, file)
deleteFile(directory, filename)
```

#### File API Plugin (`server/file-api.ts`)

Vite dev server middleware:

- `GET /api/files?dir=input` – List files
- `POST /api/files?dir=input&name=file.png` – Upload
- `DELETE /api/files?dir=input&name=file.png` – Delete
- `GET /data/*` – Static file serving

#### IndexedDB (`persistence/db.ts`)

Browser-side storage (scaffolded):

| Store | Purpose |
|-------|---------|
| `projects` | Project metadata |
| `snapshots` | Yjs state vectors |
| `assets` | Generated image blobs |
| `settings` | User preferences |

---

## AI Pipeline Status

### ✅ Implemented

- Execution Engine with topological sort and dirty tracking
- InferenceManager with queue, progress callbacks, worker messaging
- Web Worker scaffold with ONNX Runtime imported
- Node Registry with model node types defined (SD 1.5, TripoSR)
- Port System with type compatibility checking (including `mesh` type)
- File System for loading models from `data/models/`
- **SD 1.5 img2img** – Full pipeline via Python backend (Diffusers)
- **TripoSR 3D mesh** – Single-image to GLB via Python backend
- **3D Mesh Viewer** – Three.js-based viewer for GLB files (MeshViewer.svelte)
- **GLB Output** – Auto-saves to `data/output/` with preview in sidebar

### 🚧 Future Enhancements

- **Browser-side ONNX** – WebGPU inference for smaller models
- **Pipeline Orchestration** – text encoder → U-Net → VAE decoder (browser)
- **Model-Specific Nodes** – SDXL, ControlNet, LoRA adapters
- **Preview Images** – Generate 2D thumbnail renders from 3D meshes
- **Mesh Editing** – Basic mesh manipulation nodes

---

## Backend Options for Production

| Option | Pros | Cons |
|--------|------|------|
| **Browser + ONNX WebGPU** | No server, user's GPU | Limited VRAM, model size |
| **Node.js Backend** | Full filesystem, native ONNX | Requires hosting |
| **Python Backend** | PyTorch/diffusers ecosystem | Separate service, GPU server |
| **Serverless** | Scale to zero, pay per use | Latency, cost at scale |

### Recommended: Hybrid Approach

1. **Browser inference** for small models (SDXL Turbo, ~2GB)
2. **Optional backend API** for larger models/batches
3. **WebSocket** for streaming progress updates
4. **Service Worker** for model caching

---

## Data Flow Example

```
User drops image → Sidebar.svelte
                        │
                        ▼
              Canvas.svelte (handleDrop)
                        │
                        ▼
              graphStore.addNode('image', ...)
                        │
                        ▼
              Yjs Document updated
                        │
                        ▼
              nodesVersion++ (trigger reactivity)
                        │
                        ▼
              DOM overlay rendered
                        │
                        ▼
              User connects to model node
                        │
                        ▼
              graphStore.addEdge(...)
                        │
                        ▼
              executionEngine.markDirty(modelNodeId)
                        │
                        ▼
              User clicks "Run"
                        │
                        ▼
              executionEngine.execute()
                        │
                        ▼
              Topological sort → [imageNode, modelNode]
                        │
                        ▼
              inferenceManager.runInference(...)
                        │
                        ▼
              Worker: load model, run pipeline
                        │
                        ▼
              Progress callbacks → UI updates
                        │
                        ▼
              Result → outputCache → thumbnail
```

---

## Key Files Reference

```
src/lib/
├── canvas/
│   ├── renderer.ts        # WebGPU renderer
│   ├── renderer-2d.ts     # Canvas2D fallback
│   ├── grid.wgsl          # Grid shader
│   ├── nodes.wgsl         # Node shader
│   ├── wires.wgsl         # Wire shader
│   ├── ports.ts           # Port utilities
│   └── camera.ts          # Camera math
├── graph/
│   ├── store.svelte.ts    # Yjs-backed store
│   ├── execution.ts       # DAG execution engine (includes TripoSR)
│   ├── types.ts           # Core types (includes mesh port type)
│   └── nodes/registry.ts  # Node definitions (SD 1.5, TripoSR)
├── inference/
│   ├── manager.ts         # Inference coordinator (img2img + TripoSR)
│   ├── api-client.ts      # Backend API client (img2img + TripoSR)
│   ├── types.ts           # Request/response types
│   ├── onnx.ts            # ONNX utilities
│   └── sdxl-turbo.ts      # Pipeline stub
├── persistence/
│   ├── db.ts              # IndexedDB wrapper
│   └── yjs-adapter.ts     # Yjs persistence
├── services/
│   └── file-service.ts    # File API client
├── ui/
│   ├── Canvas.svelte      # Main canvas (image + mesh overlays)
│   ├── Sidebar.svelte     # Asset browser (3D preview modal)
│   ├── Toolbar.svelte     # Top toolbar
│   ├── NodePanel.svelte   # Properties panel (3D viewer)
│   ├── MeshViewer.svelte  # Three.js GLB viewer component
│   └── theme.svelte.ts    # Theme state
└── workers/
    ├── inference.worker.ts # AI worker
    └── preview.worker.ts   # Preview worker

backend/
├── server.py              # FastAPI server (SD 1.5 + TripoSR)
├── app/                   # Phase_0 refactor scaffolding (settings/services/runtime)
│   ├── config.py          # Env-based paths + CORS + debug log path
│   ├── services/          # Extracted orchestration for SD img2img + TripoSR
│   ├── runtime/           # Device selection + per-model concurrency guards
│   └── storage/           # Artifact naming/path helpers (writes to data/output)
├── requirements.txt       # Python dependencies
└── venv/                  # Python virtual environment
```
