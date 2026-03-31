# app/routers/sessions.py
from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List, Optional
from datetime import datetime, timedelta
from database import get_db
import models, schemas, auth

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


# ── Save session ────────────────────────────────────────────────────────────
@router.post("/", response_model=schemas.SessionResponse, status_code=201)
def save_session(
    payload:     schemas.SessionCreate,
    db:          Session = Depends(get_db),
    current_user = Depends(auth.get_current_user),
):
    session = models.Session(
        user_id     = current_user.id if current_user else None,
        mode        = payload.mode,
        transcript  = payload.transcript,
        translation = payload.translation,
        target_lang = payload.target_lang,
        confidence  = payload.confidence,
        status      = payload.status or "done",
        duration_ms = payload.duration_ms,
    )
    db.add(session)

    if payload.target_lang:
        stat = db.query(models.LanguageStat).filter(
            models.LanguageStat.language == payload.target_lang
        ).first()
        if stat:
            stat.count += 1
        else:
            db.add(models.LanguageStat(language=payload.target_lang, count=1))

    db.commit()
    db.refresh(session)
    return session


# ── Dashboard stats ─────────────────────────────────────────────────────────
@router.get("/stats")      # ← before GET /
def get_stats(
    timeframe: str     = Query("7d"),
    db:        Session = Depends(get_db),
):
    now = datetime.utcnow()
    since = now - (
        timedelta(hours=24) if timeframe == "24h" else
        timedelta(days=30)  if timeframe == "30d" else
        timedelta(days=7)
    )

    base_q = db.query(models.Session).filter(models.Session.created_at >= since)

    total  = base_q.count()
    speech = base_q.filter(models.Session.mode == "speech").count()
    sign   = base_q.filter(models.Session.mode == "sign").count()
    lip    = base_q.filter(models.Session.mode == "lip").count()
    errors = base_q.filter(models.Session.status == "error").count()

    avg_conf = db.query(func.avg(models.Session.confidence)).filter(
        models.Session.created_at >= since,
        models.Session.confidence.isnot(None)
    ).scalar() or 0.0

    avg_ms = db.query(func.avg(models.Session.duration_ms)).filter(
        models.Session.created_at >= since,
        models.Session.duration_ms.isnot(None)
    ).scalar() or 0

    daily = []
    for i in range(7):
        day_start = (now - timedelta(days=6 - i)).replace(
            hour=0, minute=0, second=0, microsecond=0)
        day_end = day_start + timedelta(days=1)
        count = db.query(models.Session).filter(
            models.Session.created_at >= day_start,
            models.Session.created_at < day_end,
        ).count()
        daily.append({
            "day":   day_start.strftime("%a"),
            "date":  day_start.strftime("%Y-%m-%d"),
            "count": count,
        })

    lang_stats = db.query(models.LanguageStat).order_by(
        models.LanguageStat.count.desc()
    ).all()
    total_lang = sum(l.count for l in lang_stats) or 1

    return {
        "timeframe":         timeframe,
        "total_sessions":    total,
        "speech_translated": speech,
        "signs_recognized":  sign,
        "lips_read":         lip,
        "error_count":       errors,
        "avg_confidence":    round(avg_conf * 100, 1),
        "avg_processing_ms": round(avg_ms),
        "daily_sessions":    daily,
        "language_stats": [
            {
                "language": l.language,
                "count":    l.count,
                "pct":      round((l.count / total_lang) * 100, 1),
            }
            for l in lang_stats
        ],
    }


# ── Pipeline health ─────────────────────────────────────────────────────────
@router.get("/health")     # ← before GET /
def get_pipeline_health(db: Session = Depends(get_db)):
    since = datetime.utcnow() - timedelta(hours=24)
    pipelines = []

    mode_labels = {
        "speech": "Speech ASR + NMT",
        "sign":   "Sign AI Model",
        "lip":    "Lip Vision Model",
    }

    for mode in ["speech", "sign", "lip"]:
        recent = db.query(models.Session).filter(
            models.Session.mode       == mode,
            models.Session.created_at >= since,   # ← removed duration_ms filter
        ).all()

        total_mode  = len(recent)
        errors_mode = sum(1 for s in recent if s.status == "error")

        # ← only use sessions that have duration_ms for latency
        durations   = [s.duration_ms for s in recent if s.duration_ms is not None]
        avg_latency = round(sum(durations) / len(durations)) if durations else 0

        uptime  = round(((total_mode - errors_mode) / total_mode) * 100, 1) if total_mode else 100.0
        status  = "healthy" if uptime >= 95 else "degraded" if uptime >= 80 else "down"

        pipelines.append({
            "name":       mode_labels[mode],
            "mode":       mode,
            "status":     status if total_mode > 0 else "idle",
            "latency_ms": avg_latency,
            "uptime_pct": uptime,
            "total_runs": total_mode,
        })

    return {"pipelines": pipelines}


# ── Get recent sessions ─────────────────────────────────────────────────────
@router.get("/", response_model=List[schemas.SessionResponse])   # ← always last
def get_sessions(
    limit:  int           = Query(20, ge=1, le=100),
    mode:   Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    db:     Session       = Depends(get_db),
):
    q = db.query(models.Session)
    if mode:
        q = q.filter(models.Session.mode == mode)
    if status:
        q = q.filter(models.Session.status == status)
    return q.order_by(models.Session.created_at.desc()).limit(limit).all()