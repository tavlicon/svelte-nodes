from __future__ import annotations

import io
import asyncio
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Optional

import numpy as np
import torch
from PIL import Image

from ..storage.artifacts import ArtifactPaths


@dataclass
class TripoSRParams:
    foreground_ratio: float
    mc_resolution: int
    remove_bg: bool
    chunk_size: int
    bake_texture: bool
    texture_resolution: int
    render_video: bool
    render_n_views: int
    render_resolution: int


def process_triposr_image(image: Image.Image, target_size: int = 512) -> Image.Image:
    """Behavior-preserving fallback: resize to square by scaling then center-crop."""
    w, h = image.size
    scale = target_size / min(w, h)
    new_w, new_h = int(w * scale), int(h * scale)
    image = image.resize((new_w, new_h), Image.Resampling.LANCZOS)

    left = (new_w - target_size) // 2
    top = (new_h - target_size) // 2
    return image.crop((left, top, left + target_size, top + target_size))


def remove_background_tsr(image: Image.Image, foreground_ratio: float = 0.85) -> Image.Image:
    """
    Remove background using rembg + TSR utils (same approach as server.py).
    Falls back to simple resize if deps are unavailable.
    """
    try:
        import rembg
        from tsr.utils import remove_background, resize_foreground

        rembg_session = rembg.new_session()
        image_rgba = remove_background(image, rembg_session)
        image_processed = resize_foreground(image_rgba, foreground_ratio)

        # Convert to RGB with gray background (as expected by TripoSR)
        image_np = np.array(image_processed).astype(np.float32) / 255.0
        image_rgb = image_np[:, :, :3] * image_np[:, :, 3:4] + (1 - image_np[:, :, 3:4]) * 0.5
        return Image.fromarray((image_rgb * 255.0).astype(np.uint8))
    except Exception:
        return process_triposr_image(image, 512)


class TripoSRService:
    def __init__(self, output_dir: Path):
        self._artifacts = ArtifactPaths(output_dir)

    def run_sync(
        self,
        *,
        triposr_model: Any,
        triposr_loaded: bool,
        params: TripoSRParams,
        image_bytes: bytes,
    ) -> dict[str, Any]:

        if not triposr_loaded or triposr_model is None:
            raise RuntimeError("TripoSR model not available")

        # Keep behavior: update chunk size for each request
        try:
            triposr_model.renderer.set_chunk_size(params.chunk_size)
        except Exception:
            pass

        import trimesh
        from tsr.utils import save_video

        input_image = Image.open(io.BytesIO(image_bytes)).convert("RGB")

        # Preprocess
        if params.remove_bg:
            input_image = remove_background_tsr(input_image, params.foreground_ratio)
        else:
            input_image = process_triposr_image(input_image, 512)

        start_time = time.time()

        # Device
        try:
            device = str(next(triposr_model.parameters()).device)
        except Exception:
            device = "cpu"

        # Inference
        with torch.no_grad():
            scene_codes = triposr_model([input_image], device=device)


        mesh_start = time.time()
        with torch.no_grad():
            meshes = triposr_model.extract_mesh(
                scene_codes,
                has_vertex_color=(not params.bake_texture),
                resolution=params.mc_resolution,
            )
        mesh = meshes[0]

        # Orientation correction (preserve current server.py behavior)
        rotation_z = trimesh.transformations.rotation_matrix(
            np.radians(90), [0, 0, 1], point=[0, 0, 0]
        )
        mesh.apply_transform(rotation_z)

        rotation_y = trimesh.transformations.rotation_matrix(
            np.radians(180), [0, 1, 0], point=[0, 0, 0]
        )
        mesh.apply_transform(rotation_y)

        # Optional texture baking
        if params.bake_texture:
            try:
                from tsr.bake_texture import bake_texture as bake_texture_fn

                bake_output = bake_texture_fn(
                    mesh, triposr_model, scene_codes[0], params.texture_resolution
                )
                mesh = trimesh.Trimesh(
                    vertices=mesh.vertices[bake_output["vmapping"]],
                    faces=bake_output["indices"],
                    visual=trimesh.visual.TextureVisuals(
                        uv=bake_output["uvs"],
                    ),
                )
            except Exception:
                # Keep behavior: fallback silently to vertex colors
                pass

        mesh_time = time.time() - mesh_start

        # Save mesh
        self._artifacts.ensure()
        output_path = self._artifacts.mesh_path()
        mesh.export(str(output_path), file_type="glb")

        # region agent log
        try:
            debug_log_path.open("a").write(json.dumps({
                "sessionId": "debug-session",
                "runId": "run1",
                "hypothesisId": "H2",
                "location": "backend/app/services/triposr_service.py:TripoSRService.run_sync",
                "message": "TripoSR after mesh export",
                "data": {
                    "outputPath": str(output_path),
                    "vertices": len(mesh.vertices),
                    "faces": len(mesh.faces),
                    "ru_maxrss": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
                    "mps_allocated": (torch.mps.current_allocated_memory() if hasattr(torch, "mps") and torch.backends.mps.is_available() else None),
                    "cuda_allocated": (torch.cuda.memory_allocated() if torch.cuda.is_available() else None),
                },
                "timestamp": int(time.time() * 1000)
            }) + "\n")
        except Exception:
            pass
        # endregion

        # Optional video
        video_url: Optional[str] = None
        video_time: float = 0.0
        if params.render_video:
            video_start = time.time()
            try:
                with torch.no_grad():
                    render_images = triposr_model.render(
                        scene_codes,
                        n_views=params.render_n_views,
                        height=params.render_resolution,
                        width=params.render_resolution,
                        return_type="pil",
                    )
                video_path = self._artifacts.video_path(output_path)
                save_video(render_images[0], str(video_path), fps=12)
                video_time = time.time() - video_start
                video_url = f"/data/output/{video_path.name}"
            except Exception:
                video_url = None

        # Preview PNG
        preview_url: Optional[str] = None
        try:
            preview_path = self._artifacts.preview_path(output_path)
            scene = mesh.scene()
            png_data = scene.save_image(resolution=(512, 512))
            preview_path.write_bytes(png_data)
            preview_url = f"/data/output/{preview_path.name}"
        except Exception:
            preview_url = None

        total_time = time.time() - start_time
        return {
            "status": "success",
            "mesh_path": f"/data/output/{output_path.name}",
            "video_url": video_url,
            "preview_url": preview_url,
            "output_path": str(output_path),
            "time_taken": total_time,
            "mesh_time": mesh_time,
            "video_time": video_time if params.render_video else None,
            "vertices": len(mesh.vertices),
            "faces": len(mesh.faces),
        }

    async def run(
        self,
        *,
        triposr_model: Any,
        triposr_loaded: bool,
        params: TripoSRParams,
        image_bytes: bytes,
    ) -> dict[str, Any]:
        # Run heavy inference work off the event loop
        return await asyncio.to_thread(
            self.run_sync,
            triposr_model=triposr_model,
            triposr_loaded=triposr_loaded,
            params=params,
            image_bytes=image_bytes,
        )
