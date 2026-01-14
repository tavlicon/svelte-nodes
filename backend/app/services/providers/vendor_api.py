from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .base import JobEmitter, ProviderContext, VendorProvider


@dataclass(frozen=True)
class VendorApiConfig:
    """
    Placeholder for vendor API integration (e.g., Nano Banana).
    Keep this config small and environment-driven (API key, base URL, model id).
    """
    name: str
    base_url: str


class VendorApiProvider(VendorProvider):
    def __init__(self, cfg: VendorApiConfig):
        self.cfg = cfg

    async def execute(self, *, ctx: ProviderContext, payload: dict[str, Any], emitter: JobEmitter) -> dict[str, Any]:
        # Phase_1: skeleton only. Implementation depends on vendor API contract.
        raise NotImplementedError(f"Vendor provider '{self.cfg.name}' not implemented yet")

