import subprocess
import tempfile
import os
import sys
import time
from fastapi import APIRouter, UploadFile, File, HTTPException, BackgroundTasks
from session_helper import save_session

router = APIRouter()

# ── paths ─────────────────────────────────────────────────────────────────
BASE_DIR     = os.path.dirname(
               os.path.dirname(
               os.path.dirname(os.path.abspath(__file__))))

LIP_DIR      = os.path.join(BASE_DIR, "lip_reading")
INFER_SCRIPT = os.path.join(LIP_DIR, "infer.py")
CONFIG_FILE  = os.path.join(LIP_DIR, "configs", "LRS3_V_WER32.3.ini")

# ── helpers ───────────────────────────────────────────────────────────────
def convert_to_mp4(input_path: str) -> str:
    mp4_path = os.path.splitext(input_path)[0] + "_converted.mp4"
    result   = subprocess.run(
        ["ffmpeg", "-y", "-i", input_path, "-c:v", "libx264",
         "-preset", "fast", "-crf", "23", "-c:a", "aac", mp4_path],
        capture_output=True, text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(f"ffmpeg conversion failed:\n{result.stderr}")
    return mp4_path


def parse_output(stdout: str) -> str:
    for line in stdout.strip().splitlines():
        if line.strip().startswith("hyp:"):
            part = line.split("hyp:")[-1].strip()
            part = part.split("(len=")[0].strip()
            part = part.strip("'\"")
            return part.capitalize()
    return ""


# ── endpoint ──────────────────────────────────────────────────────────────
@router.post("/api/lip/read")
async def lip_read(
    video:            UploadFile,       # ← no File(...) default needed
    background_tasks: BackgroundTasks,  # ← FastAPI injects automatically
):
    start = time.time()

    original_ext = os.path.splitext(video.filename)[-1].lower() or ".webm"

    with tempfile.NamedTemporaryFile(
        delete=False, suffix=original_ext, dir=LIP_DIR
    ) as tmp:
        tmp.write(await video.read())
        original_path = tmp.name

    mp4_path = None

    try:
        if original_ext == ".mp4":
            input_for_infer = original_path
            print(f"[lip] File is already mp4 → skipping conversion")
        else:
            print(f"[lip] File is {original_ext} → converting to mp4...")
            try:
                mp4_path        = convert_to_mp4(original_path)
                input_for_infer = mp4_path
                print(f"[lip] Converted successfully → {mp4_path}")
            except RuntimeError as e:
                raise HTTPException(status_code=500, detail=str(e))

        result = subprocess.run(
            [
                sys.executable, "-W", "ignore",  # ← sys.executable instead of PYTHON_BIN
                INFER_SCRIPT,
                f"config_filename=configs/LRS3_V_WER32.3.ini",
                f"data_filename={input_for_infer}",
                "detector=mediapipe",
                "gpu_idx=0",
            ],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=LIP_DIR,
            encoding="utf-8",
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        )

        if result.returncode != 0:
            background_tasks.add_task(save_session, mode="lip", status="error", start_time=start)
            raise HTTPException(
                status_code=500,
                detail=f"infer.py failed:\n{result.stderr}"
            )

        transcript = parse_output(result.stdout)

        if not transcript:
            background_tasks.add_task(save_session, mode="lip", status="error", start_time=start)
            raise HTTPException(
                status_code=422,
                detail=f"Could not parse output:\n{result.stdout}"
            )

        background_tasks.add_task(
            save_session,
            mode       = "lip",
            transcript = transcript,
            confidence = 0.90,
            status     = "done",
            start_time = start,
        )

        return {
            "text":       transcript,
            "transcript": transcript,
            "confidence": 0.90,
        }

    except HTTPException:
        raise

    except Exception as e:
        background_tasks.add_task(save_session, mode="lip", status="error", start_time=start)
        raise HTTPException(status_code=500, detail=str(e))

    finally:
        if os.path.exists(original_path):
            os.unlink(original_path)
        if mp4_path and os.path.exists(mp4_path):
            os.unlink(mp4_path)