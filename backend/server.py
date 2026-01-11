"""
Stable Diffusion 1.5 img2img Backend Server
Provides REST API for image-to-image generation with KSampler parameters
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
from PIL import Image
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
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


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
