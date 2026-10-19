import { useEffect, useState } from "react";

/**
 * DashboardFooter — slim status bar for the Command Center.
 *
 *   <DashboardFooter
 *     apiStatus="ok"                  // "ok" | "degraded" | "down"
 *     latencyMs={42}                  // round-trip of the last /api/dashboard poll
 *     latencyHistory={[40, 44, ...]}  // last ~20 polls, drawn as a sparkline
 *     lastSync={lastPollAt}           // ms timestamp
 *     pollIntervalMs={3000}
 *     services={24} projects={2}
 *     cpuThreshold={policy.cpu_threshold}
 *     memThreshold={policy.memory_threshold}
 *     theme={theme}
 *     version="1.0.0"
 *     onShortcuts={...} />
 *
 * Left   : API health, latency, sync age, fleet size
 * Centre : the live alarm thresholds (same colours as Fleet pulse)
 * Right  : links, clock in the operator's timezone, version
 * Hides sections progressively on narrow screens.
 */

const PALETTE = {
  dark: {
    "--fv-bg": "#0d1424",
    "--fv-ctl": "#131d33",
    "--fv-line": "rgba(148,163,184,0.16)",
    "--fv-text": "#e2e8f0",
    "--fv-mute": "#94a3b8",
    "--fv-accent": "#3b82f6",
    "--fv-crit": "#ef4444",
    "--fv-warn": "#f59e0b",
    "--fv-ok": "#10b981",
  },
  light: {
    "--fv-bg": "#ffffff",
    "--fv-ctl": "#f1f5f9",
    "--fv-line": "rgba(15,23,42,0.12)",
    "--fv-text": "#0f172a",
    "--fv-mute": "#64748b",
    "--fv-accent": "#2563eb",
    "--fv-crit": "#dc2626",
    "--fv-warn": "#d97706",
    "--fv-ok": "#059669",
  },
};

const CSS = `
.fvf{display:flex;align-items:center;justify-content:space-between;gap:16px;height:36px;padding:0 20px;background:var(--fv-bg);border-top:1px solid var(--fv-line);color:var(--fv-mute);font:12px/1 Inter,system-ui,sans-serif;box-sizing:border-box;white-space:nowrap}
.fvf *{box-sizing:border-box}
.fvf.is-sticky{position:sticky;bottom:0;z-index:20}
.fvf-group{display:flex;align-items:center;gap:14px;min-width:0}
.fvf-item{display:inline-flex;align-items:center;gap:7px}
.fvf-item b{color:var(--fv-text);font-weight:600}
.fvf-dot{width:7px;height:7px;border-radius:50%;background:var(--c,var(--fv-ok));box-shadow:0 0 6px color-mix(in srgb,var(--c,var(--fv-ok)) 70%,transparent);flex:none}
.fvf-sq{width:8px;height:8px;border-radius:2px;flex:none}
.fvf-sep{width:1px;height:14px;background:var(--fv-line)}
.fvf-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.fvf a,.fvf button{display:inline-flex;align-items:center;gap:6px;padding:5px 7px;border:0;border-radius:6px;background:none;color:var(--fv-mute);font:inherit;text-decoration:none;cursor:pointer}
.fvf a:hover,.fvf button:hover{color:var(--fv-text);background:var(--fv-ctl)}
.fvf a:focus-visible,.fvf button:focus-visible{outline:2px solid var(--fv-accent)}
.fvf-kbd{font:600 10px ui-monospace,SFMono-Regular,Menlo,monospace;padding:2px 5px;border-radius:4px;border:1px solid var(--fv-line);background:var(--fv-ctl)}
@media (max-width:1200px){.fvf-mid{display:none}}
@media (max-width:900px){.fvf-links,.fvf-ver{display:none}}
@media (max-width:640px){.fvf{padding:0 12px}.fvf-sync,.fvf-counts{display:none}}
`;

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ago` : `${Math.floor(m / 60)}h ago`;
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function Spark({ data, color }) {
  if (!data || data.length < 2) return null;
  const w = 56;
  const h = 14;
  const max = Math.max(...data);
  const min = Math.min(...data);
  const span = max - min || 1;
  const pts = data
    .map((v, i) => `${((i / (data.length - 1)) * w).toFixed(1)},${(h - 1 - ((v - min) / span) * (h - 2)).toFixed(1)}`)
    .join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

const API = {
  ok: { label: "API healthy", color: "var(--fv-ok)" },
  degraded: { label: "API degraded", color: "var(--fv-warn)" },
  down: { label: "API unreachable", color: "var(--fv-crit)" },
};

export default function DashboardFooter({
  apiStatus = "ok",
  latencyMs,
  latencyHistory = [],
  lastSync,
  pollIntervalMs = 3000,
  services = 0,
  projects = 0,
  cpuThreshold = 60,
  memThreshold = 70,
  theme = "dark",
  provenance = null,
  version = "1.0.0",
  timeZone,
  sticky = false,
  links = [
    { label: "Ingestion API", href: "http://localhost:8001", external: true },
    { label: "Analyzer Console", href: "http://localhost:8081", external: true },
  ],
  onShortcuts,
}) {
  const now = useNow(1000);
  const api = API[apiStatus] || API.ok;
  const stamp = lastSync instanceof Date ? lastSync.getTime() : lastSync;
  const age = stamp ? now - stamp : 0;
  const syncStale = stamp && age > pollIntervalMs * 3;
  const latColor =
    latencyMs == null ? "var(--fv-mute)" : latencyMs < 150 ? "var(--fv-ok)" : latencyMs < 400 ? "var(--fv-warn)" : "var(--fv-crit)";

  const tz = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const clock = new Date(now).toLocaleTimeString("en-GB", { hour12: false, timeZone: tz });
  const tzShort = (tz.split("/").pop() || tz).replace(/_/g, " ");

  return (
    <footer
      className={`fvf${sticky ? " is-sticky" : ""}`}
      style={PALETTE[theme] || PALETTE.dark}
      data-theme={theme}
    >
      <style>{CSS}</style>

      <div className="fvf-group">
        <span className="fvf-item" style={{ "--c": api.color }}>
          <i className="fvf-dot" />
          <b>{api.label}</b>
        </span>
        {latencyMs != null && (
          <span
            className="fvf-item fvf-mono"
            title={
              "Gateway round-trip: browser → /api/dashboard build (file aggregation of 71k-row " +
              "dataset metadata, MTTA CSVs, live-status merge) → response. NOT the advisor " +
              "decision compute time (that is ~0.04 ms p99, shown at right when available)."
            }
          >
            <b style={{ color: latColor }}>{Math.round(latencyMs)} ms</b>
            <span style={{ color: "var(--fv-mute)", marginLeft: 4 }}>gateway RT</span>
            <Spark data={latencyHistory} color={latColor} />
          </span>
        )}
        {provenance?.eval_summary?.advisor_p99_ms != null && (
          <span
            className="fvf-item fvf-mono"
            title="Advisor decision p99 from advisor_evaluation_summary.json latency benchmark (decide() only, excludes network + gateway build)"
          >
            <span style={{ color: "var(--fv-mute)" }}>advisor p99</span>{" "}
            <b style={{ color: "var(--fv-ok)" }}>{Number(provenance.eval_summary.advisor_p99_ms).toFixed(2)} ms</b>
          </span>
        )}
        <span className="fvf-sep fvf-sync" />
        <span className="fvf-item fvf-sync" style={syncStale ? { color: "var(--fv-warn)" } : undefined}>
          Synced {stamp ? ago(age) : "—"} · every {Math.round(pollIntervalMs / 1000)}s
        </span>
      </div>

      <div className="fvf-group">
        <span className="fvf-item fvf-mono" title={tz}>
          <b>{clock}</b> {tzShort}
        </span>
        <span className="fvf-ver fvf-mono">v{version}</span>
      </div>
    </footer>
  );
}
