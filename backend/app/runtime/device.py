from __future__ import annotations

import torch


def get_device_and_dtype() -> tuple[str, torch.dtype]:
    """
    Determine the best device and dtype for inference.

    Important behavior to preserve from the current backend:
    - MPS runs in float32 to avoid NaN/VAE decoding issues.
    """
    if torch.cuda.is_available():
        return "cuda", torch.float16
    if torch.backends.mps.is_available():
        return "mps", torch.float32
    return "cpu", torch.float32

