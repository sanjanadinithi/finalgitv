import React, { useMemo, useState, useEffect } from "react";
import {
  Clock,
  Check,
  X,
  BellOff,
  ArrowRight,
  Zap,
  Cpu,
  Gauge,
  TrendingUp,
  Layers,
  ArrowDownToLine,
  Activity,
  Database,
  MemoryStick,
  AlertTriangle,
  Flame,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import RiskGauge from "./RiskGauge.jsx";
import StatusBadge from "./StatusBadge.jsx";
import {
  computePriorityScore,
  getRecommendation,
  explainPriority,
  getBreachEstimate,
  getBlastRadius,
  getDriverChips,
  getCorrelatedIncidents,
  fmtPercent,
} from "../utils.js";

// Driver icon keys → actual lucide icons (chips carry an icon, never a sentence)
const ICONS = {
  cpu: Cpu,
  gauge: Gauge,
  trendingUp: TrendingUp,
  layers: Layers,
  arrowDown: ArrowDownToLine,
  activity: Activity,
  zap: Zap,
  database: Database,
  memory: MemoryStick,
  alert: AlertTriangle,
};

function DriverChip({ chip }) {
  const Icon = ICONS[chip.icon] || Activity;
  return (
    <span className="driver-chip" title={`${chip.label} · ${chip.pct}% of risk`}>
      <Icon size={13} />
      <span>{chip.label}</span>
      <span className="font-mono tabular-nums">{chip.pct}%</span>
    </span>
  );
}

function pad(n) {
  return String(Math.max(0, Math.floor(n))).padStart(2, "0");
}

export default function DecisionHero({
  services = [],
  onSelectService,
  onApproveAction,
  onSnoozeAction,
  onDismissAction,
  onFailAction,
  onRejectModal,
}) {
  // Local sets for immediate alert removal / state tracking
  const [dismissedIds, setDismissedIds] = useState(() => new Set());
  const [resolvedIds, setResolvedIds] = useState(() => new Set());
  const [failedIds, setFailedIds] = useState(() => new Set());

  // Rank EVERY at-risk service by priority score (probability × blast × urgency)
  // Filters out muted services and locally dismissed/resolved/failed services
  const ranked = useMemo(
    () =>
      [...services]
        .filter(
          (s) =>
            s.risk !== "HEALTHY" &&
            !s.muted &&
            !dismissedIds.has(s.id) &&
            !resolvedIds.has(s.id) &&
            !failedIds.has(s.id)
        )
        .map((s) => ({
          ...s,
          priorityScore: computePriorityScore(s, services),
          priorityExplain: explainPriority(s, services),
          recommendation: getRecommendation(s),
          blast: getBlastRadius(s, services),
          breach: getBreachEstimate(s),
          drivers: getDriverChips(s, 3),
        }))
        .sort((a, b) => b.priorityScore - a.priorityScore),
    [services, dismissedIds, resolvedIds, failedIds]
  );

  const correlatedGroups = useMemo(() => getCorrelatedIncidents(services), [services]);

  // Live countdowns seeded from MTTA advance warning lead time or breach ETA.
  // Counts down second-by-second until 0:00.
  const [secondsMap, setSecondsMap] = useState({});
  const [initialSecondsMap, setInitialSecondsMap] = useState({});

  useEffect(() => {
    setSecondsMap((prev) => {
      const next = { ...prev };
      let changed = false;
      ranked.forEach((s) => {
        if (next[s.id] == null) {
          const mins = Number(s.breach?.minutes || s.mtta_minutes || 5);
          const initialSecs = Math.max(30, Math.round(mins * 60));
          next[s.id] = initialSecs;
          setInitialSecondsMap((iprev) => ({ ...iprev, [s.id]: initialSecs }));
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [ranked]);

  // Ticking countdown loop
  useEffect(() => {
    const timer = setInterval(() => {
      setSecondsMap((prev) => {
        let changed = false;
        const next = { ...prev };
        for (const id in next) {
          if (next[id] > 0) {
            next[id] -= 1;
            changed = true;
            // When countdown reaches 0 without resolution: mark as failed & remove active alert
            if (next[id] === 0) {
              setFailedIds((f) => new Set(f).add(id));
              const svc = services.find((s) => s.id === id);
              if (svc) {
                onFailAction?.(svc);
              }
            }
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [services, onFailAction]);

  const [expandedGroups, setExpandedGroups] = useState(() => new Set());

  // Action handlers
  const handleSolve = (svc) => {
    const remaining = secondsMap[svc.id] ?? 0;
    setResolvedIds((prev) => new Set(prev).add(svc.id));
    onApproveAction?.(svc, remaining);
  };

  const handleDismiss = (svc) => {
    setDismissedIds((prev) => new Set(prev).add(svc.id));
    onDismissAction?.(svc);
  };

  if (ranked.length === 0) {
    const totalDismissed = dismissedIds.size + resolvedIds.size + failedIds.size;
    return (
      <div className="hero-fix-card is-healthy" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <StatusBadge status="HEALTHY" />
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700 }}>
              {totalDismissed > 0 ? "All Active Incidents Handled" : "Fleet Healthy — Nothing to Fix"}
            </div>
            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
              {totalDismissed > 0
                ? `${resolvedIds.size} solved before crash · ${dismissedIds.size} dismissed · ${failedIds.size} expired.`
                : "No active critical or warning alerts detected."}
            </div>
          </div>
        </div>
        {totalDismissed > 0 && (
          <button
            className="btn-secondary btn-compact"
            onClick={() => {
              setDismissedIds(new Set());
              setResolvedIds(new Set());
              setFailedIds(new Set());
            }}
            style={{ fontSize: "12px" }}
          >
            Reset Dismissed ({totalDismissed})
          </button>
        )}
      </div>
    );
  }

  const hero = ranked[0];
  const rest = ranked.slice(1, 10);
  const heroMttaLabel = hero.mtta_minutes != null ? `~${hero.mtta_minutes}m early` : "";
  const heroMaxProb = Math.max(
    Number(hero.cpu_probability || 0),
    Number(hero.memory_probability || 0)
  );
  const heroAfter = Math.max(0, Number(hero.recommendation.expectedRiskAfter || 0));
  const heroSecs = secondsMap[hero.id];
  const heroInitSecs = initialSecondsMap[hero.id] || heroSecs || 1;
  const isUrgent = heroSecs != null && heroSecs <= 60;

  // Collapse correlated incidents (#2–#10) into ONE expandable row each
  const groupKeyFor = {};
  correlatedGroups.forEach((g) => g.services.forEach((s) => (groupKeyFor[s.id] = g.key)));
  const consumedGroups = new Set();
  const rows = [];
  rest.forEach((s) => {
    const gk = groupKeyFor[s.id];
    if (gk) {
      if (consumedGroups.has(gk)) return;
      consumedGroups.add(gk);
      const group = correlatedGroups.find((g) => g.key === gk);
      rows.push({ type: "group", group, anchor: s });
    } else {
      rows.push({ type: "service", service: s });
    }
  });

  const toggleGroup = (key) =>
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="decision-layer">
      {/* ── HERO: Fix this first ─────────────────────────────── */}
      <div
        className="hero-fix-card"
        onClick={() => onSelectService?.(hero)}
        title={`Priority ${hero.priorityExplain.score} = ${hero.priorityExplain.probabilityPct}% risk × blast ${hero.priorityExplain.blastWeight} × urgency ${hero.priorityExplain.timeFactor}`}
      >
        <div
          className="hero-ring-wrap"
          title={
            "Risk = model P(failure) in the next 5 min: max of the CPU spike probability and the " +
            "memory leak probability reported by Component 4 for this service. Not a calibrated " +
            "guarantee — see the calibrated band in the Decision Advisor panel."
          }
        >
          <RiskGauge value={heroMaxProb} size={132} strokeWidth={11} />
        </div>

        <div className="hero-body">
          <div className="hero-eyebrow">
            <Flame size={14} color="var(--critical)" />
            <span>Fix this first</span>
          </div>

          <div className="hero-name" title={hero.service}>
            {hero.service}
          </div>

          {/* Active Live Countdown Timer */}
          {heroSecs != null && (
            <div
              className="hero-countdown"
              title={`Advance warning lead time (MTTA): ${heroMttaLabel}. Solve before this timer reaches 0:00.`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "4px",
                alignItems: "flex-start",
                padding: "8px 12px",
                borderRadius: "var(--radius-md)",
                background: isUrgent ? "rgba(239, 68, 68, 0.12)" : "rgba(56, 189, 248, 0.08)",
                border: isUrgent ? "1px solid var(--critical)" : "1px solid var(--border-subtle)",
                marginBottom: "6px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <Clock size={16} color={isUrgent ? "var(--critical)" : "var(--accent)"} />
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                    color: isUrgent ? "var(--critical)" : "var(--text-muted)",
                  }}
                >
                  {isUrgent ? "🚨 Failure Imminent — Take Action" : "Advance Warning Countdown (MTTA)"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "baseline", gap: "8px" }}>
                <span
                  className="font-mono tabular-nums hero-countdown-num"
                  style={{
                    color: isUrgent ? "var(--critical)" : "var(--accent-text)",
                    fontSize: "24px",
                    fontWeight: 800,
                  }}
                >
                  {pad(heroSecs / 60)}:{pad(heroSecs % 60)}
                </span>
                <span style={{ fontSize: "12px", color: isUrgent ? "var(--critical)" : "var(--text-secondary)" }}>
                  {isUrgent ? "remaining before service crash" : "advance warning before failure"}
                </span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: "4px",
                  background: "var(--bg-app)",
                  borderRadius: "2px",
                  overflow: "hidden",
                  marginTop: "2px",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: `${Math.min(100, Math.max(0, (heroSecs / heroInitSecs) * 100))}%`,
                    background: isUrgent ? "var(--critical)" : "var(--accent)",
                    transition: "width 1s linear",
                  }}
                />
              </div>
            </div>
          )}

          {/* Top 3 driver chips */}
          <div className="driver-chip-row">
            {hero.drivers.length > 0 ? (
              hero.drivers.map((c) => <DriverChip key={c.name} chip={c} />)
            ) : (
              <span className="text-muted-13">No drivers above threshold</span>
            )}
          </div>

          {/* Before → After bar (green = risk removed) */}
          <div className="before-after">
            <div className="ba-track">
              <div className="ba-drop" style={{ width: `${Math.round((1 - heroAfter) * 100)}%` }} />
            </div>
            <div className="ba-labels">
              <span className="ba-before">{fmtPercent(heroMaxProb)}</span>
              <ArrowRight size={14} />
              <span className="ba-after-label">{fmtPercent(heroAfter)}</span>
              <span
                className="est-badge"
                title={
                  "Heuristic projection, not a model output: 'after' applies a fixed per-tier " +
                  "risk-attenuation factor (soft/moderate/emergency) to the current P(failure). " +
                  "Illustrates direction and magnitude only."
                }
              >est.</span>
            </div>
          </div>

          <div className="hero-meta">
            {hero.mtta_minutes != null && (
              <span className="blip" title="Alarm predicted strictly ahead of failure onset (Mean Time To Anticipate)">
                <Clock size={13} color="var(--accent)" />
                MTTA: {heroMttaLabel}
              </span>
            )}
            <span className="blip" title={"Blast radius = count of services sharing the same project label (co-location heuristic). No call-graph/dependency topology source exists, so this is an estimate, not measured impact."}>
              <Layers size={13} />
              Blast: {hero.blast.label} · {hero.blast.peerCount} peers
              <span className="est-badge">est.</span>
            </span>
            <span className="blip" title={hero.recommendation.confidenceNote}>
              <Check size={13} />
              {hero.recommendation.approvalNeeded ? "Needs approval" : "No approval needed"}
            </span>
            <span className="blip" title={`Downtime ${hero.recommendation.downtime} · Effect ${hero.recommendation.timeToEffect} — planning figures from the fixed runbook tier table (TIER_MODEL), not measured data`}>
              <Clock size={13} />
              {hero.recommendation.downtime} downtime
              <span className="est-badge">est.</span>
            </span>
          </div>

          {/* Action buttons allowing operator to act, solve, or dismiss */}
          <div className="hero-actions" onClick={(e) => e.stopPropagation()}>
            <button
              className="btn-hero-primary"
              onClick={() => handleSolve(hero)}
              title={`Execute mitigation before crash: ${hero.recommendation.actionTitle}`}
            >
              <Zap size={15} />
              {hero.recommendation.shortLabel} · Solve Before Crash
            </button>
            <button
              className="btn-hero-secondary"
              onClick={() => handleDismiss(hero)}
              title="Dismiss and remove alert from dashboard"
            >
              <X size={15} />
              Dismiss Alert
            </button>
            <button
              className="btn-hero-secondary"
              onClick={() => onSnoozeAction?.(hero)}
              title="Snooze 15 minutes"
            >
              <BellOff size={15} />
              Snooze
            </button>
            <button
              className="btn-hero-secondary"
              onClick={() => (onRejectModal ? onRejectModal(hero) : onDismissAction?.(hero))}
              title="Reject with operational rationale"
            >
              Reject
            </button>
            <button
              className="btn-hero-secondary"
              onClick={() => onSelectService?.(hero)}
              title="Open service details drawer"
            >
              Details
            </button>
          </div>
        </div>
      </div>

      {/* ── RANKED COMPACT ROWS: #2–#10 ──────────────────────── */}
      {rows.length > 0 && (
        <div className="rank-list">
          {rows.map((row) => {
            if (row.type === "group") {
              const { group, anchor } = row;
              const isOpen = expandedGroups.has(group.key);
              const members = group.services;
              return (
                <div key={group.key} className="rank-group">
                  <div
                    className="rank-row"
                    onClick={() => toggleGroup(group.key)}
                    title={`${members.length} services share cause: ${group.driver}`}
                  >
                    <span className="rank-sev critical">
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </span>
                    <span className="rank-name">
                      {members.length} services · same cause
                    </span>
                    <span className="rank-driver">
                      <Activity size={13} /> {group.driver}
                    </span>
                    <span className="rank-spacer" />
                    <span className="rank-risk font-mono tabular-nums">
                      {fmtPercent(Math.max(...members.map((m) => Math.max(Number(m.cpu_probability || 0), Number(m.memory_probability || 0)))))}
                    </span>
                    <button className="btn-rank" onClick={(e) => { e.stopPropagation(); onSelectService?.(anchor); }}>
                      Details
                    </button>
                  </div>
                  {isOpen && (
                    <div className="rank-group-members">
                      {members.map((m) => (
                        <div key={m.id} className="rank-row rank-row-sub" onClick={() => onSelectService?.(m)}>
                          <AlertTriangle size={13} color={m.risk === "CRITICAL" ? "var(--critical)" : "var(--warning)"} />
                          <span className="rank-name">{m.service}</span>
                          <span className="rank-spacer" />
                          <span className="rank-risk font-mono tabular-nums">
                            {fmtPercent(Math.max(Number(m.cpu_probability || 0), Number(m.memory_probability || 0)))}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            }

            const s = row.service;
            const maxProb = Math.max(Number(s.cpu_probability || 0), Number(s.memory_probability || 0));
            const secs = secondsMap[s.id];
            const mttaLabel = s.mtta_minutes != null ? `~${s.mtta_minutes}m early` : "";
            return (
              <div
                key={s.id}
                className="rank-row"
                onClick={() => onSelectService?.(s)}
                title={`Priority ${s.priorityScore} = ${s.priorityExplain.probabilityPct}% risk × blast ${s.priorityExplain.blastWeight} × urgency ${s.priorityExplain.timeFactor} (${s.priorityExplain.urgencyBasis})`}
              >
                <span className={`rank-sev ${s.risk === "CRITICAL" ? "critical" : "warning"}`}>
                  {s.risk === "CRITICAL" ? <Flame size={15} /> : <AlertTriangle size={15} />}
                </span>
                <span className="rank-name" title={s.service}>{s.service}</span>
                <span className="rank-risk font-mono tabular-nums">{fmtPercent(maxProb)}</span>
                {secs != null && (
                  <span
                    className="rank-countdown font-mono tabular-nums"
                    style={{ color: secs <= 60 ? "var(--critical)" : "var(--accent-text)" }}
                    title={`Advance warning lead time countdown: ${pad(secs / 60)}:${pad(secs % 60)} (MTTA: ${mttaLabel})`}
                  >
                    <Clock size={12} color={secs <= 60 ? "var(--critical)" : "var(--accent)"} />
                    {pad(secs / 60)}:{pad(secs % 60)}
                  </span>
                )}
                <div style={{ display: "flex", gap: "6px" }} onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn-rank"
                    onClick={() => handleSolve(s)}
                    title={`Solve before crash: ${s.recommendation.actionTitle}`}
                    style={{ background: "var(--accent)", color: "#fff", border: "none" }}
                  >
                    Solve
                  </button>
                  <button
                    className="btn-rank"
                    onClick={() => handleDismiss(s)}
                    title="Dismiss alert"
                    style={{ padding: "4px 8px" }}
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
