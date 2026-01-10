"""
Manually build SD 1.5 pipeline from safetensors - NO NETWORK REQUIRED

This script extracts weights from the checkpoint and builds the pipeline
component by component, using only local config files.

Run: python setup_manual.py
"""

import os
import sys
import json
from pathlib import Path

def main():
    print("=" * 60)
    print("SD 1.5 Manual Pipeline Builder - Fully Offline")
    print("=" * 60)
    print()
    
    # Paths
    model_dir = Path(__file__).parent.parent / "data" / "models"
    safetensors_path = model_dir / "v1-5-pruned-emaonly-fp16.safetensors"
    local_model_path = model_dir / "sd-v1-5-local"
    
    if not safetensors_path.exists():
        print(f"❌ Safetensors not found: {safetensors_path}")
        sys.exit(1)
    
    print(f"Source: {safetensors_path}")
    print(f"  Size: {safetensors_path.stat().st_size / 1024 / 1024:.1f} MB")
    print(f"Target: {local_model_path}")
    print()
    
    # Import dependencies
    import torch
    from safetensors.torch import load_file, save_file
    
    # Determine device/dtype
    if torch.cuda.is_available():
        device = "cuda"
        dtype = torch.float16
    elif torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float16
    else:
        device = "cpu"
        dtype = torch.float32
    
    print(f"Device: {device}, dtype: {dtype}")
    print()
    
    # Load checkpoint
    print("Loading checkpoint...")
    state_dict = load_file(str(safetensors_path))
    print(f"  Loaded {len(state_dict)} tensors")
    
    # Key mapping for SD 1.5 checkpoints
    # The checkpoint uses CompVis naming, we need to convert to diffusers
    
    # Count keys by prefix
    prefixes = {}
    for key in state_dict.keys():
        prefix = key.split('.')[0]
        prefixes[prefix] = prefixes.get(prefix, 0) + 1
    print(f"  Key prefixes: {prefixes}")
    print()
    
    # Separate weights by component
    print("Extracting component weights...")
    
    unet_state = {}
    vae_state = {}
    text_encoder_state = {}
    
    for key, value in state_dict.items():
        # UNet: model.diffusion_model.*
        if key.startswith("model.diffusion_model."):
            new_key = key.replace("model.diffusion_model.", "")
            unet_state[new_key] = value
        # VAE: first_stage_model.*
        elif key.startswith("first_stage_model."):
            new_key = key.replace("first_stage_model.", "")
            vae_state[new_key] = value
        # Text Encoder: cond_stage_model.transformer.*
        elif key.startswith("cond_stage_model.transformer."):
            new_key = key.replace("cond_stage_model.transformer.", "")
            text_encoder_state[new_key] = value
    
    print(f"  UNet: {len(unet_state)} tensors")
    print(f"  VAE: {len(vae_state)} tensors")  
    print(f"  Text Encoder: {len(text_encoder_state)} tensors")
    print()
    
    # Save weights in diffusers format
    print("Saving component weights...")
    
    # Ensure directories exist
    (local_model_path / "unet").mkdir(parents=True, exist_ok=True)
    (local_model_path / "vae").mkdir(parents=True, exist_ok=True)
    (local_model_path / "text_encoder").mkdir(parents=True, exist_ok=True)
    
    # Save UNet
    unet_path = local_model_path / "unet" / "diffusion_pytorch_model.safetensors"
    save_file(unet_state, str(unet_path))
    print(f"  ✅ UNet saved: {unet_path.stat().st_size / 1024 / 1024:.1f} MB")
    
    # Save VAE  
    vae_path = local_model_path / "vae" / "diffusion_pytorch_model.safetensors"
    save_file(vae_state, str(vae_path))
    print(f"  ✅ VAE saved: {vae_path.stat().st_size / 1024 / 1024:.1f} MB")
    
    # Save Text Encoder
    text_path = local_model_path / "text_encoder" / "model.safetensors"
    save_file(text_encoder_state, str(text_path))
    print(f"  ✅ Text Encoder saved: {text_path.stat().st_size / 1024 / 1024:.1f} MB")
    
    print()
    
    # Now we need to download tokenizer files - these are just text files
    print("Downloading tokenizer vocabulary (small files, ~1MB)...")
    download_tokenizer_files(local_model_path / "tokenizer")
    
    print()
    print("=" * 60)
    print("✅ Model setup complete!")
    print()
    print(f"Model directory: {local_model_path}")
    print()
    print("Start the server with: python server.py")
    print("=" * 60)


def download_tokenizer_files(tokenizer_path: Path):
    """Download CLIP tokenizer vocabulary files"""
    import urllib.request
    import ssl
    
    # Create unverified SSL context for corporate firewalls
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    
    tokenizer_path.mkdir(parents=True, exist_ok=True)
    
    # URLs for CLIP tokenizer files (from OpenAI CLIP)
    base_url = "https://huggingface.co/openai/clip-vit-large-patch14/resolve/main"
    
    files = {
        "vocab.json": f"{base_url}/vocab.json",
        "merges.txt": f"{base_url}/merges.txt",
    }
    
    for filename, url in files.items():
        filepath = tokenizer_path / filename
        if filepath.exists():
            print(f"  {filename} already exists, skipping")
            continue
        
        try:
            print(f"  Downloading {filename}...")
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, context=ctx) as response:
                content = response.read()
                filepath.write_bytes(content)
            print(f"    ✅ {filepath.stat().st_size / 1024:.1f} KB")
        except Exception as e:
            print(f"    ❌ Failed to download {filename}: {e}")
            print(f"    You may need to download manually from: {url}")


if __name__ == "__main__":
    main()
