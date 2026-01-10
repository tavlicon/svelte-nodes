"""
One-time setup script to download SD 1.5 model config and cache locally.
After running this once, the backend can operate fully offline.

Run: python setup_model.py
"""

import os
import sys
from pathlib import Path

# Ensure we can import diffusers
try:
    import torch
    from diffusers import StableDiffusionImg2ImgPipeline
except ImportError:
    print("Please activate the venv first: source venv/bin/activate")
    sys.exit(1)

def main():
    print("=" * 60)
    print("SD 1.5 Model Setup - One-Time Network Download")
    print("=" * 60)
    
    model_dir = Path(__file__).parent.parent / "data" / "models"
    safetensors_path = model_dir / "v1-5-pruned-emaonly-fp16.safetensors"
    local_model_path = model_dir / "sd-v1-5-local"
    
    if not safetensors_path.exists():
        print(f"❌ Safetensors file not found at: {safetensors_path}")
        print("Please download v1-5-pruned-emaonly-fp16.safetensors to data/models/")
        sys.exit(1)
    
    print(f"Found safetensors: {safetensors_path}")
    print(f"Size: {safetensors_path.stat().st_size / 1024 / 1024:.1f} MB")
    print()
    
    if local_model_path.exists():
        print(f"Local model already exists at: {local_model_path}")
        print("Delete it and re-run if you want to re-download.")
        sys.exit(0)
    
    print("Downloading model configuration from HuggingFace...")
    print("(This requires internet, but only needs to be done once)")
    print()
    
    # Determine device
    if torch.cuda.is_available():
        device = "cuda"
        dtype = torch.float16
    elif torch.backends.mps.is_available():
        device = "mps"
        dtype = torch.float16
    else:
        device = "cpu"
        dtype = torch.float32
    
    print(f"Using device: {device}")
    
    try:
        # Load from safetensors (this downloads config from HF)
        print("Loading pipeline from safetensors file...")
        pipeline = StableDiffusionImg2ImgPipeline.from_single_file(
            str(safetensors_path),
            torch_dtype=dtype,
            use_safetensors=True,
            load_safety_checker=False,
        )
        
        # Save locally in diffusers format
        print(f"Saving to local directory: {local_model_path}")
        pipeline.save_pretrained(str(local_model_path))
        
        print()
        print("=" * 60)
        print("✅ Setup complete!")
        print(f"Model saved to: {local_model_path}")
        print()
        print("The backend will now work fully offline.")
        print("Start the server with: python server.py")
        print("=" * 60)
        
    except Exception as e:
        print(f"❌ Error: {e}")
        print()
        print("If you're getting SSL errors, try:")
        print("  pip install certifi")
        print("  export SSL_CERT_FILE=$(python -c 'import certifi; print(certifi.where())')")
        sys.exit(1)

if __name__ == "__main__":
    main()
