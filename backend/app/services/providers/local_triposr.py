from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from ..triposr_service import TripoSRParams, TripoSRService
from ...runtime.concurrency import ConcurrencyManager
from .base import JobEmitter, ProviderContext, TripoSRProvider


@dataclass(frozen=True)
class TripoSRProviderDeps:
    get_model: Callable[[], Any]
    is_loaded: Callable[[], bool]
    concurrency: ConcurrencyManager
    output_dir: Path


class LocalTripoSRProvider(TripoSRProvider):
    def __init__(self, deps: TripoSRProviderDeps):
        self.deps = deps
        self.svc = TripoSRService(output_dir=self.deps.output_dir)

    async def execute(self, *, ctx: ProviderContext, payload: dict, emitter: JobEmitter) -> dict:
        model = self.deps.get_model()
        if not self.deps.is_loaded() or model is None:
            raise RuntimeError("TripoSR model not available")

        image_bytes: bytes = payload["image_bytes"]
        params_dict: dict = payload["params"]
        params = TripoSRParams(**params_dict)

        # Coarse staged progress (TripoSR is not step-based like SD)
        await emitter.progress(current=1, total=4, stage="preprocess")

        async with self.deps.concurrency.triposr:
            await emitter.progress(current=2, total=4, stage="inference")

            # Heavy work already runs via asyncio.to_thread inside TripoSRService.run()
            await emitter.started()
            result = await self.svc.run(
                triposr_model=model,
                triposr_loaded=True,
                params=params,
                image_bytes=image_bytes,
            )

        await emitter.progress(current=4, total=4, stage="done")
        return result

