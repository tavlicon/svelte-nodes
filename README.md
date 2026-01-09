# Generative Design Studio

A node-based canvas editor for building AI image generation workflows. Built with Svelte 5, WebGPU, and Yjs.

## Features

- **Node-Based Canvas**: GPU-accelerated infinite canvas with drag-and-drop node creation
- **WebGPU/Canvas2D Rendering**: Hardware-accelerated rendering with automatic fallback
- **Visual Connections**: Bezier curve connectors with snap-to-port and type validation
- **Asset Management**: Drag and drop images and models from sidebar or desktop
- **Undo/Redo**: 5-level history with keyboard shortcuts (⌘Z / ⇧⌘Z)
- **Light/Dark Theme**: Toggle between themes with persistent preference
- **Local File Storage**: Assets stored locally in `data/` directory

## Requirements

- Modern browser with WebGPU support (recommended):
  - Chrome 113+
  - Edge 113+
  - Safari 18+
- Falls back to Canvas 2D for older browsers
- Node.js 18+

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Open http://localhost:5173
```

## Usage

### Adding Nodes
- Click **+ Add Node** in the toolbar
- Drag images from the **Assets** sidebar onto the canvas
- Drag models from the **Models** sidebar onto the canvas
- Drag files from your desktop onto the canvas

### Connecting Nodes
- Hover over a node to see its ports
- Drag from an **output port** (right side) to an **input port** (left side)
- Compatible ports snap together automatically
- Click a connection to select it, press Delete to remove

### Editing
- Click a node to select it and view properties
- Drag nodes to reposition them
- Shift+click for multi-select
- Click and drag on empty canvas to marquee select

### Navigation
- **Pan**: Space + drag, or middle-mouse drag
- **Zoom**: Mouse wheel or pinch gesture
- **Zoom Controls**: Use dropdown in toolbar (⌘1 fit, ⌘+ in, ⌘- out)

## Node Types

### Image
Input node for images. Drag images onto the canvas or from the Assets sidebar.

### Model
AI model node. Supports SafeTensors, ONNX, and PyTorch formats. Has prompt and image inputs, image output.

## Project Structure

```
├── data/               # Local storage (gitignored contents)
│   ├── input/         # Uploaded images
│   ├── models/        # AI models (.safetensors, .onnx, etc.)
│   ├── output/        # Generated images
│   └── canvases/      # Saved workflows
├── server/            # Vite dev server plugins
├── src/
│   ├── lib/
│   │   ├── canvas/    # WebGPU/Canvas2D rendering
│   │   ├── graph/     # Node graph logic & store
│   │   ├── inference/ # AI model runtime (planned)
│   │   ├── persistence/ # Storage adapters
│   │   ├── services/  # File service API
│   │   ├── ui/        # Svelte components
│   │   └── workers/   # Web Workers
│   └── main.ts
└── index.html
```

## Development

```bash
# Type checking
npm run check

# Build for production
npm run build

# Preview production build
npm run preview
```

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| ⌘Z | Undo |
| ⇧⌘Z | Redo |
| Delete/Backspace | Delete selected |
| Escape | Deselect all |
| Shift+Click | Multi-select |
| Space+Drag | Pan canvas |
| ⌘1 | Zoom to fit |
| ⌘+ | Zoom in |
| ⌘- | Zoom out |

## Architecture

### Rendering
- WebGPU instanced rendering with SDF-based visuals
- Canvas 2D fallback for broader compatibility
- SVG overlays for connection lines (reliable cross-browser)
- DOM overlays for image/model nodes

### State Management
- Yjs CRDT document for graph state
- Svelte 5 runes for reactive UI
- Optimistic updates for responsive interactions

### Storage
- File-based storage via Vite dev server
- IndexedDB for persistence (planned)
- Service Worker for model caching (planned)

## Data Directory

The `data/` directory stores local assets:

| Directory | Purpose |
|-----------|---------|
| `input/` | Uploaded images |
| `models/` | AI model files |
| `output/` | Generated images |
| `canvases/` | Saved workflows (JSON) |

**Note**: Contents are gitignored. Only the directory structure is committed.

## License

MIT
