import React, { useEffect, useMemo, useState } from "react";
import {
  X,
  ShieldAlert,
  Terminal,
  CheckCircle2,
  Clock,
  ArrowRight,
  Cpu,
  MemoryStick,
  Info,
  Zap,
} from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import RiskGauge from "./RiskGauge.jsx";
import CommandBlock from "./CommandBlock.jsx";
import InteractiveTrendChart from "./InteractiveTrendChart.jsx";
import {
  fmtPercent,
  getTopContributors,
  getRecommendation,
  getTierOptions,
  getBreachEstimate,
  getBlastRadius,
  parseRunbookStep,
  projectRiskFromShed,
  fetchAudit,
  timeAgo,
  TIER_MODEL,
} from "../utils.js";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "why", label: "Why" },
  { id: "options", label: "Options" },
  { id: "history", label: "History" },
];

function Badge({ icon: Icon, children, tone = "neutral", title }) {
  return (
    <span className={`drawer-badge ${tone}`} title={title}>
      {Icon && <Icon size={12} />}
      {children}
    </span>
  );
}

export default function DetailsDrawer({
  service,
  policy,
  onClose,
  onApproveAction,
  onSnoozeAction,
  onOpenSimulator,
}) {
  const [activeTab, setActiveTab] = useState("overview");
  const [checkedSteps, setCheckedSteps] = useState(new Set());
  const [shed, setShed] = useState(TIER_MODEL.soft.shedPercent);
  const [audit, setAudit] = useState([]);

  useEffect(() => {
    setActiveTab("overview");
    setCheckedSteps(new Set());
  }, [service?.id]);

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
  }, [service?.id]);

  if (!service) return null;

  const maxProb = Math.max(Number(service.cpu_probability || 0), Number(service.memory_probability || 0));
  const topDrivers = getTopContributors(service, 5);
  const rec = getRecommendation(service);
  const blast = getBlastRadius(service);
  const breach = getBreachEstimate(service);
  const tiers = getTierOptions(service);
  const runbookSteps = (service.sre_runbook_steps || []).map(parseRunbookStep);
  const mit = service.mitigation_state || {};
  const history = service.history || [];

  const markers = useMemo(() => {
    const cpuThresh = Number(policy?.cpu_threshold ?? 0.6);
    const memThresh = Number(policy?.memory_threshold ?? 0.7);
    const cpuProb = Number(service.cpu_probability || 0);
    const memProb = Number(service.memory_probability || 0);
    if (cpuProb >= memProb) {
      return { value: cpuThresh, label: `CPU alarm (${Math.round(cpuThresh * 100)}%)` };
    }
    return { value: memThresh, label: `Memory alarm (${Math.round(memThresh * 100)}%)` };
  }, [policy, service]);

  const simAfter = projectRiskFromShed(maxProb, shed);

  const toggleStep = (idx) =>
    setCheckedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });

  const serviceAudit = audit.filter((a) => a.service === service.service);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="details-drawer" role="dialog" aria-modal="true" aria-label="Incident detail">
        <div className="drawer-header">
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: 800 }}>{service.service}</h2>
              <StatusBadge status={service.risk} size="sm" />
            </div>
            <div className="text-muted-13" style={{ marginTop: "2px" }}>
              {service.project} · {service.runtime}
            </div>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close drawer">
            <X size={16} />
          </button>
        </div>

        <div className="drawer-tabs" role="tablist">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              className={`drawer-tab ${activeTab === tab.id ? "active" : ""}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="drawer-body">
          {/* ── OVERVIEW ─────────────────────────────────────────── */}
          {activeTab === "overview" && (
            <>
              <div className="drawer-hero" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div className="drawer-hero-label">Risk probability</div>
                  <div className="drawer-hero-value font-mono tabular-nums">{fmtPercent(maxProb)}</div>
                  <div className="text-muted-13" style={{ marginTop: "2px" }}>
                    {breach
                      ? `Breach in ~${Math.round(breach.minutes)} min`
                      : "No dynamic slope breach yet"}
                  </div>
                </div>
                <div>
                  <div className="drawer-hero-label">Alarm Lead Time (MTTA)</div>
                  <div className="drawer-hero-value font-mono tabular-nums" style={{ color: "var(--accent-text)", fontSize: "19px" }}>
                    {service.mtta_minutes != null ? `~${service.mtta_minutes}m early` : ""}
                  </div>
                  <div className="text-muted-13" style={{ marginTop: "2px" }}>
                    {service.anticipated_rate != null ? `${service.anticipated_rate}% early anticipation` : ""}
                  </div>
                </div>
                <RiskGauge value={maxProb} size={64} strokeWidth={5} />
              </div>

              <div className="drawer-badge-row">
                {service.mtta_minutes != null && (
                  <Badge icon={Clock} tone="healthy" title="Mean Time To Anticipate (MTTA): measured advance warning">
                    Lead time: ~{service.mtta_minutes}m early
                  </Badge>
                )}
                <Badge icon={Cpu} tone={service.cpu_alarm ? "warning" : "neutral"}>
                  CPU {fmtPercent(service.cpu_probability)}
                </Badge>
                <Badge icon={MemoryStick} tone={service.memory_alarm ? "critical" : "neutral"}>
                  Memory {fmtPercent(service.memory_probability)}
                </Badge>
                <Badge tone="neutral" title="Peer services in the same project">
                  Blast {blast.label} · {blast.peerCount} peers
                </Badge>
                {mit.circuit_breaker && (
                  <Badge icon={ShieldAlert} tone={String(mit.circuit_breaker).startsWith("OPEN") ? "critical" : "healthy"}>
                    {mit.circuit_breaker}
                  </Badge>
                )}
                {mit.cooldown_remaining_sec != null && (
                  <Badge icon={Clock} tone="warning">
                    Cooldown {Math.max(0, Math.round(mit.cooldown_remaining_sec))}s
                  </Badge>
                )}
                {service.muted && <Badge tone="warning">Muted</Badge>}
              </div>

              <div className="drawer-card">
                <div className="drawer-card-title">Recommended action</div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 700 }}>{rec.actionTitle}</span>
                  <span className="est-badge" title={rec.confidenceNote}>model estimate</span>
                </div>
                <div className="text-muted-13" style={{ marginTop: "4px" }}>
                  {rec.why}
                </div>
                <div style={{ display: "flex", gap: "16px", marginTop: "8px", flexWrap: "wrap" }}>
                  <span className="text-muted-13">Risk after: <strong style={{ color: "var(--text-primary)" }}>{fmtPercent(rec.expectedRiskAfter)}</strong></span>
                  <span className="text-muted-13">Downtime: <strong style={{ color: "var(--text-primary)" }}>{rec.downtime}</strong></span>
                  <span className="text-muted-13">Time to effect: <strong style={{ color: "var(--text-primary)" }}>{rec.timeToEffect}</strong></span>
                  <span className="text-muted-13">Approval: <strong style={{ color: "var(--text-primary)" }}>{rec.approvalNeeded ? "required" : "not required"}</strong></span>
                </div>
              </div>

              {history.length >= 2 ? (
                <InteractiveTrendChart
                  history={history}
                  threshold={markers.value}
                  thresholdLabel={markers.label}
                  color={service.risk === "CRITICAL" ? "var(--critical)" : "var(--warning)"}
                  height={120}
                />
              ) : (
                <div className="drawer-card empty-note">
                  Trend chart hidden — fewer than 2 recorded samples.
                </div>
              )}
            </>
          )}

          {/* ── WHY ──────────────────────────────────────────────── */}
          {activeTab === "why" && (
            <>
              <div className="text-muted-13">What is driving the risk</div>
              {topDrivers.length === 0 ? (
                <div className="drawer-card empty-note">
                  No measured driver breakdown for this service. The predictor reported a
                  placeholder (equal) attribution, so no cause is shown.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                  {topDrivers.slice(0, 3).map((item) => (
                    <div key={item.name} className="driver-bar">
                      <div className="driver-bar-head">
                        <span style={{ fontWeight: 600 }}>{item.label}</span>
                        <span className="tabular-nums font-mono" style={{ color: "var(--accent-text)" }}>
                          {item.pct}%
                        </span>
                      </div>
                      <div className="driver-bar-track">
                        <div style={{ width: `${Math.min(100, item.pct)}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="drawer-card empty-note">
                <Info size={13} style={{ marginRight: "6px" }} />
                Attribution is estimated by the prediction model, not a measured incident cause.
              </div>
            </>
          )}

          {/* ── OPTIONS ──────────────────────────────────────────── */}
          {activeTab === "options" && (
            <>
              <div className="drawer-badge-row">
                <Badge icon={ShieldAlert} tone="warning">Dry run · not executed</Badge>
                <Badge tone="neutral">Shared risk model</Badge>
              </div>

              <div className="tier-grid">
                {tiers.map((t) => (
                  <div key={t.key} className={`tier-card ${t.recommended ? "recommended" : ""} ${t.danger ? "danger" : ""}`}>
                    <div className="tier-head">
                      <span className="tier-name">{t.tierName}</span>
                      {t.recommended && <span className="tier-flag">Recommended</span>}
                    </div>
                    <div className="tier-action">{t.plainLabel}</div>
                    <div className="tier-metrics">
                      <div className="tier-metric">
                        <span>Risk</span>
                        <strong className="font-mono tabular-nums">{t.beforePct}% → {t.afterPct}%</strong>
                      </div>
                      <div className="tier-metric">
                        <span>Downtime</span>
                        <strong>{t.downtime}</strong>
                      </div>
                      <div className="tier-metric">
                        <span>Effect</span>
                        <strong>{t.timeToEffect}</strong>
                      </div>
                      <div className="tier-metric">
                        <span>Approval</span>
                        <strong>{t.approvalNeeded ? "Required" : "None"}</strong>
                      </div>
                      <div className="tier-metric">
                        <span>Side effects</span>
                        <strong>{t.sideEffects}</strong>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* What-if slider — same curve as the tier ladder */}
              <div className="drawer-card">
                <div className="drawer-card-title">What-if: reduce traffic</div>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                  <span className="text-muted-13">Traffic shed</span>
                  <span className="font-mono tabular-nums" style={{ color: "var(--accent)" }}>{shed}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="80"
                  step="5"
                  value={shed}
                  onChange={(e) => setShed(Number(e.target.value))}
                  style={{ width: "100%", accentColor: "var(--accent)" }}
                  aria-label="Traffic shed percentage"
                />
                <div className="before-after" style={{ marginTop: "10px" }}>
                  <div className="ba-track">
                    <div
                      className="ba-drop"
                      style={{ width: `${Math.round((1 - simAfter) * 100)}%` }}
                    />
                  </div>
                  <div className="ba-labels">
                    <span className="ba-before">{fmtPercent(maxProb)}</span>
                    <ArrowRight size={14} />
                    <span className="ba-after-label">{fmtPercent(simAfter)}</span>
                    <span className="est-badge">est.</span>
                  </div>
                </div>
                <button
                  className="btn-secondary"
                  style={{ marginTop: "10px" }}
                  onClick={() => onOpenSimulator?.(service)}
                >
                  <Zap size={13} /> Open full simulator
                </button>
              </div>

              {/* Runbook */}
              <div className="drawer-card">
                <div className="drawer-card-title">
                  <Terminal size={13} style={{ marginRight: "6px" }} />
                  Runbook
                </div>
                {runbookSteps.length === 0 ? (
                  <div className="text-muted-13">No runbook steps emitted for this incident.</div>
                ) : (
                  <div className="stepper-container">
                    {runbookSteps.map((step, idx) => {
                      const isChecked = checkedSteps.has(idx);
                      return (
                        <div key={idx} className="stepper-step">
                          <div className="stepper-dot-col">
                            <button
                              className={`stepper-dot ${isChecked ? "done" : "active"}`}
                              onClick={() => toggleStep(idx)}
                              aria-label={`Mark step ${idx + 1} ${isChecked ? "not done" : "done"}`}
                            >
                              {isChecked ? "✓" : idx + 1}
                            </button>
                            {idx < runbookSteps.length - 1 && <div className="stepper-line" />}
                          </div>
                          <div style={{ flex: 1, minWidth: 0, paddingBottom: "10px" }}>
                            <div
                              className="step-title"
                              style={{
                                color: isChecked ? "var(--text-muted)" : "var(--text-primary)",
                                textDecoration: isChecked ? "line-through" : "none",
                              }}
                            >
                              {step.title}
                            </div>
                            <CommandBlock command={step.command} isDryRun />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div style={{ display: "flex", gap: "10px" }}>
                <button
                  className="btn-primary"
                  style={{ flex: 1, justifyContent: "center" }}
                  onClick={() => onApproveAction?.(service)}
                >
                  <CheckCircle2 size={14} />
                  Record approval — {rec.shortLabel}
                </button>
                <button className="btn-secondary" onClick={() => onSnoozeAction?.(service)}>
                  Snooze 15m
                </button>
              </div>
            </>
          )}

          {/* ── HISTORY ──────────────────────────────────────────── */}
          {activeTab === "history" && (
            <>
              <div className="text-muted-13">Recorded decisions for this service</div>
              {serviceAudit.length === 0 ? (
                <div className="drawer-card empty-note">
                  No decisions recorded yet. Approvals, rejections and snoozes appear here.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {serviceAudit.map((a) => (
                    <div key={a.id} className="drawer-card">
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span style={{ fontWeight: 700, textTransform: "capitalize" }}>{a.decision}</span>
                        <span className="text-muted-13">{timeAgo(a.ts)}</span>
                      </div>
                      <div className="text-muted-13" style={{ marginTop: "4px" }}>
                        {a.reason || "No reason given"}
                      </div>
                      <div style={{ display: "flex", gap: "16px", marginTop: "6px", flexWrap: "wrap" }}>
                        <span className="text-muted-13">Actor: {a.actor}</span>
                        {a.risk_at_decision != null && (
                          <span className="text-muted-13">Risk: {fmtPercent(a.risk_at_decision)}</span>
                        )}
                        {a.minutes != null && <span className="text-muted-13">Snooze: {a.minutes}m</span>}
                        <span className="text-muted-13">
                          Executed: <strong style={{ color: a.executed ? "var(--healthy)" : "var(--warning)" }}>
                            {a.executed ? "yes" : "no"}
                          </strong>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </aside>
    </>
  );
}
