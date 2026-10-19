import React from "react";
import {
  Search,
  Moon,
  Sun,
  Download,
  Sliders,
  Keyboard,
  Bell,
  GitCompare,
} from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import { timeAgo } from "../utils.js";

export default function Topbar({
  summary = {},
  generatedAt,
  theme,
  onToggleTheme,
  onOpenCommandPalette,
  onOpenShortcuts,
  onOpenHandoff,
  onOpenCompare,
  onOpenNotifications,
  onOpenSettings,
}) {
  const total = summary.services ?? 0;
  const critical = summary.critical ?? 0;
  const warning = summary.warning ?? 0;
  const atRisk = summary.at_risk ?? critical + warning;

  // Single source of truth: tone always matches the highest severity present.
  // A red incident can never coexist with a "0 critical" top bar.
  const fleetTone = critical > 0 ? "CRITICAL" : warning > 0 ? "WARNING" : "HEALTHY";
  const fleetCount =
    critical > 0 || warning > 0
      ? `${critical} critical · ${warning} warning`
      : `All ${total} services healthy`;

  return (
    <header className="sentinel-topbar">
      <div className="fleet-health-lead">
        <StatusBadge status={fleetTone} size="sm" />
        <span className="fleet-status-text">{fleetCount}</span>
        <span className="live-pulse-badge" title="Telemetry refreshed live every 1 second">
          <span className="pulse-dot" />
          <span>live · {timeAgo(generatedAt)}</span>
        </span>
      </div>

      <div className="topbar-actions">
        <button
          className="search-command-trigger"
          onClick={onOpenCommandPalette}
          title="Search services or run commands (Ctrl/⌘ + K)"
        >
          <Search size={14} />
          <span>Search or command…</span>
          <kbd className="kbd-badge">⌘K</kbd>
        </button>

        <button className="btn-secondary" onClick={onOpenCompare} title="Compare services (C)">
          <GitCompare size={14} />
          <span>Compare</span>
        </button>

        <button className="btn-secondary" onClick={onOpenHandoff} title="Shift handoff & reports (E)">
          <Download size={14} />
          <span>Reports</span>
        </button>

        <button className="btn-secondary" onClick={onOpenSettings} title="Settings" aria-label="Settings" style={{ padding: "7px 9px" }}>
          <Sliders size={15} />
        </button>

        <button
          className="btn-secondary"
          onClick={onToggleTheme}
          title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          aria-label="Toggle theme"
          style={{ padding: "7px 9px" }}
        >
          {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
        </button>

        <button
          className="btn-secondary"
          onClick={onOpenNotifications}
          title={`Active predictions (${atRisk} flagged)`}
          aria-label="Notification center"
          style={{ padding: "7px 9px", position: "relative" }}
        >
          <Bell size={15} />
          {atRisk > 0 && (
            <span
              className="topbar-dot"
              style={{ background: critical > 0 ? "var(--critical)" : "var(--warning)" }}
            />
          )}
        </button>

        <button
          className="btn-secondary"
          onClick={onOpenShortcuts}
          title="Keyboard shortcuts (?)"
          aria-label="Keyboard shortcuts"
          style={{ padding: "7px 9px" }}
        >
          <Keyboard size={15} />
        </button>
      </div>
    </header>
  );
}
