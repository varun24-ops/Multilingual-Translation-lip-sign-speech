# Multilingual-Translation-lip-sign-speech — Backend

FastAPI backend for the Unicomm multilingual communication system.  
Handles Speech Translation, Sign Language Recognition, and Lip Reading pipelines.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Web framework | FastAPI + Uvicorn |
| Database | SQLite (via SQLAlchemy) |
| Auth ||
| Speech ASR | Whisper LoRA (HuggingFace) |
| Language ID | Custom BetterLangIDClassifier |
| Translation | NLLB (HuggingFace) + Google Translate fallback |
| Lip Reading | LRS3 model via infer.py |
| Sign Language | MediaPipe ANN via sign_infer.py |

---

## Project Structure

```
backend/
├── app/
│   ├── main.py              ← FastAPI app entry point
│   ├── database.py          ← SQLite connection
│   ├── models.py            ← SQLAlchemy table definitions
│   ├── schemas.py           ← Pydantic request/response models
│   ├── auth.py       
│   ├── session_helper.py    ← Auto-save sessions after inference
│   └── routers/
│       ├── speech.py        ← POST /api/speech/translate
│       ├── lip.py           ← POST /api/lip/read
│       ├── sign.py          ← POST /api/sign/recognize
│       ├── sessions.py      ← GET/POST /api/sessions
│       └── users.py         ← POST /api/users/register|login
├── lip_reading/             ← Lip reading model files
├── Sign-Language-Detection-Mediapipe-ANN/
└── requirements.txt
```

---

## Prerequisites

- Python 3.10+
- ffmpeg installed and on PATH
- Git

### Install ffmpeg

**Windows:**
```bash

winget install ffmpeg
# or download from https://ffmpeg.org/download.html
```

**Mac:**
```bash
brew install ffmpeg
```

**Linux:**
```bash
sudo apt install ffmpeg
```

Verify: `ffmpeg -version`

---

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/varun24-ops/Multilingual-Translation-lip-sign-speech
cd Multilingual-Translation-lip-sign-speech/backend
```

### 3. Create Python environment

**Option A — Conda (recommended)**
```bash
conda create -n unicomm python=3.10
conda activate unicomm
pip install -r requirements.txt
```

**Option B — venv**
```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Mac/Linux
source venv/bin/activate

pip install -r requirements.txt
```

### 5. Start the server

```bash
cd app
python -m uvicorn main:app --reload --timeout-keep-alive 180
```

Server runs at: `http://localhost:8000`

---

## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/health` | Health check |
| POST | `/api/speech/translate` | Audio → transcript + translation |
| POST | `/api/sign/recognize` | Video → sign language text |
| POST | `/api/lip/read` | Video → lip read text |
| POST | `/api/users/register` | Create account |
| POST | `/api/users/login` | Login → JWT token |
| GET | `/api/users/me` | Get current user |
| PUT | `/api/users/change-password` | Change password |
| GET | `/api/users/sessions` | User session history |
| POST | `/api/sessions` | Save a session |
| GET | `/api/sessions` | Recent sessions |
| GET | `/api/sessions/stats` | Dashboard stats |
| GET | `/api/sessions/health` | Pipeline health |

Full interactive docs: `http://localhost:8000/docs`

---

## Speech Pipeline

```
Audio
  → Language ID  (Samruddhi1916/langid-indic)
  → ASR          (Samruddhi1916/whisper-{lang}-lora  OR  openai/whisper-small)
  → → English    (Wizard1203/nllb-{lang}-en)
  → → Target     (Wizard1203/nllb-en-{lang}  OR  Google Translate)
```

Supported languages: Hindi, Tamil, Kannada, Telugu, Malayalam


## Common Issues

**`ModuleNotFoundError: No module named 'torch'`**
→ You're not in the right environment. Run `python -m uvicorn` not `uvicorn`.

**`ffmpeg not found`**
→ Install ffmpeg and make sure it's on your PATH. Run `ffmpeg -version` to verify.

**`infer.py failed`**
→ Check that `LIP_DIR` points to the correct folder and `configs/LRS3_V_WER32.3.ini` exists inside it.

**`HuggingFace download fails`**
→ Set `HF_TOKEN` in `.env`. Get token from https://huggingface.co/settings/tokens

**CORS error in browser**
→ Set `FRONTEND_URL=http://localhost:5173` in `.env` (or your actual frontend port).
