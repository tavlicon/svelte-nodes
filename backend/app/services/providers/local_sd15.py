from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

import torch

from ..img2img_service import Img2ImgParams, Img2ImgService
from ...runtime.concurrency import ConcurrencyManager
from .base import Img2ImgProvider, JobEmitter, ProviderContext


@dataclass(frozen=True)
class SD15ProviderDeps:
    get_pipeline: Callable[[], Any]
    is_loaded: Callable[[], bool]
    get_current_device: Callable[[], str]
    set_scheduler: Callable[[Any, str, str], None]
    concurrency: ConcurrencyManager
    output_dir: Path


class LocalSD15Provider(Img2ImgProvider):
    def __init__(self, deps: SD15ProviderDeps):
        self.deps = deps
        self.svc = Img2ImgService(output_dir=self.deps.output_dir)

    async def execute(self, *, ctx: ProviderContext, payload: dict, emitter: JobEmitter) -> dict:
        # payload expects:
        # - image_bytes: bytes
        # - params: Img2ImgParams fields
        pipeline = self.deps.get_pipeline()
        if not self.deps.is_loaded() or pipeline is None:
            raise RuntimeError("Model not loaded")

        image_bytes: bytes = payload["image_bytes"]
        params_dict: dict = payload["params"]

        # Ensure consistent backpressure with existing semaphores
        async with self.deps.concurrency.sd_img2img:
            # scheduler mutation must be guarded too (shared pipeline)
            self.deps.set_scheduler(pipeline, params_dict["sampler_name"], params_dict["scheduler"])

            # progress callback hooks
            total_steps = int(params_dict["steps"])
            loop = asyncio.get_running_loop()

            def progress_callback(step: int, timestep: int, latents: torch.Tensor):
                # step is 0-indexed in diffusers callback
                loop.call_soon_threadsafe(
                    lambda: asyncio.create_task(
                        emitter.progress(current=step + 1, total=total_steps, stage="denoise")
                    )
                )

            # Run in a thread to avoid blocking the event loop
            def _run_sync() -> dict:
                from PIL import Image
                import io

                input_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
                return self.svc.run(
                    pipeline=pipeline,
                    model_loaded=True,
                    params=Img2ImgParams(**params_dict),
                    input_image=input_image,
                    current_device=self.deps.get_current_device(),
                    progress_callback=progress_callback,
                )

            await emitter.started()
            result = await asyncio.to_thread(_run_sync)
            return {k: result[k] for k in ["status", "image", "time_taken", "width", "height", "output_path"]}

