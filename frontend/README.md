# Unicomm — Frontend

React + Vite frontend for the Unicomm multilingual communication system.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | React 18 |
| Build tool | Vite 5 |
| Fonts | Syne (headings) + DM Sans (body) via Google Fonts |
| Styling | Inline React styles (no CSS framework needed) |
| State | React hooks (useState, useEffect, useCallback, useRef) |
| Auth | JWT stored in localStorage |
| Media | MediaRecorder API (mic + camera) |

---

## Project Structure

```
frontend/
├── src/
│   ├── App.jsx              ← Root layout, sidebar, auth state, health check
│   ├── main.jsx             ← React entry point
│   └── pages/
│       ├── LiveDemo.jsx     ← Speech / Sign / Lip recording UI
│       ├── Dashboard.jsx    ← Analytics fetched from FastAPI
│       ├── About.jsx        ← Pipeline explainer + tech stack
│       └── Auth.jsx         ← Login + Register page
├── public/
├── index.html               ← HTML entry with Google Fonts
├── vite.config.js           ← Vite config with API proxy
├── package.json
└── .env.example             ← Copy to .env
```

---

## Prerequisites

- Node.js 18+ 
- npm 9+

Check versions:
```bash
node --version
npm --version
```

---

## Setup

### 1. Install dependencies

```bash
cd frontend
npm install
```

### 2. Configure environment

```bash
# Windows
copy .env.example .env

# Mac/Linux
cp .env.example .env
```

Default `.env`:
```dotenv
VITE_API_URL=http://localhost:8000
```

Change `VITE_API_URL` only if your backend runs on a different port.

### 3. Start development server

```bash
npm run dev
```

App runs at: `http://localhost:5173`

> **Note:** Make sure the backend is also running at `http://localhost:8000` before using the app.

---

## Pages

### Live Demo (`/`)
- **Speech Translation** — records mic audio → sends to `/api/speech/translate` → shows transcript + translation
- **Sign Language** — opens external sign language app in new tab
- **Lip Reading** — records webcam → sends to `/api/lip/read` → shows recognized text
- File upload fallback for all modes
- Expandable fullscreen camera view

### Dashboard
- Fetches real data from `/api/sessions/stats`, `/api/sessions`, `/api/sessions/health`
- Bar chart of daily sessions
- Language distribution
- Pipeline health (latency + uptime)
- Auto-refreshes every 30 seconds

### How It Works
- Step-by-step pipeline explanation for each mode
- Tech stack reference
- FastAPI endpoint reference

---

## Build for Production

```bash
npm run build
```

Output goes to `frontend/dist/` — deploy this folder to any static host (Vercel, Netlify, etc.).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | `http://localhost:8000` | Backend FastAPI URL |

---

## Browser Requirements

| Feature | Required for |
|---|---|
| `MediaRecorder` API | Speech recording, Lip reading |
| `getUserMedia` API | Camera access for Lip reading |
| HTTPS or localhost | Camera/mic access (browsers block on non-HTTPS) |

> All modern browsers (Chrome 88+, Firefox 86+, Edge 88+) support these APIs.  
> Safari has limited `MediaRecorder` support — Chrome is recommended.

---

## Common Issues

**Sidebar shows red "API offline"**
→ Backend is not running. Start it with `python -m uvicorn main:app --reload` in `backend/app/`.

**Camera/mic permission denied**
→ Allow browser permissions when prompted. On Chrome: click the lock icon in the address bar → reset permissions.

**`npm install` fails**
→ Make sure Node.js 18+ is installed: `node --version`

**Blank page after `npm run dev`**
→ Check browser console (F12) for errors. Most common cause: missing `.env` file.

**CORS error in console**
→ Make sure `FRONTEND_URL=http://localhost:5173` is set in backend `.env`.