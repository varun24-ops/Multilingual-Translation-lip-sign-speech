# app/schemas.py
from pydantic import BaseModel
from typing import Optional
from datetime import datetime


# ── User schemas ───────────────────────────────────────────────────────────
class UserCreate(BaseModel):
    email:    str
    username: str
    password: str

class UserResponse(BaseModel):
    id:         int
    email:      str
    username:   str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Auth schemas ───────────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email:    str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"
    user:         UserResponse


# ── Session schemas ────────────────────────────────────────────────────────
class SessionCreate(BaseModel):
    mode:        str
    transcript:  Optional[str]   = None
    translation: Optional[str]   = None
    target_lang: Optional[str]   = None
    confidence:  Optional[float] = None
    status:      Optional[str]   = "done"
    duration_ms: Optional[int]   = None

class SessionResponse(BaseModel):
    id:          int
    mode:        str
    transcript:  Optional[str]
    translation: Optional[str]
    target_lang: Optional[str]
    confidence:  Optional[float]
    status:      str
    duration_ms: Optional[int]
    created_at:  datetime

    class Config:
        from_attributes = True


# ── Language stat schemas ──────────────────────────────────────────────────
class LanguageStatResponse(BaseModel):
    language:   str
    count:      int
    updated_at: datetime

    class Config:
        from_attributes = True