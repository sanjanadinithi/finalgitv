import { useState, useEffect, useMemo, useCallback } from "react";
import {
  Sparkles, ShieldAlert, Clock, Check, X, ArrowUpRight, AlertTriangle, RefreshCw,
  MessageSquare,
} from "lucide-react";
import { fmtPercent } from "../utils.js";
import { advisorDrift, advisorFeedback } from "../advisorClient.js";
import ChatDrawer from "./ChatDrawer.jsx";
import DataSourceStrip from "./DataSourceStrip.jsx";

/**
 * DecisionAdvisorPanel — the Advanced AI decision-support surface.
 *
 * Every field shown is produced by Component 4's Decision Advisor on its live
 * hot path (svc.advisor) or fetched from the advisor REST endpoints via the
 * gateway. Nothing is invented client-side: when the advisor is unavailable the
 * panel says so. Heavy work (drift) is polled on a slow cadence, never the 1 s
 * telemetry path.
 */

const ACTION_LABEL = {
  NO_ACTION: "No action",
  LOAD_SHEDDING: "Load shedding (Envoy 25%)",
  SCALE_OUT: "Scale out (+2 pods)",
  PROACTIVE_RESTART: "Proactive restart",
  CRITICAL_RESTART_AND_REROUTE: "Critical restart + reroute",
};

const ACTION_TONE = {
  NO_ACTION: "#3fb950",
  LOAD_SHEDDING: "#d4a72c",
  SCALE_OUT: "#d4a72c",
  PROACTIVE_RESTART: "#f0883e",
  CRITICAL_RESTART_AND_REROUTE: "#f85149",
};

function label(a) {
  return ACTION_LABEL[a] || a;
}
function tone(a) {
  return ACTION_TONE[a] || "var(--text-primary)";
}

function Countdown({ p10, p50, p90 }) {
  if (p50 == null) return <span style={{ color: "var(--text-muted)" }}>no forecast</span>;
  const fmt = (m) => (m < 1 ? `${Math.round(m * 60)}s` : `${m.toFixed(1)}m`);
  return (
    <span className="font-mono tabular-nums" style={{ fontWeight: 800, fontSize: 18 }}>
      {fmt(p50)}
      <span style={{ color: "var(--text-muted)", fontWeight: 600, fontSize: 13 }}>
        {"  "}(range {fmt(p10)}–{fmt(p90)})
      </span>
    </span>
  );
}

export default function DecisionAdvisorPanel({ services = [], selectedService, onSelectService, provenance = null }) {
  const [drift, setDrift] = useState(null);
  const [driftError, setDriftError] = useState("");
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState("");
  const [chatOpen, setChatOpen] = useState(false);

  // Focused service: operator selection (an object OR a name string), else the
  // highest-risk service that has an advisor view, else the riskiest service.
  const svc = useMemo(() => {
    const byName = (x) =>
      services.find((s) => s.service === x || s.id === x) || null;
    if (selectedService) {
      if (typeof selectedService === "object") {
        return services.find(
          (s) => s.service === selectedService.service || s.id === selectedService.id
        ) || selectedService;
      }
      return byName(selectedService);
    }
    const withAdvisor = services.filter((s) => s.advisor);
    const pool = withAdvisor.length ? withAdvisor : services;
    return [...pool].sort(
      (a, b) => (b.cpu_probability || 0) - (a.cpu_probability || 0)
    )[0] || null;
  }, [services, selectedService]);

  const advisor = svc?.advisor || null;

  const loadDrift = useCallback(async () => {
    try {
      const res = await advisorDrift();
      setDrift(res);
      setDriftError("");
    } catch (err) {
      setDriftError(err.message || "advisor unavailable");
      setDrift(null);
    }
  }, []);

  // Drift/retrain banner is heavy and offline — poll on a slow 20 s cadence,
  // never on the 1 s telemetry loop.
  useEffect(() => {
    const t = setTimeout(loadDrift, 0);
    const id = setInterval(loadDrift, 20000);
    return () => { clearTimeout(t); clearInterval(id); };
  }, [loadDrift]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  async function record(decision, chosenAction = null) {
    if (!advisor || !svc) return;
    setBusy(true);
    try {
      await advisorFeedback({
        serviceName: svc.service || svc.id,
        decision,
        recommendedAction: advisor.recommended_action,
        chosenAction,
        confidence: advisor.confidence,
      });
      setToast(
        decision === "accepted" ? "Approved — recorded to advisor feedback log"
        : decision === "ignored" ? "Ignored — recorded"
        : `Override to ${label(chosenAction)} — recorded`
      );
    } catch (err) {
      setToast(`Feedback failed: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  const driftAdvisory = drift && drift.status === "ok"
    ? (drift.services || []).find((d) => d.service_name === (svc?.service)) || null
    : null;
  const retrainBanner = driftAdvisory && driftAdvisory.advice === "RETRAIN_RECOMMENDED";
  const adjustBanner = driftAdvisory && driftAdvisory.advice === "ADJUST_THRESHOLD";

  return (
    <div className="analyzer-panel" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div className="analyzer-header">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, margin: 0 }}>
          <Sparkles size={20} style={{ color: "var(--accent)" }} /> Decision Advisor
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <select
            className="analyzer-select"
            value={svc?.service || svc?.id || ""}
            onChange={(e) => {
              const match = services.find((s) => (s.service || s.id) === e.target.value);
              onSelectService && onSelectService(match || e.target.value);
            }}
            style={{ minWidth: 180 }}
          >
            {services.map((s) => (
              <option key={s.service || s.id} value={s.service || s.id}
                style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}>
                {s.service || s.id}
              </option>
            ))}
          </select>
        </div>
      </div>

      <DataSourceStrip provenance={provenance} />

      {/* Drift / retrain banner (offline advisory, human-approval only) */}
      {drift?.status === "not_computed" && (
        <div className="analyzer-note">
          Drift/retrain advisor not yet computed — run the advisor evaluation to populate it.
        </div>
      )}
      {driftError && (
        <div className="analyzer-note" style={{ color: "#f85149" }}>
          <AlertTriangle size={14} /> Advisor backend unavailable ({driftError}). No recommendation is invented.
        </div>
      )}
      {(retrainBanner || adjustBanner) && (
        <div
          className="analyzer-note"
          style={{
            borderColor: retrainBanner ? "#f85149" : "#d4a72c",
            display: "flex", alignItems: "center", gap: 8,
          }}
        >
          <RefreshCw size={14} />
          <strong>{retrainBanner ? "Retrain recommended" : "Threshold adjustment suggested"}</strong>
          <span>for {svc?.service} (PSI {driftAdvisory.psi?.toFixed?.(3)}, KS p {driftAdvisory.ks_p_value}).</span>
          <span style={{ color: "var(--text-muted)" }}>Requires human approval; never applied automatically.</span>
        </div>
      )}

      {!advisor ? (
        <div className="analyzer-empty">
          No Decision Advisor view for {svc ? svc.service : "this service"} yet. It appears once the
          Component 4 live daemon (with the advisor layer) reports a prediction for this service.
        </div>
      ) : (
        <>
          {/* Recommended action + confidence + TTF */}
          <div className="analyzer-grid">
            <div className="analyzer-meters">
              <div className="advisor-reco">
                <div style={{ fontSize: 12, color: "var(--text-muted)" }}>RECOMMENDED ACTION</div>
                <div style={{ fontSize: 22, fontWeight: 900, color: tone(advisor.recommended_action) }}>
                  {label(advisor.recommended_action)}
                </div>
                <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  Guaranteed fallback: {label(advisor.fallback_matrix_action)}
                </div>
              </div>

              <div className="analyzer-meter">
                <div className="analyzer-meter-head">
                  <span
                    title="Confidence here is a FIXED ±0.15 display band around the point estimate — it is NOT a calibrated interval (isotonic calibration did not improve ECE on this frame). 'Risk' alongside it is the model's P(failure in next 5 min)."
                  >
                    Confidence (±0.15 display band)
                  </span>
                  <ShieldAlert size={14} />
                </div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>
                  {fmtPercent(advisor.confidence)}
                  {advisor.confidence_band && (
                    <span style={{ color: "var(--text-muted)", fontSize: 13, fontWeight: 600 }}>
                      {"  "}({fmtPercent(advisor.confidence_band[0])}–{fmtPercent(advisor.confidence_band[1])})
                    </span>
                  )}
                </div>
              </div>

              <div className="analyzer-meter">
                <div className="analyzer-meter-head">
                  <span title="Time to failure = forecast p50 in minutes, range p10–p90. A statistical estimate, not a guarantee (offline MAE ≈ 5 min).">
                    Time to failure
                  </span>
                  <Clock size={14} />
                </div>
                <Countdown
                  p10={advisor.time_to_failure_band?.[0]}
                  p50={advisor.time_to_failure_min}
                  p90={advisor.time_to_failure_band?.[1]}
                />
              </div>
            </div>

            {/* Plain-language brief */}
            <div className="advisor-brief">
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 6 }}>OPERATOR BRIEF</div>
              <p style={{ margin: 0, lineHeight: 1.5 }}>{advisor.brief}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                {advisor.needs_human_review && (
                  <span className="pill warning"><AlertTriangle size={12} /> Uncertain — review</span>
                )}
                {advisor.requires_operator_approval && (
                  <span className="pill critical"><ShieldAlert size={12} /> Approval required (Tier &gt; 1)</span>
                )}
              </div>
            </div>
          </div>

          {/* Top-3 ranked actions with reasons */}
          <div className="advisor-ranked">
            <div style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 8 }}>
              TOP OPTIONS (cost-sensitive ranking — lower expected cost is better)
            </div>
            {(advisor.ranked_actions || []).slice(0, 3).map((a) => (
              <div key={a.rank} className="advisor-action-row">
                <div className="advisor-action-rank">#{a.rank}</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, color: tone(a.action) }}>{label(a.action)}</div>
                  <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{a.reason}</div>
                  <div
                    style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}
                    title={
                      "expected cost = policy score (not money): residual_failure × 120 + disruption + time_pressure. " +
                      "residual failure = P(failure | action taken). " +
                      "risk −X% = reduction RELATIVE TO the current joint failure probability (p_fail − residual)."
                    }
                  >
                    expected cost {a.expected_cost?.toFixed?.(1)} (policy score) · residual failure {(a.residual_failure_prob * 100)?.toFixed?.(0)}% · risk −{(a.risk_reduced * 100)?.toFixed?.(0)}% vs current p_fail
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Operator actions */}
          <div className="advisor-controls">
            <button
              className="btn primary"
              disabled={busy}
              onClick={() => record("accepted")}
            >
              <Check size={16} /> Approve
            </button>
            <button
              className="btn"
              disabled={busy}
              onClick={() => record("ignored")}
            >
              <X size={16} /> Ignore
            </button>
            <label className="btn" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <ArrowUpRight size={16} /> Override
              <select
                defaultValue=""
                disabled={busy}
                className="analyzer-select"
                style={{ padding: "4px 8px", fontSize: 12 }}
                onChange={(e) => e.target.value && record("overridden", e.target.value)}
              >
                <option value="" disabled style={{ background: "var(--bg-input)", color: "var(--text-muted)" }}>choose action…</option>
                {Object.keys(ACTION_LABEL).map((a) => (
                  <option key={a} value={a} style={{ background: "var(--bg-input)", color: "var(--text-primary)" }}>{label(a)}</option>
                ))}
              </select>
            </label>
            {toast && <span className="advisor-toast">{toast}</span>}
          </div>
        </>
      )}

      {/* Ask Sentinel chat trigger + drawer */}
      <button
        className="chat-fab"
        onClick={() => setChatOpen(true)}
        aria-label="Ask Sentinel"
        title="Ask Sentinel"
      >
        <MessageSquare size={20} />
      </button>
      <ChatDrawer
        service={svc?.service || svc?.id || ""}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
      />
    </div>
  );
}
