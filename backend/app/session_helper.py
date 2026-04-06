# app/session_helper.py
# Import this in lip.py, sign.py, speech.py to auto-save sessions after inference

import httpx
import time

API_BASE = "http://localhost:8000"


async def save_session(
    mode:        str,
    transcript:  str   = None,
    translation: str   = None,
    target_lang: str   = None,
    confidence:  float = None,
    status:      str   = "done",
    start_time:  float = None,
    token:       str   = None,
):
    """
    Fire-and-forget async session save.
    Call with: await save_session(...)
    Won't crash the main request if it fails.
    """
    try:
        duration_ms = int((time.time() - start_time) * 1000) if start_time else None
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{API_BASE}/api/sessions/",
                json={
                    "mode":        mode,
                    "transcript":  transcript,
                    "translation": translation,
                    "target_lang": target_lang,
                    "confidence":  confidence,
                    "status":      status,
                    "duration_ms": duration_ms,
                },
                headers=headers,
                timeout=5,
            )
        print(f"[session] Saved: {response.status_code}")

    except Exception as e:
        print(f"[session] Save failed (non-critical): {e}")