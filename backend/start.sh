#!/bin/bash

# Start the Stable Diffusion backend server
# This script handles conda/venv conflicts automatically

cd "$(dirname "$0")"

# === IMPORTANT: Deactivate conda to prevent library conflicts ===
# Conda's TensorFlow/protobuf packages conflict with PyTorch and cause crashes
if [ -n "$CONDA_DEFAULT_ENV" ]; then
    echo "⚠️  Conda environment detected: $CONDA_DEFAULT_ENV"
    echo "   Deactivating conda to prevent library conflicts..."
    
    # Deactivate all conda environments
    while [ -n "$CONDA_DEFAULT_ENV" ]; do
        conda deactivate 2>/dev/null || break
    done
    
    # Clear conda from PATH if still present
    export PATH=$(echo "$PATH" | tr ':' '\n' | grep -v "conda" | grep -v "miniconda" | grep -v "anaconda" | tr '\n' ':' | sed 's/:$//')
    
    echo "   ✅ Conda deactivated"
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3.10 -m venv venv || python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Verify we're using the venv Python
PYTHON_PATH=$(which python)
if [[ "$PYTHON_PATH" != *"venv"* ]]; then
    echo "❌ Error: Python is not from venv. Got: $PYTHON_PATH"
    echo "   Please start a fresh terminal and try again."
    exit 1
fi

# Install/update dependencies if needed
if [ ! -f "venv/.deps_installed" ] || [ "requirements.txt" -nt "venv/.deps_installed" ]; then
    echo "📥 Installing dependencies..."
    pip install --upgrade pip
    pip install -r requirements.txt
    touch venv/.deps_installed
else
    echo "✅ Dependencies already installed"
fi

# Start the server
echo ""
echo "============================================================"
echo "🚀 Starting Generative Design Studio Backend"
echo "============================================================"
python server.py
