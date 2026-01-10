# Generative Design Studio

A node-based canvas editor for building AI image generation workflows. Built with Svelte 5, WebGPU, and a Python backend using Diffusers.

## Features

- **Node-Based Canvas**: GPU-accelerated infinite canvas with drag-and-drop node creation
- **WebGPU/Canvas2D Rendering**: Hardware-accelerated rendering with automatic fallback
- **Visual Connections**: Bezier curve connectors with snap-to-port and type validation
- **SD 1.5 img2img**: Local Stable Diffusion inference using Diffusers library
- **Output Node**: Auto-generated output node shows result with file path
- **Asset Management**: Drag and drop images and models from sidebar or desktop
- **Undo/Redo**: 5-level history with keyboard shortcuts (⌘Z / ⇧⌘Z)
- **Light/Dark Theme**: Toggle between themes with persistent preference
- **Local File Storage**: All assets stored locally in `data/` directory

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    GENERATIVE DESIGN STUDIO                     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────────┐         ┌──────────────────────────────┐ │
│  │   FRONTEND       │  HTTP   │   BACKEND (Python)           │ │
│  │   (Svelte 5)     │ ──────► │   FastAPI + Diffusers        │ │
│  │                  │         │                              │ │
│  │  • Node Editor   │         │  • Loads SD 1.5 model        │ │
│  │  • WebGPU Canvas │         │  • Runs on MPS/CUDA/CPU      │ │
│  │  • Parameters    │         │  • img2img inference         │ │
│  │  • Output Display│ ◄────── │  • Returns generated image   │ │
│  └──────────────────┘         └──────────────────────────────┘ │
│        localhost:5173              localhost:8000              │
└─────────────────────────────────────────────────────────────────┘
```

**Note**: This is a standalone application. It does NOT use ComfyUI or any external inference service.

## Requirements

### Frontend
- Node.js 18+
- Modern browser with WebGPU support (recommended):
  - Chrome 113+, Edge 113+, Safari 18+
- Falls back to Canvas 2D for older browsers

### Backend
- Python 3.10+
- ~8GB RAM (for model loading)
- GPU recommended:
  - **Apple Silicon** (M1/M2/M3): Uses MPS acceleration
  - **NVIDIA GPU**: Uses CUDA acceleration
  - **CPU**: Works but slower (~30s/image)

## Quick Start

### 1. Clone and Install Frontend

```bash
git clone https://github.com/yourusername/generative-design-studio-2.git
cd generative-design-studio-2

# Install frontend dependencies
npm install
```

### 2. Set Up Python Backend

```bash
cd backend
python3 -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
```

### 3. Download Model Files (Offline Setup)

For fully offline operation, download these files from HuggingFace and place them in `data/models/sd-v1-5-local/`:

```
data/models/sd-v1-5-local/
├── model_index.json
├── scheduler/
│   └── scheduler_config.json
├── text_encoder/
│   ├── config.json
│   └── model.safetensors (~492 MB)
├── tokenizer/
│   ├── merges.txt
│   ├── special_tokens_map.json
│   ├── tokenizer_config.json
│   └── vocab.json
├── unet/
│   ├── config.json
│   └── diffusion_pytorch_model.safetensors (~3.4 GB)
└── vae/
    ├── config.json
    └── diffusion_pytorch_model.safetensors (~335 MB)
```

Download links (from `runwayml/stable-diffusion-v1-5`):
- All config files: https://huggingface.co/runwayml/stable-diffusion-v1-5/tree/main
- Model weights: Download the `.safetensors` files for each component

### 4. Start the Backend

```bash
cd backend
source venv/bin/activate
python server.py
```

The server will start on `http://localhost:8000` and show:
```
✅ Model loaded successfully (offline mode)!
Backend: MPS | Model: v1-5-pruned-emaonly-fp16
```

### 5. Start the Frontend

```bash
# In a new terminal, from project root
npm run dev
```

Open `http://localhost:5173`

The toolbar will show backend status:
- **🟢 MPS/CUDA/CPU** - Connected with model loaded
- **🟡 SIMULATION** - Backend offline, using simulation mode

## Usage

### Creating an img2img Workflow

1. **Add Input Image**: Click Assets → Imported → Click an image to add to canvas
2. **Add Model Node**: Click Models → Click the model to add
3. **Connect Nodes**: Drag from Image output (right) → Model input (left)
4. **Configure Parameters**:
   - **Positive Prompt**: What you want to see
   - **Negative Prompt**: What to avoid
   - **Steps**: Denoising steps (3-50, more = better quality)
   - **CFG Scale**: Prompt strength (1-20)
   - **Sampler**: LCM (fast), Euler, DPM++, etc.
   - **Denoise**: How much to change (0-1, higher = more change)
5. **Run**: Click **▶ Run** in toolbar
6. **Output**: An Output node appears automatically showing:
   - Generated image preview
   - File path in `data/output/`
   - Generation time

### Keyboard Shortcuts

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

## Node Types

| Type | Category | Description |
|------|----------|-------------|
| **Image** | Input | Source image for img2img |
| **Model** | Model | SD 1.5 img2img processor with prompts & sampler params |
| **Output** | Output | Auto-created, shows generated image and file path |

## Project Structure

```
├── backend/              # Python inference server
│   ├── server.py        # FastAPI server with Diffusers
│   ├── requirements.txt # Python dependencies
│   └── venv/            # Python virtual environment
├── data/                 # Local storage (gitignored contents)
│   ├── input/           # Uploaded images
│   ├── models/          # AI models
│   │   └── sd-v1-5-local/  # Diffusers-format SD 1.5
│   ├── output/          # Generated images (img2img_TIMESTAMP_SEED.png)
│   └── canvases/        # Saved workflows
├── src/
│   ├── lib/
│   │   ├── canvas/      # WebGPU/Canvas2D rendering
│   │   ├── graph/       # Node graph logic & store
│   │   │   ├── execution.ts   # Topological execution engine
│   │   │   ├── store.svelte.ts # Yjs-backed reactive store
│   │   │   └── nodes/registry.ts # Node type definitions
│   │   ├── inference/   # Backend communication
│   │   │   └── manager.ts # HTTP client for img2img API
│   │   ├── ui/          # Svelte components
│   │   └── workers/     # Web Workers (fallback)
│   └── main.ts
└── index.html
```

## Backend API

### `GET /api/model/info`
Returns model status:
```json
{
  "loaded": true,
  "model_name": "v1-5-pruned-emaonly-fp16",
  "device": "mps"
}
```

### `POST /api/img2img`
Performs img2img generation. Form data:
- `image`: Input image file
- `positive_prompt`: Text prompt
- `negative_prompt`: Negative prompt
- `seed`: Random seed (int)
- `steps`: Inference steps (int)
- `cfg`: Guidance scale (float)
- `sampler_name`: Sampler type
- `scheduler`: Scheduler type
- `denoise`: Denoising strength (0-1)

Returns:
```json
{
  "image": "data:image/png;base64,...",
  "output_path": "/path/to/data/output/img2img_123456_42.png",
  "time_taken": 8.5,
  "width": 512,
  "height": 512
}
```

## Troubleshooting

### 403 WebSocket Errors in Terminal

```
WebSocket /ws?clientId=xxx" 403
connection rejected (403 Forbidden)
```

This is **harmless**. It's caused by ComfyUI (if installed) trying to connect to port 8000. Our server correctly rejects these. To stop the messages:
- Close ComfyUI app/browser tab, OR
- Run our server on a different port: `uvicorn server:app --port 8001`

### Black/Corrupt Output Images

If generated images are black, the server automatically applies a fix for MPS (Apple Silicon) by running in float32 mode. Check the server logs for:
```
Pipeline running in float32 for MPS stability
```

### Model Not Loading

1. Ensure all model files are in `data/models/sd-v1-5-local/`
2. Check file sizes match expected:
   - `unet/diffusion_pytorch_model.safetensors`: ~3.4 GB
   - `vae/diffusion_pytorch_model.safetensors`: ~335 MB
   - `text_encoder/model.safetensors`: ~492 MB
3. Check server logs for specific errors

### Simulation Mode (Yellow Indicator)

If frontend shows "SIMULATION" instead of "MPS/CUDA":
1. Ensure backend is running: `curl http://localhost:8000/api/model/info`
2. Check backend loaded model: look for "✅ Model loaded" in server logs
3. Refresh frontend page

## Performance

| Hardware | Speed | Notes |
|----------|-------|-------|
| Apple M1/M2/M3 | ~8-12s/image | Uses MPS, float32 for stability |
| NVIDIA RTX 3080+ | ~3-5s/image | Uses CUDA, float16 |
| CPU | ~30-60s/image | Not recommended |

Tips:
- Use fewer steps (3-10 with LCM sampler)
- Lower CFG scale (2-4 with LCM)
- Use 512x512 input images

## Development

```bash
# Type checking
npm run check

# Build for production
npm run build

# Preview production build
npm run preview
```

## License

MIT
