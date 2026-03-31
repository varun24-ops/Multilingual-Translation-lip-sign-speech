// pages/About.jsx
import { useState } from "react";

const PIPELINES = [
  {
    id: "speech",
    label: "Speech Translation",
    icon: "🎙️",
    color: "#6366F1",
    steps: [
      { icon: "🎤", title: "User Speech Input", desc: "Raw audio captured from microphone in real time." },
      { icon: "🌍", title: "Multilingual ASR", desc: "Automatic Speech Recognition transcribes audio to text across 50+ languages." },
      { icon: "🔄", title: "Machine Translation", desc: "Neural Machine Translation (NMT) converts source text to the target language." },
      { icon: "🧠", title: "Feature Extraction", desc: "Real-time vocal features extracted for voice cloning alignment." },
      { icon: "🎭", title: "Voice Clone Module", desc: "Synthesizes translated speech in the user's cloned voice using TTS." },
      { icon: "🔊", title: "Playback Cloned Voice",desc: "Final translated audio played back in the speaker's own vocal identity." },
    ],
  },
  {
    id: "sign",
    label: "Sign Language",
    icon: "✋",
    color: "#14B8A6",
    steps: [
      { icon: "📹", title: "Video Input",             desc: "Camera feed captured at high frame rate for motion clarity." },
      { icon: "🤚", title: "Pose & Hand Tracking",   desc: "MediaPipe / OpenPose tracks 21 hand keypoints and body skeleton per frame." },
      { icon: "⚙️", title: "Feature Extraction",     desc: "Spatial-temporal features extracted from tracked keypoint sequences." },
      { icon: "🤖", title: "AI Deep Learning Model", desc: "LSTM / Transformer classifier recognizes sign gestures from feature vectors." },
      { icon: "📝", title: "Text Generation",         desc: "Recognized gestures mapped to words and assembled into coherent sentences." },
      { icon: "🖥️", title: "Displayed Text Output",  desc: "Translated text rendered on screen with confidence score." },
    ],
  },
  {
    id: "lip",
    label: "Lip Reading",
    icon: "👄",
    color: "#EC4899",
    steps: [
      { icon: "📹", title: "Video Input",             desc: "Close-up or standard camera feed used as input." },
      { icon: "😶", title: "Face & Mouth Tracking",  desc: "Facial landmark detection isolates lip region with high precision." },
      { icon: "👁️", title: "Lip Feature Extraction", desc: "Geometric and texture features extracted from lip movement sequences." },
      { icon: "🤖", title: "AI Visual Speech Model", desc: "Deep CNN + RNN model classifies visual phonemes from lip movements." },
      { icon: "📝", title: "Text Generation",         desc: "Phoneme sequences decoded into words using a language model." },
      { icon: "🖥️", title: "Displayed Text Output",  desc: "Final transcribed text shown with timing and confidence data." },
    ],
  },
];

const TECH_STACK = [
  { layer: "Frontend", items: [
    { name: "React 18",    desc: "UI framework",            tag: "UI" },
    { name: "Vite",        desc: "Build tool",              tag: "Build" },
    { name: "TailwindCSS", desc: "Utility styling",         tag: "Style" },
  ]},
  { layer: "Backend", items: [
    { name: "FastAPI",     desc: "REST + WebSocket server", tag: "API" },
    { name: "Python 3.11", desc: "Runtime",                 tag: "Runtime" },
    { name: "Uvicorn",     desc: "ASGI server",             tag: "Server" },
  ]},
  { layer: "AI / ML", items: [
    { name: "Whisper",     desc: "OpenAI ASR model",        tag: "ASR" },
    { name: "Seamless M4T",desc: "Meta NMT model",          tag: "NMT" },
    { name: "MediaPipe",   desc: "Pose & hand tracking",    tag: "CV" },
    { name: "LipNet",      desc: "Lip reading model",       tag: "Visual" },
    { name: "Coqui TTS",   desc: "Voice synthesis + clone", tag: "TTS" },
  ]},
];

const TAG_COLORS = {
  UI: "#6366F1", Build: "#6366F1", Style: "#6366F1",
  API: "#00D9FF", Runtime: "#00D9FF", Server: "#00D9FF",
  ASR: "#14B8A6", NMT: "#14B8A6", CV: "#14B8A6", Visual: "#EC4899", TTS: "#F59E0B",
};

export default function About() {
  const [active, setActive] = useState("speech");
  const pipeline = PIPELINES.find((p) => p.id === active);
  const c = pipeline.color;

  return (
    <div>
      <h1 style={s.pageTitle}>How It Works</h1>
      <p style={s.pageSub}>
        Three AI pipelines unified into one multilingual communication system.
        Built with React + FastAPI, powered by state-of-the-art speech and vision models.
      </p>

      {/* Pipeline selector */}
      <div style={s.pipelineSelector}>
        {PIPELINES.map((p) => (
          <button
            key={p.id}
            onClick={() => setActive(p.id)}
            style={{
              ...s.pipeBtn,
              ...(active === p.id
                ? { border: `1.5px solid ${p.color}`, background: `${p.color}14`, color: "#fff" }
                : {}),
            }}
          >
            <span style={{ fontSize: "20px" }}>{p.icon}</span>
            <span style={{ fontSize: "13px", fontWeight: 500 }}>{p.label}</span>
          </button>
        ))}
      </div>

      {/* Pipeline steps */}
      <div style={{ ...s.card, marginBottom: "20px" }}>
        <div style={s.cardHeader}>
          <span style={{ ...s.cardTitle, color: c }}>{pipeline.icon} {pipeline.label} Pipeline</span>
          <span style={{ fontSize: "12px", color: "#475569" }}>{pipeline.steps.length} stages</span>
        </div>
        <div style={s.stepsGrid}>
          {pipeline.steps.map((step, i) => (
            <div key={i} style={s.stepWrapper}>
              <div style={s.stepCard}>
                <div style={{ ...s.stepNum, background: `${c}18`, color: c, border: `1px solid ${c}33` }}>
                  {i + 1}
                </div>
                <div style={{ fontSize: "22px", margin: "8px 0" }}>{step.icon}</div>
                <div style={s.stepTitle}>{step.title}</div>
                <div style={s.stepDesc}>{step.desc}</div>
              </div>
              {i < pipeline.steps.length - 1 && (
                <div style={s.stepArrow}>
                  <svg width="20" height="16" viewBox="0 0 20 16" fill="none">
                    <path d="M0 8h16M10 2l6 6-6 6" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.6"/>
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Architecture overview */}
      <div style={s.archRow}>
        <div style={s.card}>
          <div style={{ ...s.cardHeader, marginBottom: "16px" }}>
            <span style={s.cardTitle}>Tech Stack</span>
          </div>
          {TECH_STACK.map((layer) => (
            <div key={layer.layer} style={s.layerBlock}>
              <div style={s.layerLabel}>{layer.layer}</div>
              <div style={s.techItems}>
                {layer.items.map((item) => (
                  <div key={item.name} style={s.techItem}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={s.techName}>{item.name}</span>
                      <span style={{ ...s.techTag, background: `${TAG_COLORS[item.tag]}18`, color: TAG_COLORS[item.tag], border: `1px solid ${TAG_COLORS[item.tag]}33` }}>
                        {item.tag}
                      </span>
                    </div>
                    <span style={s.techDesc}>{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* FastAPI integration box */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={s.card}>
            <div style={s.cardTitle}>FastAPI Endpoints</div>
            <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { method: "POST", path: "/api/speech/translate",  desc: "Audio → translated text + audio" },
                { method: "POST", path: "/api/sign/recognize",    desc: "Video frames → text output" },
                { method: "POST", path: "/api/lip/read",          desc: "Lip video → transcribed text" },
                { method: "WS",   path: "/ws/stream",             desc: "Real-time streaming pipeline" },
                { method: "GET",  path: "/api/health",            desc: "Pipeline health check" },
              ].map((ep) => (
                <div key={ep.path} style={s.endpoint}>
                  <span style={{
                    ...s.method,
                    background: ep.method === "GET" ? "rgba(34,197,94,0.12)" : ep.method === "WS" ? "rgba(245,158,11,0.12)" : "rgba(99,102,241,0.12)",
                    color: ep.method === "GET" ? "#4ADE80" : ep.method === "WS" ? "#FCD34D" : "#A5B4FC",
                  }}>
                    {ep.method}
                  </span>
                  <div>
                    <div style={{ fontFamily: "monospace", fontSize: "11px", color: "#94A3B8" }}>{ep.path}</div>
                    <div style={{ fontSize: "10px", color: "#475569", marginTop: "1px" }}>{ep.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ ...s.card, background: "rgba(99,102,241,0.06)", border: "1px solid rgba(99,102,241,0.2)" }}>
            <div style={s.cardTitle}>Quick Start</div>
            <pre style={s.code}>{`# Backend
pip install fastapi uvicorn
uvicorn main:app --reload

# Frontend
npm install
npm run dev`}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

const s = {
  pageTitle: { fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "26px", color: "#fff", marginBottom: "8px" },
  pageSub:   { color: "#64748B", fontSize: "13px", lineHeight: 1.6, marginBottom: "24px", maxWidth: "600px" },

  pipelineSelector: { display: "flex", gap: "10px", marginBottom: "20px" },
  pipeBtn: {
    display: "flex", alignItems: "center", gap: "8px",
    padding: "10px 18px", borderRadius: "12px",
    border: "1px solid rgba(255,255,255,0.08)",
    background: "rgba(255,255,255,0.03)", color: "#64748B",
    fontFamily: "'DM Sans',sans-serif", cursor: "pointer", transition: "all 0.2s",
  },

  card: {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "16px", padding: "20px",
  },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" },
  cardTitle:  { fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: "14px", color: "#fff" },

  stepsGrid: {
    display: "flex", alignItems: "flex-start", gap: "0",
    overflowX: "auto", paddingBottom: "4px",
  },
  stepWrapper: { display: "flex", alignItems: "center", flex: "0 0 auto" },
  stepCard: {
    width: "130px", padding: "14px 10px", borderRadius: "12px",
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
    display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
  },
  stepNum: {
    width: "22px", height: "22px", borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "11px", fontWeight: 700,
  },
  stepTitle: { fontSize: "11px", fontWeight: 600, color: "#E2E8F0", marginBottom: "4px", lineHeight: 1.3 },
  stepDesc:  { fontSize: "10px", color: "#475569", lineHeight: 1.4 },
  stepArrow: { padding: "0 4px", flexShrink: 0, display: "flex", alignItems: "center" },

  archRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" },
  layerBlock: { marginBottom: "16px" },
  layerLabel: { fontSize: "10px", fontWeight: 700, letterSpacing: "1px", textTransform: "uppercase", color: "#334155", marginBottom: "8px" },
  techItems:  { display: "flex", flexDirection: "column", gap: "6px" },
  techItem: {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: "8px", padding: "8px 10px", display: "flex", flexDirection: "column", gap: "2px",
  },
  techName: { fontSize: "12px", fontWeight: 500, color: "#E2E8F0" },
  techTag:  { fontSize: "9px", fontWeight: 700, padding: "2px 7px", borderRadius: "100px" },
  techDesc: { fontSize: "10px", color: "#475569" },

  endpoint: {
    display: "flex", alignItems: "flex-start", gap: "10px",
    padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
  },
  method: { fontSize: "9px", fontWeight: 700, padding: "3px 6px", borderRadius: "4px", flexShrink: 0, marginTop: "2px", letterSpacing: "0.5px" },

  code: {
    background: "rgba(0,0,0,0.3)", border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "8px", padding: "12px", fontFamily: "monospace",
    fontSize: "11px", color: "#94A3B8", lineHeight: 1.7, marginTop: "12px", overflowX: "auto",
  },
};
