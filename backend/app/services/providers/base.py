from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass
class ProviderContext:
    """
    Generic context passed to providers.
    Keep this small; add fields as needed (e.g. auth, client_id, request metadata).
    """
    client_id: str = "anonymous"


class JobEmitter(Protocol):
    async def queued(self) -> None: ...
    async def started(self) -> None: ...
    async def progress(self, *, current: int, total: int, stage: str = "") -> None: ...


class Img2ImgProvider(Protocol):
    async def execute(self, *, ctx: ProviderContext, payload: dict[str, Any], emitter: JobEmitter) -> dict[str, Any]: ...


class TripoSRProvider(Protocol):
    async def execute(self, *, ctx: ProviderContext, payload: dict[str, Any], emitter: JobEmitter) -> dict[str, Any]: ...


class VendorProvider(Protocol):
    """
    Placeholder for future vendor API integrations (e.g. Nano Banana).
    """
    async def execute(self, *, ctx: ProviderContext, payload: dict[str, Any], emitter: JobEmitter) -> dict[str, Any]: ...

