"""
Generative Design Studio Backend Server
Provides REST API for:
- Stable Diffusion 1.5 img2img generation
- TripoSR single-image to 3D mesh generation
"""

import asyncio
import base64
import io
import json
import os
import time
import uuid
import logging
import ssl
import certifi
from pathlib import Path
from typing import Optional

import torch
import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse

from app.config import load_settings
from app.runtime.device import get_device_and_dtype as _get_device_and_dtype
from app.storage.artifacts import ArtifactPaths
from app.services.img2img_service import Img2ImgService, Img2ImgParams
from app.services.triposr_service import TripoSRService, TripoSRParams
from app.runtime.concurrency import ConcurrencyManager
from app.runtime.jobs import JobStore
from app.runtime.queue import JobQueueManager
from app.runtime.events import periodic_cleanup_task
from app.api.routes_jobs import create_jobs_router
from app.services.providers.base import ProviderContext
from app.services.providers.local_sd15 import LocalSD15Provider, SD15ProviderDeps
from app.services.providers.local_triposr import LocalTripoSRProvider, TripoSRProviderDeps

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Fix SSL certificate issues for any network calls
os.environ['REQUESTS_CA_BUNDLE'] = certifi.where()
os.environ['SSL_CERT_FILE'] = certifi.where()
os.environ['CURL_CA_BUNDLE'] = certifi.where()

# Diffusers imports
from diffusers import (
    StableDiffusionImg2ImgPipeline,
    DDIMScheduler,
    EulerDiscreteScheduler,
    EulerAncestralDiscreteScheduler,
    DPMSolverMultistepScheduler,
    LCMScheduler,
    UniPCMultistepScheduler,
    AutoencoderKL,
)
from diffusers.pipelines.stable_diffusion import StableDiffusionPipelineOutput
from transformers import CLIPTextModel, CLIPTokenizer

app = FastAPI(title="Generative Design Studio Backend", version="1.0.0")

SETTINGS = load_settings()
CONCURRENCY = ConcurrencyManager()
JOB_STORE = JobStore(ttl_seconds=60 * 30)

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=SETTINGS.cors_allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global pipeline storage
pipeline: Optional[StableDiffusionImg2ImgPipeline] = None
current_device = "cpu"
model_loaded = False

# TripoSR model storage
triposr_model = None
triposr_loaded = False

# Progress tracking
progress_updates: dict[str, list] = {}


class Img2ImgRequest(BaseModel):
    """Request model for img2img generation"""
    positive_prompt: str
    negative_prompt: str = ""
    seed: int = 42
    steps: int = 20
    cfg: float = 7.5
    sampler_name: str = "euler"
    scheduler: str = "normal"
    denoise: float = 0.75
    width: int = 512
    height: int = 512


class ModelInfo(BaseModel):
    """Model information response"""
    loaded: bool
    model_name: str = ""
    device: str = "cpu"


# Scheduler mapping
SCHEDULERS = {
    "lcm": LCMScheduler,
    "euler": EulerDiscreteScheduler,
    "euler_a": EulerAncestralDiscreteScheduler,
    "dpmpp_2m": DPMSolverMultistepScheduler,
    "dpmpp_2m_sde": DPMSolverMultistepScheduler,
    "dpmpp_sde": DPMSolverMultistepScheduler,
    "ddim": DDIMScheduler,
    "uni_pc": UniPCMultistepScheduler,
}


def get_scheduler(sampler_name: str, scheduler_type: str, config):
    """Get the appropriate scheduler based on sampler name and type"""
    scheduler_class = SCHEDULERS.get(sampler_name, EulerDiscreteScheduler)
    
    # Create scheduler with appropriate config
    scheduler_config = dict(config)
    
    # Handle karras sigmas for applicable schedulers
    if scheduler_type == "karras" and sampler_name in ["euler", "euler_a", "dpmpp_2m", "dpmpp_sde"]:
        scheduler_config["use_karras_sigmas"] = True
    
    # Handle SDE variants
    if "sde" in sampler_name:
        scheduler_config["algorithm_type"] = "sde-dpmsolver++"
    
    return scheduler_class.from_config(scheduler_config)


def get_device_and_dtype():
    """Determine the best device and dtype for inference"""
    return _get_device_and_dtype()

class _StoreEmitter:
    def __init__(self, store: JobStore, job_id: str):
        self.store = store
        self.job_id = job_id

    async def queued(self) -> None:
        return

    async def started(self) -> None:
        # JobStore.set_running already emits the started event.
        return

    async def progress(self, *, current: int, total: int, stage: str = "") -> None:
        await self.store.set_progress(self.job_id, current=current, total=total, stage=stage)

def _set_sd_scheduler(p: StableDiffusionImg2ImgPipeline, sampler_name: str, scheduler_type: str) -> None:
    p.scheduler = get_scheduler(sampler_name, scheduler_type, p.scheduler.config)

# Providers are local-first and wrap existing Phase_0 services.
SD_PROVIDER = LocalSD15Provider(
    SD15ProviderDeps(
        get_pipeline=lambda: pipeline,
        is_loaded=lambda: model_loaded,
        get_current_device=lambda: current_device,
        set_scheduler=_set_sd_scheduler,
        concurrency=CONCURRENCY,
        output_dir=SETTINGS.output_dir,
    )
)

TRIPOSR_PROVIDER = LocalTripoSRProvider(
    TripoSRProviderDeps(
        get_model=lambda: triposr_model,
        is_loaded=lambda: triposr_loaded,
        concurrency=CONCURRENCY,
        output_dir=SETTINGS.output_dir,
    )
)

async def _execute_img2img_job(job_id: str) -> None:
    rec = await JOB_STORE.get(job_id)
    if rec.status == "cancelled":
        return
    if rec.cancel_requested and rec.status == "queued":
        await JOB_STORE.cancel(job_id)
        return

    await JOB_STORE.set_running(job_id)
    emitter = _StoreEmitter(JOB_STORE, job_id)
    try:
        result = await SD_PROVIDER.execute(ctx=ProviderContext(), payload=rec.payload, emitter=emitter)
        await JOB_STORE.succeed(job_id, result)
    except Exception as e:
        await JOB_STORE.fail(job_id, str(e))

async def _execute_triposr_job(job_id: str) -> None:
    rec = await JOB_STORE.get(job_id)
    if rec.status == "cancelled":
        return
    if rec.cancel_requested and rec.status == "queued":
        await JOB_STORE.cancel(job_id)
        return

    await JOB_STORE.set_running(job_id)
    emitter = _StoreEmitter(JOB_STORE, job_id)
    try:
        result = await TRIPOSR_PROVIDER.execute(ctx=ProviderContext(), payload=rec.payload, emitter=emitter)
        await JOB_STORE.succeed(job_id, result)
    except Exception as e:
        await JOB_STORE.fail(job_id, str(e))

JOB_QUEUE = JobQueueManager(
    store=JOB_STORE,
    execute_img2img=_execute_img2img_job,
    execute_triposr=_execute_triposr_job,
)

async def _ensure_sd_loaded() -> None:
    if not model_loaded or pipeline is None:
        raise HTTPException(status_code=503, detail="Model not loaded")

async def _ensure_triposr_loaded(chunk_size: int) -> None:
    global triposr_loaded
    if not triposr_loaded:
        success = load_triposr_model(chunk_size)
        if not success:
            raise HTTPException(status_code=503, detail="TripoSR model not available")

app.include_router(
    create_jobs_router(
        store=JOB_STORE,
        queue=JOB_QUEUE,
        ensure_sd_loaded=_ensure_sd_loaded,
        ensure_triposr_loaded=_ensure_triposr_loaded,
    )
)


def load_model_local(model_path: str):
    """Load from local diffusers directory - FULLY OFFLINE, no network"""
    global pipeline, current_device, model_loaded
    
    logger.info(f"Loading model from local directory: {model_path}")
    
    current_device, torch_dtype = get_device_and_dtype()
    logger.info(f"Using device: {current_device}, dtype: {torch_dtype}")
    
    try:
        # Load from local diffusers format - no network needed
        pipeline = StableDiffusionImg2ImgPipeline.from_pretrained(
            model_path,
            torch_dtype=torch_dtype,
            local_files_only=True,  # Strictly offline
            safety_checker=None,
            requires_safety_checker=False,
        )
        
        logger.info(f"Moving pipeline to {current_device}...")
        pipeline = pipeline.to(current_device)
        
        # Enable memory optimizations
        if current_device == "cuda":
            pipeline.enable_attention_slicing()
            try:
                pipeline.enable_xformers_memory_efficient_attention()
                logger.info("Enabled xformers memory efficient attention")
            except Exception:
                pass
        elif current_device == "mps":
            pipeline.enable_attention_slicing()
            logger.info("Enabled attention slicing for MPS")
            logger.info("Pipeline running in float32 for MPS stability")
        
        model_loaded = True
        logger.info("✅ Model loaded successfully (offline mode)!")
        
    except Exception as e:
        logger.error(f"❌ Error loading model: {e}")
        import traceback
        traceback.print_exc()
        raise


def load_model_from_safetensors(model_path: str):
    """Load from safetensors file - requires network for config on first run"""
    global pipeline, current_device, model_loaded
    
    logger.info(f"Loading model from safetensors: {model_path}")
    
    current_device, torch_dtype = get_device_and_dtype()
    logger.info(f"Using device: {current_device}, dtype: {torch_dtype}")
    
    try:
        # This will download config from HuggingFace on first run
        pipeline = StableDiffusionImg2ImgPipeline.from_single_file(
            model_path,
            torch_dtype=torch_dtype,
            use_safetensors=True,
            load_safety_checker=False,
        )
        
        logger.info(f"Moving pipeline to {current_device}...")
        pipeline = pipeline.to(current_device)
        
        # Disable safety checker
        pipeline.safety_checker = None
        pipeline.requires_safety_checker = False
        
        # Enable memory optimizations
        if current_device == "cuda":
            pipeline.enable_attention_slicing()
            try:
                pipeline.enable_xformers_memory_efficient_attention()
                logger.info("Enabled xformers memory efficient attention")
            except Exception:
                pass
        elif current_device == "mps":
            pipeline.enable_attention_slicing()
            logger.info("Enabled attention slicing for MPS")
        
        model_loaded = True
        logger.info("✅ Model loaded successfully!")
        
    except Exception as e:
        logger.error(f"❌ Error loading model: {e}")
        import traceback
        traceback.print_exc()
        raise


def image_to_base64(image: Image.Image, format: str = "PNG") -> str:
    """Convert PIL Image to base64 string"""
    buffer = io.BytesIO()
    image.save(buffer, format=format)
    return base64.b64encode(buffer.getvalue()).decode()


def base64_to_image(base64_str: str) -> Image.Image:
    """Convert base64 string to PIL Image"""
    # Handle data URL format
    if base64_str.startswith("data:"):
        base64_str = base64_str.split(",")[1]
    
    image_data = base64.b64decode(base64_str)
    return Image.open(io.BytesIO(image_data))


@app.on_event("startup")
async def startup_event():
    """Load model on startup - LOCAL ONLY MODE"""
    global pipeline, current_device, model_loaded
    
    # Look for model in data/models directory
    model_dir = Path(__file__).parent.parent / "data" / "models"
    local_model_path = model_dir / "sd-v1-5-local"  # Diffusers format (preferred)
    safetensors_path = model_dir / "v1-5-pruned-emaonly-fp16.safetensors"
    
    logger.info("=" * 60)
    logger.info("🚀 Starting Stable Diffusion Backend Server")
    logger.info("📍 Mode: LOCAL ONLY (no network calls)")
    logger.info("=" * 60)

    # region agent log
    try:
        SETTINGS.debug_log_path.parent.mkdir(parents=True, exist_ok=True)
        SETTINGS.debug_log_path.open("a").write(json.dumps({
            "sessionId": "debug-session",
            "runId": "pre-fix",
            "hypothesisId": "H1",
            "location": "backend/server.py:startup_event",
            "message": "Startup model presence check",
            "data": {
                "localModelExists": local_model_path.exists(),
                "safetensorsExists": safetensors_path.exists(),
                "cwd": os.getcwd()
            },
            "timestamp": int(time.time() * 1000)
        }) + "\n")
    except Exception:
        pass
    # endregion
    
    # Prefer local diffusers format (fully offline)
    if local_model_path.exists():
        logger.info(f"Found local model directory: {local_model_path}")
        try:
            load_model_local(str(local_model_path))
        except Exception as e:
            logger.error(f"Failed to load local model: {e}")
            logger.warning("⚠️ Server starting without model")
    
    # Fallback to safetensors (requires network for config on first run)
    elif safetensors_path.exists():
        logger.warning(f"Found safetensors file, but no local model directory.")
        logger.warning(f"Please run: python setup_model.py")
        logger.warning(f"This downloads model config once, then works offline.")
        logger.info("")
        logger.info("Attempting to load from safetensors (may require network)...")
        
        # Temporarily disable offline mode for first-time setup
        os.environ.pop('HF_HUB_OFFLINE', None)
        os.environ.pop('TRANSFORMERS_OFFLINE', None)
        
        try:
            load_model_from_safetensors(str(safetensors_path))
            # Save for next time
            if model_loaded and pipeline is not None:
                logger.info(f"Saving model locally for offline use...")
                pipeline.save_pretrained(str(local_model_path))
                logger.info(f"✅ Model saved to {local_model_path}")
        except Exception as e:
            logger.error(f"Failed to load from safetensors: {e}")
            logger.warning("⚠️ Server starting without model")
            logger.warning("Run 'python setup_model.py' to set up the model.")
    else:
        logger.error(f"❌ No model found!")
        logger.error(f"  - Local model: {local_model_path}")
        logger.error(f"  - Safetensors: {safetensors_path}")
        logger.warning("⚠️ Server starting without model")
    
    logger.info("=" * 60)
    if model_loaded:
        logger.info(f"✅ Ready for inference on {current_device.upper()}")
    else:
        logger.warning("⚠️ Model NOT loaded - inference will fail")
    logger.info("=" * 60)

    # Start Phase_1 job queue workers and background cleanup
    JOB_QUEUE.start()
    asyncio.create_task(periodic_cleanup_task(JOB_STORE), name="job-ttl-cleanup")

    # region agent log
    try:
        SETTINGS.debug_log_path.open("a").write(json.dumps({
            "sessionId": "debug-session",
            "runId": "pre-fix",
            "hypothesisId": "H1",
            "location": "backend/server.py:startup_event",
            "message": "Startup model load result",
            "data": {
                "modelLoaded": model_loaded,
                "device": current_device,
                "localModelPath": str(local_model_path),
                "safetensorsPath": str(safetensors_path)
            },
            "timestamp": int(time.time() * 1000)
        }) + "\n")
    except Exception:
        pass
    # endregion


@app.get("/api/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "model_loaded": model_loaded}


@app.get("/api/model/info", response_model=ModelInfo)
async def get_model_info():
    """Get current model information"""
    return ModelInfo(
        loaded=model_loaded,
        model_name="v1-5-pruned-emaonly-fp16" if model_loaded else "",
        device=current_device,
    )


@app.post("/api/model/load")
async def load_model_endpoint(model_path: str = Form(...)):
    """Load a model from the specified path"""
    global model_loaded
    
    if not os.path.exists(model_path):
        raise HTTPException(status_code=404, detail=f"Model not found: {model_path}")
    
    try:
        load_model(model_path)
        return {"status": "success", "device": current_device}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/img2img")
async def img2img(
    image: UploadFile = File(...),
    positive_prompt: str = Form(...),
    negative_prompt: str = Form(""),
    seed: int = Form(42),
    steps: int = Form(20),
    cfg: float = Form(7.5),
    sampler_name: str = Form("euler"),
    scheduler: str = Form("normal"),
    denoise: float = Form(0.75),
):
    """
    Perform img2img generation
    Returns the generated image as base64
    """
    global pipeline
    
    logger.info("=" * 50)
    logger.info("📥 Received img2img request")
    logger.info(f"  Prompt: {positive_prompt[:50]}...")
    logger.info(f"  Negative: {negative_prompt[:30]}..." if negative_prompt else "  Negative: (none)")
    logger.info(f"  Steps: {steps}, CFG: {cfg}, Denoise: {denoise}")
    logger.info(f"  Sampler: {sampler_name}, Scheduler: {scheduler}")
    logger.info(f"  Seed: {seed}")
    
    if not model_loaded or pipeline is None:
        logger.error("❌ Model not loaded!")
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    # Validate parameter combination - ensure at least 1 effective inference step
    effective_steps = int(steps * denoise)
    if effective_steps < 1:
        error_msg = f"Invalid parameter combination: steps={steps} × denoise={denoise} = {effective_steps} effective steps. Need at least 1. Try increasing steps (≥10) or denoise (≥0.1)."
        logger.error(f"❌ {error_msg}")
        raise HTTPException(status_code=400, detail=error_msg)
    
    try:
        logger.info("📷 Reading input image bytes...")
        image_bytes = await image.read()

        # Phase_1: enqueue a job and await completion (keeps endpoint behavior stable)
        rec = await JOB_STORE.create(
            "img2img",
            {
                "image_bytes": image_bytes,
                # Legacy non-stream endpoint doesn't need step progress; avoid callback overhead.
                "emit_progress": False,
                "params": {
                    "positive_prompt": positive_prompt,
                    "negative_prompt": negative_prompt,
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": sampler_name,
                    "scheduler": scheduler,
                    "denoise": denoise,
                },
            },
        )
        try:
            await JOB_QUEUE.enqueue(rec.job_id, "img2img")
        except Exception:
            await JOB_STORE.fail(rec.job_id, "Queue is full. Try again shortly.")
            raise HTTPException(status_code=429, detail="Queue is full. Try again shortly.")

        finished = await JOB_STORE.wait(rec.job_id)
        if finished.status == "succeeded" and finished.result is not None:
            logger.info("=" * 50)
            return finished.result
        if finished.status == "failed" and finished.error is not None:
            raise HTTPException(status_code=500, detail=finished.error.message)
        if finished.status == "cancelled":
            raise HTTPException(status_code=499, detail="Cancelled")
        raise HTTPException(status_code=500, detail="Job did not complete successfully")
        
    except Exception as e:
        logger.error(f"❌ Error during inference: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/img2img/stream")
async def img2img_stream(
    image: UploadFile = File(...),
    positive_prompt: str = Form(...),
    negative_prompt: str = Form(""),
    seed: int = Form(42),
    steps: int = Form(20),
    cfg: float = Form(7.5),
    sampler_name: str = Form("euler"),
    scheduler: str = Form("normal"),
    denoise: float = Form(0.75),
):
    """
    Perform img2img generation with SSE progress streaming
    """
    global pipeline
    
    if not model_loaded or pipeline is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    # Validate parameter combination - ensure at least 1 effective inference step
    effective_steps = int(steps * denoise)
    if effective_steps < 1:
        error_msg = f"Invalid parameter combination: steps={steps} × denoise={denoise} = {effective_steps} effective steps. Need at least 1. Try increasing steps (≥10) or denoise (≥0.1)."
        raise HTTPException(status_code=400, detail=error_msg)
    
    async def generate():
        try:
            image_bytes = await image.read()
            rec = await JOB_STORE.create(
                "img2img",
                {
                    "image_bytes": image_bytes,
                    # Stream endpoint needs progress.
                    "emit_progress": True,
                    "params": {
                        "positive_prompt": positive_prompt,
                        "negative_prompt": negative_prompt,
                        "seed": seed,
                        "steps": steps,
                        "cfg": cfg,
                        "sampler_name": sampler_name,
                        "scheduler": scheduler,
                        "denoise": denoise,
                    },
                },
            )
            try:
                await JOB_QUEUE.enqueue(rec.job_id, "img2img")
            except Exception:
                await JOB_STORE.fail(rec.job_id, "Queue is full. Try again shortly.")
                yield {"event": "error", "data": json.dumps({"status": "error", "message": "Queue is full"})}
                return

            # Initial progress for legacy clients
            yield {"event": "progress", "data": json.dumps({"step": 0, "total_steps": steps, "progress": 0, "status": "starting"})}

            # Replay history then subscribe for live events (legacy event mapping)
            history = await JOB_STORE.list_events_snapshot(rec.job_id)
            q = await JOB_STORE.subscribe(rec.job_id)
            try:
                events = history
                while True:
                    if events:
                        ev = events.pop(0)
                    else:
                        ev = await q.get()

                    if ev.event == "progress":
                        cur = int(ev.data.get("current", 0))
                        tot = int(ev.data.get("total", steps))
                        pct = float(ev.data.get("percent", 0.0))
                        yield {"event": "progress", "data": json.dumps({"step": cur, "total_steps": tot, "progress": pct})}
                    elif ev.event == "completed":
                        result = (ev.data.get("result") or {})
                        yield {"event": "complete", "data": json.dumps({
                            "status": "success",
                            "image": result.get("image"),
                            "time_taken": result.get("time_taken"),
                            "width": result.get("width"),
                            "height": result.get("height"),
                        })}
                        return
                    elif ev.event == "failed":
                        msg = (ev.data.get("error") or {}).get("message", "Job failed")
                        yield {"event": "error", "data": json.dumps({"status": "error", "message": msg})}
                        return
                    elif ev.event == "cancelled":
                        yield {"event": "error", "data": json.dumps({"status": "error", "message": "Cancelled"})}
                        return
            
        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"status": "error", "message": str(e)})
            }
        finally:
            try:
                await JOB_STORE.unsubscribe(rec.job_id, q)  # type: ignore[name-defined]
            except Exception:
                pass
    
    return EventSourceResponse(generate())


@app.post("/api/img2img/base64")
async def img2img_base64(
    image_base64: str = Form(...),
    positive_prompt: str = Form(...),
    negative_prompt: str = Form(""),
    seed: int = Form(42),
    steps: int = Form(20),
    cfg: float = Form(7.5),
    sampler_name: str = Form("euler"),
    scheduler: str = Form("normal"),
    denoise: float = Form(0.75),
):
    """
    Perform img2img generation with base64 input image
    """
    global pipeline
    
    if not model_loaded or pipeline is None:
        raise HTTPException(status_code=503, detail="Model not loaded")
    
    # Validate parameter combination - ensure at least 1 effective inference step
    effective_steps = int(steps * denoise)
    if effective_steps < 1:
        error_msg = f"Invalid parameter combination: steps={steps} × denoise={denoise} = {effective_steps} effective steps. Need at least 1. Try increasing steps (≥10) or denoise (≥0.1)."
        raise HTTPException(status_code=400, detail=error_msg)
    
    try:
        # Convert base64 input to bytes for the job system (store bytes, decode in worker)
        input_image = base64_to_image(image_base64).convert("RGB")
        buf = io.BytesIO()
        input_image.save(buf, format="PNG")
        image_bytes = buf.getvalue()

        rec = await JOB_STORE.create(
            "img2img",
            {
                "image_bytes": image_bytes,
                # Legacy non-stream endpoint doesn't need step progress; avoid callback overhead.
                "emit_progress": False,
                "params": {
                    "positive_prompt": positive_prompt,
                    "negative_prompt": negative_prompt,
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": sampler_name,
                    "scheduler": scheduler,
                    "denoise": denoise,
                },
            },
        )
        try:
            await JOB_QUEUE.enqueue(rec.job_id, "img2img")
        except Exception:
            await JOB_STORE.fail(rec.job_id, "Queue is full. Try again shortly.")
            raise HTTPException(status_code=429, detail="Queue is full. Try again shortly.")

        finished = await JOB_STORE.wait(rec.job_id)
        if finished.status == "succeeded" and finished.result is not None:
            # Preserve legacy response shape (no output_path here)
            return {k: finished.result.get(k) for k in ["status", "image", "time_taken", "width", "height"]}
        if finished.status == "failed" and finished.error is not None:
            raise HTTPException(status_code=500, detail=finished.error.message)
        if finished.status == "cancelled":
            raise HTTPException(status_code=499, detail="Cancelled")
        raise HTTPException(status_code=500, detail="Job did not complete successfully")
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# TripoSR 3D Mesh Generation
# =============================================================================

class TripoSRRequest(BaseModel):
    """Request model for TripoSR 3D generation"""
    foreground_ratio: float = 0.85
    mc_resolution: int = 256
    chunk_size: int = 8192
    bake_texture: bool = False
    texture_resolution: int = 2048


def load_triposr_model(chunk_size: int = 8192):
    """Load TripoSR model from local directory using TSR system"""
    global triposr_model, triposr_loaded, current_device
    
    if triposr_loaded and triposr_model is not None:
        # Update chunk size if model already loaded
        triposr_model.renderer.set_chunk_size(chunk_size)
        return True
    
    model_dir = Path(__file__).parent.parent / "data" / "models"
    triposr_path = model_dir / "triposr-base"
    
    if not triposr_path.exists():
        logger.error(f"❌ TripoSR model not found at {triposr_path}")
        return False
    
    logger.info("=" * 60)
    logger.info("🔺 Loading TripoSR model using TSR system...")
    
    try:
        # Import TSR from local tsr module
        import sys
        backend_dir = Path(__file__).parent
        if str(backend_dir) not in sys.path:
            sys.path.insert(0, str(backend_dir))
        
        from tsr.system import TSR
        
        # Determine device
        device, torch_dtype = get_device_and_dtype()
        # TripoSR works better with float32 on MPS
        if device == "mps":
            torch_dtype = torch.float32
        
        logger.info(f"  Device: {device}, dtype: {torch_dtype}")
        
        # Load full TSR model using from_pretrained
        logger.info(f"  Loading TSR model from {triposr_path}...")
        model = TSR.from_pretrained(
            str(triposr_path),
            config_name="config.yaml",
            weight_name="model.ckpt",
        )
        
        # Configure renderer chunk size
        model.renderer.set_chunk_size(chunk_size)
        
        # Move to device
        model.to(device)
        
        triposr_model = model
        triposr_loaded = True
        current_device = device
        
        logger.info("✅ TripoSR model loaded successfully!")
        logger.info("=" * 60)
        return True
        
    except Exception as e:
        logger.error(f"❌ Failed to load TripoSR model: {e}")
        import traceback
        traceback.print_exc()
        return False


def remove_background_tsr(image: Image.Image, foreground_ratio: float = 0.85) -> Image.Image:
    """
    Remove background from image using rembg and resize foreground.
    Uses the same approach as the reference TripoSR run.py
    """
    try:
        import rembg
        
        # Import utilities from local tsr module
        import sys
        backend_dir = Path(__file__).parent
        if str(backend_dir) not in sys.path:
            sys.path.insert(0, str(backend_dir))
        
        from tsr.utils import remove_background, resize_foreground
        
        # Create rembg session
        rembg_session = rembg.new_session()
        
        # Remove background using tsr utility
        image_rgba = remove_background(image, rembg_session)
        
        # Resize foreground using tsr utility
        image_processed = resize_foreground(image_rgba, foreground_ratio)
        
        # Convert to RGB with gray background (as expected by TripoSR)
        image_np = np.array(image_processed).astype(np.float32) / 255.0
        image_rgb = image_np[:, :, :3] * image_np[:, :, 3:4] + (1 - image_np[:, :, 3:4]) * 0.5
        image_final = Image.fromarray((image_rgb * 255.0).astype(np.uint8))
        
        return image_final
        
    except ImportError as e:
        logger.warning(f"rembg not installed or tsr utils not available: {e}")
        # Fallback: simple resize
        return process_triposr_image(image)


def process_triposr_image(image: Image.Image, target_size: int = 512) -> Image.Image:
    """Process image for TripoSR: resize to square"""
    # Resize to target size maintaining aspect ratio, then center crop
    w, h = image.size
    scale = target_size / min(w, h)
    new_w, new_h = int(w * scale), int(h * scale)
    image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Center crop to square
    left = (new_w - target_size) // 2
    top = (new_h - target_size) // 2
    image = image.crop((left, top, left + target_size, top + target_size))
    
    return image


@app.get("/api/triposr/info")
async def get_triposr_info():
    """Get TripoSR model status"""
    device = "none"
    if triposr_model is not None:
        try:
            # Get device from model parameters
            device = str(next(triposr_model.parameters()).device)
        except:
            device = current_device
    return {
        "loaded": triposr_loaded,
        "device": device,
        "model_name": "TripoSR Base",
    }


@app.post("/api/triposr/load")
async def load_triposr_endpoint(chunk_size: int = 8192):
    """Explicitly load TripoSR model"""
    success = load_triposr_model(chunk_size)
    if success:
        device = str(next(triposr_model.parameters()).device)
        return {"status": "success", "device": device}
    else:
        raise HTTPException(status_code=500, detail="Failed to load TripoSR model")


@app.post("/api/triposr")
async def generate_3d_mesh(
    image: UploadFile = File(...),
    foreground_ratio: float = Form(0.85),
    mc_resolution: int = Form(256),
    remove_bg: bool = Form(True),
    chunk_size: int = Form(8192),
    bake_texture: bool = Form(False),
    texture_resolution: int = Form(2048),
    render_video: bool = Form(False),
    render_n_views: int = Form(30),
    render_resolution: int = Form(256),
):
    """
    Generate 3D mesh from single image using TripoSR.
    Returns path to generated GLB file and optional turntable video.
    
    Parameters:
    - foreground_ratio: Ratio of foreground to image (0.5-1.0)
    - mc_resolution: Marching cubes grid resolution (64-512)
    - remove_bg: Whether to auto-remove background
    - chunk_size: Evaluation chunk size for rendering (1024-16384)
    - bake_texture: Whether to bake UV texture instead of vertex colors
    - texture_resolution: Texture atlas size if baking (512-4096)
    - render_video: Whether to generate turntable MP4 video preview
    - render_n_views: Number of frames for video (30 = 1 second at 30fps)
    - render_resolution: Resolution for video frames (128-512)
    """
    logger.info("=" * 50)
    logger.info("📥 Received TripoSR request")
    logger.info(f"  Foreground ratio: {foreground_ratio}")
    logger.info(f"  MC Resolution: {mc_resolution}")
    logger.info(f"  Remove background: {remove_bg}")
    logger.info(f"  Chunk size: {chunk_size}")
    logger.info(f"  Bake texture: {bake_texture}")
    if bake_texture:
        logger.info(f"  Texture resolution: {texture_resolution}")
    logger.info(f"  Render video: {render_video}")
    if render_video:
        logger.info(f"  Video frames: {render_n_views}, resolution: {render_resolution}px")
    
    # Load model if not loaded
    if not triposr_loaded:
        logger.info("  Loading TripoSR model (first request)...")
        success = load_triposr_model(chunk_size)
        if not success:
            raise HTTPException(status_code=503, detail="TripoSR model not available")
    
    try:
        image_bytes = await image.read()

        rec = await JOB_STORE.create(
            "triposr",
            {
                "image_bytes": image_bytes,
                "params": {
                    "foreground_ratio": foreground_ratio,
                    "mc_resolution": mc_resolution,
                    "remove_bg": remove_bg,
                    "chunk_size": chunk_size,
                    "bake_texture": bake_texture,
                    "texture_resolution": texture_resolution,
                    "render_video": render_video,
                    "render_n_views": render_n_views,
                    "render_resolution": render_resolution,
                },
            },
        )
        try:
            await JOB_QUEUE.enqueue(rec.job_id, "triposr")
        except Exception:
            await JOB_STORE.fail(rec.job_id, "Queue is full. Try again shortly.")
            raise HTTPException(status_code=429, detail="Queue is full. Try again shortly.")

        finished = await JOB_STORE.wait(rec.job_id)
        if finished.status == "succeeded" and finished.result is not None:
            logger.info("=" * 50)
            return finished.result
        if finished.status == "failed" and finished.error is not None:
            raise HTTPException(status_code=500, detail=finished.error.message)
        if finished.status == "cancelled":
            raise HTTPException(status_code=499, detail="Cancelled")
        raise HTTPException(status_code=500, detail="Job did not complete successfully")
        
    except Exception as e:
        logger.error(f"❌ Error during TripoSR inference: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
