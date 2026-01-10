"""
Convert SD 1.5 CompVis checkpoint weights to Diffusers format.
This handles the key name mapping between formats.
"""

import os
import sys
import re
from pathlib import Path
import torch
from safetensors.torch import load_file, save_file

def convert_unet_keys(state_dict):
    """Convert CompVis UNet keys to Diffusers format"""
    new_state_dict = {}
    
    # Key mapping patterns for UNet
    # CompVis format -> Diffusers format
    patterns = [
        # Input blocks
        (r'input_blocks\.(\d+)\.0\.', lambda m: f'down_blocks.{int(m.group(1))//3}.resnets.{int(m.group(1))%3}.'),
        (r'input_blocks\.(\d+)\.1\.', lambda m: f'down_blocks.{int(m.group(1))//3}.attentions.{int(m.group(1))%3}.'),
        
        # Output blocks
        (r'output_blocks\.(\d+)\.0\.', lambda m: f'up_blocks.{int(m.group(1))//3}.resnets.{int(m.group(1))%3}.'),
        (r'output_blocks\.(\d+)\.1\.', lambda m: f'up_blocks.{int(m.group(1))//3}.attentions.{int(m.group(1))%3}.'),
        (r'output_blocks\.(\d+)\.2\.', lambda m: f'up_blocks.{int(m.group(1))//3}.upsamplers.0.'),
        
        # Middle block
        (r'middle_block\.0\.', 'mid_block.resnets.0.'),
        (r'middle_block\.1\.', 'mid_block.attentions.0.'),
        (r'middle_block\.2\.', 'mid_block.resnets.1.'),
        
        # Downsampler
        (r'input_blocks\.(\d+)\.0\.op\.', lambda m: f'down_blocks.{int(m.group(1))//3 - 1}.downsamplers.0.conv.'),
        
        # Time embedding
        (r'time_embed\.', 'time_embedding.linear_'),
        
        # Layer normalization
        (r'in_layers\.0\.', 'norm1.'),
        (r'in_layers\.2\.', 'conv1.'),
        (r'out_layers\.0\.', 'norm2.'),
        (r'out_layers\.3\.', 'conv2.'),
        (r'emb_layers\.1\.', 'time_emb_proj.'),
        (r'skip_connection\.', 'conv_shortcut.'),
        
        # Transformer blocks
        (r'transformer_blocks\.(\d+)\.attn1\.', r'transformer_blocks.\1.attn1.'),
        (r'transformer_blocks\.(\d+)\.attn2\.', r'transformer_blocks.\1.attn2.'),
        (r'transformer_blocks\.(\d+)\.ff\.net\.0\.proj', r'transformer_blocks.\1.ff.net.0.proj'),
        (r'transformer_blocks\.(\d+)\.ff\.net\.2', r'transformer_blocks.\1.ff.net.2'),
        (r'transformer_blocks\.(\d+)\.norm1', r'transformer_blocks.\1.norm1'),
        (r'transformer_blocks\.(\d+)\.norm2', r'transformer_blocks.\1.norm2'),
        (r'transformer_blocks\.(\d+)\.norm3', r'transformer_blocks.\1.norm3'),
        
        # Attention
        (r'\.to_q\.', '.to_q.'),
        (r'\.to_k\.', '.to_k.'),
        (r'\.to_v\.', '.to_v.'),
        (r'\.to_out\.0\.', '.to_out.0.'),
        
        # Proj in/out
        (r'proj_in\.', 'proj_in.'),
        (r'proj_out\.', 'proj_out.'),
        (r'norm\.', 'norm.'),
        
        # Conv in/out
        (r'^out\.0\.', 'conv_norm_out.'),
        (r'^out\.2\.', 'conv_out.'),
    ]
    
    for old_key, value in state_dict.items():
        new_key = old_key
        
        # Apply patterns
        for pattern, replacement in patterns:
            if callable(replacement):
                new_key = re.sub(pattern, replacement, new_key)
            else:
                new_key = re.sub(pattern, replacement, new_key)
        
        new_state_dict[new_key] = value
    
    return new_state_dict


def convert_vae_keys(state_dict):
    """Convert CompVis VAE keys to Diffusers format"""
    new_state_dict = {}
    
    for old_key, value in state_dict.items():
        new_key = old_key
        
        # Encoder
        new_key = re.sub(r'encoder\.down\.(\d+)\.block\.(\d+)\.', r'encoder.down_blocks.\1.resnets.\2.', new_key)
        new_key = re.sub(r'encoder\.down\.(\d+)\.downsample\.conv\.', r'encoder.down_blocks.\1.downsamplers.0.conv.', new_key)
        new_key = re.sub(r'encoder\.mid\.block_1\.', 'encoder.mid_block.resnets.0.', new_key)
        new_key = re.sub(r'encoder\.mid\.block_2\.', 'encoder.mid_block.resnets.1.', new_key)
        new_key = re.sub(r'encoder\.mid\.attn_1\.', 'encoder.mid_block.attentions.0.', new_key)
        new_key = re.sub(r'encoder\.norm_out\.', 'encoder.conv_norm_out.', new_key)
        
        # Decoder
        new_key = re.sub(r'decoder\.up\.(\d+)\.block\.(\d+)\.', r'decoder.up_blocks.\1.resnets.\2.', new_key)
        new_key = re.sub(r'decoder\.up\.(\d+)\.upsample\.conv\.', r'decoder.up_blocks.\1.upsamplers.0.conv.', new_key)
        new_key = re.sub(r'decoder\.mid\.block_1\.', 'decoder.mid_block.resnets.0.', new_key)
        new_key = re.sub(r'decoder\.mid\.block_2\.', 'decoder.mid_block.resnets.1.', new_key)
        new_key = re.sub(r'decoder\.mid\.attn_1\.', 'decoder.mid_block.attentions.0.', new_key)
        new_key = re.sub(r'decoder\.norm_out\.', 'decoder.conv_norm_out.', new_key)
        
        # Common layer renames
        new_key = re.sub(r'\.nin_shortcut\.', '.conv_shortcut.', new_key)
        new_key = re.sub(r'\.norm\.', '.group_norm.', new_key)
        new_key = re.sub(r'\.q\.', '.to_q.', new_key)
        new_key = re.sub(r'\.k\.', '.to_k.', new_key)
        new_key = re.sub(r'\.v\.', '.to_v.', new_key)
        new_key = re.sub(r'\.proj_out\.', '.to_out.0.', new_key)
        
        # Conv layers
        new_key = re.sub(r'\.conv1\.', '.conv1.', new_key)
        new_key = re.sub(r'\.conv2\.', '.conv2.', new_key)
        new_key = re.sub(r'\.norm1\.', '.norm1.', new_key)
        new_key = re.sub(r'\.norm2\.', '.norm2.', new_key)
        
        new_state_dict[new_key] = value
    
    return new_state_dict


def convert_text_encoder_keys(state_dict):
    """Convert CompVis text encoder keys to Diffusers/Transformers format"""
    new_state_dict = {}
    
    for old_key, value in state_dict.items():
        new_key = old_key
        
        # Remove 'text_model.' prefix if needed, or add it
        if not new_key.startswith('text_model.'):
            new_key = 'text_model.' + new_key
        
        new_state_dict[new_key] = value
    
    return new_state_dict


def main():
    print("=" * 60)
    print("SD 1.5 Weight Converter - CompVis to Diffusers")
    print("=" * 60)
    
    model_dir = Path(__file__).parent.parent / "data" / "models"
    safetensors_path = model_dir / "v1-5-pruned-emaonly-fp16.safetensors"
    local_model_path = model_dir / "sd-v1-5-local"
    
    if not safetensors_path.exists():
        print(f"❌ Safetensors not found: {safetensors_path}")
        sys.exit(1)
    
    print(f"Loading: {safetensors_path}")
    state_dict = load_file(str(safetensors_path))
    print(f"Loaded {len(state_dict)} tensors")
    
    # Separate by component
    unet_state = {}
    vae_state = {}
    text_encoder_state = {}
    
    for key, value in state_dict.items():
        if key.startswith("model.diffusion_model."):
            new_key = key.replace("model.diffusion_model.", "")
            unet_state[new_key] = value
        elif key.startswith("first_stage_model."):
            new_key = key.replace("first_stage_model.", "")
            vae_state[new_key] = value
        elif key.startswith("cond_stage_model.transformer."):
            new_key = key.replace("cond_stage_model.transformer.", "")
            text_encoder_state[new_key] = value
    
    print(f"\nExtracted:")
    print(f"  UNet: {len(unet_state)} tensors")
    print(f"  VAE: {len(vae_state)} tensors")
    print(f"  Text Encoder: {len(text_encoder_state)} tensors")
    
    # Convert keys
    print("\nConverting key names...")
    unet_converted = convert_unet_keys(unet_state)
    vae_converted = convert_vae_keys(vae_state)
    text_encoder_converted = convert_text_encoder_keys(text_encoder_state)
    
    # Save
    print("\nSaving converted weights...")
    
    unet_path = local_model_path / "unet" / "diffusion_pytorch_model.safetensors"
    save_file(unet_converted, str(unet_path))
    print(f"  ✅ UNet: {unet_path.stat().st_size / 1024 / 1024:.1f} MB")
    
    vae_path = local_model_path / "vae" / "diffusion_pytorch_model.safetensors"
    save_file(vae_converted, str(vae_path))
    print(f"  ✅ VAE: {vae_path.stat().st_size / 1024 / 1024:.1f} MB")
    
    text_path = local_model_path / "text_encoder" / "model.safetensors"
    save_file(text_encoder_converted, str(text_path))
    print(f"  ✅ Text Encoder: {text_path.stat().st_size / 1024 / 1024:.1f} MB")
    
    print("\n" + "=" * 60)
    print("✅ Conversion complete!")
    print("=" * 60)


if __name__ == "__main__":
    main()
