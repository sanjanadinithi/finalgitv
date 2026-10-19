import { useEffect, useState } from "react";

/**
 * DashboardHeader — top bar for the Command Center.
 *
 *   <DashboardHeader
 *     critical={counts.critical}
 *     warning={counts.warning}
 *     lastUpdated={lastPollAt}      // ms timestamp, set after each successful /api/dashboard poll
 *     live={!paused}
 *     theme={theme} onToggleTheme={toggleTheme}
 *     notifications={activeAlarms.length}
 *     onSearch={openPalette} onCompare={...} onReports={...}
 *     onSettings={...} onNotifications={...} onShortcuts={...} />
 *
 * - Status pill follows the worst current state (CRITICAL > WARNING > HEALTHY).
 *   It pulses while anything is critical.
 * - Live chip: "live · 4s ago" -> turns amber ("stale") once the last poll is
 *   older than `staleAfterMs`, grey ("paused") when `live` is false.
 * - Ctrl/⌘ + K calls onSearch, "?" calls onShortcuts.
 * - Collapses gracefully: button labels hide < 1180px, summary < 900px,
 *   secondary icons < 640px.
 */

const PALETTE = {
  dark: {
    "--fv-bg": "#0d1424",
    "--fv-ctl": "#131d33",
    "--fv-ctl-hover": "#1a2745",
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
    "--fv-ctl-hover": "#e2e8f0",
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
.fvh{display:flex;align-items:center;justify-content:space-between;gap:16px;height:56px;padding:0 20px;background:var(--fv-bg);border-bottom:1px solid var(--fv-line);color:var(--fv-text);font:13px/1.2 Inter,system-ui,sans-serif;box-sizing:border-box;position:sticky;top:0;z-index:20}
.fvh *{box-sizing:border-box}
.fvh-left,.fvh-right{display:flex;align-items:center;gap:12px;min-width:0}
.fvh-status{--c:var(--fv-ok);display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 12px 0 10px;border-radius:999px;font-size:12px;font-weight:700;letter-spacing:.07em;color:var(--c);border:1px solid color-mix(in srgb,var(--c) 45%,transparent);background:color-mix(in srgb,var(--c) 12%,transparent);white-space:nowrap}
.fvh-status.is-critical{--c:var(--fv-crit);animation:fvh-ping 1.8s ease-out infinite}
.fvh-status.is-warning{--c:var(--fv-warn)}
@keyframes fvh-ping{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--fv-crit) 55%,transparent)}100%{box-shadow:0 0 0 8px transparent}}
.fvh-summary{color:var(--fv-mute);white-space:nowrap}
.fvh-summary b{color:var(--fv-text);font-weight:700}
.fvh-live{--c:var(--fv-ok);display:inline-flex;align-items:center;gap:7px;height:28px;padding:0 11px;border-radius:999px;font-size:12px;color:var(--fv-mute);background:var(--fv-ctl);border:1px solid var(--fv-line);white-space:nowrap}
.fvh-live i{width:7px;height:7px;border-radius:50%;background:var(--c);flex:none}
.fvh-live.is-live i{animation:fvh-blink 2s ease-in-out infinite}
.fvh-live.is-stale{--c:var(--fv-warn)}
.fvh-live.is-paused{--c:var(--fv-mute)}
@keyframes fvh-blink{50%{opacity:.3}}
.fvh-search{display:inline-flex;align-items:center;gap:8px;height:36px;width:300px;padding:0 8px 0 12px;border-radius:10px;background:var(--fv-ctl);border:1px solid var(--fv-line);color:var(--fv-mute);font:inherit;cursor:pointer;text-align:left}
.fvh-search span{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fvh-kbd{font:600 11px ui-monospace,SFMono-Regular,Menlo,monospace;padding:3px 7px;border-radius:6px;border:1px solid var(--fv-line);background:var(--fv-bg);color:var(--fv-mute)}
.fvh-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:7px;height:36px;padding:0 13px;border-radius:10px;background:var(--fv-ctl);border:1px solid var(--fv-line);color:var(--fv-text);font:600 13px Inter,system-ui,sans-serif;cursor:pointer}
.fvh-btn.is-icon{width:36px;padding:0;color:var(--fv-mute)}
.fvh-search:hover,.fvh-btn:hover{background:var(--fv-ctl-hover);color:var(--fv-text);border-color:color-mix(in srgb,var(--fv-accent) 40%,var(--fv-line))}
.fvh-search:focus-visible,.fvh-btn:focus-visible{outline:2px solid var(--fv-accent);outline-offset:2px}
.fvh-badge{position:absolute;top:-5px;right:-5px;min-width:17px;height:17px;padding:0 4px;border-radius:9px;background:var(--fv-crit);color:#fff;font-size:10px;font-weight:700;display:grid;place-items:center;border:2px solid var(--fv-bg)}
.fvh-sep{width:1px;height:22px;background:var(--fv-line)}
@media (max-width:1180px){.fvh-label{display:none}.fvh-btn.is-text{width:36px;padding:0}.fvh-search{width:220px}}
@media (max-width:900px){.fvh-summary{display:none}}
@media (max-width:640px){.fvh{padding:0 12px;gap:8px}.fvh-search{width:36px;padding:0;justify-content:center}.fvh-search span,.fvh-kbd,.fvh-live-text,.fvh-sm-hide{display:none}.fvh-live{padding:0 9px}}
@media (prefers-reduced-motion:reduce){.fvh-status,.fvh-live i{animation:none!important}}
`;

const ICONS = {
  search: (<><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>),
  compare: (<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="18" r="2.5" /><path d="M13 6h3a2 2 0 0 1 2 2v7M11 18H8a2 2 0 0 1-2-2V9" /></>),
  reports: (<><path d="M12 3v12m0 0-4-4m4 4 4-4" /><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" /></>),
  sliders: (<><path d="M4 7h8m4 0h4M4 17h4m4 0h8" /><circle cx="14" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>),
  sun: (<><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4m11.4-11.4 1.4-1.4" /></>),
  moon: (<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />),
  bell: (<><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>),
  keyboard: (<><rect x="2" y="5" width="20" height="14" rx="2" /><path d="M6 9h.01M10 9h.01M14 9h.01M18 9h.01M7 15h10" /></>),
  alert: (<><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5M12 16.5h.01" /></>),
  check: (<><circle cx="12" cy="12" r="9" /><path d="m8.5 12.5 2.5 2.5 4.5-5" /></>),
};

function Icon({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function ago(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");

export default function DashboardHeader({
  critical = 0,
  warning = 0,
  lastUpdated,
  live = true,
  staleAfterMs = 15000,
  theme = "dark",
  notifications = 0,
  onToggleTheme,
  onSearch,
  onCompare,
  onReports,
  onSettings,
  onNotifications,
  onShortcuts,
}) {
  const now = useNow(1000);
  const level = critical > 0 ? "critical" : warning > 0 ? "warning" : "healthy";
  const stamp = lastUpdated instanceof Date ? lastUpdated.getTime() : lastUpdated;
  const age = stamp ? now - stamp : 0;
  const state = !live ? "paused" : stamp && age > staleAfterMs ? "stale" : "live";
  const liveText = state === "paused" ? "paused" : `${state} · ${stamp ? ago(age) : "just now"}`;

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onSearch && onSearch();
        return;
      }
      const t = e.target;
      const typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
      if (e.key === "?" && !typing) onShortcuts && onShortcuts();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSearch, onShortcuts]);

  return (
    <header className="fvh" style={PALETTE[theme] || PALETTE.dark} data-theme={theme}>
      <style>{CSS}</style>

      <div className="fvh-left">
        <span className={`fvh-status is-${level}`} role="status">
          <Icon name={level === "healthy" ? "check" : "alert"} size={14} />
          {level.toUpperCase()}
        </span>
        <span
          className={`fvh-live is-${state}`}
          title={stamp ? `Last update ${new Date(stamp).toLocaleTimeString()}` : "Waiting for first update"}
        >
          <i />
          <span className="fvh-live-text">{liveText}</span>
        </span>
      </div>

      <div className="fvh-right">
        <button className="fvh-search" onClick={onSearch} aria-label="Search or run a command">
          <Icon name="search" />
          <span>Search or command…</span>
          <kbd className="fvh-kbd">{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>

        <button className="fvh-btn is-text" onClick={onCompare} aria-label="Compare" title="Compare">
          <Icon name="compare" />
          <span className="fvh-label">Compare</span>
        </button>
        <button className="fvh-btn is-text" onClick={onReports} aria-label="Reports" title="Reports">
          <Icon name="reports" />
          <span className="fvh-label">Reports</span>
        </button>

        <span className="fvh-sep fvh-sm-hide" />

        <button className="fvh-btn is-icon fvh-sm-hide" onClick={onSettings} aria-label="Tuning and settings" title="Tuning">
          <Icon name="sliders" />
        </button>
        <button
          className="fvh-btn is-icon"
          onClick={onToggleTheme}
          aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          title={theme === "dark" ? "Light theme" : "Dark theme"}
        >
          <Icon name={theme === "dark" ? "sun" : "moon"} />
        </button>
        <button
          className="fvh-btn is-icon"
          onClick={onNotifications}
          aria-label={notifications ? `${notifications} active alarms` : "Notifications"}
          title="Notifications"
        >
          <Icon name="bell" />
          {notifications > 0 && <span className="fvh-badge">{notifications > 9 ? "9+" : notifications}</span>}
        </button>
        <button className="fvh-btn is-icon fvh-sm-hide" onClick={onShortcuts} aria-label="Keyboard shortcuts" title="Shortcuts (?)">
          <Icon name="keyboard" />
        </button>
      </div>
    </header>
  );
}
