#!/bin/bash
echo "🛠️ Starting RunPod Auto-Setup (Torch 2.4.0 Optimization)..."

# 1. System dependencies
echo "📦 Installing system libraries..."
apt update && apt install -y ffmpeg libsndfile1 screen

# 2. Fix specific Torch/Torchaudio/Pyannote conflicts for 2.4.0
# The error 'list_audio_backends' is fixed by upgrading pyannote.audio and using compatible torchaudio
echo "🐍 Aligning AI libraries..."
pip install --upgrade pip
pip install "pyannote.audio>=3.3.1" "onnxruntime-gpu" "torchvision" "torchaudio>=2.4.0" 

# 3. Project dependencies
echo "📦 Installing requirements_gpu.txt..."
pip install -r requirements_gpu.txt

echo "------------------------------------------------"
echo "✅ Setup Complete!"
echo "------------------------------------------------"
echo "Start Command Ready: python remote_worker.py"
echo "------------------------------------------------"
