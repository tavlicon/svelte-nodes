"""
Convert safetensors checkpoint to diffusers format - FULLY OFFLINE
No network access required.

This script converts v1-5-pruned-emaonly-fp16.safetensors to a local diffusers
pipeline that can be loaded without any HuggingFace network calls.

Run: python convert_model.py
"""

import os
import sys
from pathlib import Path

def main():
    print("=" * 60)
    print("SD 1.5 Model Converter - Fully Offline")
    print("=" * 60)
    
    # Paths
    model_dir = Path(__file__).parent.parent / "data" / "models"
    safetensors_path = model_dir / "v1-5-pruned-emaonly-fp16.safetensors"
    local_model_path = model_dir / "sd-v1-5-local"
    
    if not safetensors_path.exists():
        print(f"❌ Safetensors file not found: {safetensors_path}")
        sys.exit(1)
    
    print(f"Source: {safetensors_path}")
    print(f"  Size: {safetensors_path.stat().st_size / 1024 / 1024:.1f} MB")
    print(f"Target: {local_model_path}")
    print()
    
    # Check if config files exist
    config_files = [
        "model_index.json",
        "scheduler/scheduler_config.json",
        "text_encoder/config.json",
        "tokenizer/tokenizer_config.json",
        "unet/config.json",
        "vae/config.json",
    ]
    
    missing_configs = []
    for cfg in config_files:
        if not (local_model_path / cfg).exists():
            missing_configs.append(cfg)
    
    if missing_configs:
        print(f"❌ Missing config files: {missing_configs}")
        print("Please create the config files first.")
        sys.exit(1)
    
    print("✅ Config files found")
    print()
    
    # Import torch and safetensors
    try:
        import torch
        from safetensors.torch import load_file, save_file
    except ImportError as e:
        print(f"❌ Missing dependencies: {e}")
        print("Run: pip install torch safetensors")
        sys.exit(1)
    
    # Load the safetensors checkpoint
    print("Loading safetensors checkpoint...")
    state_dict = load_file(str(safetensors_path))
    print(f"  Loaded {len(state_dict)} tensors")
    
    # SD 1.5 checkpoint key mappings
    # The checkpoint has keys like "model.diffusion_model.xxx" for UNet
    # and "cond_stage_model.xxx" for text encoder
    # and "first_stage_model.xxx" for VAE
    
    # Separate the state dict into components
    unet_state_dict = {}
    vae_state_dict = {}
    text_encoder_state_dict = {}
    
    print("Separating weights by component...")
    
    for key, value in state_dict.items():
        if key.startswith("model.diffusion_model."):
            # UNet weights
            new_key = key.replace("model.diffusion_model.", "")
            unet_state_dict[new_key] = value
        elif key.startswith("cond_stage_model.transformer."):
            # Text encoder weights (CLIP)
            new_key = key.replace("cond_stage_model.transformer.", "")
            text_encoder_state_dict[new_key] = value
        elif key.startswith("first_stage_model."):
            # VAE weights
            new_key = key.replace("first_stage_model.", "")
            vae_state_dict[new_key] = value
    
    print(f"  UNet: {len(unet_state_dict)} tensors")
    print(f"  VAE: {len(vae_state_dict)} tensors")
    print(f"  Text Encoder: {len(text_encoder_state_dict)} tensors")
    
    # Save each component
    print()
    print("Saving components...")
    
    # Save UNet
    unet_path = local_model_path / "unet" / "diffusion_pytorch_model.safetensors"
    print(f"  Saving UNet to {unet_path}...")
    save_file(unet_state_dict, str(unet_path))
    
    # Save VAE
    vae_path = local_model_path / "vae" / "diffusion_pytorch_model.safetensors"
    print(f"  Saving VAE to {vae_path}...")
    save_file(vae_state_dict, str(vae_path))
    
    # Save Text Encoder
    text_encoder_path = local_model_path / "text_encoder" / "model.safetensors"
    print(f"  Saving Text Encoder to {text_encoder_path}...")
    save_file(text_encoder_state_dict, str(text_encoder_path))
    
    print()
    print("=" * 60)
    print("✅ Conversion complete!")
    print()
    print("The model can now be loaded fully offline with:")
    print("  pipeline = StableDiffusionImg2ImgPipeline.from_pretrained(")
    print(f"      '{local_model_path}',")
    print("      local_files_only=True")
    print("  )")
    print()
    print("Start the server with: python server.py")
    print("=" * 60)

if __name__ == "__main__":
    main()
