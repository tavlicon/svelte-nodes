from __future__ import annotations

from typing import Any, Awaitable, Callable, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..runtime.events import sse_response
from ..runtime.jobs import JobRecord, JobStore, JobType
from ..runtime.queue import JobQueueManager


def _public_job(rec: JobRecord) -> dict[str, Any]:
    return {
        "job_id": rec.job_id,
        "type": rec.type,
        "status": rec.status,
        "created_at": rec.created_at,
        "started_at": rec.started_at,
        "ended_at": rec.ended_at,
        "progress": {
            "current": rec.progress.current,
            "total": rec.progress.total,
            "percent": rec.progress.percent,
            "stage": rec.progress.stage,
        },
        "result": rec.result,
        "error": {"message": rec.error.message} if rec.error else None,
    }


def create_jobs_router(
    *,
    store: JobStore,
    queue: JobQueueManager,
    ensure_sd_loaded: Optional[Callable[[], Awaitable[None]]] = None,
    ensure_triposr_loaded: Optional[Callable[[int], Awaitable[None]]] = None,
) -> APIRouter:
    router = APIRouter(prefix="/api/jobs", tags=["jobs"])

    # -------------------------------------------------------------------------
    # Create jobs (multipart to match existing endpoints)
    # -------------------------------------------------------------------------
    @router.post("/img2img")
    async def create_img2img_job(
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
        if ensure_sd_loaded is not None:
            await ensure_sd_loaded()

        effective_steps = int(steps * denoise)
        if effective_steps < 1:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid parameter combination: steps={steps} × denoise={denoise} = {effective_steps} effective steps. "
                    "Need at least 1. Try increasing steps (≥10) or denoise (≥0.1)."
                ),
            )

        image_bytes = await image.read()
        payload = {
            "image_bytes": image_bytes,
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
        }

        rec = await store.create("img2img", payload)
        try:
            await queue.enqueue(rec.job_id, "img2img")
        except Exception:
            # Queue is full (or not started yet)
            await store.fail(rec.job_id, "Queue is full. Try again shortly.")
            raise HTTPException(status_code=429, detail="Queue is full. Try again shortly.")
        return {"job_id": rec.job_id, "status": rec.status}

    @router.post("/triposr")
    async def create_triposr_job(
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
        if ensure_triposr_loaded is not None:
            await ensure_triposr_loaded(chunk_size)

        image_bytes = await image.read()
        payload = {
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
        }
        rec = await store.create("triposr", payload)
        try:
            await queue.enqueue(rec.job_id, "triposr")
        except Exception:
            await store.fail(rec.job_id, "Queue is full. Try again shortly.")
            raise HTTPException(status_code=429, detail="Queue is full. Try again shortly.")
        return {"job_id": rec.job_id, "status": rec.status}

    # -------------------------------------------------------------------------
    # Status/events/cancel
    # -------------------------------------------------------------------------
    @router.get("/{job_id}")
    async def get_job(job_id: str):
        try:
            rec = await store.get(job_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Job not found")
        return _public_job(rec)

    @router.get("/{job_id}/events")
    async def job_events(job_id: str):
        try:
            await store.get(job_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Job not found")
        return sse_response(store, job_id)

    @router.post("/{job_id}/cancel")
    async def cancel_job(job_id: str):
        try:
            await store.cancel(job_id)
            rec = await store.get(job_id)
        except KeyError:
            raise HTTPException(status_code=404, detail="Job not found")
        return {"job_id": job_id, "status": rec.status}

    return router

