# app/routers/users.py
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List                  # ← add this
from database import get_db
import models, schemas, auth

router = APIRouter(prefix="/api/users", tags=["users"])


# ── Register ───────────────────────────────────────────────────────────────
@router.post("/register", response_model=schemas.TokenResponse, status_code=201)
def register(payload: schemas.UserCreate, db: Session = Depends(get_db)):

    if db.query(models.User).filter(models.User.email == payload.email).first():
        raise HTTPException(status_code=400, detail="Email already registered")

    if db.query(models.User).filter(models.User.username == payload.username).first():
        raise HTTPException(status_code=400, detail="Username already taken")

    user = models.User(
        email    = payload.email,
        username = payload.username,
        password = auth.hash_password(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = auth.create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer", "user": user}


# ── Login ──────────────────────────────────────────────────────────────────
@router.post("/login", response_model=schemas.TokenResponse)
def login(payload: schemas.LoginRequest, db: Session = Depends(get_db)):

    user = db.query(models.User).filter(models.User.email == payload.email).first()

    if not user or not auth.verify_password(payload.password, user.password):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    token = auth.create_access_token({"sub": str(user.id)})
    return {"access_token": token, "token_type": "bearer", "user": user}


# ── Get current user ───────────────────────────────────────────────────────
@router.get("/me", response_model=schemas.UserResponse)
def get_me(current_user=Depends(auth.require_user)):
    return current_user


# ── Change password ────────────────────────────────────────────────────────
class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password:     str

@router.put("/change-password")
def change_password(
    payload:     ChangePasswordRequest,
    db:          Session = Depends(get_db),
    current_user = Depends(auth.require_user),
):
    if not auth.verify_password(payload.current_password, current_user.password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")

    current_user.password = auth.hash_password(payload.new_password)
    db.commit()
    return {"message": "Password updated successfully"}


# ── Get user session history ───────────────────────────────────────────────
@router.get("/sessions", response_model=List[schemas.SessionResponse])  # ← List not list
def get_my_sessions(
    limit:       int     = 20,
    db:          Session = Depends(get_db),
    current_user         = Depends(auth.require_user),
):
    return (
        db.query(models.Session)
        .filter(models.Session.user_id == current_user.id)
        .order_by(models.Session.created_at.desc())
        .limit(limit)
        .all()
    )