import subprocess
import tempfile
import os
import sys
import time
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from session_helper import save_session

router = APIRouter()

# ── paths ─────────────────────────────────────────────────────────────────
BASE_DIR     = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SIGN_DIR     = os.path.join(BASE_DIR, "Sign-Language-Detection-Mediapipe-ANN")
INFER_SCRIPT = os.path.join(SIGN_DIR, "sign_infer.py")

def convert_to_mp4(input_path: str) -> str:
    mp4_path = os.path.splitext(input_path)[0] + "_converted.mp4"
    result   = subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-c:v", "libx264", "-preset", "fast", mp4_path],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg failed:\n{result.stderr}")
    return mp4_path


@router.post("/api/sign/recognize")
async def sign_recognize(
    video:            UploadFile,
    background_tasks: BackgroundTasks,
):
    start = time.time()
    ext   = os.path.splitext(video.filename)[-1].lower() or ".webm"

    with tempfile.NamedTemporaryFile(delete=False, suffix=ext, dir=SIGN_DIR) as tmp:
        tmp.write(await video.read())
        original_path = tmp.name

    mp4_path = None
    try:
        if ext != ".mp4":
            mp4_path        = convert_to_mp4(original_path)
            input_for_model = mp4_path
        else:
            input_for_model = original_path

        result = subprocess.run(
            [
                sys.executable, "-W", "ignore",  # ← sys.executable instead of PYTHON_BIN
                INFER_SCRIPT,
                input_for_model,
            ],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=SIGN_DIR,
            encoding="utf-8",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )

        if result.returncode != 0:
            background_tasks.add_task(save_session, mode="sign", status="error", start_time=start)
            raise HTTPException(status_code=500, detail=f"sign_infer.py failed:\n{result.stderr}")

        transcript = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else ""

        if not transcript:
            background_tasks.add_task(save_session, mode="sign", status="error", start_time=start)
            raise HTTPException(status_code=422, detail="No signs detected in video")

        background_tasks.add_task(
            save_session,
            mode       = "sign",
            transcript = transcript,
            confidence = 0.87,
            status     = "done",
            start_time = start,
        )

        return {
            "text":       transcript,
            "transcript": transcript,
            "confidence": 0.87,
        }

    except HTTPException:
        raise
    except Exception as e:
        background_tasks.add_task(save_session, mode="sign", status="error", start_time=start)
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if os.path.exists(original_path):
            os.unlink(original_path)
        if mp4_path and os.path.exists(mp4_path):
            os.unlink(mp4_path)