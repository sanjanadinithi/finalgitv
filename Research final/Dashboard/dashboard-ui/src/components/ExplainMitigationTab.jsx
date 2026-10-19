// ExplainMitigationTab.jsx — Explainability & Mitigation view (Phase 1)
// ---------------------------------------------------------------------
// Per-service drill-down over three READ-ONLY endpoints:
//   GET /api/services/{svc}/explanation        (RCA, attribution, runbook, payloads)
//   GET /api/services/{svc}/mitigation         (tier ladder, cooldown, breaker)
//   GET /api/services/{svc}/mitigation/history (escalation timeline)
//
// Hard rules enforced here:
//  * No execute path anywhere. Approve/Ignore only logs a decision to the
//    advisor feedback log — nothing is actuated; actuation is simulated.
//  * Missing / placeholder data renders as "unavailable", never zeros.
//  * The attribution method badge is taken PER RESPONSE from
//    `attribution_method`; only exact TreeExplainer output says "TreeSHAP".
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Copy,
  Download,
  RefreshCw,
  ShieldCheck,
  Flame,
  History,
  ClipboardList,
  Braces,
  FlaskConical,
  CheckCircle2,
} from "lucide-react";
import {
  serviceExplanation,
  serviceMitigation,
  serviceMitigationHistory,
  advisorFeedback,
} from "../advisorClient.js";
import {
  UNAVAILABLE,
  fmtOrUnavailable,
  attributionBadge,
  cooldownDisplay,
  circuitBreakerInfo,
  tierLadderRows,
  isPlaceholderContributions,
} from "../utils.js";
import DataSourceStrip from "./DataSourceStrip.jsx";

const POLL_MS = 5000;

function SevBadge({ severity }) {
  const s = String(severity || "").toUpperCase();
  const tone = s === "CRITICAL" ? "danger" : s === "WARNING" ? "warn" : s === "NOMINAL" || s === "HEALTHY" ? "ok" : "muted";
  return <span className={`xm-sev xm-tone-${tone}`}>{severity || UNAVAILABLE}</span>;
}

function ContributionBars({ contributions }) {
  const entries = useMemo(
    () => Object.entries(contributions || {}).sort((a, b) => b[1] - a[1]),
    [contributions]
  );
  if (!entries.length || isPlaceholderContributions(contributions)) {
    return <div className="xm-unavailable">Feature contribution: {UNAVAILABLE}</div>;
  }
  const max = Math.max(...entries.map(([, v]) => Number(v) || 0), 1);
  return (
    <div className="xm-bars" aria-label="Feature contribution bar chart">
      {entries.map(([feat, pct]) => (
        <div className="xm-bar-row" key={feat}>
          <span className="xm-bar-label" title={feat}>{feat}</span>
          <span className="xm-bar-track">
            <span className="xm-bar-fill" style={{ width: `${(Number(pct) / max) * 100}%` }} />
          </span>
          <span className="xm-bar-val">{Number(pct).toFixed(1)}%</span>
        </div>
      ))}
    </div>
  );
}

function JsonViewer({ title, payload }) {
  const text = useMemo(() => JSON.stringify(payload ?? {}, null, 2), [payload]);
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (http) — no-op; Download still works */
    }
  };
  const download = () => {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/\s+/g, "_").toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="xm-json">
      <div className="xm-json-head">
        <span><Braces size={13} /> {title}</span>
        <span className="xm-json-actions">
          <button className="xm-btn" onClick={copy} title="Copy JSON to clipboard">
            <Copy size={12} /> {copied ? "Copied" : "Copy"}
          </button>
          <button className="xm-btn" onClick={download} title="Download JSON file">
            <Download size={12} /> Download
          </button>
        </span>
      </div>
      <pre className="xm-json-body">{text}</pre>
    </div>
  );
}

// Gateway service rows use .service (fleet) or .service_name (Comp4 records);
// App hands us either a full service object or a bare name string.
const nameOf = (s) => (s ? s.service_name || s.service || s.id || "" : "");

export default function ExplainMitigationTab({ services = [], selectedService, onSelectService, provenance }) {
  const initialSvc = useMemo(
    () => nameOf(selectedService) || nameOf(services[0]) || "",
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [svc, setSvc] = useState(initialSvc);
  const [expl, setExpl] = useState(null);
  const [mit, setMit] = useState(null);
  const [hist, setHist] = useState(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("sentinel");
  const [cooldownTick, setCooldownTick] = useState(0);
  const [cooldownAnchor, setCooldownAnchor] = useState({ at: null, remaining: null });
  const [decisionMsg, setDecisionMsg] = useState("");
  const [checkedSteps, setCheckedSteps] = useState({});

  // Follow selection changes from other views (React's recommended
  // adjust-state-on-prop-change pattern — no setState-inside-effect cascade).
  const selectedName = nameOf(selectedService);
  const [prevSelectedName, setPrevSelectedName] = useState("");
  if (selectedName && selectedName !== prevSelectedName) {
    setPrevSelectedName(selectedName);
    setSvc(selectedName);
  }

  // Reset the countdown clock when the target service changes.
  const [prevTickSvc, setPrevTickSvc] = useState(svc);
  if (svc !== prevTickSvc) {
    setPrevTickSvc(svc);
    setCooldownTick(0);
    setCooldownAnchor({ at: null, remaining: null });
  }

  // Pin the tick at which the backend's remaining seconds were first observed.
  if (mit && cooldownAnchor.at == null && cooldownAnchor.remaining != null) {
    setCooldownAnchor((p) => ({ ...p, at: cooldownTick }));
  }

  const load = useCallback(async (service) => {
    if (!service) return;
    try {
      const [e, m, h] = await Promise.all([
        serviceExplanation(service),
        serviceMitigation(service),
        serviceMitigationHistory(service),
      ]);
      setExpl(e); setMit(m); setHist(h); setError("");
      setCheckedSteps({});
      // Re-stamp the backend's remaining seconds; the render phase pins the
      // tick it was observed at, and each subsequent tick ages it by one second.
      if (m) setCooldownAnchor((p) => ({ ...p, remaining: m.cooldown_remaining_sec || 0 }));
    } catch (err) {
      setError(err.status === 404
        ? `No records yet for '${service}' — the live inference loop has not scored it.`
        : `Explainability service unavailable: ${err.message}`);
      setExpl(null);
    }
  }, []);

  // Initial + on-change fetch. The rule flags any callee that can setState;
  // load() only sets state inside its async .then path (external-system sync),
  // which is the documented exception for data fetching.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(svc); }, [svc, load]);
  // Re-poll the real mitigation state; the countdown interpolates in between.
  useEffect(() => {
    const id = setInterval(() => { load(svc); }, POLL_MS);
    const tick = setInterval(() => setCooldownTick((t) => t + 1), 1000);
    return () => { clearInterval(id); clearInterval(tick); };
  }, [svc, load]);

  // Countdown between polls: the backend value is stamped at render time
  // (pure — never read from a ref mid-render), and each tick ages it by one
  // second. A <=1 s delay between fetch and stamp is conservative: it can
  // only overstate the countdown, never understate it.
  const shownRemaining = useMemo(() => {
    if (!mit || cooldownAnchor.remaining == null) return 0;
    const elapsed = Math.max(0, cooldownTick - cooldownAnchor.at);
    return Math.max(0, cooldownAnchor.remaining - elapsed);
  }, [mit, cooldownAnchor, cooldownTick]);

  // Decision logging ONLY — Approve/Ignore never actuates anything.
  const logDecision = async (decision) => {
    try {
      await advisorFeedback({
        serviceName: svc,
        decision,                       // accepted | ignored (log only)
        recommendedAction: expl?.runbook_id || "unknown",
        confidence: null,
      });
      setDecisionMsg(`Decision "${decision}" logged (nothing executed).`);
    } catch (err) {
      setDecisionMsg(`Could not log decision: ${err.message}`);
    }
    setTimeout(() => setDecisionMsg(""), 4000);
  };

  const badge = attributionBadge(expl?.attribution_method);
  const cd = cooldownDisplay(mit ? shownRemaining : null, mit?.cooldown_total_sec ?? 180);
  const breaker = circuitBreakerInfo(mit?.circuit_breaker);
  const tiers = tierLadderRows(mit?.tiers, mit?.active_tier ?? 0);
  const payload =
    tab === "pagerduty" ? expl?.pagerduty_payload
    : tab === "servicenow" ? expl?.servicenow_payload
    : expl?.incident_ticket_payload;

  const causes = expl && expl.data_available
    ? [expl.primary_cause, expl.secondary_cause].filter(Boolean)
    : [];

  return (
    <div className="xm-root">
      <DataSourceStrip provenance={provenance} />

      <div className="xm-head">
        <h2><ShieldCheck size={18} /> Explainability &amp; Mitigation</h2>
        <div className="xm-controls">
          <select
            className="xm-select"
            value={svc}
            onChange={(e) => {
              setSvc(e.target.value);
              const match = services.find((s) => nameOf(s) === e.target.value);
              onSelectService?.(match || e.target.value);
            }}
            aria-label="Select service"
          >
            {services.map((s) => {
              const n = nameOf(s);
              return <option key={n} value={n}>{n}</option>;
            })}
          </select>
          <button className="xm-btn" onClick={() => load(svc)} title="Refresh now">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {error && <div className="xm-error">{error}</div>}
      {!error && !expl && <div className="xm-loading">Loading…</div>}

      {expl && (
        <div className="xm-grid">
          {/* ── Explainability panel ─────────────────────────────── */}
          <section className="xm-card" aria-label="Explainability">
            <div className="xm-card-head">
              <h3><Flame size={15} /> Root cause analysis</h3>
              <span
                className={`xm-badge ${badge.exact ? "xm-badge-exact" : "xm-badge-approx"}`}
                title={badge.detail}
              >
                {badge.label}
              </span>
            </div>
            <p className="xm-method-note" title="Method badge is per API response (attribution_method field)">
              {badge.detail}
            </p>

            <div className="xm-row">
              <SevBadge severity={expl.severity} />
              <span className="xm-impact" title={expl.impact_radius_note}>
                Impact radius: <strong>{expl.impact_radius || UNAVAILABLE}</strong>
                {expl.impact_radius === UNAVAILABLE && (
                  <em className="xm-impact-note"> — {expl.impact_radius_note}</em>
                )}
              </span>
            </div>

            {causes.length > 0 ? (
              <div className="xm-causes">
                {causes.map((c, i) => (
                  <div className="xm-cause" key={c.feature}>
                    <span className="xm-cause-rank">{i === 0 ? "Primary" : "Secondary"}</span>
                    <span className="xm-cause-name">{c.display_name}</span>
                    <span className="xm-cause-pct">{fmtOrUnavailable(c.contribution_pct, (v) => `${Number(v).toFixed(1)}%`)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="xm-unavailable">
                Causes: {UNAVAILABLE}{expl.reason ? ` (${expl.reason})` : ""}
              </div>
            )}

            <h4 className="xm-sub">Feature contribution <em>(field: shapley_phi_values, shown as contribution %)</em></h4>
            <ContributionBars contributions={expl.feature_contributions} />

            <h4 className="xm-sub">Plain-language narrative</h4>
            <p className="xm-narrative">{expl.rca_narrative || UNAVAILABLE}</p>

            <h4 className="xm-sub"><ClipboardList size={13} /> Recommended SRE runbook — {expl.runbook_id}</h4>
            <ul className="xm-checklist">
              {(expl.runbook_checklist || []).map((step, i) => (
                <li key={i}>
                  <label>
                    <input
                      type="checkbox"
                      checked={!!checkedSteps[i]}
                      onChange={() => setCheckedSteps((p) => ({ ...p, [i]: !p[i] }))}
                    />
                    <span className={checkedSteps[i] ? "xm-done" : ""}>{step}</span>
                  </label>
                </li>
              ))}
            </ul>
            {(!expl.runbook_checklist || !expl.runbook_checklist.length) && (
              <div className="xm-unavailable">Runbook checklist: {UNAVAILABLE}</div>
            )}

            <h4 className="xm-sub">Incident payload</h4>
            <div className="xm-tabs" role="tablist">
              {[["sentinel", "Sentinel"], ["pagerduty", "PagerDuty"], ["servicenow", "ServiceNow"]].map(([id, label]) => (
                <button
                  key={id}
                  role="tab"
                  aria-selected={tab === id}
                  className={`xm-tab ${tab === id ? "active" : ""}`}
                  onClick={() => setTab(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <JsonViewer title={`${tab} payload`} payload={payload || {}} />
          </section>

          {/* ── Mitigation panel ─────────────────────────────────── */}
          <section className="xm-card" aria-label="Mitigation">
            <div className="xm-card-head">
              <h3><ShieldCheck size={15} /> Mitigation state</h3>
              <span className={`xm-badge xm-tone-${breaker.tone}`} title={breaker.meaning}>
                {breaker.label}
              </span>
            </div>
            {mit?.reason && <p className="xm-method-note">{mit.reason}</p>}

            <div className="xm-ladder" aria-label="Mitigation tier ladder">
              {tiers.map((t) => (
                <div key={t.tier} className={`xm-tier ${t.active ? "active" : ""}`}>
                  <div className="xm-tier-no">Tier {t.tier}</div>
                  <div className="xm-tier-body">
                    <strong>{t.label}</strong>
                    <span>{t.detail}</span>
                  </div>
                  {t.active && <span className="xm-tier-flag">ACTIVE</span>}
                </div>
              ))}
              {!tiers.length && <div className="xm-unavailable">Tier ladder: {UNAVAILABLE}</div>}
            </div>

            <div className="xm-cooldown">
              <div className="xm-cooldown-head">
                <span>Cooldown (180 s policy)</span>
                <strong aria-live="off">{cd.active ? cd.text : "ready"}</strong>
              </div>
              <div className="xm-cooldown-track">
                <div className="xm-cooldown-fill" style={{ width: `${Math.round(cd.pct * 100)}%` }} />
              </div>
            </div>

            <h4 className="xm-sub">Command preview</h4>
            <div className="xm-cmd-wrap">
              <span className="xm-simulated" role="status">
                <FlaskConical size={12} /> SIMULATED — not executed
              </span>
              <pre className="xm-cmd">
                {mit?.command_preview || `No command preview (${mit?.active_tier ? `tier ${mit.active_tier}` : UNAVAILABLE})`}
              </pre>
            </div>

            <div className="xm-decisions">
              <button className="xm-btn xm-approve" onClick={() => logDecision("accepted")}>
                <CheckCircle2 size={13} /> Approve (log only)
              </button>
              <button className="xm-btn" onClick={() => logDecision("ignored")}>Ignore (log only)</button>
            </div>
            <p className="xm-decision-note">
              No execute path exists in this view. Approve/Ignore only writes to the advisor
              decision log; actuation stays simulated behind the 180 s circuit breaker.
            </p>
            {decisionMsg && <div className="xm-decision-msg">{decisionMsg}</div>}

            <h4 className="xm-sub"><History size={13} /> Mitigation history</h4>
            {hist && hist.count > 0 ? (
              <ol className="xm-history">
                {[...hist.entries].reverse().map((e, i) => (
                  <li key={i}>
                    <span className="xm-hist-time">{fmtOrUnavailable(e.timestamp)}</span>
                    <span className={`xm-hist-tier ${e.tier ? "on" : ""}`}>T{fmtOrUnavailable(e.tier)}</span>
                    <span className="xm-hist-action">{e.action || UNAVAILABLE}</span>
                    {e.command && <code className="xm-hist-cmd" title="Simulated command (never executed)">{e.command}</code>}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="xm-unavailable">
                {hist?.note || `History: ${UNAVAILABLE} (no escalations recorded yet)`}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
