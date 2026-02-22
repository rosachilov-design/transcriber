from fastapi import FastAPI, UploadFile, File
from fastapi.responses import JSONResponse
import os
import boto3
import requests
from pathlib import Path
from dotenv import load_dotenv
from botocore.config import Config

load_dotenv()

app = FastAPI(title="WhisperX Serverless Tester")

# Config
S3_BUCKET = "ez2d4o9xmt"
S3_ENDPOINT = "https://s3api-us-wa-1.runpod.io"
RUNPOD_API_KEY = os.getenv("RUNPOD_API_KEY")
ENDPOINT_ID = os.getenv("RUNPOD_ENDPOINT_ID")
HF_TOKEN = os.getenv("HF_TOKEN")

s3 = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    region_name="us-wa-1",
    aws_access_key_id=os.getenv("RUNPOD_ACCESS_KEY"),
    aws_secret_access_key=os.getenv("RUNPOD_SECRET_KEY"),
    config=Config(signature_version="s3v4"),
)

@app.post("/test-transcribe")
async def test_transcribe(file: UploadFile = File(...)):
    """Simple one-shot: Upload -> S3 -> WhisperX -> Result"""
    if not ENDPOINT_ID:
        return {"error": "RUNPOD_ENDPOINT_ID not set in .env"}

    # 1. Save locally
    temp_path = Path(f"uploads/temp_{file.filename}")
    temp_path.parent.mkdir(exist_ok=True)
    with open(temp_path, "wb") as f:
        f.write(await file.read())

    try:
        # 2. Upload to S3
        s3_key = f"transcriber/temp/{file.filename}"
        s3.upload_file(str(temp_path), S3_BUCKET, s3_key)

        # 3. Presigned URL
        presigned_url = s3.generate_presigned_url(
            'get_object', Params={'Bucket': S3_BUCKET, 'Key': s3_key}, ExpiresIn=3600
        )

        # 4. Call Worker
        url = f"https://api.runpod.ai/v2/{ENDPOINT_ID}/runsync"
        payload = {
            "input": {
                "audio_url": presigned_url,
                "language": "ru",
                "hf_token": HF_TOKEN
            }
        }
        headers = {"Authorization": f"Bearer {RUNPOD_API_KEY}"}
        
        print(f"📡 Sending {file.filename} to worker {ENDPOINT_ID}...")
        resp = requests.post(url, json=payload, headers=headers, timeout=600)
        
        # Cleanup
        os.remove(temp_path)
        
        return resp.json()

    except Exception as e:
        if temp_path.exists(): os.remove(temp_path)
        return {"error": str(e)}

if __name__ == "__main__":
    import uvicorn
    print("\n🚀 Minimal Serverless Tester running on http://localhost:8001")
    print("👉 Use this to test the worker without the main dashboard.")
    uvicorn.run(app, host="0.0.0.0", port=8001)
