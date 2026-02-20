#!/bin/bash

echo "🛠️ Starting RunPod Plug-and-Play Setup..."

# 1. Update and install system dependencies
echo "📦 Installing ffmpeg..."
apt update && apt install -y ffmpeg

# 2. Install Python dependencies
echo "🐍 Installing Python packages..."
pip install -r requirements_gpu.txt

echo "------------------------------------------------"
echo "✅ Setup Complete!"
echo "------------------------------------------------"
echo "To start the worker, run:"
echo "python remote_worker.py"
echo ""
echo "Note: Files uploaded via S3 should appear in the /workspace/transcriber/uploads folder."
echo "------------------------------------------------"
