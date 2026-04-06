// pages/LiveDemo.jsx
// Real inputs: MediaRecorder (speech), getUserMedia webcam (sign/lip), file upload fallback
import { useState, useRef, useEffect, useCallback } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const MODES = [
  { id: "speech", label: "Speech Translation", icon: "🎙️", color: "#6366F1", desc: "Speak → Translate → Clone Voice",   inputType: "audio",    external: false },
  { id: "sign",   label: "Sign Language",       icon: "✋", color: "#14B8A6", desc: "Opens in external app ↗",           inputType: "video",    external: true  },
  { id: "lip",    label: "Lip Reading",         icon: "👄", color: "#EC4899", desc: "Face Track → Visual Speech → Text", inputType: "video",    external: false },
];

const LANGS = ["English", "Hindi", "Tamil", "Telugu", "Kannada", "Malayalam"];

const PIPELINE_STEPS = {
  speech: ["ASR",  "NMT",    "TTS"],
  sign:   ["Pose", "Feature","AI Model"],
  lip:    ["Face", "Lip Feat","AI Model"],
};

// ─── helpers ────────────────────────────────────────────────────────────────

function getSupportedMimeType(kind) {
  const audio = ["audio/webm;codecs=opus","audio/webm","audio/ogg","audio/mp4"];
  const video = ["video/webm;codecs=vp9,opus","video/webm;codecs=vp8","video/webm","video/mp4"];
  const list  = kind === "audio" ? audio : video;
  return list.find((t) => MediaRecorder.isTypeSupported(t)) || "";
}

function mimeToExt(mime) {
  if (mime.includes("ogg"))  return "ogg";
  if (mime.includes("mp4"))  return "mp4";
  return "webm";
}

// ─── main component ──────────────────────────────────────────────────────────

export default function LiveDemo() {
  const [mode, setMode]           = useState("speech");
  const [lang, setLang]           = useState("Hindi");
  const [status, setStatus]       = useState("idle"); // idle|requesting|recording|processing|done|error
  const [transcript, setTranscript]   = useState("");
  const [translation, setTranslation] = useState("");
  const [confidence, setConfidence]   = useState(0);
  const [errorMsg, setErrorMsg]       = useState("");
  const [audioURL, setAudioURL]       = useState("");
  const [procStep, setProcStep]       = useState(0);
  const [expanded, setExpanded]       = useState(false);
  const [enableMT,  setEnableMT]      = useState(true);   // MT toggle
  const [enableTTS, setEnableTTS]     = useState(false);  // TTS toggle
  const [ttsAudio,  setTtsAudio]      = useState("");     // base64 TTS audio URL

  const mediaRecorderRef = useRef(null);
  const chunksRef        = useRef([]);
  const streamRef        = useRef(null);
  const videoRef         = useRef(null);
  const videoExpandRef   = useRef(null);
  const procTimerRef     = useRef(null);

  const activeMode = MODES.find((m) => m.id === mode);
  const c          = activeMode.color;

  // ── cleanup on mode switch / unmount ──
  const stopEverything = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    clearInterval(procTimerRef.current);
  }, []);

  const SIGN_URL = "https://project-brl7d-9uhvjcszw-neuralarchitect123-sources-projects.vercel.app";

  function switchMode(newMode) {
    if (newMode === "sign") {
      window.open(SIGN_URL, "_blank", "noopener,noreferrer");
      return;  // don't switch mode — open external site instead
    }
    stopEverything();
    setMode(newMode);
    resetOutput();
    setStatus("idle");
  }

  function resetOutput() {
    setTranscript(""); setTranslation(""); setConfidence(0);
    setErrorMsg(""); setAudioURL(""); setProcStep(0); setTtsAudio("");
  }

  useEffect(() => () => stopEverything(), [stopEverything]);

  // ── animate pipeline step indicator ──
  useEffect(() => {
    if (status === "processing") {
      setProcStep(0);
      const steps = PIPELINE_STEPS[mode].length;
      let i = 0;
      procTimerRef.current = setInterval(() => {
        i += 1;
        if (i < steps) setProcStep(i);
        else clearInterval(procTimerRef.current);
      }, 600);
    } else {
      clearInterval(procTimerRef.current);
    }
  }, [status, mode]);

  // ── START recording ──
  async function handleStart() {
    resetOutput();
    setStatus("requesting");

    try {
      const constraints =
        mode === "speech"
          ? { audio: true }
          : { video: { width: 640, height: 480, facingMode: "user" }, audio: false };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;

      if (videoRef.current && mode !== "speech") {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      }

      const mimeType = getSupportedMimeType(mode === "speech" ? "audio" : "video");
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const usedMime = recorder.mimeType || mimeType;
        const ext  = mimeToExt(usedMime);
        const blob = new Blob(chunksRef.current, { type: usedMime });
        if (mode === "speech") setAudioURL(URL.createObjectURL(blob));
        await sendToAPI(blob, ext);
      };

      recorder.start(250);
      setStatus("recording");
    } catch (err) {
      setStatus("error");
      setErrorMsg(
        err.name === "NotAllowedError" ? "Permission denied. Please allow microphone/camera access in your browser." :
        err.name === "NotFoundError"   ? "No microphone/camera found on this device." :
        `Could not access media: ${err.message}`
      );
    }
  }

  // ── STOP recording ──
  function handleStop() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }
    if (videoRef.current) videoRef.current.srcObject = null;
    setStatus("processing");
  }

  // ── Send blob to FastAPI ──
  async function sendToAPI(blob, ext) {
    setStatus("processing");
    const formData = new FormData();
    const fileName = mode === "speech" ? `audio.${ext}` : `video.${ext}`;

    if (mode === "speech") {
      formData.append("audio",      blob, fileName);
      formData.append("target_lang", lang);
      formData.append("enable_mt",  enableMT  ? "true" : "false");
      formData.append("enable_tts", enableTTS ? "true" : "false");
    } else {
      formData.append("video", blob, fileName);
    }

    const endpoint =
      mode === "speech" ? "/api/speech/translate" :
      mode === "sign"   ? "/api/sign/recognize"   :
                          "/api/lip/read";

    try {
      const res  = await fetch(`${API_BASE}${endpoint}`, { method: "POST", body: formData });
      if (!res.ok) throw new Error(`Server returned ${res.status}`);
      const data = await res.json();

      setTranscript(data.transcript  || data.text || "");
      setTranslation(data.translation || "");
      setConfidence(Math.round((data.confidence ?? 0) * 100));
      if (data.tts_audio) setTtsAudio(data.tts_audio);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setErrorMsg(`API error: ${err.message}. Is FastAPI running at ${API_BASE}?`);
    }
  }

  // ── File upload fallback ──
  function handleFileUpload(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    stopEverything();
    resetOutput();
    if (mode === "speech") setAudioURL(URL.createObjectURL(file));
    const ext = file.name.split(".").pop();
    sendToAPI(file, ext);
    e.target.value = "";
  }

  // ── sync stream to expanded modal video ──
  useEffect(() => {
    if (expanded && videoExpandRef.current && streamRef.current) {
      videoExpandRef.current.srcObject = streamRef.current;
      videoExpandRef.current.play().catch(() => {});
    }
    if (!expanded && videoExpandRef.current) {
      videoExpandRef.current.srcObject = null;
    }
  }, [expanded]);

  function toggleExpand() { setExpanded((v) => !v); }

  function handleCopy() {
    const text = translation || transcript;
    if (text) navigator.clipboard.writeText(text).catch(() => {});
  }

  // ─── render ─────────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Live Demo"
        sub="Real microphone & camera input — processed through the AI pipeline"
      />

      {/* Mode selector */}
      <div style={s.modeGrid}>
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => switchMode(m.id)}
            title={m.external ? "Opens in new tab" : m.label}
            style={{
              ...s.modeCard,
              ...(mode === m.id
                ? { border: `1.5px solid ${m.color}`, background: `${m.color}14`, boxShadow: `0 0 20px ${m.color}22` }
                : {}),
              ...(m.external
                ? { borderStyle: "dashed" }
                : {}),
            }}
          >
            <span style={{ fontSize: "26px" }}>{m.icon}</span>
            <div style={{ display: "flex", alignItems: "center", gap: "4px", justifyContent: "center" }}>
              <div style={{ ...s.modeLabel, ...(mode === m.id ? { color: "#fff" } : {}) }}>{m.label}</div>
              {m.external && (
                <span style={{ fontSize: "9px", color: "#14B8A6", fontWeight: 700, marginBottom: "1px" }}>↗</span>
              )}
            </div>
            <div style={s.modeDesc}>{m.desc}</div>
            {m.external && (
              <div style={{
                position: "absolute", top: "7px", right: "7px",
                fontSize: "8px", fontWeight: 700, padding: "2px 5px",
                borderRadius: "4px", background: "rgba(20,184,166,0.15)",
                color: "#14B8A6", border: "1px solid rgba(20,184,166,0.3)",
                letterSpacing: "0.5px",
              }}>
                EXT
              </div>
            )}
            {mode === m.id && !m.external && <div style={{ ...s.modePip, background: m.color }} />}
          </button>
        ))}
      </div>

      {/* Config row */}
      <div style={s.configRow}>
        {mode === "speech" && (
          <div style={s.configItem}>
            <label style={s.label}>Target Language</label>
            <select value={lang} onChange={(e) => setLang(e.target.value)} style={s.select}>
              {LANGS.map((l) => <option key={l}>{l}</option>)}
            </select>
          </div>
        )}
        <div style={s.configItem}>
          <label style={s.label}>Pipeline</label>
          <div style={{ ...s.pill, background: `${c}18`, border: `1px solid ${c}44`, color: c }}>
            {activeMode.icon} {activeMode.label}
          </div>
        </div>
        <div style={s.configItem}>
          <label style={s.label}>Upload File</label>
          <label style={{ ...s.uploadBtn, borderColor: `${c}55`, color: c }}>
            ⬆ {mode === "speech" ? "Audio file" : "Video file"}
            <input
              type="file"
              accept={mode === "speech" ? "audio/*" : "video/*"}
              onChange={handleFileUpload}
              style={{ display: "none" }}
            />
          </label>
        </div>

        {/* MT + TTS toggles — speech mode only */}
        {mode === "speech" && (
          <div style={s.configItem}>
            <label style={s.label}>Features</label>
            <div style={{ display: "flex", gap: "8px" }}>
              <button
                onClick={() => setEnableMT((v) => !v)}
                style={{
                  ...s.toggleBtn,
                  background: enableMT ? "rgba(99,102,241,0.15)" : "rgba(255,255,255,0.03)",
                  borderColor: enableMT ? "#6366F1" : "rgba(255,255,255,0.12)",
                  color: enableMT ? "#818CF8" : "#475569",
                }}
              >
                🔄 MT {enableMT ? "On" : "Off"}
              </button>
              <button
                onClick={() => setEnableTTS((v) => !v)}
                style={{
                  ...s.toggleBtn,
                  background: enableTTS ? "rgba(20,184,166,0.15)" : "rgba(255,255,255,0.03)",
                  borderColor: enableTTS ? "#14B8A6" : "rgba(255,255,255,0.12)",
                  color: enableTTS ? "#2DD4BF" : "#475569",
                }}
              >
                🔊 TTS {enableTTS ? "On" : "Off"}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Main area */}
      <div style={s.demoGrid}>

        {/* ── INPUT CARD ── */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Input</span>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <span style={{ ...s.badge, background: `${c}18`, color: c, border: `1px solid ${c}33` }}>
                {mode === "speech" ? "🎙 Microphone" : "📷 Camera"}
              </span>
              {(mode === "sign" || mode === "lip") && (
                <button
                  onClick={toggleExpand}
                  title="Enlarge camera"
                  style={{
                    ...s.expandBtn,
                    borderColor: expanded ? c : "rgba(255,255,255,0.12)",
                    color: expanded ? c : "#64748B",
                    background: expanded ? `${c}14` : "transparent",
                  }}
                >
                  {expanded ? "⊡" : "⊞"}
                </button>
              )}
            </div>
          </div>

          {/* SPEECH */}
          {mode === "speech" && (
            <div style={s.inputArea}>
              <div style={s.micZone}>
                <div style={{
                  ...s.micOuter,
                  ...(status === "recording"
                    ? { borderColor: c, boxShadow: `0 0 0 8px ${c}18, 0 0 0 18px ${c}08` }
                    : {}),
                }}>
                  <div style={{
                    ...s.micInner,
                    background: status === "recording" ? `${c}22` : "rgba(255,255,255,0.04)",
                  }}>
                    <span style={{ fontSize: "34px" }}>🎤</span>
                  </div>
                </div>
                <div style={s.hint}>
                  {status === "idle"        && "Press Record to start"}
                  {status === "requesting"  && <span style={{ color: "#FCD34D" }}>⏳ Requesting mic permission…</span>}
                  {status === "recording"   && <span style={{ color: c }}>● Recording — press Stop when done</span>}
                  {status === "processing"  && <span style={{ color: "#94A3B8" }}>Sending to pipeline…</span>}
                  {status === "done"        && <span style={{ color: "#4ADE80" }}>✓ Complete</span>}
                  {status === "error"       && <span style={{ color: "#F87171" }}>✗ Error — see below</span>}
                </div>
                {audioURL && (
                  <audio controls src={audioURL} style={s.audioPlayer} />
                )}
              </div>
            </div>
          )}

          {/* SIGN / LIP */}
          {(mode === "sign" || mode === "lip") && (
            <div style={s.inputArea}>
              <div style={s.cameraZone}>
                <div style={{
                  ...s.cameraFrame,
                  borderColor: status === "recording" ? c : "rgba(255,255,255,0.12)",
                  boxShadow: status === "recording" ? `0 0 16px ${c}33` : "none",
                }}>
                  {/* Live preview */}
                  <video
                    ref={videoRef}
                    muted
                    playsInline
                    style={{ ...s.videoEl, display: status === "recording" ? "block" : "none" }}
                  />

                  {/* Placeholder */}
                  {status !== "recording" && (
                    <div style={s.camPlaceholder}>
                      <span style={{ fontSize: "44px", opacity: 0.2 }}>
                        {mode === "sign" ? "✋" : "👄"}
                      </span>
                      <span style={{ fontSize: "11px", color: "#1E293B", marginTop: "8px" }}>
                        Camera preview
                      </span>
                    </div>
                  )}

                  {/* Corner brackets */}
                  {["tl","tr","bl","br"].map((p) => (
                    <div key={p} style={cornerStyle(p, c)} />
                  ))}

                  {status === "recording" && (
                    <div style={{ ...s.recBadge, borderColor: c, color: c }}>● LIVE</div>
                  )}

                  {status === "requesting" && (
                    <div style={s.permOverlay}>
                      <span style={{ fontSize: "11px", color: "#FCD34D" }}>⏳ Requesting camera…</span>
                    </div>
                  )}
                </div>

                <div style={s.hint}>
                  {status === "idle"       && "Press Record to open camera"}
                  {status === "requesting" && <span style={{ color: "#FCD34D" }}>Waiting for permission…</span>}
                  {status === "recording"  && <span style={{ color: c }}>● Live — press Stop when ready</span>}
                  {status === "processing" && <span style={{ color: "#94A3B8" }}>Running AI model…</span>}
                  {status === "done"       && <span style={{ color: "#4ADE80" }}>✓ Recognition complete</span>}
                  {status === "error"      && <span style={{ color: "#F87171" }}>✗ Error</span>}
                </div>
              </div>
            </div>
          )}

          {/* Error box */}
          {status === "error" && errorMsg && (
            <div style={s.errorBox}>{errorMsg}</div>
          )}

          {/* Controls */}
          <div style={s.ctrlRow}>
            {(status === "idle" || status === "done" || status === "error") && (
              <button
                onClick={handleStart}
                style={{ ...s.btn, background: c, boxShadow: `0 4px 16px ${c}44` }}
              >
                {status === "done" || status === "error" ? "↺ Record Again" : "⏺ Record"}
              </button>
            )}
            {(status === "recording" || status === "requesting") && (
              <button
                onClick={handleStop}
                disabled={status === "requesting"}
                style={{
                  ...s.btn,
                  background: status === "requesting" ? "#1E293B" : "#EF4444",
                  boxShadow: status === "requesting" ? "none" : "0 4px 16px rgba(239,68,68,0.4)",
                  cursor: status === "requesting" ? "not-allowed" : "pointer",
                  color: status === "requesting" ? "#475569" : "#fff",
                }}
              >
                ■ Stop
              </button>
            )}
            {status === "processing" && (
              <button disabled style={{ ...s.btn, background: "#0F172A", color: "#334155", cursor: "not-allowed" }}>
                ⏳ Processing…
              </button>
            )}
          </div>
        </div>

        {/* ── OUTPUT CARD ── */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Output</span>
            {status === "done" && confidence > 0 && (
              <span style={{ ...s.badge, background: "rgba(34,197,94,0.12)", color: "#4ADE80", border: "1px solid rgba(34,197,94,0.25)" }}>
                ✓ {confidence}% conf.
              </span>
            )}
          </div>

          <div style={s.outputArea}>

            {/* Pipeline step indicator */}
            {status === "processing" && (
              <div style={s.procWrapper}>
                <div style={s.procLabel}>Running pipeline</div>
                <div style={s.procRow}>
                  {PIPELINE_STEPS[mode].map((step, i) => (
                    <div key={step} style={{ display: "flex", alignItems: "center" }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "5px" }}>
                        <div style={{
                          ...s.procCircle,
                          background:   i <= procStep ? c           : "transparent",
                          borderColor:  i <= procStep ? c           : "rgba(255,255,255,0.12)",
                          boxShadow:    i === procStep ? `0 0 10px ${c}88` : "none",
                        }}>
                          {i < procStep
                            ? <span style={{ fontSize: "10px" }}>✓</span>
                            : i === procStep
                              ? <span style={s.spinDot} />
                              : null}
                        </div>
                        <span style={{ fontSize: "9px", color: i <= procStep ? "#94A3B8" : "#1E293B", fontWeight: 600 }}>
                          {step}
                        </span>
                      </div>
                      {i < PIPELINE_STEPS[mode].length - 1 && (
                        <div style={{
                          width: "28px", height: "2px", marginBottom: "14px",
                          background: i < procStep ? c : "rgba(255,255,255,0.06)",
                          transition: "background 0.3s",
                        }} />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Transcript */}
            {transcript && (
              <div style={s.outBlock}>
                <div style={s.outLabel}>
                  {mode === "speech" ? "Transcript" : "Recognized text"}
                </div>
                <div style={s.outText}>{transcript}</div>
              </div>
            )}

            {/* Translation */}
            {translation && (
              <div style={{ ...s.outBlock, borderLeftColor: c }}>
                <div style={{ ...s.outLabel, color: c }}>→ {lang}</div>
                <div style={{ ...s.outText, fontSize: "18px" }}>{translation}</div>
              </div>
            )}

            {/* MT disabled hint */}
            {mode === "speech" && status === "done" && !enableMT && (
              <div style={{ fontSize: "11px", color: "#475569", padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
                🔄 MT is off — enable it to see translation
              </div>
            )}

            {/* TTS disabled hint */}
            {mode === "speech" && status === "done" && !enableTTS && (
              <div style={{ fontSize: "11px", color: "#475569", padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.06)" }}>
                🔊 TTS is off — enable it to hear the translation spoken
              </div>
            )}

            {/* Idle */}
            {status === "idle" && (
              <div style={s.placeholder}>
                <span style={{ fontSize: "42px", opacity: 0.15 }}>
                  {mode === "speech" ? "🔊" : mode === "sign" ? "✋" : "👄"}
                </span>
                <span style={{ color: "#1E293B", fontSize: "13px", marginTop: "10px" }}>
                  Results will appear here
                </span>
              </div>
            )}

            {/* Error */}
            {status === "error" && !transcript && (
              <div style={s.placeholder}>
                <span style={{ fontSize: "34px" }}>⚠️</span>
                <span style={{ color: "#F87171", fontSize: "12px", marginTop: "8px", textAlign: "center", lineHeight: 1.5 }}>
                  {errorMsg}
                </span>
              </div>
            )}
          </div>

          {/* TTS audio output */}
          {status === "done" && ttsAudio && (
            <div style={{ marginTop: "4px" }}>
              <div style={{ fontSize: "10px", fontWeight: 600, color: "#14B8A6", letterSpacing: "0.8px", textTransform: "uppercase", marginBottom: "6px" }}>
                🔊 TTS Output
              </div>
              <audio
                controls
                src={ttsAudio}
                style={{ width: "100%", borderRadius: "8px", outline: "none" }}
              />
            </div>
          )}

          {/* Actions */}
          {status === "done" && (
            <div style={s.actionRow}>
              {mode === "speech" && audioURL && (
                <a
                  href={audioURL}
                  download="recording.webm"
                  style={{ ...s.actionBtn, textDecoration: "none", textAlign: "center" }}
                >
                  ⬇ Audio
                </a>
              )}
              <button onClick={handleCopy} style={s.actionBtn}>📋 Copy</button>
              <button
                onClick={() => {
                  const txt  = `Transcript: ${transcript}\nTranslation (${lang}): ${translation}`;
                  const url  = URL.createObjectURL(new Blob([txt], { type: "text/plain" }));
                  const a    = document.createElement("a");
                  a.href = url; a.download = "result.txt"; a.click();
                }}
                style={s.actionBtn}
              >
                ⬇ Export
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Fullscreen camera modal ── */}
      {expanded && (mode === "sign" || mode === "lip") && (
        <div style={s.modalBackdrop} onClick={() => setExpanded(false)}>
          <div style={{ ...s.modalBox, borderColor: c }} onClick={(e) => e.stopPropagation()}>

            {/* Modal header */}
            <div style={s.modalHeader}>
              <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                <span style={{ fontSize: "18px" }}>{activeMode.icon}</span>
                <span style={{ fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: "15px", color: "#fff" }}>
                  {activeMode.label} — Camera
                </span>
                {status === "recording" && (
                  <span style={{ ...s.livePill, borderColor: c, color: c }}>● LIVE</span>
                )}
              </div>
              <button onClick={() => setExpanded(false)} style={s.closeBtn}>✕</button>
            </div>

            {/* Big video */}
            <div style={{ ...s.modalVideoWrap, borderColor: status === "recording" ? c : "rgba(255,255,255,0.1)" }}>
              <video
                ref={videoExpandRef}
                muted
                playsInline
                style={{ ...s.modalVideo, display: status === "recording" ? "block" : "none" }}
              />
              {status !== "recording" && (
                <div style={s.modalPlaceholder}>
                  <span style={{ fontSize: "64px", opacity: 0.15 }}>
                    {mode === "sign" ? "✋" : "👄"}
                  </span>
                  <span style={{ fontSize: "13px", color: "#1E293B", marginTop: "12px" }}>
                    {status === "requesting" ? "Requesting camera permission…" : "Start recording to see live feed"}
                  </span>
                </div>
              )}
              {/* Corner brackets in modal */}
              {["tl","tr","bl","br"].map((p) => (
                <div key={p} style={cornerStyle(p, c)} />
              ))}
              {status === "recording" && (
                <div style={{ ...s.recBadge, borderColor: c, color: c, top: "12px", right: "14px", fontSize: "11px", padding: "3px 10px" }}>
                  ● LIVE
                </div>
              )}
            </div>

            {/* Modal controls */}
            <div style={s.modalControls}>
              <div style={{ fontSize: "12px", color: "#475569" }}>
                {status === "idle"       && "Camera is off — press Record below or in the main panel"}
                {status === "requesting" && <span style={{ color: "#FCD34D" }}>⏳ Waiting for permission…</span>}
                {status === "recording"  && <span style={{ color: c }}>● Recording in progress</span>}
                {status === "processing" && <span style={{ color: "#94A3B8" }}>Processing…</span>}
                {status === "done"       && <span style={{ color: "#4ADE80" }}>✓ Done — recording saved</span>}
                {status === "error"      && <span style={{ color: "#F87171" }}>✗ {errorMsg}</span>}
              </div>
              <div style={{ display: "flex", gap: "8px" }}>
                {(status === "idle" || status === "done" || status === "error") && (
                  <button
                    onClick={handleStart}
                    style={{ ...s.btn, background: c, boxShadow: `0 4px 16px ${c}44`, padding: "9px 24px" }}
                  >
                    ⏺ Record
                  </button>
                )}
                {(status === "recording" || status === "requesting") && (
                  <button
                    onClick={handleStop}
                    disabled={status === "requesting"}
                    style={{
                      ...s.btn,
                      background: status === "requesting" ? "#1E293B" : "#EF4444",
                      boxShadow: status === "requesting" ? "none" : "0 4px 16px rgba(239,68,68,0.4)",
                      cursor: status === "requesting" ? "not-allowed" : "pointer",
                      color: status === "requesting" ? "#475569" : "#fff",
                      padding: "9px 24px",
                    }}
                  >
                    ■ Stop
                  </button>
                )}
                <button
                  onClick={() => setExpanded(false)}
                  style={{ ...s.btn, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", padding: "9px 20px" }}
                >
                  ⊡ Collapse
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes spin  { to { transform: rotate(360deg); } }
        select option    { background: #0F1628; color: #E2E8F0; }
        audio            { filter: invert(0.85) hue-rotate(180deg); }
      `}</style>
    </div>
  );
}

// ─── corner bracket helper ───────────────────────────────────────────────────
function cornerStyle(pos, color) {
  const base = { position: "absolute", width: "12px", height: "12px", borderColor: color };
  const map  = {
    tl: { top:"7px",    left:"7px",    borderTop:`2px solid`,    borderLeft:`2px solid`,   borderRadius:"2px 0 0 0" },
    tr: { top:"7px",    right:"7px",   borderTop:`2px solid`,    borderRight:`2px solid`,  borderRadius:"0 2px 0 0" },
    bl: { bottom:"7px", left:"7px",    borderBottom:`2px solid`, borderLeft:`2px solid`,   borderRadius:"0 0 0 2px" },
    br: { bottom:"7px", right:"7px",   borderBottom:`2px solid`, borderRight:`2px solid`,  borderRadius:"0 0 2px 0" },
  };
  return { ...base, ...map[pos] };
}

// ─── PageHeader ──────────────────────────────────────────────────────────────
function PageHeader({ title, sub }) {
  return (
    <div style={{ marginBottom: "28px" }}>
      <h1 style={{ fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "26px", color: "#fff", marginBottom: "6px" }}>
        {title}
      </h1>
      <p style={{ color: "#64748B", fontSize: "13px" }}>{sub}</p>
    </div>
  );
}

// ─── styles ──────────────────────────────────────────────────────────────────
const s = {
  modeGrid: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: "12px", marginBottom: "20px" },
  modeCard: {
    display: "flex", flexDirection: "column", alignItems: "center", gap: "6px",
    padding: "18px 12px", borderRadius: "14px",
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
    cursor: "pointer", transition: "all 0.2s", position: "relative",
    color: "#E2E8F0", fontFamily: "'DM Sans',sans-serif",
  },
  modeLabel: { fontSize: "12px", fontWeight: 600, color: "#94A3B8", textAlign: "center" },
  modeDesc:  { fontSize: "10px", color: "#475569", textAlign: "center", lineHeight: 1.4 },
  modePip:   { position: "absolute", top: "10px", right: "10px", width: "6px", height: "6px", borderRadius: "50%" },

  configRow:  { display: "flex", gap: "16px", marginBottom: "20px", flexWrap: "wrap", alignItems: "flex-end" },
  configItem: { display: "flex", flexDirection: "column", gap: "6px" },
  label:      { fontSize: "11px", fontWeight: 600, color: "#475569", letterSpacing: "0.8px", textTransform: "uppercase" },
  select:     {
    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: "8px", color: "#E2E8F0", padding: "8px 12px", fontSize: "13px",
    fontFamily: "'DM Sans',sans-serif", cursor: "pointer", outline: "none",
  },
  pill:       { padding: "8px 14px", borderRadius: "8px", fontSize: "12px", fontWeight: 500 },
  uploadBtn:  {
    display: "inline-block", padding: "8px 14px", borderRadius: "8px",
    fontSize: "12px", fontWeight: 500, border: "1px dashed",
    cursor: "pointer", transition: "all 0.2s",
  },

  demoGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" },
  card: {
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)",
    borderRadius: "16px", padding: "20px", display: "flex", flexDirection: "column", gap: "16px",
  },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center" },
  cardTitle:  { fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: "14px", color: "#fff" },
  badge:      { fontSize: "11px", fontWeight: 600, padding: "4px 10px", borderRadius: "100px" },

  inputArea:   { flex: 1, minHeight: "200px", display: "flex", alignItems: "center", justifyContent: "center" },

  // Mic (speech)
  micZone:  { display: "flex", flexDirection: "column", alignItems: "center", gap: "16px", width: "100%" },
  micOuter: {
    width: "88px", height: "88px", borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.1)",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "all 0.4s",
  },
  micInner: {
    width: "68px", height: "68px", borderRadius: "50%",
    display: "flex", alignItems: "center", justifyContent: "center",
    transition: "background 0.3s",
  },
  audioPlayer: {
    width: "100%", borderRadius: "8px", outline: "none", marginTop: "4px",
  },

  // Camera (sign/lip)
  cameraZone:  { display: "flex", flexDirection: "column", alignItems: "center", gap: "14px", width: "100%" },
  cameraFrame: {
    width: "100%", maxWidth: "290px", aspectRatio: "4/3",
    border: "1px solid", borderRadius: "10px",
    position: "relative", background: "#000", overflow: "hidden",
    transition: "border-color 0.3s, box-shadow 0.3s",
  },
  videoEl: {
    width: "100%", height: "100%", objectFit: "cover",
    borderRadius: "9px", transform: "scaleX(-1)",
  },
  camPlaceholder: {
    position: "absolute", inset: 0,
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
  },
  recBadge: {
    position: "absolute", top: "8px", right: "10px",
    fontSize: "9px", fontWeight: 700, border: "1px solid",
    padding: "2px 7px", borderRadius: "4px", letterSpacing: "0.5px",
    background: "rgba(0,0,0,0.65)",
  },
  permOverlay: {
    position: "absolute", inset: 0, background: "rgba(0,0,0,0.7)",
    display: "flex", alignItems: "center", justifyContent: "center",
    borderRadius: "9px",
  },

  hint: { fontSize: "13px", color: "#64748B", textAlign: "center" },

  errorBox: {
    background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)",
    borderRadius: "8px", padding: "10px 12px", fontSize: "12px", color: "#F87171", lineHeight: 1.5,
  },

  ctrlRow: { display: "flex", justifyContent: "center" },
  btn: {
    padding: "10px 32px", borderRadius: "10px", border: "none",
    color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
    fontSize: "13px", cursor: "pointer", transition: "all 0.2s",
  },

  // Output
  outputArea: { flex: 1, minHeight: "200px", display: "flex", flexDirection: "column", gap: "16px", justifyContent: "center" },

  procWrapper: { display: "flex", flexDirection: "column", gap: "10px" },
  procLabel:   { fontSize: "10px", fontWeight: 600, color: "#334155", letterSpacing: "0.8px", textTransform: "uppercase" },
  procRow:     { display: "flex", alignItems: "center" },
  procCircle:  {
    width: "28px", height: "28px", borderRadius: "50%",
    border: "2px solid", display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "11px", color: "#fff", transition: "all 0.35s", flexShrink: 0,
  },
  spinDot: {
    display: "inline-block", width: "10px", height: "10px", borderRadius: "50%",
    border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff",
    animation: "spin 0.7s linear infinite",
  },

  outBlock: {
    borderLeft: "3px solid rgba(255,255,255,0.1)",
    paddingLeft: "12px", display: "flex", flexDirection: "column", gap: "4px",
  },
  outLabel: { fontSize: "10px", fontWeight: 600, color: "#64748B", letterSpacing: "0.8px", textTransform: "uppercase" },
  outText:  { fontSize: "15px", color: "#E2E8F0", lineHeight: 1.6 },
  placeholder: {
    display: "flex", flexDirection: "column", alignItems: "center",
    justifyContent: "center", flex: 1, gap: "4px",
  },

  actionRow: { display: "flex", gap: "8px" },
  toggleBtn: {
    padding: "7px 12px", borderRadius: "8px",
    border: "1px solid", fontSize: "11px", fontWeight: 600,
    cursor: "pointer", transition: "all 0.2s",
    fontFamily: "'DM Sans',sans-serif",
  },
  actionBtn: {
    flex: 1, padding: "9px", borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)", color: "#94A3B8", fontSize: "11px",
    fontFamily: "'DM Sans',sans-serif", cursor: "pointer", transition: "all 0.2s",
  },

  // Expand button (small icon button in card header)
  expandBtn: {
    width: "28px", height: "28px", borderRadius: "7px",
    border: "1px solid", background: "transparent",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: "15px", cursor: "pointer", transition: "all 0.2s",
    fontFamily: "monospace",
  },

  // Modal overlay
  modalBackdrop: {
    position: "fixed", inset: 0, zIndex: 1000,
    background: "rgba(5,8,18,0.85)",
    backdropFilter: "blur(8px)",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "24px",
  },
  modalBox: {
    width: "100%", maxWidth: "860px",
    background: "#0A0F20",
    border: "1px solid",
    borderRadius: "20px",
    overflow: "hidden",
    display: "flex", flexDirection: "column",
    boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
  },
  modalHeader: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "16px 20px",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    background: "rgba(255,255,255,0.02)",
  },
  livePill: {
    fontSize: "10px", fontWeight: 700, border: "1px solid",
    padding: "3px 9px", borderRadius: "100px", letterSpacing: "0.5px",
  },
  closeBtn: {
    width: "30px", height: "30px", borderRadius: "8px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.04)", color: "#64748B",
    fontSize: "13px", cursor: "pointer", display: "flex",
    alignItems: "center", justifyContent: "center", transition: "all 0.2s",
  },
  modalVideoWrap: {
    position: "relative",
    background: "#000",
    border: "none",
    aspectRatio: "16/9",
    overflow: "hidden",
    borderTop: "1px solid",
    borderBottom: "1px solid rgba(255,255,255,0.07)",
    transition: "border-color 0.3s",
  },
  modalVideo: {
    width: "100%", height: "100%", objectFit: "cover",
    transform: "scaleX(-1)", display: "block",
  },
  modalPlaceholder: {
    position: "absolute", inset: 0,
    display: "flex", flexDirection: "column",
    alignItems: "center", justifyContent: "center",
    background: "#050812",
  },
  modalControls: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "14px 20px", gap: "12px", flexWrap: "wrap",
    background: "rgba(255,255,255,0.02)",
  },
};