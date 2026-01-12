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

# Debug instrumentation configuration (do not remove until post-fix verification)
DEBUG_LOG_PATH = Path("/Users/olicon/github/generative-design-studio-2/.cursor/debug.log")

# CORS for frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
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
    if torch.cuda.is_available():
        return "cuda", torch.float16
    elif torch.backends.mps.is_available():
        # MPS works best with float32 to avoid NaN issues in VAE
        return "mps", torch.float32
    else:
        return "cpu", torch.float32


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
        DEBUG_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        DEBUG_LOG_PATH.open("a").write(json.dumps({
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

    # region agent log
    try:
        DEBUG_LOG_PATH.open("a").write(json.dumps({
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
        # Read and process input image
        logger.info("📷 Processing input image...")
        image_data = await image.read()
        input_image = Image.open(io.BytesIO(image_data)).convert("RGB")
        logger.info(f"  Input size: {input_image.width}x{input_image.height}")
        
        # Resize to target dimensions (must be divisible by 8)
        # Cap maximum dimension to prevent memory issues (SD 1.5 works best at 512-768)
        MAX_DIMENSION = 768
        
        width = input_image.width
        height = input_image.height
        
        # Scale down if too large while maintaining aspect ratio
        if width > MAX_DIMENSION or height > MAX_DIMENSION:
            scale = MAX_DIMENSION / max(width, height)
            width = int(width * scale)
            height = int(height * scale)
            logger.info(f"  Scaling down to fit {MAX_DIMENSION}px max dimension")
        
        # Make divisible by 8
        width = (width // 8) * 8
        height = (height // 8) * 8
        
        if width != input_image.width or height != input_image.height:
            input_image = input_image.resize((width, height), Image.Resampling.LANCZOS)
            logger.info(f"  Resized to: {width}x{height}")
        
        # Set up scheduler
        logger.info(f"⚙️ Setting up scheduler: {sampler_name} ({scheduler})")
        pipeline.scheduler = get_scheduler(
            sampler_name, 
            scheduler, 
            pipeline.scheduler.config
        )
        
        # Set seed for reproducibility
        generator = torch.Generator(device=current_device)
        if seed >= 0:
            generator = generator.manual_seed(seed)
            logger.info(f"  Using seed: {seed}")
        else:
            random_seed = torch.randint(0, 2**32 - 1, (1,)).item()
            generator = generator.manual_seed(random_seed)
            logger.info(f"  Using random seed: {random_seed}")
        
        # Run inference
        logger.info("🚀 Starting inference...")
        start_time = time.time()
        
        result = pipeline(
            prompt=positive_prompt,
            negative_prompt=negative_prompt,
            image=input_image,
            strength=denoise,
            num_inference_steps=steps,
            guidance_scale=cfg,
            generator=generator,
        )
        
        elapsed_time = time.time() - start_time
        logger.info(f"✅ Inference complete in {elapsed_time:.2f}s")
        
        # Get output image
        output_image = result.images[0]
        logger.info(f"  Output size: {output_image.width}x{output_image.height}")
        
        # Debug: Check if output is black
        import numpy as np
        output_array = np.array(output_image)
        logger.info(f"  Output stats: min={output_array.min()}, max={output_array.max()}, mean={output_array.mean():.2f}")
        if output_array.max() == 0:
            logger.warning("⚠️ Output image is all black! This indicates a VAE decoding issue.")
        
        # Save to output directory
        output_dir = Path(__file__).parent.parent / "data" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_filename = f"img2img_{int(time.time())}_{seed}.png"
        output_path = output_dir / output_filename
        output_image.save(output_path)
        logger.info(f"💾 Saved to: {output_path}")
        
        # Convert to base64
        output_base64 = image_to_base64(output_image)
        
        logger.info("=" * 50)
        
        return {
            "status": "success",
            "image": f"data:image/png;base64,{output_base64}",
            "time_taken": elapsed_time,
            "width": output_image.width,
            "height": output_image.height,
            "output_path": str(output_path),
        }
        
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
    
    request_id = str(uuid.uuid4())
    progress_updates[request_id] = []
    
    async def generate():
        try:
            # Read and process input image
            image_data = await image.read()
            input_image = Image.open(io.BytesIO(image_data)).convert("RGB")
            
            # Resize to target dimensions
            # Cap maximum dimension to prevent memory issues
            MAX_DIMENSION = 768
            
            width = input_image.width
            height = input_image.height
            
            # Scale down if too large while maintaining aspect ratio
            if width > MAX_DIMENSION or height > MAX_DIMENSION:
                scale = MAX_DIMENSION / max(width, height)
                width = int(width * scale)
                height = int(height * scale)
            
            # Make divisible by 8
            width = (width // 8) * 8
            height = (height // 8) * 8
            
            if width != input_image.width or height != input_image.height:
                input_image = input_image.resize((width, height), Image.Resampling.LANCZOS)
            
            # Set up scheduler
            pipeline.scheduler = get_scheduler(
                sampler_name,
                scheduler,
                pipeline.scheduler.config
            )
            
            # Set seed
            generator = torch.Generator(device=current_device)
            if seed >= 0:
                generator = generator.manual_seed(seed)
            else:
                generator = generator.manual_seed(torch.randint(0, 2**32 - 1, (1,)).item())
            
            # Progress callback
            def progress_callback(step: int, timestep: int, latents: torch.Tensor):
                progress_data = {
                    "step": step + 1,
                    "total_steps": steps,
                    "progress": (step + 1) / steps * 100,
                }
                progress_updates[request_id].append(progress_data)
            
            # Send initial progress
            yield {
                "event": "progress",
                "data": json.dumps({"step": 0, "total_steps": steps, "progress": 0, "status": "starting"})
            }
            
            start_time = time.time()
            
            # Run inference with callback
            result = pipeline(
                prompt=positive_prompt,
                negative_prompt=negative_prompt,
                image=input_image,
                strength=denoise,
                num_inference_steps=steps,
                guidance_scale=cfg,
                generator=generator,
                callback=progress_callback,
                callback_steps=1,
            )
            
            elapsed_time = time.time() - start_time
            
            # Get output image
            output_image = result.images[0]
            output_base64 = image_to_base64(output_image)
            
            # Send completion
            yield {
                "event": "complete",
                "data": json.dumps({
                    "status": "success",
                    "image": f"data:image/png;base64,{output_base64}",
                    "time_taken": elapsed_time,
                    "width": output_image.width,
                    "height": output_image.height,
                })
            }
            
        except Exception as e:
            yield {
                "event": "error",
                "data": json.dumps({"status": "error", "message": str(e)})
            }
        finally:
            # Cleanup
            if request_id in progress_updates:
                del progress_updates[request_id]
    
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
        # Decode input image from base64
        input_image = base64_to_image(image_base64).convert("RGB")
        
        # Resize to target dimensions (must be divisible by 8)
        # Cap maximum dimension to prevent memory issues
        MAX_DIMENSION = 768
        
        width = input_image.width
        height = input_image.height
        
        # Scale down if too large while maintaining aspect ratio
        if width > MAX_DIMENSION or height > MAX_DIMENSION:
            scale = MAX_DIMENSION / max(width, height)
            width = int(width * scale)
            height = int(height * scale)
        
        # Make divisible by 8
        width = (width // 8) * 8
        height = (height // 8) * 8
        
        if width != input_image.width or height != input_image.height:
            input_image = input_image.resize((width, height), Image.Resampling.LANCZOS)
        
        # Set up scheduler
        pipeline.scheduler = get_scheduler(
            sampler_name,
            scheduler,
            pipeline.scheduler.config
        )
        
        # Set seed for reproducibility
        generator = torch.Generator(device=current_device)
        if seed >= 0:
            generator = generator.manual_seed(seed)
        else:
            generator = generator.manual_seed(torch.randint(0, 2**32 - 1, (1,)).item())
        
        # Run inference
        start_time = time.time()
        
        result = pipeline(
            prompt=positive_prompt,
            negative_prompt=negative_prompt,
            image=input_image,
            strength=denoise,
            num_inference_steps=steps,
            guidance_scale=cfg,
            generator=generator,
        )
        
        elapsed_time = time.time() - start_time
        
        # Get output image
        output_image = result.images[0]
        
        # Convert to base64
        output_base64 = image_to_base64(output_image)
        
        return {
            "status": "success",
            "image": f"data:image/png;base64,{output_base64}",
            "time_taken": elapsed_time,
            "width": output_image.width,
            "height": output_image.height,
        }
        
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
    else:
        # Update chunk size
        triposr_model.renderer.set_chunk_size(chunk_size)
    
    try:
        import trimesh
        
        # Read and process input image
        logger.info("📷 Processing input image...")
        image_data = await image.read()
        input_image = Image.open(io.BytesIO(image_data)).convert("RGB")
        logger.info(f"  Input size: {input_image.width}x{input_image.height}")
        
        # Remove background if requested
        if remove_bg:
            logger.info("  Removing background...")
            input_image = remove_background_tsr(input_image, foreground_ratio)
            logger.info(f"  After background removal: {input_image.width}x{input_image.height}")
        else:
            # Just resize to proper size
            input_image = process_triposr_image(input_image, 512)
        
        logger.info(f"  Final input size: {input_image.width}x{input_image.height}")
        
        start_time = time.time()
        
        # Get device
        device = str(next(triposr_model.parameters()).device)
        
        # Run TSR model forward pass to get scene codes
        logger.info("🧠 Running TSR inference...")
        with torch.no_grad():
            scene_codes = triposr_model([input_image], device=device)
        
        logger.info(f"  Scene codes shape: {scene_codes.shape}")
        
        # Extract mesh using marching cubes
        logger.info(f"🔺 Extracting mesh at resolution {mc_resolution}...")
        with torch.no_grad():
            meshes = triposr_model.extract_mesh(
                scene_codes,
                has_vertex_color=(not bake_texture),
                resolution=mc_resolution,
            )
        
        mesh = meshes[0]
        
        # Handle texture baking if requested
        if bake_texture:
            logger.info(f"🎨 Baking texture at resolution {texture_resolution}...")
            try:
                import xatlas
                from tsr.bake_texture import bake_texture as bake_texture_fn
                
                bake_output = bake_texture_fn(mesh, triposr_model, scene_codes[0], texture_resolution)
                
                # Update mesh with UV mapping
                mesh = trimesh.Trimesh(
                    vertices=mesh.vertices[bake_output["vmapping"]],
                    faces=bake_output["indices"],
                    visual=trimesh.visual.TextureVisuals(
                        uv=bake_output["uvs"],
                    ),
                )
                logger.info("  Texture baked successfully")
            except Exception as e:
                logger.warning(f"  Texture baking failed, using vertex colors: {e}")
        
        mesh_time = time.time() - start_time
        logger.info(f"✅ Mesh generation complete in {mesh_time:.2f}s")
        logger.info(f"  Vertices: {len(mesh.vertices)}, Faces: {len(mesh.faces)}")
        
        # Save mesh as GLB
        output_dir = Path(__file__).parent.parent / "data" / "output"
        output_dir.mkdir(parents=True, exist_ok=True)
        timestamp = int(time.time())
        unique_id = uuid.uuid4().hex[:8]
        output_filename = f"mesh_{timestamp}_{unique_id}.glb"
        output_path = output_dir / output_filename
        
        # Export to GLB
        mesh.export(str(output_path), file_type="glb")
        logger.info(f"💾 Saved to: {output_path}")
        
        # Generate turntable video if requested
        video_url = None
        video_time = 0.0
        if render_video:
            logger.info(f"🎬 Rendering turntable video ({render_n_views} frames at {render_resolution}px)...")
            video_start = time.time()
            try:
                from tsr.utils import save_video
                
                # Render frames using NeRF
                with torch.no_grad():
                    render_images = triposr_model.render(
                        scene_codes,
                        n_views=render_n_views,
                        height=render_resolution,
                        width=render_resolution,
                        return_type="pil"
                    )
                
                # Save as MP4
                video_filename = f"render_{timestamp}_{unique_id}.mp4"
                video_path = output_dir / video_filename
                # Use 12fps for slower, smoother turntable animation
                save_video(render_images[0], str(video_path), fps=12)
                
                video_time = time.time() - video_start
                video_url = f"/data/output/{video_filename}"
                logger.info(f"  Video saved to: {video_path} ({video_time:.2f}s)")
            except Exception as e:
                logger.warning(f"  Video rendering failed: {e}")
                import traceback
                traceback.print_exc()
        
        # Also save a rendered preview image (fallback for no-video case)
        preview_filename = output_filename.replace(".glb", "_preview.png")
        preview_path = output_dir / preview_filename
        
        # Create a simple preview by rendering the mesh
        preview_url = None
        try:
            scene = mesh.scene()
            # Get PNG data from scene
            png_data = scene.save_image(resolution=(512, 512))
            with open(preview_path, 'wb') as f:
                f.write(png_data)
            logger.info(f"  Preview saved to: {preview_path}")
            preview_url = f"/data/output/{preview_filename}"
        except Exception as e:
            logger.warning(f"  Could not generate preview: {e}")
        
        total_time = time.time() - start_time
        logger.info(f"⏱️ Total time: {total_time:.2f}s (mesh: {mesh_time:.2f}s, video: {video_time:.2f}s)")
        logger.info("=" * 50)
        
        return {
            "status": "success",
            "mesh_path": f"/data/output/{output_filename}",
            "video_url": video_url,
            "preview_url": preview_url,
            "output_path": str(output_path),
            "time_taken": total_time,
            "mesh_time": mesh_time,
            "video_time": video_time if render_video else None,
            "vertices": len(mesh.vertices),
            "faces": len(mesh.faces),
        }
        
    except Exception as e:
        logger.error(f"❌ Error during TripoSR inference: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
