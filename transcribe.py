import whisper
import os
import torch
from pathlib import Path

def format_timestamp(seconds):
    """Helper to format seconds into MM:SS or HH:MM:SS"""
    hours = int(seconds // 3600)
    minutes = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    if hours > 0:
        return f"{hours:02}:{minutes:02}:{secs:02}"
    return f"{minutes:02}:{secs:02}"

# Detect if GPU is available
device = "cuda" if torch.cuda.is_available() else "cpu"

# Define the model to use (turbo in this case)
model_name = "turbo"
# Define the path to your audio file
audio_file_path = r"C:\Users\halfo\OneDrive\Desktop\test-trans-1.m4a"
output_file_path = Path(audio_file_path).with_suffix(".md")

print(f"Device detected: {device.upper()}")
print(f"Loading model: {model_name}...")
model = whisper.load_model(model_name, device=device)
print("Model loaded.")

if os.path.exists(audio_file_path):
    print(f"Transcribing audio from: {audio_file_path}...")
    # Transcribe the audio file with segments
    result = model.transcribe(audio_file_path, verbose=False)
    
    print(f"Transcription complete. Saving to: {output_file_path}")
    
    with open(output_file_path, "w", encoding="utf-8") as f:
        f.write(f"# Transcription: {Path(audio_file_path).name}\n\n")
        
        for segment in result["segments"]:
            start = format_timestamp(segment["start"])
            text = segment["text"].strip()
            # We use a placeholder for Speaker Name as Whisper doesn't automate diarization
            f.write(f"**[{start}] Speaker:** {text}\n\n")

    print("\n--- Transcription Saved Successfully ---")
    print(f"Output file: {output_file_path}")
else:
    print(f"Error: The file '{audio_file_path}' was not found.")
    print("Please make sure the audio file is in the correct location.")
