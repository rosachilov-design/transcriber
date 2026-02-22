import os
import requests
import boto3
import time
from pathlib import Path
from dotenv import load_dotenv
from botocore.config import Config

# Load credentials
load_dotenv()

RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY")
ENDPOINT_ID = os.getenv("RUNPOD_ENDPOINT_ID")
HF_TOKEN = os.getenv("HF_TOKEN")

S3_BUCKET = os.getenv("S3_BUCKET", "ez2d4o9xmt") # Using your bucket from server.py
S3_ENDPOINT = "https://s3api-us-wa-1.runpod.io"
S3_REGION = "us-wa-1"

# Initialize S3
s3 = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    region_name=S3_REGION,
    aws_access_key_id=os.getenv("RUNPOD_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("RUNPOD_SECRET_KEY"),
    config=Config(signature_version="s3v4"),
)

def test_transcription(local_file_path):
    print(f"🚀 Starting Test for Serverless Worker: {ENDPOINT_ID}")
    
    file_path = Path(local_file_path)
    if not file_path.exists():
        print(f"❌ Error: File {local_file_path} not found.")
        return

    # 1. Upload to S3
    print(f"☁️  Uploading {file_path.name} to S3...")
    s3_key = f"transcriber/tests/{file_path.name}"
    s3.upload_file(str(file_path), S3_BUCKET, s3_key)

    # 2. Generate Presigned URL
    print("🔗 Generating presigned URL...")
    presigned_url = s3.generate_presigned_url(
        'get_object',
        Params={'Bucket': S3_BUCKET, 'Key': s3_key},
        ExpiresIn=3600
    )

    try:
        # 3. Call Serverless Endpoint
        print(f"🧠 Sending job to GPU (RTX 6000 Ada)...")
        # Use /run instead of /runsync to handle cold starts and long files
        run_url = f"https://api.runpod.ai/v2/{ENDPOINT_ID}/run"
        headers = {
            "Authorization": f"Bearer {RUNPOD_API_KEY}",
            "Content-Type": "application/json"
        }
        payload = {
            "input": {
                "audio_url": presigned_url,
                "language": "ru",
                "hf_token": HF_TOKEN,
                "min_speakers": 2,
                "max_speakers": 5
            }
        }

        run_resp = requests.post(run_url, headers=headers, json=payload)
        job_data = run_resp.json()
        job_id = job_data.get("id")
        
        if not job_id:
            print(f"❌ Failed to start job: {job_data}")
            return

        print(f"⏳ Job started (ID: {job_id}). Waiting for GPU to process...")
        
        # 4. Poll for status
        status_url = f"https://api.runpod.ai/v2/{ENDPOINT_ID}/status/{job_id}"
        while True:
            status_resp = requests.get(status_url, headers=headers)
            result = status_resp.json()
            status = result.get("status")

            if status == "COMPLETED":
                print("\n✅ SUCCESS! Transcription received:")
                print("-" * 50)
                for seg in result["output"]["segments"]:
                    print(f"[{seg['start']:.2f}s] {seg['speaker']}: {seg['text']}")
                print("-" * 50)
                break
            elif status == "FAILED":
                print(f"\n❌ Job Failed: {result.get('error')}")
                break
            elif status == "IN_QUEUE":
                print("💤 Waiting in queue (Cold start)...", end="\r")
            elif status == "IN_PROGRESS":
                print("🎙️  Transcribing...", end="\r")
            
            time.sleep(2)
            
    except Exception as e:
        print(f"❌ Connection Error: {e}")

if __name__ == "__main__":
    # Feel free to change this to any filename in your uploads folder
    test_file = "uploads/Interview1.m4a" 
    test_transcription(test_file)
