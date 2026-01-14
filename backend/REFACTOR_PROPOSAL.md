# Backend Refactor Proposal (Python-first, cloud-ready)

This document proposes a refactor of the current backend implementation in `backend/server.py` into a scalable, testable architecture **without changing runtime behavior** initially.

It is designed to support:

- **MacBook Pro (M2–M4) local execution** with MPS
- **Cloud deployment** later with GPU workers
- Future **3rd-party model providers via API** (e.g., “Nano Banana”) as additional backends

## What’s wrong with the current shape (from a scaling standpoint)

`backend/server.py` currently mixes:

- HTTP API layer (FastAPI routes, request parsing)
- Model lifecycle management (load/save, device selection)
- Inference orchestration (pre/post-processing, resizing, background removal)
- Artifact storage concerns (filesystem paths, filenames)
- Streaming/progress concerns (SSE callbacks, in-memory progress)

This creates a few scaling risks:

- **Blocking request handlers**: heavy compute in request context reduces concurrency and increases tail latency.
- **Global mutable state**: `pipeline`, `triposr_model`, `current_device` are shared across requests and have no concurrency guard.
- **Config is not environment-driven**: hard-coded paths (e.g., debug log path) and assumptions about `/data` serving.
- **Unclear separation of concerns**: harder to replace “TripoSR local” with “TripoSR via vendor API” later.

## Target package layout

Proposed structure under `backend/app/` (or `backend/src/`):

```
backend/
  app/
    __init__.py
    main.py                 # create_app(); FastAPI assembly
    api/
      __init__.py
      routes_health.py
      routes_img2img.py
      routes_triposr.py
      routes_jobs.py        # later: job-based API
      schemas.py            # pydantic request/response types
    services/
      __init__.py
      img2img_service.py    # pure orchestration: validate -> preprocess -> run -> postprocess
      triposr_service.py
      providers/
        __init__.py
        local_sd15.py       # Diffusers-backed provider
        local_triposr.py    # TSR-backed provider
        vendor_api.py       # later: NanoBananaProvider(...)
    runtime/
      __init__.py
      device.py             # device selection policy: cuda/mps/cpu + dtype rules
      model_manager.py      # load/unload, warmup, reload, memory opts
      concurrency.py        # locks, semaphores, backpressure policy
      jobs.py               # later: queue + job state machine
    storage/
      __init__.py
      artifacts.py          # output naming, directories, metadata
      urls.py               # how to construct public URLs (local / cloud)
    observability/
      __init__.py
      logging.py            # structured logging setup
      metrics.py            # later: prometheus/opentelemetry glue
    config.py               # pydantic settings from env
```

### Design principle: Providers

Each “model capability” should expose a stable interface like:

- `Img2ImgProvider.generate(request) -> Img2ImgResult`
- `MeshProvider.generate(request) -> MeshResult`

Then your implementation choices become pluggable:

- local Diffusers vs vendor API
- local TSR vs vendor API
- future ONNX/TensorRT variants

## Minimal extraction steps from `server.py` (behavior-preserving)

This is the lowest-risk path: **move code, don’t change semantics**.

### Step 1: Introduce `config.py`

Move all environment-sensitive values into settings:

- `DATA_DIR` (defaults to repo `data/`)
- `OUTPUT_DIR` (defaults to `data/output`)
- `CORS_ALLOW_ORIGINS`
- `HOST`, `PORT`
- `DEVICE_POLICY` (auto/cuda/mps/cpu)
- `MODEL_PATHS` (sd local dir, safetensors path, triposr dir)

Replace hardcoded debug path (currently points to a different repo) with env-driven config.

### Step 2: Extract “device + dtype”

Move `get_device_and_dtype()` into `runtime/device.py` and make it testable.

Key rule to preserve: **MPS uses float32** for VAE stability.

### Step 3: Extract model loaders

Move:

- `load_model_local()`
- `load_model_from_safetensors()`
- `load_triposr_model()`

…into `runtime/model_manager.py` or provider modules.

Ensure the API layer only calls: `model_manager.get_sd_pipeline()` or `model_manager.get_triposr()`.

### Step 4: Extract request preprocessing

Split pure functions for:

- image decode + resize-to-multiples-of-8 (SD)
- background removal + crop/resize (TripoSR)

This enables unit tests without GPU.

### Step 5: Add concurrency guards (still behavior-preserving)

Add per-model locks/semaphores:

- `sd_semaphore = Semaphore(1)` initially (single in-flight) to avoid VRAM thrash
- `tsr_semaphore = Semaphore(1)` similarly

For Mac MPS this improves stability under multi-user traffic.

Later you can relax this based on measured VRAM and batching.

### Step 6: Extract artifact writing

Create `storage/artifacts.py` to centralize:

- naming policy (timestamps, ids)
- output directories
- return payloads (`/data/output/...` vs signed URLs)

This makes it easy to move to S3/GCS later.

## Notes for Mac now, cloud later

- **Local Mac**: keep single process, but use job-style queuing or semaphores to limit concurrency and keep UI responsive.\n+- **Cloud**: split API from GPU workers; the providers still work, but run inside worker processes.\n+
## What to do about “Nano Banana” or other vendor models

Add a `VendorApiProvider` that implements the same provider interface. The rest of the app should not care whether a generation is local or remote; it just receives progress + artifact references.

