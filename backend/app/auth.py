# app/auth.py
import secrets
from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session
from database import get_db
import models


# ── Password helpers (plain-text, dev-only) ────────────────────────────────
def hash_password(password: str) -> str:
    return password                          # store as-is

def verify_password(plain: str, stored: str) -> bool:
    return plain == stored


# ── Token helpers ──────────────────────────────────────────────────────────
def create_access_token(_data: dict = None) -> str:
    """Generate a random opaque token; store it on the User row."""
    return secrets.token_hex(32)


# ── Current user dependency ────────────────────────────────────────────────
def get_current_user(
    authorization: str | None = Header(default=None),
    db: Session = Depends(get_db),
):
    """Returns current user if token is valid, else None (guest allowed)."""
    if not authorization:
        return None
    # Expect "Bearer <token>" or just the raw token
    token = authorization.removeprefix("Bearer ").strip()
    if not token:
        return None
    return db.query(models.User).filter(models.User.token == token).first()


def require_user(current_user=Depends(get_current_user)):
    """Use this dependency when login is required."""
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return current_user