from __future__ import annotations

import base64
import io
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
from PIL import Image

from ..runtime.device import get_device_and_dtype
from ..storage.artifacts import ArtifactPaths


@dataclass
class Img2ImgParams:
    positive_prompt: str
    negative_prompt: str
    seed: int
    steps: int
    cfg: float
    sampler_name: str
    scheduler: str
    denoise: float


def image_to_base64(image: Image.Image, format: str = "PNG") -> str:
    buffer = io.BytesIO()
    image.save(buffer, format=format)
    return base64.b64encode(buffer.getvalue()).decode()


def base64_to_image(base64_str: str) -> Image.Image:
    if base64_str.startswith("data:"):
        base64_str = base64_str.split(",", 1)[1]
    image_data = base64.b64decode(base64_str)
    return Image.open(io.BytesIO(image_data))


def prepare_sd_image(input_image: Image.Image, max_dimension: int = 768) -> Image.Image:
    """
    Behavior-preserving preprocessing from server.py:
    - RGB conversion
    - cap max dimension (default 768)
    - resize to multiples of 8
    """
    input_image = input_image.convert("RGB")
    width = input_image.width
    height = input_image.height

    if width > max_dimension or height > max_dimension:
        scale = max_dimension / max(width, height)
        width = int(width * scale)
        height = int(height * scale)

    width = (width // 8) * 8
    height = (height // 8) * 8

    if width != input_image.width or height != input_image.height:
        input_image = input_image.resize((width, height), Image.Resampling.LANCZOS)
    return input_image


class Img2ImgService:
    """
    Phase_0 extraction wrapper. Keeps behavior the same but isolates orchestration.
    The pipeline is still owned by the caller (server.py) in PR2; later it moves to a provider/model manager.
    """

    def __init__(self, output_dir: Path):
        self._artifacts = ArtifactPaths(output_dir)

    def run(
        self,
        *,
        pipeline: Any,
        model_loaded: bool,
        params: Img2ImgParams,
        input_image: Image.Image,
        current_device: Optional[str] = None,
        progress_callback: Optional[Any] = None,
    ) -> dict[str, Any]:
        if not model_loaded or pipeline is None:
            raise RuntimeError("Model not loaded")

        effective_steps = int(params.steps * params.denoise)
        if effective_steps < 1:
            raise ValueError(
                f"Invalid parameter combination: steps={params.steps} × denoise={params.denoise} = {effective_steps} effective steps. "
                "Need at least 1. Try increasing steps (≥10) or denoise (≥0.1)."
            )

        image = prepare_sd_image(input_image)

        # Seed
        if current_device is None:
            current_device, _dtype = get_device_and_dtype()
        generator = torch.Generator(device=current_device)
        if params.seed >= 0:
            generator = generator.manual_seed(params.seed)
        else:
            random_seed = torch.randint(0, 2**32 - 1, (1,)).item()
            generator = generator.manual_seed(random_seed)

        # Scheduler is set by caller for now (keeps mapping centralized in server.py)
        start_time = time.time()
        pipeline_kwargs: dict[str, Any] = dict(
            prompt=params.positive_prompt,
            negative_prompt=params.negative_prompt,
            image=image,
            strength=params.denoise,
            num_inference_steps=params.steps,
            guidance_scale=params.cfg,
            generator=generator,
        )
        if progress_callback is not None:
            pipeline_kwargs["callback"] = progress_callback
            pipeline_kwargs["callback_steps"] = 1

        result = pipeline(**pipeline_kwargs)
        elapsed = time.time() - start_time

        output_image = result.images[0]
        output_array = np.array(output_image)

        # Write artifact
        self._artifacts.ensure()
        output_path = self._artifacts.img2img_path(params.seed)
        output_image.save(output_path)

        return {
            "status": "success",
            "image": f"data:image/png;base64,{image_to_base64(output_image)}",
            "time_taken": elapsed,
            "width": output_image.width,
            "height": output_image.height,
            "output_path": str(output_path),
            "debug": {
                "min": int(output_array.min()) if output_array.size else 0,
                "max": int(output_array.max()) if output_array.size else 0,
                "mean": float(output_array.mean()) if output_array.size else 0.0,
            },
        }

