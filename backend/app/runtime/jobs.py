from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Literal, Optional
import os
import json
from pathlib import Path
import torch

JobType = Literal["img2img", "triposr"]
JobStatus = Literal["queued", "running", "succeeded", "failed", "cancelled"]


@dataclass
class JobProgress:
    current: int = 0
    total: int = 0
    percent: float = 0.0
    stage: str = ""


@dataclass
class JobError:
    message: str


@dataclass
class JobRecord:
    job_id: str
    type: JobType
    status: JobStatus
    created_at: int
    started_at: Optional[int] = None
    ended_at: Optional[int] = None
    progress: JobProgress = field(default_factory=JobProgress)
    result: Optional[dict[str, Any]] = None
    error: Optional[JobError] = None

    # Payload is in-memory for local-first Phase_1 (bounded by queue limits + TTL cleanup)
    payload: dict[str, Any] = field(default_factory=dict)

    cancel_requested: bool = False
    done: asyncio.Event = field(default_factory=asyncio.Event)


@dataclass
class JobEvent:
    event: str
    data: dict[str, Any]
    ts: int = field(default_factory=lambda: int(time.time()))


class JobStore:
    def __init__(self, *, ttl_seconds: int = 60 * 60, max_events_per_job: int = 200):
        self.ttl_seconds = ttl_seconds
        self.max_events_per_job = max_events_per_job
        self._jobs: dict[str, JobRecord] = {}
        # Each subscriber gets its own queue to avoid consumers stealing events from each other.
        self._subscribers: dict[str, set[asyncio.Queue[JobEvent]]] = {}
        self._event_history: dict[str, list[JobEvent]] = {}
        self._lock = asyncio.Lock()

    async def create(self, job_type: JobType, payload: dict[str, Any]) -> JobRecord:
        async with self._lock:
            job_id = str(uuid.uuid4())
            rec = JobRecord(
                job_id=job_id,
                type=job_type,
                status="queued",
                created_at=int(time.time()),
                payload=payload,
            )
            self._jobs[job_id] = rec
            self._subscribers[job_id] = set()
            self._event_history[job_id] = []
        await self.emit(job_id, "queued", {"status": "queued"})
        return rec

    async def get(self, job_id: str) -> JobRecord:
        async with self._lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            return self._jobs[job_id]

    async def list_events_snapshot(self, job_id: str) -> list[JobEvent]:
        async with self._lock:
            return list(self._event_history.get(job_id, []))

    async def subscribe(self, job_id: str) -> asyncio.Queue[JobEvent]:
        async with self._lock:
            if job_id not in self._jobs:
                raise KeyError(job_id)
            q: asyncio.Queue[JobEvent] = asyncio.Queue()
            self._subscribers[job_id].add(q)
            return q

    async def unsubscribe(self, job_id: str, q: asyncio.Queue[JobEvent]) -> None:
        async with self._lock:
            subs = self._subscribers.get(job_id)
            if not subs:
                return
            subs.discard(q)

    async def emit(self, job_id: str, event: str, data: dict[str, Any]) -> None:
        ev = JobEvent(event=event, data=data)
        async with self._lock:
            if job_id not in self._jobs:
                return
            hist = self._event_history[job_id]
            hist.append(ev)
            if len(hist) > self.max_events_per_job:
                del hist[: len(hist) - self.max_events_per_job]
            for q in list(self._subscribers.get(job_id, set())):
                try:
                    q.put_nowait(ev)
                except asyncio.QueueFull:
                    # Unbounded queues are expected; if a queue is full, drop the event for that subscriber.
                    pass

    async def set_running(self, job_id: str) -> None:
        rec = await self.get(job_id)
        rec.status = "running"
        rec.started_at = int(time.time())
        await self.emit(job_id, "started", {"status": "running"})

    async def set_progress(self, job_id: str, *, current: int, total: int, stage: str = "") -> None:
        rec = await self.get(job_id)
        rec.progress.current = current
        rec.progress.total = total
        rec.progress.stage = stage
        rec.progress.percent = (current / total * 100.0) if total else 0.0
        await self.emit(
            job_id,
            "progress",
            {
                "current": rec.progress.current,
                "total": rec.progress.total,
                "percent": rec.progress.percent,
                "stage": rec.progress.stage,
            },
        )

    async def succeed(self, job_id: str, result: dict[str, Any]) -> None:
        rec = await self.get(job_id)
        rec.status = "succeeded"
        rec.ended_at = int(time.time())
        rec.result = result
        rec.done.set()
        await self.emit(job_id, "completed", {"status": "succeeded", "result": result})
        # region agent log
        try:
            debug_log_path = Path(os.getenv("DNA_DEBUG_LOG_PATH", str(Path(__file__).resolve().parents[3] / ".cursor" / "debug.log")))
            # Approximate retained payload bytes (only counts raw image bytes)
            img_bytes = rec.payload.get("image_bytes")
            approx_payload = len(img_bytes) if isinstance(img_bytes, (bytes, bytearray)) else 0
            # Approximate retained result bytes (notably SD base64 images can be large)
            approx_result = 0
            if isinstance(rec.result, dict):
                img_str = rec.result.get("image")
                if isinstance(img_str, str):
                    approx_result += len(img_str)
            # Totals across all retained jobs (rough, but useful for leak detection)
            total_payload = 0
            total_result = 0
            for _jid, _rec in self._jobs.items():
                _b = _rec.payload.get("image_bytes")
                if isinstance(_b, (bytes, bytearray)):
                    total_payload += len(_b)
                if isinstance(_rec.result, dict):
                    _img = _rec.result.get("image")
                    if isinstance(_img, str):
                        total_result += len(_img)
            mps_alloc = (torch.mps.current_allocated_memory() if hasattr(torch, "mps") and torch.backends.mps.is_available() else None)
            cuda_alloc = (torch.cuda.memory_allocated() if torch.cuda.is_available() else None)
            debug_log_path.open("a").write(json.dumps({
                "sessionId": "debug-session",
                "runId": "run1",
                "hypothesisId": "H4",
                "location": "backend/app/runtime/jobs.py:JobStore.succeed",
                "message": "Job succeeded",
                "data": {
                    "jobId": job_id,
                    "jobType": rec.type,
                    "approxPayloadBytes": approx_payload,
                    "approxResultBytes": approx_result,
                    "jobCount": len(self._jobs),
                    "totalPayloadBytes": total_payload,
                    "totalResultBytes": total_result,
                    "mps_allocated": mps_alloc,
                    "cuda_allocated": cuda_alloc,
                },
                "timestamp": int(time.time() * 1000)
            }) + "\n")
        except Exception:
            pass
        # endregion

    async def fail(self, job_id: str, message: str) -> None:
        rec = await self.get(job_id)
        rec.status = "failed"
        rec.ended_at = int(time.time())
        rec.error = JobError(message=message)
        rec.done.set()
        await self.emit(job_id, "failed", {"status": "failed", "error": {"message": message}})

    async def cancel(self, job_id: str) -> None:
        rec = await self.get(job_id)
        rec.cancel_requested = True
        if rec.status == "queued":
            rec.status = "cancelled"
            rec.ended_at = int(time.time())
            rec.done.set()
            await self.emit(job_id, "cancelled", {"status": "cancelled"})

    async def wait(self, job_id: str, timeout_seconds: Optional[float] = None) -> JobRecord:
        rec = await self.get(job_id)
        if timeout_seconds is None:
            await rec.done.wait()
        else:
            await asyncio.wait_for(rec.done.wait(), timeout=timeout_seconds)
        return rec

    async def cleanup_expired(self) -> int:
        now = int(time.time())
        removed = []
        async with self._lock:
            for job_id, rec in list(self._jobs.items()):
                if rec.status in ("succeeded", "failed", "cancelled") and rec.ended_at is not None:
                    if now - rec.ended_at > self.ttl_seconds:
                        removed.append(job_id)
            for job_id in removed:
                self._jobs.pop(job_id, None)
                self._subscribers.pop(job_id, None)
                self._event_history.pop(job_id, None)
        return len(removed)

