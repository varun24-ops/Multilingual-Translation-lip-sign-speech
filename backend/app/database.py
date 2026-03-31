# database.py
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# ← SQLite — creates a file called linguaai.db in backend/app/
DATABASE_URL = "sqlite:///./linguaai.db"

engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}  # ← needed for SQLite + FastAPI
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()