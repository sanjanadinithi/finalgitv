import React, { useState, useMemo } from "react";
import { Zap, Activity, Layers, Clock, ArrowRight } from "lucide-react";
import {
  fmtPercent,
  fmtNumber,
  riskProbability,
  getBreachEstimate,
  getTierOptions,
  projectRiskFromShed,
} from "../utils.js";

/**
 * CpuSpikeDecisionHelper — CPU Analyzer / Decision Assistance Engine.
 * Every number shown is measured or derived from real telemetry:
 * - Velocity & queue pressure come from the CPU predictor's real feature set.
 * - Time to act comes from the backend's defensible breach estimate.
 * - Tier risk drops and the what-if projection both use the SHARED tier model
 *   (utils.js) so they can never disagree with the drawer or the simulator.
 * When a signal is absent we say so — nothing is invented.
 */
const TIER_ORDER = [
  { n: 1, key: "soft" },
  { n: 2, key: "moderate" },
  { n: 3, key: "emergency" },
];

function Meter({ label, value, unit, tone, icon, barWidth, note }) {
  return (
    <div className="analyzer-meter">
      <div className="analyzer-meter-head">
        <span>{label}</span>
        {icon}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: "8px", marginTop: "6px" }}>
        <span className="font-mono tabular-nums" style={{ fontSize: "20px", fontWeight: 800, color: tone }}>
          {value}
          {unit}
        </span>
        {note && <span style={{ fontSize: "13px", color: tone, fontWeight: 700 }}>{note}</span>}
      </div>
      <div className="analyzer-bar">
        <div style={{ width: `${barWidth}%`, background: tone }} />
      </div>
    </div>
  );
}

export default function CpuSpikeDecisionHelper({
  services = [],
  selectedService,
  onSelectService,
  onExecuteTierAction,
}) {
  const activeSvc = useMemo(() => {
    if (selectedService) return selectedService;
    const atRisk = services.filter((s) => (s.cpu_probability || 0) > 0.2 || s.cpu_alarm);
    if (atRisk.length > 0) {
      return [...atRisk].sort((a, b) => (b.cpu_probability || 0) - (a.cpu_probability || 0))[0];
    }
    return services[0] || null;
  }, [services, selectedService]);

  const [shedPercent, setShedPercent] = useState(30);

  if (!activeSvc) return null;

  const baseRisk = riskProbability(activeSvc);

  // Real measured signals — surfaced only when the predictor actually reported
  // them (never derived from a placeholder equal-split breakdown).
  const driversUsable = !activeSvc.drivers_are_placeholder;
  const cpuVelocity = driversUsable ? Number(activeSvc.feature_contributions?.cpu_velocity) : NaN;
  const queuePressure = driversUsable ? Number(activeSvc.feature_contributions?.queue_pressure_index) : NaN;
  const hasVelocity = Number.isFinite(cpuVelocity);
  const hasQueue = Number.isFinite(queuePressure);

  const breach = getBreachEstimate(activeSvc);
  const mit = activeSvc.mitigation_state || {};
  const circuitBreaker = mit.circuit_breaker;
  const cooldownSec = Number(mit.cooldown_remaining_sec || 0);

  // Shared model — identical curves to the drawer tiers and the simulator.
  const tierOptions = getTierOptions(activeSvc);
  const tiersForLadder = TIER_ORDER.map((t) => ({
    ...t,
    opt: tierOptions.find((o) => o.key === t.key),
  }));

  const projectedRisk = projectRiskFromShed(baseRisk, shedPercent);

  return (
    <div className="panel analyzer-panel">
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div className="analyzer-icon">
            <Zap size={18} />
          </div>
          <div>
            <div style={{ fontSize: "15px", fontWeight: 800, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
              CPU Analyzer
              {circuitBreaker != null && (
                <span className="drawer-badge healthy">Circuit breaker: {String(circuitBreaker)}</span>
              )}
              {cooldownSec > 0 && (
                <span className="drawer-badge warning">Cooldown {Math.round(cooldownSec)}s</span>
              )}
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              Target <strong style={{ color: "var(--text-primary)" }}>{activeSvc.service}</strong> · {activeSvc.project}
            </div>
          </div>
        </div>

        <select
          className="analyzer-select"
          value={activeSvc.service}
          onChange={(e) => {
            const found = services.find((s) => s.service === e.target.value);
            if (found) onSelectService?.(found);
          }}
        >
          {services
            .filter((s) => (s.cpu_probability || 0) > 0.1 || s.cpu_alarm)
            .map((s) => (
              <option key={s.service} value={s.service}>
                {s.service} ({fmtPercent(s.cpu_probability)} risk)
              </option>
            ))}
        </select>
      </div>

      {/* Measured signal meters */}
      <div className="analyzer-meters">
        <Meter
          label="CPU velocity"
          value={hasVelocity ? `+${fmtNumber(cpuVelocity, 1)}` : "Not reported"}
          unit={hasVelocity ? "%/min" : ""}
          tone={hasVelocity ? (cpuVelocity > 15 ? "var(--critical)" : "var(--warning)") : "var(--text-muted)"}
          icon={<Activity size={13} color="var(--accent)" />}
          barWidth={hasVelocity ? Math.min(100, Math.max(10, cpuVelocity * 3)) : 0}
          note={hasVelocity ? (cpuVelocity > 20 ? "Surge" : "Accelerating") : null}
        />
        <Meter
          label="Queue pressure"
          value={hasQueue ? fmtNumber(queuePressure, 2) : "Not reported"}
          unit={hasQueue ? "x" : ""}
          tone={hasQueue ? (queuePressure > 3 ? "var(--warning)" : "var(--healthy)") : "var(--text-muted)"}
          icon={<Layers size={13} color="var(--warning)" />}
          barWidth={hasQueue ? Math.min(100, Math.max(15, queuePressure * 20)) : 0}
          note={hasQueue ? (queuePressure > 3 ? "Backpressure" : "Manageable") : null}
        />
        <Meter
          label="Time to act (Live)"
          value={breach ? `~${Math.round(breach.minutes)}` : activeSvc.mtta_minutes ? `~${Math.round(activeSvc.mtta_minutes)}` : "Open"}
          unit={breach || activeSvc.mtta_minutes ? " min" : " window"}
          tone={breach || activeSvc.mtta_minutes ? "var(--text-primary)" : "var(--text-muted)"}
          icon={<Clock size={13} color="var(--healthy)" />}
          barWidth={breach ? Math.min(100, Math.max(20, breach.minutes * 4)) : activeSvc.mtta_minutes ? Math.min(100, activeSvc.mtta_minutes * 5) : 40}
          note={breach ? "Live slope" : "MTTA window"}
        />
        <Meter
          label="Alarm Lead Time (MTTA)"
          value={activeSvc.mtta_minutes != null ? `~${activeSvc.mtta_minutes}` : ""}
          unit={activeSvc.mtta_minutes != null ? " min" : ""}
          tone="var(--accent-text)"
          icon={<Clock size={13} color="var(--accent)" />}
          barWidth={activeSvc.mtta_minutes != null ? Math.min(100, Math.max(30, activeSvc.mtta_minutes * 5)) : 0}
          note={activeSvc.mtta_minutes != null ? "Measured early warning" : ""}
        />
      </div>

      {activeSvc.mtta_minutes != null && (
        <div style={{ background: "var(--bg-surface-elevated)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "10px 14px", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-secondary)" }}>
          <Clock size={14} color="var(--accent)" />
          <span>
            Measured mean advance warning: <strong style={{ color: "var(--accent-text)" }}>~{activeSvc.mtta_minutes} minutes</strong>.
          </span>
        </div>
      )}

      {/* Mitigation tier ladder — risk drops come from the SHARED model */}
      <div>
        <div className="analyzer-section-title">
          <span>Mitigation ladder</span>
          <span className="cell-note">Risk drop from the shared mitigation model</span>
        </div>
        <div className="analyzer-tiers">
          {tiersForLadder.map(({ n, opt }) => (
            <div key={n} className={`analyzer-tier${opt?.recommended ? " is-recommended" : ""}`}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "6px" }}>
                <span style={{ fontSize: "13px", fontWeight: 800, color: "var(--text-secondary)" }}>
                  TIER {n} · {opt?.tierName}
                </span>
                {opt?.recommended && <span className="drawer-badge healthy">Recommended</span>}
              </div>
              <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)", marginTop: "4px" }}>
                {opt?.plainLabel}
              </div>
              <div className="tier-metrics">
                <span className="tier-metric">
                  <span className="cell-note">Risk</span>
                  <strong className="font-mono">{opt ? `${opt.dropPct >= 0 ? "-" : "+"}${Math.abs(opt.dropPct)}%` : "—"}</strong>
                </span>
                <span className="tier-metric">
                  <span className="cell-note">Time to effect</span>
                  <strong>{opt?.timeToEffect || "—"}</strong>
                </span>
                <span className="tier-metric">
                  <span className="cell-note">Disruption</span>
                  <strong>{opt?.downtime || "—"}</strong>
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "10px" }}>
                <span className="cell-note">{opt?.approvalNeeded ? "Needs approval" : "No approval needed"}</span>
                <button
                  className={n === 1 ? "btn-primary btn-compact" : "btn-secondary btn-compact"}
                  onClick={() => onExecuteTierAction?.(activeSvc, n, shedPercent)}
                >
                  Record decision
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* What-if shedding simulator — same shared curve as the tier ladder */}
      <div className="analyzer-sim">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px", gap: "10px", flexWrap: "wrap" }}>
          <div>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
              What-if traffic shedding
            </span>
            <span className="cell-note" style={{ marginLeft: "8px" }}>Uses the shared risk model</span>
          </div>
          <span className="font-mono tabular-nums" style={{ fontSize: "13px", fontWeight: 800, color: "var(--accent-text)" }}>
            Shed {shedPercent}%
          </span>
        </div>

        <input
          type="range"
          min="0"
          max="60"
          step="5"
          value={shedPercent}
          onChange={(e) => setShedPercent(Number(e.target.value))}
          aria-label="Traffic shedding percentage"
          style={{ width: "100%", accentColor: "var(--accent)", cursor: "pointer", height: "6px" }}
        />

        <div className="analyzer-beforeafter">
          <div>
            <div className="sim-label">Current risk</div>
            <div className="font-mono tabular-nums" style={{ fontSize: "16px", fontWeight: 800, color: "var(--critical)" }}>
              {fmtPercent(baseRisk)}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", color: "var(--healthy)" }}>
            <ArrowRight size={18} />
          </div>
          <div>
            <div className="sim-label">Projected · {shedPercent}% shed</div>
            <div className="font-mono tabular-nums" style={{ fontSize: "16px", fontWeight: 800, color: "var(--healthy)" }}>
              {fmtPercent(projectedRisk)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
