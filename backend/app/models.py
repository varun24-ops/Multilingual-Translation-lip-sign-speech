# app/models.py
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, event
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from datetime import datetime, timezone
from database import Base


# ── Users table ────────────────────────────────────────────────────────────
class User(Base):
    __tablename__ = "users"

    id         = Column(Integer, primary_key=True, index=True)
    email      = Column(String,  unique=True, index=True, nullable=False)
    username   = Column(String,  unique=True, index=True, nullable=False)
    password   = Column(String,  nullable=False)                           # plain text (dev only)
    token      = Column(String,  unique=True, index=True, nullable=True)   # ← added
    created_at = Column(DateTime, server_default=func.now())

    # one user → many sessions
    sessions   = relationship("Session", back_populates="user")


# ── Sessions table ─────────────────────────────────────────────────────────
class Session(Base):
    __tablename__ = "sessions"

    id          = Column(Integer, primary_key=True, index=True)
    user_id     = Column(Integer, ForeignKey("users.id"), nullable=True)  # nullable = guests allowed
    mode        = Column(String,  nullable=False)          # "speech" | "sign" | "lip"
    transcript  = Column(String,  nullable=True)           # recognized text
    translation = Column(String,  nullable=True)           # translated text (speech only)
    target_lang = Column(String,  nullable=True)           # e.g. "Hindi"
    confidence  = Column(Float,   nullable=True)           # 0.0 – 1.0
    status      = Column(String,  default="done")          # "done" | "error"
    duration_ms = Column(Integer, nullable=True)           # processing time in ms
    created_at  = Column(DateTime, server_default=func.now())

    # relationship back to user
    user = relationship("User", back_populates="sessions")


# ── Language stats table ───────────────────────────────────────────────────
class LanguageStat(Base):
    __tablename__ = "language_stats"

    id         = Column(Integer, primary_key=True, index=True)
    language   = Column(String,  unique=True, index=True, nullable=False)  # e.g. "Hindi"
    count      = Column(Integer, default=0)                                # total uses
    updated_at = Column(DateTime, server_default=func.now())               # ← removed broken onupdate


# ── Auto-update timestamp for LanguageStat ────────────────────────────────
@event.listens_for(LanguageStat, "before_update")
def update_language_stat_timestamp(mapper, connection, target):
    target.updated_at = datetime.now(timezone.utc)                         # ← handles onupdate for SQLite