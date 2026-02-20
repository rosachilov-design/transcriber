import os
import boto3
from botocore.config import Config
from pathlib import Path

# --- CONFIGURATION ---
BUCKET_NAME = "ez2d4o9xmt"
ENDPOINT_URL = "https://s3api-us-wa-1.runpod.io"
REGION_NAME = "us-wa-1"
LOCAL_UPLOADS_DIR = Path("uploads")

def get_s3_client():
    access_key = os.environ.get("RUNPOD_ACCESS_KEY")
    secret_key = os.environ.get("RUNPOD_SECRET_KEY")

    if not access_key or not secret_key:
        raise Exception("RUNPOD_ACCESS_KEY and RUNPOD_SECRET_KEY not found in environment.")

    return boto3.client(
        "s3",
        endpoint_url=ENDPOINT_URL,
        region_name=REGION_NAME,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4")
    )

def upload_local_to_cloud():
    """Upload new audio files to RunPod."""
    s3 = get_s3_client()
    print(f"📤 Syncing LOCAL -> CLOUD (Audio files)...")
    
    # Supported audio extensions
    extensions = [".m4a", ".mp3", ".wav"]
    local_files = [f for f in LOCAL_UPLOADS_DIR.glob("*") if f.suffix.lower() in extensions]
    
    for file_path in local_files:
        file_name = file_path.name
        try:
            s3.head_object(Bucket=BUCKET_NAME, Key=file_name)
            print(f"  ✅ {file_name} exists")
        except:
            print(f"  📤 Uploading {file_name}...")
            s3.upload_file(str(file_path), BUCKET_NAME, file_name)

def download_cloud_to_local():
    """Download finished transcriptions (.json, .md, .docx) from RunPod."""
    s3 = get_s3_client()
    print(f"\n📥 Syncing CLOUD -> LOCAL (Transcriptions)...")
    
    # List everything in the bucket
    response = s3.list_objects_v2(Bucket=BUCKET_NAME)
    if 'Contents' not in response:
        print("  Bucket is empty.")
        return

    # Extensions we want to pull back
    results_exts = [".json", ".md", ".docx"]
    
    for obj in response['Contents']:
        file_name = obj['Key']
        ext = os.path.splitext(file_name)[1].lower()
        
        if ext in results_exts:
            local_path = LOCAL_UPLOADS_DIR / file_name
            
            # If it doesn't exist locally or is newer in cloud, download it
            if not local_path.exists():
                print(f"  📥 Downloading {file_name}...")
                s3.download_file(BUCKET_NAME, file_name, str(local_path))
            else:
                # Optional: compare timestamps or just skip
                pass

if __name__ == "__main__":
    try:
        from dotenv import load_dotenv
        load_dotenv()
    except ImportError:
        pass

    try:
        upload_local_to_cloud()
        download_cloud_to_local()
        print("\n✨ All synced up!")
    except Exception as e:
        print(f"❌ Error: {e}")
