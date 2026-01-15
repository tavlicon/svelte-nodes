from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class BackendSettings:
    repo_root: Path
    data_dir: Path
    output_dir: Path
    cors_allow_origins: list[str]
    debug_log_path: Path


def _parse_origins(raw: str) -> list[str]:
    """
    Accepts either:
    - JSON array: '["http://localhost:5173", "http://127.0.0.1:5173"]'
    - Comma-separated: 'http://localhost:5173,http://127.0.0.1:5173'
    """
    raw = raw.strip()
    if not raw:
        return []
    if raw.startswith("["):
        return [str(x) for x in json.loads(raw)]
    return [x.strip() for x in raw.split(",") if x.strip()]


def load_settings() -> BackendSettings:
    # backend/app/config.py -> repo_root
    repo_root = Path(__file__).resolve().parents[2]

    data_dir = Path(os.getenv("DNA_DATA_DIR", str(repo_root / "data"))).resolve()
    output_dir = Path(os.getenv("DNA_OUTPUT_DIR", str(data_dir / "output"))).resolve()

    origins_raw = os.getenv("DNA_CORS_ALLOW_ORIGINS", "")
    cors_allow_origins = (
        _parse_origins(origins_raw)
        if origins_raw
        else ["http://localhost:5173", "http://127.0.0.1:5173"]
    )

    debug_log_path = Path(
        os.getenv("DNA_DEBUG_LOG_PATH", str(repo_root / ".cursor" / "debug.log"))
    ).resolve()

    return BackendSettings(
        repo_root=repo_root,
        data_dir=data_dir,
        output_dir=output_dir,
        cors_allow_origins=cors_allow_origins,
        debug_log_path=debug_log_path,
    )

