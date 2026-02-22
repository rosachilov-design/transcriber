"""
remote_worker.py — Headless GPU Worker for RunPod
Scans the uploads/ folder, transcribes any audio that doesn't have a .json result yet,
and automatically uploads the results back to S3.
"""

import os
import sys
import time
import boto3
from pathlib import Path
from botocore.config import Config

# Try to load .env if available
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Import the GPU engine
from engine import transcribe_file, save_results

UPLOAD_DIR = Path("uploads")
AUDIO_EXTENSIONS = {".m4a", ".mp3", ".wav", ".ogg", ".flac", ".webm"}

# --- S3 CONFIG ---
S3_BUCKET = "ez2d4o9xmt"
S3_ENDPOINT = "https://s3api-us-wa-1.runpod.io"
S3_REGION = "us-wa-1"

def get_s3_client():
    access_key = os.getenv("RUNPOD_ACCESS_KEY")
    secret_key = os.getenv("RUNPOD_SECRET_KEY")
    if not access_key or not secret_key:
        print("⚠️  Warning: RUNPOD_ACCESS_KEY/SECRET_KEY not set. S3 upload will fail.")
        return None
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        region_name=S3_REGION,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4")
    )

def upload_results(filename_stem):
    """Upload .json, .md, and .docx results to S3."""
    s3 = get_s3_client()
    if not s3: return

    for ext in [".json", ".md", ".docx"]:
        file_path = UPLOAD_DIR / f"{filename_stem}{ext}"
        if file_path.exists():
            print(f"  ☁️  Uploading result to S3: {file_path.name}...")
            # We use the 'transcriber/uploads/' prefix for consistency
            s3.upload_file(str(file_path), S3_BUCKET, f"transcriber/uploads/{file_path.name}")

def move_stray_files():
    """Look for newly uploaded files in /workspace/ or parent and move them to uploads/."""
    stray_dirs = [Path("/workspace"), Path(".."), Path(".")]
    for d in stray_dirs:
        if not d.exists(): continue
        for f in d.iterdir():
            if f.is_file() and f.suffix.lower() in AUDIO_EXTENSIONS:
                if f.parent != UPLOAD_DIR:
                    dest = UPLOAD_DIR / f.name
                    if not dest.exists():
                        print(f"🚚 Moving stray file to uploads: {f.name}")
                        f.rename(dest)

def find_pending_files():
    """Find audio files that haven't been transcribed yet (no .json result)."""
    move_stray_files()
    pending = []
    for f in UPLOAD_DIR.iterdir():
        if f.suffix.lower() in AUDIO_EXTENSIONS and not f.with_suffix(".json").exists():
            pending.append(f)
    return sorted(pending)

def process_all():
    """Transcribe all pending files and upload results."""
    pending = find_pending_files()

    if not pending:
        print("✅ No pending files. Everything is transcribed.")
        return 0

    print(f"🚀 Found {len(pending)} file(s) to transcribe:\n")
    for i, f in enumerate(pending, 1):
        print(f"  {i}. {f.name}")
    print()

    for i, file_path in enumerate(pending, 1):
        print(f"{'='*60}")
        print(f"🎬 [{i}/{len(pending)}] Processing: {file_path.name}")
        print(f"{'='*60}")

        task = transcribe_file(file_path)

        if task["status"] == "completed":
            save_results(task, UPLOAD_DIR)
            print(f"✅ Transcription done: {file_path.name}")
            
            # --- NEW: Upload to Cloud ---
            upload_results(file_path.stem)
            print(f"🌟 Results synced to cloud.\n")
        else:
            print(f"❌ Failed: {file_path.name} — {task.get('error', 'Unknown error')}\n")

    return len(pending)

if __name__ == "__main__":
    UPLOAD_DIR.mkdir(exist_ok=True)

    if "--watch" in sys.argv:
        print("👀 Watch mode — monitoring for new files. Ctrl+C to stop.\n")
        while True:
            count = process_all()
            if count == 0:
                print("💤 Waiting for new files...", end="\r")
            time.sleep(5)
    else:
        process_all()
        print("\n🏁 All done. You can now stop the Pod.")
