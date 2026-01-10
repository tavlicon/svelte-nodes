"""
One-time setup to download model config files (bypasses SSL verification).
After running this once, the backend works fully offline.

Run: python setup_offline.py
"""

import os
import sys
import ssl
import warnings
from pathlib import Path

# DISABLE SSL VERIFICATION - only for one-time setup
# This is needed if you're behind a corporate firewall with SSL inspection
os.environ['CURL_CA_BUNDLE'] = ''
os.environ['REQUESTS_CA_BUNDLE'] = ''

# Disable SSL warnings
warnings.filterwarnings('ignore', message='Unverified HTTPS request')

# Monkey-patch SSL context to not verify
try:
    _create_unverified_https_context = ssl._create_unverified_context
except AttributeError:
    pass
else:
    ssl._create_default_https_context = _create_unverified_https_context

# Also patch requests
import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# Patch huggingface_hub to not verify SSL
os.environ['HF_HUB_DISABLE_SSL_VERIFICATION'] = '1'


def main():
    print("=" * 60)
    print("SD 1.5 Offline Setup (SSL verification disabled)")
    print("=" * 60)
    print()
    
    # Import after SSL patches
    import torch
    from diffusers import StableDiffusionImg2ImgPipeline
    
    model_dir = Path(__file__).parent.parent / "data" / "models"
    safetensors_path = model_dir / "v1-5-pruned-emaonly-fp16.safetensors"
    local_model_path = model_dir / "sd-v1-5-local"
    
    if not safetensors_path.exists():
        print(f"❌ Safetensors not found: {safetensors_path}")
        sys.exit(1)
    
    print(f"Found safetensors: {safetensors_path}")
    print(f"Size: {safetensors_path.stat().st_size / 1024 / 1024:.1f} MB")
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
    
    print(f"Device: {device}")
    print()
    
    print("Downloading config files from HuggingFace (one-time)...")
    print("(SSL verification disabled for corporate firewall bypass)")
    print()
    
    try:
        # Patch requests session to disable SSL verify
        import requests
        old_request = requests.Session.request
        def patched_request(self, *args, **kwargs):
            kwargs['verify'] = False
            return old_request(self, *args, **kwargs)
        requests.Session.request = patched_request
        
        # Load pipeline using runwayml repo (original SD 1.5)
        # Try the original runwayml repo first
        try:
            print("Trying runwayml/stable-diffusion-v1-5...")
            pipeline = StableDiffusionImg2ImgPipeline.from_single_file(
                str(safetensors_path),
                torch_dtype=dtype,
                use_safetensors=True,
                load_safety_checker=False,
                config="runwayml/stable-diffusion-v1-5",
            )
        except Exception as e1:
            print(f"  Failed: {e1}")
            print("Trying alternative: CompVis/stable-diffusion-v1-4...")
            pipeline = StableDiffusionImg2ImgPipeline.from_single_file(
                str(safetensors_path),
                torch_dtype=dtype,
                use_safetensors=True,
                load_safety_checker=False,
                config="CompVis/stable-diffusion-v1-4",
            )
        
        print("✅ Pipeline loaded!")
        print()
        
        # Save locally
        print(f"Saving to: {local_model_path}")
        pipeline.save_pretrained(str(local_model_path))
        
        print()
        print("=" * 60)
        print("✅ Setup complete!")
        print()
        print(f"Model saved to: {local_model_path}")
        print()
        print("The backend will now work FULLY OFFLINE.")
        print("Start the server with: python server.py")
        print("=" * 60)
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
