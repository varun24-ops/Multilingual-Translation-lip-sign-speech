# LinguaAI — Multilingual Communication System

An AI-powered platform for Speech Translation, Sign Language Recognition, and Lip Reading — supporting Hindi, Tamil, Kannada, Telugu, and Malayalam.

---
## System Overview
```
┌─────────────────────────────────────────────────┐
│                  React Frontend                  │
│         Live Demo · Dashboard · About            │
└──────────────────────┬──────────────────────────┘
                       │ HTTP / REST
┌──────────────────────▼──────────────────────────┐
│                 FastAPI Backend                  │
├──────────────┬──────────────┬───────────────────┤
│  Speech      │  Sign Lang   │   Lip Reading      │
│  Pipeline    │  Pipeline    │   Pipeline         │
├──────────────┼──────────────┼───────────────────┤
│ LangID       │ MediaPipe    │ LRS3 infer.py      │
│ Whisper LoRA │ ANN Model    │                    │
│ NLLB MT      │              │                    │
└──────────────┴──────────────┴───────────────────┘
                       │
┌──────────────────────▼──────────────────────────┐
│            SQLite Database                       │
│     users · sessions · language_stats            │
└─────────────────────────────────────────────────┘
```

---

## Repository Structure

```
lingua-ai/
├── frontend/                    ← React + Vite app
│   ├── src/
│   │   ├── App.jsx
│   │   └── pages/
│   │       ├── LiveDemo.jsx
│   │       ├── Dashboard.jsx
│   │       ├── About.jsx
│   │       └── Auth.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── .env.example
│
├── backend/
│   ├── app/
│   │   ├── main.py
│   │   ├── database.py
│   │   ├── models.py
│   │   ├── schemas.py
│   │   ├── auth.py
│   │   ├── session_helper.py
│   │   └── routers/
│   │       ├── speech.py
│   │       ├── lip.py
│   │       ├── sign.py
│   │       ├── sessions.py
│   │       └── users.py
│   ├── lip_reading/             
│   ├── Sign-Language-Detection-Mediapipe-ANN/ 
│   └── requirements.txt
│
└── README.md                   
```

---

## Quick Start

### Requirements
- Python 3.10+
- Node.js 18+
- ffmpeg
- Git

### 1. Clone

```bash
git clone https://github.com/varun24-ops/unicomm
cd unicomm
```

### 2. Backend setup

```bash
cd backend

# create environment
conda create -n unicomm python=3.10
conda activate unicomm
pip install -r requirements.txt

# start
cd app
python -m uvicorn main:app --reload --timeout-keep-alive 180
```

### 4. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
npm run dev
```

### 5. Open

| Service | URL |
|---|---|
| Frontend | http://localhost:5173 |
| Backend API | http://localhost:8000 |
| API Docs | http://localhost:8000/docs |

---

## AI Models Used

### Speech Pipeline
| Step | Model |
|---|---|
| Language ID | `Samruddhi1916/langid-indic` |
| ASR — Hindi | `Samruddhi1916/whisper-hindi-lora` |
| ASR — Tamil | `Samruddhi1916/whisper-tamil-lora` |
| ASR — Kannada | `Samruddhi1916/whisper-kannada-lora` |
| ASR — Telugu | `Samruddhi1916/whisper-telugu-lora` |
| ASR — Malayalam | `Samruddhi1916/whisper-malayalam-lora` |
| ASR fallback | `openai/whisper-small` |
| MT → English | `Wizard1203/nllb-{lang}-en` |
| MT → Target | `Wizard1203/nllb-en-{lang}` |
| MT fallback | Google Translate (deep-translator) |

### Sign Language
- MediaPipe hand landmark detection
- Custom ANN classifier (`sign_model.pth`)
- Qwen 2.5 for sentence stitching (optional)

### Lip Reading
- LRS3 model (`LRS3_V_WER32.3.ini`)
- MediaPipe face detection

---

## Team Setup Notes

1. Each teammate needs their own `.env` files — **never commit `.env`**
2. Model folders (`lip_reading/`, `Sign-Language-Detection-*`) are gitignored — clone separately
3. `linguaai.db` is gitignored — each teammate gets a fresh database
4. Use `python -m uvicorn` not `uvicorn` to ensure correct Python environment

---

## Detailed Docs

- [Backend README](backend/README.md)
- [Frontend README](frontend/README.md)