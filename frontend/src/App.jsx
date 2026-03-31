// App.jsx — Root with auth + navigation + health check
import { useState, useEffect, useCallback } from "react";
import LiveDemo  from "./pages/LiveDemo";
import Dashboard from "./pages/Dashboard";
import About     from "./pages/About";
import Auth      from "./pages/Auth";

const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:8000";

const NAV = [
  { id: "demo",      label: "Live Demo",    icon: "⚡" },
  { id: "dashboard", label: "Dashboard",    icon: "📊" },
  { id: "about",     label: "How It Works", icon: "🧠" },
];

export default function App() {
  const [page, setPage]           = useState("demo");
  const [apiStatus, setApiStatus] = useState("checking");
  const [user, setUser]           = useState(() => {
    try { return JSON.parse(localStorage.getItem("user")) || null; }
    catch { return null; }
  });
  const [showAuth, setShowAuth]   = useState(false);

  // ── health check ───────────────────────────────────────────────────────
  const checkHealth = useCallback(() => {
    setApiStatus("checking");
    fetch(`${API_BASE}/api/health`, { signal: AbortSignal.timeout(4000) })
      .then((res) => res.ok ? setApiStatus("connected") : setApiStatus("disconnected"))
      .catch(() => setApiStatus("disconnected"));
  }, []);

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 30000);
    return () => clearInterval(interval);
  }, [checkHealth]);

  // ── auth ───────────────────────────────────────────────────────────────
  function handleLogin(userData) {
    setUser(userData);
    setShowAuth(false);
  }

  function handleLogout() {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    setUser(null);
    setPage("demo");
  }

  // show auth page
  if (showAuth) {
    return <Auth onLogin={handleLogin} />;
  }

  return (
    <div style={s.root}>
      <div style={s.orb1} /><div style={s.orb2} /><div style={s.orb3} />

      {/* Sidebar */}
      <aside style={s.sidebar}>

        {/* Logo */}
        <div style={s.logo}>
          <span style={s.logoIcon}>🌐</span>
          <div>
            <div style={s.logoTitle}>Unicomm</div>
            <div style={s.logoSub}>v1.0 · multilingual</div>
          </div>
        </div>

        {/* Nav */}
        <nav style={s.nav}>
          {NAV.map((n) => (
            <button
              key={n.id}
              onClick={() => setPage(n.id)}
              style={{ ...s.navBtn, ...(page === n.id ? s.navActive : {}) }}
            >
              <span style={s.navIcon}>{n.icon}</span>
              <span>{n.label}</span>
              {page === n.id && <span style={s.navPip} />}
            </button>
          ))}
        </nav>

        {/* User section */}
        <div style={s.userSection}>
          {user ? (
            <div style={s.userCard}>
              <div style={s.userAvatar}>
                {user.username?.[0]?.toUpperCase() || "U"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={s.userName}>{user.username}</div>
                <div style={s.userEmail}>{user.email}</div>
              </div>
              <button onClick={handleLogout} style={s.logoutBtn} title="Logout">↩</button>
            </div>
          ) : (
            <button onClick={() => setShowAuth(true)} style={s.loginBtn}>
              Sign In / Register
            </button>
          )}
        </div>

        {/* API status */}
        <div
          onClick={apiStatus === "disconnected" ? checkHealth : undefined}
          style={{
            ...s.statusBar,
            background: apiStatus === "connected"    ? "rgba(0,255,100,0.05)"
                      : apiStatus === "checking"     ? "rgba(245,158,11,0.05)"
                      : "rgba(239,68,68,0.05)",
            border: `1px solid ${
              apiStatus === "connected"    ? "rgba(0,255,100,0.12)"
            : apiStatus === "checking"     ? "rgba(245,158,11,0.12)"
            : "rgba(239,68,68,0.18)"
            }`,
            cursor: apiStatus === "disconnected" ? "pointer" : "default",
          }}
        >
          <div style={{
            ...s.statusDot,
            background: apiStatus === "connected"    ? "#22C55E"
                      : apiStatus === "checking"     ? "#F59E0B"
                      : "#EF4444",
            boxShadow: `0 0 6px ${
              apiStatus === "connected"    ? "#22C55E"
            : apiStatus === "checking"     ? "#F59E0B"
            : "#EF4444"
            }`,
          }} />
          <span style={{
            ...s.statusText,
            color: apiStatus === "connected"    ? "#4ADE80"
                 : apiStatus === "checking"     ? "#FCD34D"
                 : "#F87171",
          }}>
            {apiStatus === "connected"    && "FastAPI connected"}
            {apiStatus === "checking"     && "Checking API…"}
            {apiStatus === "disconnected" && "API offline · retry ↺"}
          </span>
        </div>
      </aside>

      {/* Main */}
      <main style={s.main}>
        {page === "demo"      && <LiveDemo  user={user} />}
        {page === "dashboard" && <Dashboard user={user} />}
        {page === "about"     && <About />}
      </main>

      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  );
}

const s = {
  root: { display: "flex", minHeight: "100vh", background: "#050812", fontFamily: "'DM Sans', sans-serif", color: "#E2E8F0", position: "relative", overflow: "hidden" },
  orb1: { position: "fixed", top: "-120px", left: "-80px", width: "500px", height: "500px", borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 },
  orb2: { position: "fixed", bottom: "-100px", right: "200px", width: "400px", height: "400px", borderRadius: "50%", background: "radial-gradient(circle, rgba(0,217,255,0.08) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 },
  orb3: { position: "fixed", top: "40%", right: "-60px", width: "300px", height: "300px", borderRadius: "50%", background: "radial-gradient(circle, rgba(236,72,153,0.07) 0%, transparent 70%)", pointerEvents: "none", zIndex: 0 },

  sidebar: { width: "220px", minHeight: "100vh", background: "rgba(255,255,255,0.03)", borderRight: "1px solid rgba(255,255,255,0.07)", display: "flex", flexDirection: "column", padding: "24px 16px", position: "relative", zIndex: 10, flexShrink: 0, gap: "4px" },

  logo:      { display: "flex", alignItems: "center", gap: "12px", marginBottom: "32px" },
  logoIcon:  { fontSize: "28px" },
  logoTitle: { fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: "16px", color: "#fff" },
  logoSub:   { fontSize: "10px", color: "#475569", marginTop: "2px" },

  nav:     { display: "flex", flexDirection: "column", gap: "4px", flex: 1 },
  navBtn:  { display: "flex", alignItems: "center", gap: "10px", padding: "10px 12px", borderRadius: "10px", border: "none", background: "transparent", color: "#64748B", fontSize: "13px", fontWeight: 500, cursor: "pointer", textAlign: "left", width: "100%", transition: "all 0.2s", position: "relative", fontFamily: "'DM Sans', sans-serif" },
  navActive: { background: "rgba(99,102,241,0.12)", color: "#fff", border: "1px solid rgba(99,102,241,0.25)" },
  navIcon:   { fontSize: "16px", width: "20px", textAlign: "center" },
  navPip:    { width: "6px", height: "6px", borderRadius: "50%", background: "#6366F1", marginLeft: "auto", boxShadow: "0 0 8px rgba(99,102,241,0.6)" },

  userSection: { marginBottom: "8px" },
  userCard:  { display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "10px", background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" },
  userAvatar:{ width: "28px", height: "28px", borderRadius: "50%", background: "linear-gradient(135deg,#6366F1,#818CF8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 700, color: "#fff", flexShrink: 0 },
  userName:  { fontSize: "12px", fontWeight: 500, color: "#E2E8F0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  userEmail: { fontSize: "10px", color: "#475569", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  logoutBtn: { background: "transparent", border: "none", color: "#475569", fontSize: "14px", cursor: "pointer", padding: "2px", flexShrink: 0 },
  loginBtn:  { width: "100%", padding: "10px 12px", borderRadius: "10px", border: "1px solid rgba(99,102,241,0.3)", background: "rgba(99,102,241,0.08)", color: "#818CF8", fontSize: "12px", fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.2s" },

  statusBar:  { display: "flex", alignItems: "center", gap: "8px", padding: "10px 12px", borderRadius: "10px", transition: "all 0.3s" },
  statusDot:  { width: "7px", height: "7px", borderRadius: "50%", flexShrink: 0 },
  statusText: { fontSize: "11px" },

  main: { flex: 1, overflowY: "auto", position: "relative", zIndex: 5, padding: "32px 36px" },
};