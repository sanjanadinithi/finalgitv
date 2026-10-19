import React, { useEffect, useMemo, useState } from "react";
import {
  Sliders,
  BookOpen,
  FileText,
  Check,
  Save,
  Copy,
  Download,
  Trash2,
  BellOff,
  Activity,
} from "lucide-react";
import CommandBlock from "./CommandBlock.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  deriveStatus,
  fmtPercent,
  getRecommendation,
  parseRunbookStep,
  savePolicy,
  clearMute,
  fetchAudit,
  timeAgo,
} from "../utils.js";

// ── SETTINGS ─────────────────────────────────────────────────────────
// Alarm thresholds with a LIVE preview of how many services would alert at
// the drafted values. The preview runs the same deriveStatus() the whole
// console uses, so the count can never disagree with the fleet view.
export function SettingsPanel({ dashboard, onPolicyUpdated, theme, onToggleTheme }) {
  const services = dashboard?.services || [];
  const policy = dashboard?.policy || {};
  const mutes = dashboard?.mutes || [];

  const [cpuThresh, setCpuThresh] = useState(policy.cpu_threshold ?? 0.6);
  const [memThresh, setMemThresh] = useState(policy.memory_threshold ?? 0.7);
  const [critThresh, setCritThresh] = useState(policy.critical_threshold ?? 0.9);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setCpuThresh(policy.cpu_threshold ?? 0.6);
    setMemThresh(policy.memory_threshold ?? 0.7);
    setCritThresh(policy.critical_threshold ?? 0.9);
  }, [policy.cpu_threshold, policy.memory_threshold, policy.critical_threshold]);

  const draft = { cpu_threshold: cpuThresh, memory_threshold: memThresh, critical_threshold: critThresh };

  const preview = useMemo(() => {
    let critical = 0;
    let warning = 0;
    services.forEach((s) => {
      const risk = deriveStatus(s, draft);
      if (risk === "CRITICAL") critical += 1;
      else if (risk === "WARNING") warning += 1;
    });
    return { critical, warning, total: services.length };
  }, [services, cpuThresh, memThresh, critThresh]);

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      await savePolicy(Number(cpuThresh), Number(memThresh), Number(critThresh));
      setSaved(true);
      onPolicyUpdated?.();
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const sliders = [
    { label: "CPU alarm", value: cpuThresh, set: setCpuThresh, color: "var(--warning)" },
    { label: "Memory alarm", value: memThresh, set: setMemThresh, color: "var(--warning)" },
    { label: "Critical threshold", value: critThresh, set: setCritThresh, color: "var(--critical)" },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: 720 }}>
      <div className="table-panel" style={{ padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Sliders size={16} color="var(--accent)" />
            <span className="panel-title">Alarm thresholds</span>
          </div>
          <button className="btn-secondary" onClick={handleSave} disabled={saving}>
            {saved ? (
              <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--healthy)" }}>
                <Check size={13} /> Saved
              </span>
            ) : (
              <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <Save size={13} /> Save
              </span>
            )}
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {sliders.map((s) => (
            <div key={s.label}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                <span style={{ color: "var(--text-secondary)" }}>{s.label}</span>
                <span className="tabular-nums font-mono" style={{ fontWeight: 700, color: s.color }}>
                  {Math.round(s.value * 100)}%
                </span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.99"
                step="0.01"
                value={s.value}
                onChange={(e) => s.set(parseFloat(e.target.value))}
                style={{ width: "100%", accentColor: s.color }}
                aria-label={s.label}
              />
            </div>
          ))}
        </div>

        {/* Live preview — real counts derived from the current fleet */}
        <div
          style={{
            marginTop: "14px",
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            background: "var(--bg-surface-elevated)",
            border: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            gap: "10px",
            fontSize: "13px",
          }}
        >
          <Activity size={14} color="var(--accent)" />
          <span style={{ color: "var(--text-secondary)" }}>Live preview</span>
          <span className="font-mono tabular-nums" style={{ color: "var(--critical)", fontWeight: 700 }}>
            {preview.critical} critical
          </span>
          <span style={{ color: "var(--text-muted)" }}>·</span>
          <span className="font-mono tabular-nums" style={{ color: "var(--warning)", fontWeight: 700 }}>
            {preview.warning} warning
          </span>
          <span style={{ color: "var(--text-muted)", marginLeft: "auto" }}>
            of {preview.total} services
          </span>
        </div>

        {error && (
          <div style={{ marginTop: "8px", fontSize: "13px", color: "var(--critical-text)" }}>{error}</div>
        )}
      </div>

      <div className="table-panel" style={{ padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "12px" }}>
          <BellOff size={16} color="var(--accent)" />
          <span className="panel-title">Active alert mutes</span>
        </div>
        {mutes.length === 0 ? (
          <div className="text-muted-13">No muted services.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            {mutes.map((m) => (
              <div
                key={m.id || m.service}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "12px",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  background: "var(--bg-surface-elevated)",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 600 }}>{m.service}</div>
                  <div className="text-muted-13">
                    {m.reason || "Snoozed"} · expires in {Math.max(0, Math.round((m.seconds_remaining || 0) / 60))}m
                  </div>
                </div>
                <button
                  className="btn-secondary"
                  onClick={async () => {
                    await clearMute({ service: m.service, muteId: m.id });
                    onPolicyUpdated?.();
                  }}
                  title="Unmute this service"
                >
                  <Trash2 size={13} /> Unmute
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {onToggleTheme && (
        <div className="table-panel" style={{ padding: "16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span className="panel-title">Appearance</span>
          <button className="btn-secondary" onClick={onToggleTheme}>
            {theme === "dark" ? "Switch to light" : "Switch to dark"}
          </button>
        </div>
      )}
    </div>
  );
}

// ── RUNBOOKS ─────────────────────────────────────────────────────────
// Every step comes from the predictor's real sre_runbook_steps payload.
// Nothing is invented and nothing is marked as executed.
export function RunbooksPage({ services = [], onSelectService }) {
  const [onlyAtRisk, setOnlyAtRisk] = useState(true);

  const entries = useMemo(() => {
    return services
      .filter((s) => (s.sre_runbook_steps || []).length > 0)
      .filter((s) => !onlyAtRisk || s.risk !== "HEALTHY")
      .map((s) => ({ service: s, steps: (s.sre_runbook_steps || []).map(parseRunbookStep) }))
      .sort((a, b) => (a.service.risk === "CRITICAL" ? -1 : 0) - (b.service.risk === "CRITICAL" ? -1 : 0));
  }, [services, onlyAtRisk]);

  const totalSteps = entries.reduce((n, e) => n + e.steps.filter((s) => s.command).length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className="table-panel" style={{ padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <BookOpen size={16} color="var(--accent)" />
            <span className="panel-title">Remediation runbooks</span>
          </div>
          <button
            className={`filter-chip ${onlyAtRisk ? "active" : ""}`}
            onClick={() => setOnlyAtRisk((v) => !v)}
          >
            {onlyAtRisk ? "At-risk only" : "All services"}
          </button>
        </div>
        <div className="text-muted-13">
          {entries.length} services · {totalSteps} commands · dry run, not executed
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="table-panel" style={{ padding: "24px", textAlign: "center", color: "var(--text-muted)" }}>
          No runbook steps emitted for the current fleet state.
        </div>
      ) : (
        entries.map(({ service, steps }) => (
          <div key={service.id} className="table-panel" style={{ padding: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
              <button
                onClick={() => onSelectService?.(service)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-primary)",
                  fontWeight: 700,
                  fontSize: "14px",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                {service.service}
              </button>
              <StatusBadge status={service.risk} size="sm" />
              <span className="text-muted-13">{service.project}</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {steps.map((step, i) => (
                <div key={i}>
                  <div style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>{step.title}</div>
                  <CommandBlock command={step.command} isDryRun />
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── REPORTS ──────────────────────────────────────────────────────────
// Shift handoff export (Markdown + PDF via print) plus the durable audit
// trail written by the gateway. Both read real state only.
export function ReportsPage({ dashboard, services = [] }) {
  const [audit, setAudit] = useState([]);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    fetchAudit(200)
      .then((data) => {
        if (alive) setAudit(data?.audit || []);
      })
      .catch(() => {
        if (alive) setAudit([]);
      });
    return () => {
      alive = false;
    };
  }, [dashboard?.generated_at]);

  const atRisk = services.filter((s) => s.risk !== "HEALTHY");
  const summary = dashboard?.summary || {};

  const markdown = useMemo(() => {
    return `# Sentinel shift handoff

Generated: ${new Date(dashboard?.generated_at || Date.now()).toUTCString()}

## Fleet
- Services monitored: ${summary.services ?? services.length}
- Critical: ${summary.critical ?? 0}
- Warning: ${summary.warning ?? 0}
- Healthy: ${summary.healthy ?? 0}

## Active incidents
${
  atRisk.length === 0
    ? "All services nominal during this rotation."
    : atRisk
        .map((s) => {
          const rec = getRecommendation(s);
          const est = s.breach_estimate;
          return `### ${s.service} (${s.risk})
- Project: ${s.project}
- CPU risk: ${fmtPercent(s.cpu_probability)} · Memory risk: ${fmtPercent(s.memory_probability)}
- Recommended action: ${rec.shortLabel}
- Time to breach: ${est ? `~${Math.round(est.minutes)} min (${est.method})` : "no reliable estimate"}
- Circuit breaker: ${s.mitigation_state?.circuit_breaker || "unknown"}
- Execution: not executed (awaiting SRE authorization)`;
        })
        .join("\n\n")
}

## Thresholds
- CPU alarm: ${Math.round((dashboard?.policy?.cpu_threshold ?? 0.6) * 100)}%
- Memory alarm: ${Math.round((dashboard?.policy?.memory_threshold ?? 0.7) * 100)}%
- Critical: ${Math.round((dashboard?.policy?.critical_threshold ?? 0.9) * 100)}%
`;
  }, [dashboard, services, atRisk, summary]);

  const handleCopy = () => {
    navigator.clipboard.writeText(markdown);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sentinel_handoff_${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const handlePdf = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(
      `<pre style="font:12px/1.5 ui-monospace,monospace;white-space:pre-wrap;padding:24px">${markdown
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre>`
    );
    w.document.close();
    w.focus();
    w.print();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
      <div className="table-panel" style={{ padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <FileText size={16} color="var(--accent)" />
            <span className="panel-title">Shift handoff</span>
          </div>
          <div style={{ display: "flex", gap: "8px" }}>
            <button className="btn-secondary" onClick={handleDownload}>
              <Download size={13} /> Markdown
            </button>
            <button className="btn-secondary" onClick={handlePdf}>
              <Download size={13} /> PDF
            </button>
            <button className="btn-primary" onClick={handleCopy}>
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <textarea
          readOnly
          value={markdown}
          aria-label="Shift handoff report"
          style={{
            width: "100%",
            height: "280px",
            background: "var(--bg-input)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md)",
            padding: "12px",
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            color: "var(--text-primary)",
            lineHeight: 1.5,
            resize: "vertical",
          }}
        />
      </div>

      <div className="table-panel" style={{ padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "10px" }}>
          <Activity size={16} color="var(--accent)" />
          <span className="panel-title">Decision audit trail</span>
          <span className="text-muted-13">({audit.length} records)</span>
        </div>
        {audit.length === 0 ? (
          <div className="text-muted-13">No recorded decisions yet.</div>
        ) : (
          <div className="dense-table-container">
            <table className="dense-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Service</th>
                  <th>Decision</th>
                  <th>Reason</th>
                  <th>Risk at decision</th>
                  <th>Executed</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono">{timeAgo(r.ts)}</td>
                    <td style={{ fontWeight: 600 }}>{r.service}</td>
                    <td>{r.decision}</td>
                    <td style={{ color: "var(--text-secondary)" }}>{r.reason || "—"}</td>
                    <td className="tabular-nums font-mono">
                      {r.risk_at_decision ? fmtPercent(r.risk_at_decision) : "—"}
                    </td>
                    <td>
                      <span className="text-muted-13">{r.executed ? "yes" : "no"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
