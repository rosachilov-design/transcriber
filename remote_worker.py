"""
remote_worker.py — Headless GPU Worker for RunPod
Scans the uploads/ folder, transcribes any audio that doesn't have a .json result yet.
Run this on a RunPod Pod with a GPU attached.

Usage:
    python remote_worker.py           # Process all pending files and exit
    python remote_worker.py --watch   # Stay alive and watch for new files
"""

import sys
import time
from pathlib import Path

# Import the GPU engine
from engine import transcribe_file, save_results

UPLOAD_DIR = Path("uploads")
AUDIO_EXTENSIONS = {".m4a", ".mp3", ".wav", ".ogg", ".flac", ".webm"}


def find_pending_files():
    """Find audio files that haven't been transcribed yet (no .json result)."""
    pending = []
    for f in UPLOAD_DIR.iterdir():
        if f.suffix.lower() in AUDIO_EXTENSIONS and not f.with_suffix(".json").exists():
            pending.append(f)
    return sorted(pending)


def process_all():
    """Transcribe all pending files."""
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
            print(f"✅ Done: {file_path.name} → {len(task['result'])} segments\n")
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
