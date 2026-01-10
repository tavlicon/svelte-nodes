#!/bin/bash

# Start the Stable Diffusion backend server

cd "$(dirname "$0")"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Install/update dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Start the server
echo "Starting Stable Diffusion backend server..."
echo "Model will be loaded from: ../data/models/v1-5-pruned-emaonly-fp16.safetensors"
echo ""
python server.py
