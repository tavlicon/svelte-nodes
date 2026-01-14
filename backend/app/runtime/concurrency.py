from __future__ import annotations

import asyncio
from dataclasses import dataclass


@dataclass
class ConcurrencyLimits:
    # Default to single in-flight per model to avoid GPU/MPS memory thrash.
    sd_img2img: int = 1
    triposr: int = 1


class ConcurrencyManager:
    def __init__(self, limits: ConcurrencyLimits | None = None):
        self.limits = limits or ConcurrencyLimits()
        self.sd_img2img = asyncio.Semaphore(self.limits.sd_img2img)
        self.triposr = asyncio.Semaphore(self.limits.triposr)

