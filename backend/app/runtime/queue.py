from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Awaitable, Callable, Optional

from .jobs import JobStore, JobType


@dataclass(frozen=True)
class QueueLimits:
    max_sd_queued: int = 10
    max_triposr_queued: int = 10


class JobQueueManager:
    """
    Local-first in-process queue with 2 lanes (SD and TripoSR).
    Heavy work is executed via asyncio.to_thread to avoid blocking the event loop.
    """

    def __init__(
        self,
        *,
        store: JobStore,
        execute_img2img: Callable[[str], Awaitable[None]],
        execute_triposr: Callable[[str], Awaitable[None]],
        limits: Optional[QueueLimits] = None,
    ):
        self.store = store
        self.limits = limits or QueueLimits()
        self._sd_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=self.limits.max_sd_queued)
        self._triposr_queue: asyncio.Queue[str] = asyncio.Queue(maxsize=self.limits.max_triposr_queued)

        self._execute_img2img = execute_img2img
        self._execute_triposr = execute_triposr

        self._tasks: list[asyncio.Task] = []

    def start(self) -> None:
        # 1 worker per lane (keeps your current backpressure semantics)
        self._tasks.append(asyncio.create_task(self._sd_worker_loop(), name="sd-worker"))
        self._tasks.append(asyncio.create_task(self._triposr_worker_loop(), name="triposr-worker"))

    async def enqueue(self, job_id: str, job_type: JobType) -> None:
        if job_type == "img2img":
            await self._sd_queue.put(job_id)
        elif job_type == "triposr":
            await self._triposr_queue.put(job_id)
        else:
            raise ValueError(f"Unknown job type: {job_type}")

    async def _sd_worker_loop(self) -> None:
        while True:
            job_id = await self._sd_queue.get()
            try:
                await self._execute_img2img(job_id)
            finally:
                self._sd_queue.task_done()

    async def _triposr_worker_loop(self) -> None:
        while True:
            job_id = await self._triposr_queue.get()
            try:
                await self._execute_triposr(job_id)
            finally:
                self._triposr_queue.task_done()

