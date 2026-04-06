# app/main.py
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import asyncio

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse

from database import engine
import models
from routers import lip, sign, speech                      # ← moved to top
from routers.sessions import router as sessions_router     # ← moved to top
from routers.users    import router as users_router        # ← moved to top
import imageio_ffmpeg
import os
os.environ["PATH"] += os.pathsep + imageio_ffmpeg.get_ffmpeg_dir()
# ── startup: create all tables ─────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):                          # ← replaces create_all at module level
    models.Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(
    title       = "LinguaAI API",
    description = "Multilingual communication system — Speech, Sign, Lip Reading",
    version     = "1.0.0",
    lifespan    = lifespan,                                # ← wired in here
)


# ── middleware ─────────────────────────────────────────────────────────────
# Registration order matters — last registered runs first.
# timeout → CORS → GZip ensures timeout responses include CORS headers.

@app.middleware("http")                                    # ← registered first = runs last
async def timeout_middleware(request: Request, call_next):
    try:
        return await asyncio.wait_for(call_next(request), timeout=150)
    except asyncio.TimeoutError:
        return JSONResponse(
            status_code=504,
            content={"detail": "Request timed out — model took too long. Try a shorter recording."}
        )

app.add_middleware(                                        # ← registered second = runs second
    CORSMiddleware,
    allow_origins     = ["http://localhost:5173","https://project-brl7d-9uhvjcszw-neuralarchitect123-sources-projects.vercel.app"],
    allow_credentials = True,
    allow_methods     = ["*"],
    allow_headers     = ["*"],
)

app.add_middleware(GZipMiddleware, minimum_size=1000)      # ← registered last = runs first


# ── routers ────────────────────────────────────────────────────────────────
app.include_router(lip.router)
app.include_router(sign.router)
app.include_router(speech.router)
app.include_router(sessions_router)
app.include_router(users_router)


# ── health check ───────────────────────────────────────────────────────────
@app.get("/api/health")
def health():
    return {
        "status":    "ok",
        "version":   "1.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),   # ← was datetime.utcnow()
        "pipelines": ["speech", "sign", "lip"],
    }
