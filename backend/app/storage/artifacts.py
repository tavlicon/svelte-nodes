from __future__ import annotations

import time
import uuid
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class ArtifactPaths:
    output_dir: Path

    def ensure(self) -> None:
        self.output_dir.mkdir(parents=True, exist_ok=True)

    def img2img_path(self, seed: int) -> Path:
        ts = int(time.time())
        filename = f"img2img_{ts}_{seed}.png"
        return self.output_dir / filename

    def mesh_path(self) -> Path:
        ts = int(time.time())
        unique_id = uuid.uuid4().hex[:8]
        filename = f"mesh_{ts}_{unique_id}.glb"
        return self.output_dir / filename

    def video_path(self, mesh_path: Path) -> Path:
        # Keep naming aligned with current server.py behavior (timestamp/id shared)
        return mesh_path.with_name(mesh_path.name.replace("mesh_", "render_")).with_suffix(".mp4")

    def preview_path(self, mesh_path: Path) -> Path:
        return mesh_path.with_suffix("").with_name(mesh_path.stem + "_preview.png")

