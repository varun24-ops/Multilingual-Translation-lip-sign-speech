// pages/Auth.jsx — Login + Register
import { useState } from "react";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

export default function Auth({ onLogin }) {
  const [tab, setTab]         = useState("login");   // login | register
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");

  // login fields
  const [loginEmail, setLoginEmail]       = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // register fields
  const [regEmail, setRegEmail]         = useState("");
  const [regUsername, setRegUsername]   = useState("");
  const [regPassword, setRegPassword]   = useState("");
  const [regConfirm, setRegConfirm]     = useState("");

  async function handleLogin(e) {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/users/login`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: loginEmail, password: loginPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Login failed");
      localStorage.setItem("token", data.token);                      // ← was data.access_token
      localStorage.setItem("user",  JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError("");
    if (regPassword !== regConfirm) { setError("Passwords do not match"); return; }
    setLoading(true);
    try {
      const res  = await fetch(`${API_BASE}/api/users/register`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ email: regEmail, username: regUsername, password: regPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Registration failed");
      localStorage.setItem("token", data.token);                      // ← was data.access_token
      localStorage.setItem("user",  JSON.stringify(data.user));
      onLogin(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.orb1} /><div style={s.orb2} />

      <div style={s.card}>
        {/* Logo */}
        <div style={s.logoRow}>
          <span style={s.logoIcon}>🌐</span>
          <div>
            <div style={s.logoTitle}>Unicomm</div>
            <div style={s.logoSub}>Multilingual Communication System</div>
          </div>
        </div>

        {/* Tab switcher */}
        <div style={s.tabs}>
          {["login","register"].map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(""); }}
              style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
            >
              {t === "login" ? "Sign In" : "Create Account"}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && <div style={s.errorBox}>{error}</div>}

        {/* Login form */}
        {tab === "login" && (
          <form onSubmit={handleLogin} style={s.form}>
            <Field label="Email"    type="email"    value={loginEmail}    onChange={setLoginEmail}    placeholder="you@example.com" />
            <Field label="Password" type="password" value={loginPassword} onChange={setLoginPassword} placeholder="••••••••" />
            <button type="submit" disabled={loading} style={{ ...s.submitBtn, opacity: loading ? 0.7 : 1 }}>
              {loading ? "Signing in…" : "Sign In"}
            </button>
            <p style={s.switchText}>
              Don't have an account?{" "}
              <span style={s.switchLink} onClick={() => setTab("register")}>Create one</span>
            </p>
          </form>
        )}

        {/* Register form */}
        {tab === "register" && (
          <form onSubmit={handleRegister} style={s.form}>
            <Field label="Email"            type="email"    value={regEmail}    onChange={setRegEmail}    placeholder="you@example.com" />
            <Field label="Username"         type="text"     value={regUsername} onChange={setRegUsername} placeholder="yourname" />
            <Field label="Password"         type="password" value={regPassword} onChange={setRegPassword} placeholder="Min 8 characters" />
            <Field label="Confirm Password" type="password" value={regConfirm}  onChange={setRegConfirm}  placeholder="Repeat password" />
            <button type="submit" disabled={loading} style={{ ...s.submitBtn, opacity: loading ? 0.7 : 1 }}>
              {loading ? "Creating account…" : "Create Account"}
            </button>
            <p style={s.switchText}>
              Already have an account?{" "}
              <span style={s.switchLink} onClick={() => setTab("login")}>Sign in</span>
            </p>
          </form>
        )}

        {/* Guest mode */}
        <div style={s.divider}><span>or</span></div>
        <button onClick={() => onLogin(null)} style={s.guestBtn}>
          Continue as Guest
        </button>
        <p style={{ fontSize: "10px", color: "#334155", textAlign: "center", marginTop: "8px" }}>
          Guest sessions are not saved to your profile
        </p>
      </div>
    </div>
  );
}

function Field({ label, type, value, onChange, placeholder }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
      <label style={{ fontSize: "11px", fontWeight: 600, color: "#475569", letterSpacing: "0.8px", textTransform: "uppercase" }}>
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required
        style={{
          background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: "8px", color: "#E2E8F0", padding: "10px 14px", fontSize: "13px",
          fontFamily: "'DM Sans',sans-serif", outline: "none", width: "100%",
        }}
      />
    </div>
  );
}

const s = {
  page: {
    minHeight: "100vh", background: "#050812",
    display: "flex", alignItems: "center", justifyContent: "center",
    padding: "24px", position: "relative", overflow: "hidden",
    fontFamily: "'DM Sans', sans-serif",
  },
  orb1: { position: "fixed", top: "-100px", left: "-80px", width: "400px", height: "400px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)", pointerEvents: "none" },
  orb2: { position: "fixed", bottom: "-80px", right: "-60px", width: "350px", height: "350px", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,217,255,0.1) 0%, transparent 70%)", pointerEvents: "none" },

  card: {
    width: "100%", maxWidth: "420px",
    background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: "20px", padding: "32px",
    display: "flex", flexDirection: "column", gap: "20px",
    position: "relative", zIndex: 1,
  },

  logoRow:   { display: "flex", alignItems: "center", gap: "12px" },
  logoIcon:  { fontSize: "32px" },
  logoTitle: { fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "18px", color: "#fff" },
  logoSub:   { fontSize: "10px", color: "#475569", marginTop: "2px" },

  tabs:      { display: "flex", gap: "4px", background: "rgba(255,255,255,0.04)", padding: "4px", borderRadius: "10px", border: "1px solid rgba(255,255,255,0.07)" },
  tab:       { flex: 1, padding: "9px", borderRadius: "7px", border: "none", background: "transparent", color: "#64748B", fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.2s" },
  tabActive: { background: "rgba(99,102,241,0.15)", color: "#fff", border: "1px solid rgba(99,102,241,0.25)" },

  errorBox:  { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "8px", padding: "10px 12px", fontSize: "12px", color: "#F87171" },

  form:      { display: "flex", flexDirection: "column", gap: "14px" },
  submitBtn: {
    padding: "12px", borderRadius: "10px", border: "none",
    background: "linear-gradient(135deg, #6366F1, #818CF8)",
    color: "#fff", fontFamily: "'DM Sans',sans-serif", fontWeight: 600,
    fontSize: "14px", cursor: "pointer", transition: "all 0.2s",
    boxShadow: "0 4px 16px rgba(99,102,241,0.4)", marginTop: "4px",
  },
  switchText: { fontSize: "12px", color: "#475569", textAlign: "center", margin: 0 },
  switchLink: { color: "#818CF8", cursor: "pointer", textDecoration: "underline" },

  divider: {
    display: "flex", alignItems: "center", gap: "12px",
    fontSize: "11px", color: "#334155",
  },
  guestBtn: {
    padding: "10px", borderRadius: "10px",
    border: "1px solid rgba(255,255,255,0.1)",
    background: "rgba(255,255,255,0.03)", color: "#94A3B8",
    fontFamily: "'DM Sans',sans-serif", fontWeight: 500, fontSize: "13px",
    cursor: "pointer", transition: "all 0.2s",
  },
};