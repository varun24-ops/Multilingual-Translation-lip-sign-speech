// pages/Dashboard.jsx — wired to real FastAPI data
import { useState, useEffect, useCallback } from "react";

const API_BASE     = import.meta.env.VITE_API_URL || "http://localhost:8000";
const MODE_ICONS   = { speech: "🎙️", sign: "✋", lip: "👄" };
const MODE_COLORS  = { speech: "#6366F1", sign: "#14B8A6", lip: "#EC4899" };
const MODE_LABELS  = { speech: "Speech", sign: "Sign", lip: "Lip" };

function authHeader() {
  const token = localStorage.getItem("token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export default function Dashboard() {
  const [timeframe, setTimeframe]   = useState("7d");
  const [stats, setStats]           = useState(null);
  const [sessions, setSessions]     = useState([]);
  const [health, setHealth]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState("");

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [statsRes, sessionsRes, healthRes] = await Promise.all([
        fetch(`${API_BASE}/api/sessions/stats?timeframe=${timeframe}`, { headers: authHeader() }),
        fetch(`${API_BASE}/api/sessions?limit=10`,                     { headers: authHeader() }),
        fetch(`${API_BASE}/api/sessions/health`,                        { headers: authHeader() }),
      ]);

      if (!statsRes.ok || !sessionsRes.ok || !healthRes.ok) {
        throw new Error("Failed to fetch dashboard data");
      }

      const [statsData, sessionsData, healthData] = await Promise.all([
        statsRes.json(),
        sessionsRes.json(),
        healthRes.json(),
      ]);

      setStats(sessionsData);
      setSessions(sessionsData);
      setHealth(healthData.pipelines || []);
      setStats(statsData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [timeframe]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(fetchAll, 30000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  return (
    <div>
      {/* Header */}
      <div style={s.topRow}>
        <div>
          <h1 style={s.pageTitle}>Dashboard</h1>
          <p style={s.pageSub}>
            Live analytics across all pipelines
            {loading && <span style={{ color: "#6366F1", marginLeft: "8px", fontSize: "11px" }}>⟳ refreshing…</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
          <div style={s.tfRow}>
            {["24h","7d","30d"].map((t) => (
              <button
                key={t}
                onClick={() => setTimeframe(t)}
                style={{ ...s.tfBtn, ...(timeframe === t ? s.tfActive : {}) }}
              >
                {t}
              </button>
            ))}
          </div>
          <button onClick={fetchAll} style={s.refreshBtn} title="Refresh">↺</button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={s.errorBox}>
          ⚠️ {error} — <span style={{ textDecoration: "underline", cursor: "pointer" }} onClick={fetchAll}>retry</span>
        </div>
      )}

      {/* Stat cards */}
      <div style={s.statsGrid}>
        {[
          { label: "Total Sessions",    value: stats?.total_sessions    ?? 0, color: "#6366F1", icon: "⚡" },
          { label: "Speech Translated", value: stats?.speech_translated ?? 0, color: "#00D9FF", icon: "🎙️" },
          { label: "Signs Recognized",  value: stats?.signs_recognized  ?? 0, color: "#14B8A6", icon: "✋" },
          { label: "Lips Read",         value: stats?.lips_read         ?? 0, color: "#EC4899", icon: "👄" },
          { label: "Avg Confidence",    value: `${stats?.avg_confidence ?? 0}%`, color: "#F59E0B", icon: "🎯" },
          { label: "Avg Process Time",  value: stats ? `${stats.avg_processing_ms}ms` : "—", color: "#22C55E", icon: "⚡" },
        ].map((st) => (
          <div key={st.label} style={{ ...s.statCard, borderTop: `2px solid ${st.color}` }}>
            <div style={s.statIconRow}>
              <span style={{ fontSize: "18px" }}>{st.icon}</span>
              {loading && <span style={{ fontSize: "10px", color: "#334155" }}>loading…</span>}
            </div>
            <div style={{ ...s.statValue, color: st.color }}>
              {loading ? "—" : st.value.toLocaleString?.() ?? st.value}
            </div>
            <div style={s.statLabel}>{st.label}</div>
          </div>
        ))}
      </div>

      {/* Middle row */}
      <div style={s.midGrid}>

        {/* Bar chart */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Sessions over time</span>
            <span style={s.cardSub}>Last {timeframe}</span>
          </div>
          <BarChart data={stats?.daily_sessions || []} loading={loading} />
        </div>

        {/* Language distribution */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Target languages</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
            {loading ? (
              [1,2,3].map((i) => <div key={i} style={s.skeleton} />)
            ) : stats?.language_stats?.length > 0 ? (
              stats.language_stats.slice(0, 6).map((l, i) => {
                const colors = ["#6366F1","#00D9FF","#14B8A6","#EC4899","#F59E0B","#334155"];
                const color  = colors[i % colors.length];
                return (
                  <div key={l.language}>
                    <div style={s.langRow}>
                      <span style={s.langName}>{l.language}</span>
                      <span style={{ ...s.langPct, color }}>{l.pct}%</span>
                    </div>
                    <div style={s.barTrack}>
                      <div style={{ ...s.barFill, width: `${l.pct}%`, background: color }} />
                    </div>
                  </div>
                );
              })
            ) : (
              <div style={s.emptyHint}>No language data yet</div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom row */}
      <div style={s.botGrid}>

        {/* Recent sessions */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Recent sessions</span>
            <span style={s.cardSub}>{sessions.length} shown</span>
          </div>
          <table style={s.table}>
            <thead>
              <tr>
                {["ID","Mode","Language","Confidence","Time","Status"].map((h) => (
                  <th key={h} style={s.th}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [1,2,3].map((i) => (
                  <tr key={i}>
                    {[1,2,3,4,5,6].map((j) => (
                      <td key={j} style={s.td}><div style={{ ...s.skeleton, height: "12px", width: "60px" }} /></td>
                    ))}
                  </tr>
                ))
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ ...s.td, textAlign: "center", padding: "32px", color: "#334155" }}>
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontSize: "28px", opacity: 0.3 }}>📭</span>
                      <span style={{ fontSize: "12px" }}>No sessions yet — run a demo to see results here</span>
                    </div>
                  </td>
                </tr>
              ) : sessions.map((r) => (
                <tr key={r.id} style={s.tr}>
                  <td style={{ ...s.td, color: "#475569", fontFamily: "monospace" }}>#{r.id}</td>
                  <td style={s.td}>
                    <span style={{ ...s.modePill, background: `${MODE_COLORS[r.mode]}18`, color: MODE_COLORS[r.mode], border: `1px solid ${MODE_COLORS[r.mode]}33` }}>
                      {MODE_ICONS[r.mode]} {MODE_LABELS[r.mode]}
                    </span>
                  </td>
                  <td style={{ ...s.td, color: "#64748B" }}>{r.target_lang || "—"}</td>
                  <td style={s.td}>
                    {r.confidence != null ? (
                      <span style={{ color: r.confidence >= 0.9 ? "#4ADE80" : r.confidence >= 0.75 ? "#F59E0B" : "#EF4444" }}>
                        {Math.round(r.confidence * 100)}%
                      </span>
                    ) : "—"}
                  </td>
                  <td style={{ ...s.td, color: "#475569" }}>{timeAgo(r.created_at)}</td>
                  <td style={s.td}>
                    <span style={{
                      ...s.statusPill,
                      background: r.status === "done" ? "rgba(34,197,94,0.1)"  : "rgba(239,68,68,0.1)",
                      color:      r.status === "done" ? "#4ADE80"              : "#F87171",
                      border:     `1px solid ${r.status === "done" ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
                    }}>
                      {r.status === "done" ? "✓ Done" : "✗ Error"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Pipeline health */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <span style={s.cardTitle}>Pipeline health</span>
            {!loading && health.length > 0 && (
              <span style={{
                ...s.badge,
                background: health.every(p => p.status === "healthy" || p.status === "idle")
                  ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
                color:  health.every(p => p.status === "healthy" || p.status === "idle")
                  ? "#4ADE80" : "#FCD34D",
                border: `1px solid ${health.every(p => p.status === "healthy" || p.status === "idle")
                  ? "rgba(34,197,94,0.2)" : "rgba(245,158,11,0.2)"}`,
              }}>
                {health.filter(p => p.status === "healthy").length}/{health.length} healthy
              </span>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "8px" }}>
            {loading ? (
              [1,2,3].map((i) => <div key={i} style={{ ...s.skeleton, height: "36px" }} />)
            ) : health.length === 0 ? (
              <div style={s.emptyHint}>No pipeline data yet</div>
            ) : health.map((p) => (
              <div key={p.name} style={s.healthRow}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div style={{
                    ...s.healthDot,
                    background: p.status === "healthy"  ? "#22C55E"
                              : p.status === "degraded" ? "#F59E0B"
                              : p.status === "down"     ? "#EF4444"
                              : "#334155",
                    boxShadow: p.status === "idle" ? "none"
                              : `0 0 6px ${p.status === "healthy" ? "#22C55E" : p.status === "degraded" ? "#F59E0B" : "#EF4444"}`,
                  }} />
                  <div>
                    <div style={s.healthName}>{p.name}</div>
                    <div style={{ fontSize: "9px", color: "#334155" }}>{p.total_runs} runs today</div>
                  </div>
                </div>
                <div style={s.healthMeta}>
                  <span style={s.healthStat}>{p.latency_ms > 0 ? `${p.latency_ms}ms` : "—"}</span>
                  <span style={{ ...s.healthStat, color: "#334155" }}>|</span>
                  <span style={{
                    ...s.healthStat,
                    color: p.status === "healthy"  ? "#4ADE80"
                         : p.status === "degraded" ? "#FCD34D"
                         : p.status === "down"     ? "#F87171"
                         : "#334155",
                  }}>
                    {p.total_runs > 0 ? `${p.uptime_pct}%` : "—"}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── BarChart ───────────────────────────────────────────────────────────────
function BarChart({ data, loading }) {
  const max = Math.max(...(data.map(d => d.count)), 1);
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: "8px", height: "120px", marginTop: "12px" }}>
      {loading ? (
        [1,2,3,4,5,6,7].map((i) => (
          <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", height: "100%" }}>
            <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
              <div style={{ width: "100%", height: `${20 + Math.random() * 60}%`, background: "rgba(255,255,255,0.05)", borderRadius: "4px 4px 0 0" }} />
            </div>
            <div style={{ ...s.skeleton, width: "24px", height: "9px" }} />
          </div>
        ))
      ) : data.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: "#334155", fontSize: "12px" }}>
          No data yet
        </div>
      ) : data.map((d, i) => (
        <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: "4px", height: "100%" }}>
          <div style={{ flex: 1, display: "flex", alignItems: "flex-end", width: "100%" }}>
            <div style={{
              width: "100%",
              height: `${Math.max((d.count / max) * 100, d.count > 0 ? 8 : 2)}%`,
              background: i === data.length - 1
                ? "linear-gradient(to top,#6366F1,#818CF8)"
                : "rgba(99,102,241,0.25)",
              borderRadius: "4px 4px 0 0",
              border: i === data.length - 1
                ? "1px solid rgba(99,102,241,0.5)"
                : "1px solid rgba(99,102,241,0.15)",
              minHeight: "3px",
              transition: "height 0.4s ease",
              position: "relative",
            }}>
              {d.count > 0 && (
                <span style={{ position: "absolute", top: "-16px", left: "50%", transform: "translateX(-50%)", fontSize: "9px", color: "#6366F1", fontWeight: 600 }}>
                  {d.count}
                </span>
              )}
            </div>
          </div>
          <span style={{ fontSize: "9px", color: "#334155" }}>{d.day}</span>
        </div>
      ))}
    </div>
  );
}

// ── helpers ────────────────────────────────────────────────────────────────
function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60)   return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

// ── styles ─────────────────────────────────────────────────────────────────
const s = {
  topRow:    { display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "24px" },
  pageTitle: { fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "26px", color: "#fff", marginBottom: "4px" },
  pageSub:   { color: "#64748B", fontSize: "13px" },
  tfRow:     { display: "flex", gap: "4px", background: "rgba(255,255,255,0.04)", padding: "4px", borderRadius: "8px", border: "1px solid rgba(255,255,255,0.07)" },
  tfBtn:     { padding: "6px 12px", borderRadius: "6px", border: "none", background: "transparent", color: "#64748B", fontSize: "12px", fontWeight: 500, cursor: "pointer", fontFamily: "'DM Sans',sans-serif", transition: "all 0.2s" },
  tfActive:  { background: "rgba(99,102,241,0.2)", color: "#A5B4FC" },
  refreshBtn:{ padding: "6px 10px", borderRadius: "6px", border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.04)", color: "#64748B", fontSize: "14px", cursor: "pointer", transition: "all 0.2s" },

  errorBox:  { background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)", borderRadius: "10px", padding: "10px 14px", fontSize: "12px", color: "#F87171", marginBottom: "16px" },

  statsGrid: { display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: "10px", marginBottom: "16px" },
  statCard:  { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "14px" },
  statIconRow: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" },
  statValue:   { fontFamily: "'Syne',sans-serif", fontWeight: 800, fontSize: "20px", marginBottom: "4px" },
  statLabel:   { fontSize: "10px", color: "#475569", fontWeight: 500 },

  midGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "16px" },
  botGrid: { display: "grid", gridTemplateColumns: "1.6fr 1fr", gap: "12px" },
  card:    { background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: "14px", padding: "18px" },
  cardHeader: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "4px" },
  cardTitle:  { fontFamily: "'Syne',sans-serif", fontWeight: 700, fontSize: "13px", color: "#fff" },
  cardSub:    { fontSize: "11px", color: "#475569" },
  badge:      { fontSize: "11px", fontWeight: 600, padding: "3px 9px", borderRadius: "100px" },

  langRow:   { display: "flex", justifyContent: "space-between", marginBottom: "4px" },
  langName:  { fontSize: "12px", color: "#94A3B8" },
  langPct:   { fontSize: "12px", fontWeight: 600 },
  barTrack:  { height: "4px", background: "rgba(255,255,255,0.05)", borderRadius: "2px", overflow: "hidden" },
  barFill:   { height: "100%", borderRadius: "2px", transition: "width 0.5s ease" },

  table:      { width: "100%", borderCollapse: "collapse", marginTop: "8px" },
  th:         { fontSize: "10px", color: "#334155", fontWeight: 600, letterSpacing: "0.8px", textTransform: "uppercase", textAlign: "left", padding: "6px 8px", borderBottom: "1px solid rgba(255,255,255,0.05)" },
  tr:         { borderBottom: "1px solid rgba(255,255,255,0.04)" },
  td:         { fontSize: "12px", color: "#94A3B8", padding: "9px 8px" },
  modePill:   { fontSize: "10px", fontWeight: 600, padding: "3px 8px", borderRadius: "100px" },
  statusPill: { fontSize: "10px", fontWeight: 600, padding: "3px 8px", borderRadius: "100px" },

  healthRow:  { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,0.05)" },
  healthDot:  { width: "8px", height: "8px", borderRadius: "50%", flexShrink: 0 },
  healthName: { fontSize: "12px", color: "#94A3B8" },
  healthMeta: { display: "flex", gap: "8px", alignItems: "center" },
  healthStat: { fontSize: "11px", color: "#475569" },

  skeleton:   { background: "rgba(255,255,255,0.05)", borderRadius: "4px", width: "100%", height: "16px", animation: "pulse 1.5s ease-in-out infinite" },
  emptyHint:  { fontSize: "12px", color: "#334155", textAlign: "center", padding: "16px 0" },
};