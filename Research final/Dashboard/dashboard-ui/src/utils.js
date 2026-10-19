// Sentinel Enterprise Incident-Decision Console Utilities
// ========================================================

export const STATUS_ENUM = {
  CRITICAL: "CRITICAL",
  WARNING: "WARNING",
  HEALTHY: "HEALTHY",
};

export const STATUS_ORDER = {
  CRITICAL: 0,
  WARNING: 1,
  HEALTHY: 2,
};

export const LIFECYCLE_STEPS = [
  "Detected",
  "Investigating",
  "Recommended",
  "Approved",
  "Executed",
  "Verified",
  "Resolved",
];

// Feature display name dictionary mapping raw telemetry to plain English
export const FEATURE_NAMES = {
  cpu_percent: "CPU Utilization",
  cpu_velocity: "CPU Rate of Change",
  cpu_trend_5min: "CPU 5m Trend",
  cpu_trend_10min: "CPU 10m Trend",
  in_flight_queue: "In-Flight Queue Depth",
  incoming_rate: "Incoming Request Rate",
  processing_rate: "Processing Throughput",
  queue_growth_rate: "Queue Growth Rate",
  queue_pressure_index: "Queue Pressure Index",
  overload_flag: "Overload Condition",
  ram_percent: "RAM Utilization",
  ram_mean: "Average RAM",
  ram_max: "Peak RAM",
  ram_std: "RAM Volatility",
  ram_std_trend: "RAM Variance Slope",
  memory_change_5min: "5m Memory Delta",
  memory_change_10min: "10m Memory Delta",
  heap_mb_used: "Heap Memory Used",
  heap_max: "Heap Limit",
  heap_rate: "Heap Allocation Rate",
  gc_count: "GC Invocations",
  gc_spike_count: "GC Spike Bursts",
  heap_fill_ratio: "Heap Saturation Ratio",
  memory_acceleration: "Memory Acceleration",
  gc_efficiency: "GC Efficiency",
  ram_std_ratio: "RAM Volatility Ratio",
  memory_growth_velocity: "Memory Growth Velocity",
  time_to_oom_slope: "Time-to-OOM Slope",
  gc_pressure_index: "GC Pressure Index",
  ram_leak_momentum: "RAM Leak Momentum",
};

// Plain-English plain explanations for features
export const FEATURE_PLAIN_DESC = {
  cpu_trend_5min: "CPU rising steadily over the last 5 minutes",
  cpu_trend_10min: "Sustained upward CPU slope over 10 minutes",
  cpu_percent: "High current CPU capacity utilization",
  cpu_velocity: "Rapid acceleration in CPU demand",
  in_flight_queue: "Requests accumulating in queue waiting for execution",
  queue_pressure_index: "Buffer pressure building faster than processing rate",
  incoming_rate: "Surge in inbound traffic volume",
  processing_rate: "Throughput drop relative to incoming workload",
  heap_fill_ratio: "Heap memory approaching configured capacity limit",
  memory_change_5min: "Unreclaimed memory accumulating over 5 minutes",
  gc_spike_count: "Frequent GC pause spikes attempting memory recovery",
  gc_pressure_index: "Garbage collection thrashing under memory pressure",
};

// ── Shared Mitigation Tier Model (SINGLE SOURCE OF TRUTH) ────────────
// Every simulator, tier ladder, and recommendation derives from THIS
// model so the numbers always agree. All values are model *estimates*.
export const TIER_MODEL = {
  soft: {
    key: "soft",
    tierName: "Soft",
    plainLabel: "Reduce traffic",
    shedPercent: 25,
    efficiency: 0.2125, // kept in sync with the 25% shedding curve below
    downtime: "No downtime",
    downtimeSec: 0,
    timeToEffect: "~45s",
    approvalNeeded: false,
    sideEffects: "Non-critical traffic limited",
  },
  moderate: {
    key: "moderate",
    tierName: "Moderate",
    plainLabel: "Add capacity",
    shedPercent: 0,
    efficiency: 0.55,
    downtime: "~10s",
    downtimeSec: 10,
    timeToEffect: "~90s",
    approvalNeeded: true,
    sideEffects: "New pods start cold",
  },
  emergency: {
    key: "emergency",
    tierName: "Emergency",
    plainLabel: "Restart service",
    shedPercent: 0,
    efficiency: 0.92,
    downtime: "~3s",
    downtimeSec: 3,
    timeToEffect: "~15s",
    approvalNeeded: true,
    sideEffects: "In-flight requests dropped",
  },
  doNothing: {
    key: "doNothing",
    tierName: "Do nothing",
    plainLabel: "Do nothing",
    shedPercent: 0,
    efficiency: 0,
    downtime: "—",
    downtimeSec: 0,
    timeToEffect: "—",
    approvalNeeded: false,
    sideEffects: "Breach continues",
  },
};

export const ACTION_TO_TIER = {
  TRIGGER_LOAD_SHEDDING: "soft",
  TRIGGER_PROACTIVE_POD_RESTART: "moderate",
  SCALE_OUT: "moderate",
  CRITICAL_RESTART_AND_TRAFFIC_REROUTE: "emergency",
  NO_ACTION: "doNothing",
};

export function tierForAction(action) {
  return ACTION_TO_TIER[action] || "moderate";
}

// Projected residual risk after applying a tier to a base probability (0..1)
export function projectRisk(baseRisk, tierKey) {
  const tier = TIER_MODEL[tierKey] || TIER_MODEL.moderate;
  const base = Number(baseRisk || 0);
  // Shedding-based tiers (soft) follow the SAME curve as the what-if simulator,
  // so the tier ladder and the simulator always report identical numbers.
  const after =
    tier.shedPercent > 0
      ? base * (1 - (tier.shedPercent / 100) * 0.85)
      : base * (1 - tier.efficiency);
  return Math.round(after * 1000) / 1000;
}

// Unified what-if traffic-shedding curve — used by BOTH simulators so their
// numbers always agree. 80% shed ≈ 68% risk reduction.
export function projectRiskFromShed(baseRisk, shedPercent) {
  const p = Math.min(100, Math.max(0, Number(shedPercent) || 0));
  const efficiency = (p / 100) * 0.85;
  const after = Math.max(0, Number(baseRisk || 0) * (1 - efficiency));
  return Math.round(after * 1000) / 1000;
}

// Icon key per driver, resolved to a lucide icon in the UI (never a sentence)
export const DRIVER_ICON = {
  cpu_percent: "cpu",
  cpu_velocity: "gauge",
  cpu_trend_5min: "trendingUp",
  cpu_trend_10min: "trendingUp",
  in_flight_queue: "layers",
  incoming_rate: "arrowDown",
  processing_rate: "activity",
  queue_growth_rate: "trendingUp",
  queue_pressure_index: "gauge",
  overload_flag: "alert",
  ram_percent: "memory",
  ram_mean: "memory",
  ram_max: "memory",
  ram_std: "activity",
  ram_std_trend: "trendingUp",
  memory_change_5min: "trendingUp",
  memory_change_10min: "trendingUp",
  heap_mb_used: "database",
  heap_max: "database",
  heap_rate: "trendingUp",
  gc_count: "zap",
  gc_spike_count: "zap",
  heap_fill_ratio: "database",
  memory_acceleration: "trendingUp",
  gc_efficiency: "gauge",
  ram_std_ratio: "activity",
  memory_growth_velocity: "trendingUp",
  time_to_oom_slope: "trendingUp",
  gc_pressure_index: "gauge",
  ram_leak_momentum: "trendingUp",
};

// Unified Status Derivation: Single Source of Truth.
// Probability-first: a service at or above `critical_threshold` risk on EITHER
// signal is CRITICAL, whatever the other signal is doing. This mirrors
// classify_risk() in Dashboard/server.py so the UI and the backend can never
// disagree about how many incidents are critical.
export function deriveStatus(service, policy) {
  if (!service) return STATUS_ENUM.HEALTHY;
  const cpuThresh = Number(policy?.cpu_threshold ?? 0.60);
  const memThresh = Number(policy?.memory_threshold ?? 0.70);
  const critThresh = Number(policy?.critical_threshold ?? 0.90);

  const cpuProb = Number(service.cpu_probability ?? 0);
  const memProb = Number(service.memory_probability ?? 0);

  if (cpuProb >= critThresh || memProb >= critThresh) return STATUS_ENUM.CRITICAL;

  const cpuAlarm = cpuProb >= cpuThresh || Boolean(service.cpu_alarm);
  const memAlarm = memProb >= memThresh || Boolean(service.memory_alarm);
  if (cpuAlarm || memAlarm) return STATUS_ENUM.WARNING;
  return STATUS_ENUM.HEALTHY;
}

// Max risk probability for a service (the number severity is derived from).
export function riskProbability(service) {
  return Math.max(
    Number(service?.cpu_probability || 0),
    Number(service?.memory_probability || 0)
  );
}

// A service's real breach estimate object, or null when the backend has not
// accumulated enough genuine history to defend one. Never invents an ETA.
export function getBreachEstimate(service) {
  const est = service?.breach_estimate;
  if (est && Number.isFinite(Number(est.minutes)) && Number(est.minutes) > 0) {
    return { ...est, minutes: Number(est.minutes) };
  }
  const mins = Number(service?.historical_warning_minutes);
  if (Number.isFinite(mins) && mins > 0) {
    return { minutes: mins, method: "recorded", estimated: true };
  }
  return null;
}

// Fleet summary — the ONE place counts are computed (topbar, KPIs, heatmap all use this)
export function computeSummary(services, policy) {
  const list = Array.isArray(services) ? services : [];
  let critical = 0;
  let warning = 0;
  let healthy = 0;
  let needsAttention = 0;
  let activeMitigations = 0;
  let breachSum = 0;
  let breachN = 0;
  let riskDeltaSum = 0;
  let riskDeltaN = 0;
  let mttaSum = 0;
  let mttaN = 0;
  let anticipatedRateSum = 0;
  let anticipatedRateN = 0;
  // Event-weighted accumulators (genuine per-service rows only):
  //   ewLeadSecSum = Σ (mean_mtta_seconds × anticipated_events)
  //   ewAntSum     = Σ anticipated_events   (weight numerator / lead denominator)
  //   ewTotSum     = Σ total_events         (anticipation-rate denominator)
  let ewLeadSecSum = 0;
  let ewAntSum = 0;
  let ewTotSum = 0;

  list.forEach((s) => {
    const risk = STATUS_ENUM[s.risk] ? s.risk : deriveStatus(s, policy);
    if (risk === STATUS_ENUM.CRITICAL) critical += 1;
    else if (risk === STATUS_ENUM.WARNING) warning += 1;
    else healthy += 1;
    if (risk !== STATUS_ENUM.HEALTHY) needsAttention += 1;

    if ((s.mitigation_state?.status || "").toUpperCase().includes("ACTIVE")) {
      activeMitigations += 1;
    }

    const est = getBreachEstimate(s);
    if (est) {
      breachSum += est.minutes;
      breachN += 1;
    }

    // Fleet MTTA is aggregated EVENT-WEIGHTED, not mean-of-means: each service
    // contributes proportional to the number of failure events it had anticipated,
    // so a service with 20 caught failures is not outvoted by one with 2. Only
    // genuine per-service measurements (mtta_scope === "service") carry event
    // counts and are weighted; the model-wide fallback row (scope === "model")
    // is excluded so it cannot double-count the fleet average as a single data point.
    if (s.mtta_scope === "service") {
      const secs = Number(s.mtta_seconds);
      const antEv = Number(s.mtta_anticipated_events);
      const totEv = Number(s.mtta_total_events);
      if (Number.isFinite(secs) && secs > 0 && Number.isFinite(antEv) && antEv > 0) {
        ewLeadSecSum += secs * antEv;
        ewAntSum += antEv;
        if (Number.isFinite(totEv) && totEv > 0) ewTotSum += totEv;
      }
    }
    // Mean-of-means FALLBACK (used only when event counts are not present, e.g.
    // older payloads). Still excludes the model-wide fallback row so it is never
    // double-counted; the event-weighted result below takes priority when available.
    if (s.mtta_scope !== "model") {
      const mtta = Number(s.mtta_minutes);
      if (Number.isFinite(mtta) && mtta > 0) {
        mttaSum += mtta;
        mttaN += 1;
      }
      const anticipatedRate = Number(s.anticipated_rate);
      if (Number.isFinite(anticipatedRate) && anticipatedRate >= 0) {
        anticipatedRateSum += anticipatedRate;
        anticipatedRateN += 1;
      }
    }

    // Real recent risk change: last real sample vs current max probability.
    const hist = Array.isArray(s.history) ? s.history : [];
    const lastHist = hist.length >= 2 ? hist[hist.length - 2] : null;
    if (lastHist && Number.isFinite(Number(lastHist.probability))) {
      riskDeltaSum += riskProbability(s) - Number(lastHist.probability);
      riskDeltaN += 1;
    }
  });

  return {
    services: list.length,
    critical,
    warning,
    healthy,
    at_risk: critical + warning,
    needs_attention: needsAttention,
    active_mitigations: activeMitigations,
    avg_time_to_breach_min: breachN ? Math.round(breachSum / breachN) : null,
    breach_coverage: breachN,
    mean_mtta_minutes: ewAntSum
      ? Math.round((ewLeadSecSum / ewAntSum / 60) * 10) / 10
      : (mttaN ? Math.round((mttaSum / mttaN) * 10) / 10 : null),
    anticipation_rate_pct: ewAntSum && ewTotSum
      ? Math.round((ewAntSum / ewTotSum) * 1000) / 10
      : (anticipatedRateN ? Math.round((anticipatedRateSum / anticipatedRateN) * 10) / 10 : null),
    mtta_label: ewAntSum
      ? `~${(Math.round((ewLeadSecSum / ewAntSum / 60) * 10) / 10).toFixed(1)}m`
      : (mttaN ? `~${(Math.round((mttaSum / mttaN) * 10) / 10).toFixed(1)}m` : null),
    risk_delta_pct: riskDeltaN ? Math.round((riskDeltaSum / riskDeltaN) * 1000) / 10 : null,
    status:
      critical > 0
        ? STATUS_ENUM.CRITICAL
        : warning > 0
        ? STATUS_ENUM.WARNING
        : STATUS_ENUM.HEALTHY,
  };
}

// Blast radius estimate — derived from real project fan-out. No fabricated
// absolute user counts. Flagged `estimated` so the UI can label it honestly.
export function getBlastRadius(service, allServices) {
  const project = service?.project;
  const peers =
    Array.isArray(allServices) && project
      ? allServices.filter((s) => s.project === project).length
      : 1;
  const peerCount = Math.max(1, peers);
  const weight = Math.min(3, Math.round((1 + (peerCount - 1) * 0.4) * 10) / 10);
  const tier = weight >= 2.4 ? "Tier 1" : weight >= 1.6 ? "Tier 2" : "Tier 3";
  const label = weight >= 2.4 ? "High" : weight >= 1.6 ? "Medium" : "Standard";
  return { tier, label, weight, peerCount, estimated: true };
}

// Priority Score: Probability × Blast Radius Weight × Time Urgency
// Urgency comes from a REAL breach estimate only. When no estimate exists the
// factor is neutral (1.0) and flagged, rather than inventing a lead time.
export function urgencyFactor(service) {
  const est = getBreachEstimate(service);
  if (est) {
    return {
      timeFactor: Math.min(10, Math.max(0.5, 60 / Math.max(1, est.minutes))),
      minutes: est.minutes,
      basis: "measured",
    };
  }
  if (service?.risk === STATUS_ENUM.CRITICAL) {
    return { timeFactor: 10, minutes: null, basis: "already breaching" };
  }
  return { timeFactor: 1, minutes: null, basis: "no estimate" };
}

export function computePriorityScore(service, allServices) {
  const prob = riskProbability(service);
  const blast = getBlastRadius(service, allServices);
  const { timeFactor } = urgencyFactor(service);
  const rawScore = prob * blast.weight * timeFactor * 10;
  return Math.round(rawScore * 10) / 10;
}

// Explain the priority score — powers the hover tooltip on ranked rows
export function explainPriority(service, allServices) {
  const prob = riskProbability(service);
  const blast = getBlastRadius(service, allServices);
  const urgency = urgencyFactor(service);
  return {
    score: computePriorityScore(service, allServices),
    formula: "risk × blast radius × urgency",
    probabilityPct: Math.round(prob * 100),
    blastWeight: blast.weight,
    blastLabel: blast.label,
    minutes: urgency.minutes,
    timeFactor: Math.round(urgency.timeFactor * 10) / 10,
    urgencyBasis: urgency.basis,
  };
}

// Plain-English action mapping. Descriptions are deliberately generic: the
// prediction models expose no outcome telemetry, so no durations are invented.
const ACTION_META = {
  CRITICAL_RESTART_AND_TRAFFIC_REROUTE: {
    shortLabel: "Restart service",
    category: "Emergency mitigation",
    why: "CPU and memory headroom are both exhausted.",
  },
  TRIGGER_LOAD_SHEDDING: {
    shortLabel: "Reduce traffic",
    category: "Queue mitigation",
    why: "Incoming traffic exceeds processing capacity.",
  },
  TRIGGER_PROACTIVE_POD_RESTART: {
    shortLabel: "Restart service",
    category: "Memory mitigation",
    why: "Progressive memory growth on the heap.",
  },
  SCALE_OUT: {
    shortLabel: "Add capacity",
    category: "Capacity scaling",
    why: "Sustained demand exceeds provisioned capacity.",
  },
  NO_ACTION: {
    shortLabel: "No action needed",
    category: "Nominal",
    why: "All signals are within thresholds.",
  },
};

// Recommendation Engine — risk drop and side effects come from the SHARED tier
// model so the recommendation, the tier ladder, and the simulator always agree.
export function getRecommendation(service) {
  const action = service?.action || "NO_ACTION";
  const maxProb = riskProbability(service);

  const tierKey = tierForAction(action);
  const tier = TIER_MODEL[tierKey];
  const riskAfter = projectRisk(maxProb, tierKey);
  const expectedReduction =
    action === "NO_ACTION" || maxProb <= 0
      ? "Stable"
      : `${Math.round(maxProb * 100)}% → ${Math.round(riskAfter * 100)}%`;

  const meta = ACTION_META[action] || {
    shortLabel: action.replaceAll("_", " ").toLowerCase(),
    category: "Mitigation",
    why: "Signals indicate anomalous behaviour.",
  };

  // Alternatives are the other tiers, priced by the SAME model — nothing hardcoded.
  const alternatives = ["soft", "moderate", "emergency"]
    .filter((k) => k !== tierKey)
    .map((k) => {
      const t = TIER_MODEL[k];
      const after = projectRisk(maxProb, k);
      return {
        tierKey: k,
        name: t.plainLabel,
        afterPct: Math.round(after * 100),
        dropPct: Math.round((maxProb - after) * 100),
      };
    });

  return {
    actionTitle: meta.shortLabel,
    shortLabel: meta.shortLabel,
    category: meta.category,
    why: meta.why,
    tier: tierKey,
    tierName: tier.tierName,
    plainLabel: tier.plainLabel,
    riskPct: Math.round(maxProb * 100),
    expectedReduction,
    expectedRiskAfter: riskAfter,
    downtime: tier.downtime,
    downtimeSec: tier.downtimeSec,
    timeToEffect: tier.timeToEffect,
    approvalNeeded: tier.approvalNeeded,
    sideEffects: tier.sideEffects,
    alternatives,
    // The prediction models do not emit a confidence score — surfaced as null
    // rather than a plausible-looking invented number.
    confidence: null,
    confidencePct: null,
    confidenceLabel: null,
    confidenceNote: "Not provided by the prediction model",
    estimated: true,
  };
}

// Side-by-side tier options for the drawer: Soft / Moderate / Emergency / Do nothing
export function getTierOptions(service) {
  const maxProb = riskProbability(service);
  const recommendedKey = tierForAction(service?.action);
  return ["soft", "moderate", "emergency", "doNothing"].map((key) => {
    const tier = TIER_MODEL[key];
    const after = projectRisk(maxProb, key);
    return {
      ...tier,
      beforePct: Math.round(maxProb * 100),
      afterPct: Math.round(after * 100),
      dropPct: Math.round((maxProb - after) * 100),
      recommended: key === recommendedKey,
      danger: key === "doNothing",
    };
  });
}

// Generate ONE-line plain English summary (<= 120 chars)
export function getOneLineReason(service) {
  const topContrib = getTopContributors(service, 1)[0];
  const name = service.service;
  const cpuProb = Number(service.cpu_probability || 0);
  const memProb = Number(service.memory_probability || 0);

  if (cpuProb >= 0.5 && memProb >= 0.5) {
    return "Compound failure: CPU and memory heap both exhausting simultaneously.";
  }
  if (topContrib) {
    const plain = FEATURE_PLAIN_DESC[topContrib.name] || `${topContrib.label} elevated`;
    return `${plain} (${topContrib.pct}% attribution).`;
  }
  if (service.mup_reason && service.mup_reason !== "N/A") {
    return service.mup_reason.split(",")[0].trim();
  }
  return `Telemetry elevated: ${Math.round(Math.max(cpuProb, memProb) * 100)}% risk trajectory.`;
}

// Extract top non-zero Shapley/feature contributions.
// Returns [] when the driver breakdown is a placeholder equal-split (the CPU
// predictor emits all-10.0 when it has no real explanation) — showing that as a
// measured root cause would be a fabrication.
export function getTopContributors(service, limit = 5) {
  if (service?.drivers_are_placeholder) return [];
  const rawContribs = service.feature_contributions || {};
  const phis = service.shapley_phi_values || {};
  const ranked = Object.entries(rawContribs)
    .map(([key, val]) => {
      const numVal = Number(val || 0);
      return {
        name: key,
        label: FEATURE_NAMES[key] || key.replaceAll("_", " "),
        plainDesc: FEATURE_PLAIN_DESC[key] || "Observed signal contribution",
        pct: Math.round(numVal * 10) / 10,
        phi: phis[key] !== undefined ? Number(phis[key]).toFixed(4) : null,
      };
    })
    .filter(item => item.pct > 0.05)
    .sort((a, b) => b.pct - a.pct);

  // A breakdown with only one distinct value carries no ranking information.
  // Checked on the FULL list (not the truncated one) so limit=1 still works.
  if (new Set(ranked.map((e) => e.pct)).size <= 1) return [];
  return ranked.slice(0, limit);
}

// Breach clock time at HH:MM — ONLY when a real estimate exists, else null.
export function getPredictedBreachTime(service) {
  const est = getBreachEstimate(service);
  if (!est) return null;
  const breach = new Date(Date.now() + est.minutes * 60000);
  return breach.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

// Build SVG sparkline path
export function buildSparkline(values, width = 120, height = 32, padding = 3) {
  const clean = (values || []).map(v => Number(v)).filter(v => Number.isFinite(v));
  if (clean.length < 2) return { line: "", area: "", min: 0, max: 0, lastPt: null };

  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const stepX = (width - padding * 2) / (clean.length - 1);

  const pts = clean.map((v, i) => {
    const x = padding + i * stepX;
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return [x, y];
  });

  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const lastPt = pts[pts.length - 1];
  const area = `${line} L ${lastPt[0].toFixed(1)},${height - padding} L ${pts[0][0].toFixed(1)},${height - padding} Z`;

  return { line, area, min, max, lastPt, pts };
}

// Relative time formatting ("2s ago", "5m ago")
export function timeAgo(timestamp) {
  if (!timestamp) return "just now";
  const diff = (Date.now() - new Date(timestamp).getTime()) / 1000;
  if (diff < 3) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

// Format percent with 1 decimal or integer
export function fmtPercent(val, decimals = 0) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return `${(Number(val) * 100).toFixed(decimals)}%`;
}

// Format raw number with comma
export function fmtNumber(val, decimals = 1) {
  if (val === null || val === undefined || isNaN(val)) return "—";
  return Number(val).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

// Clean Command string from raw runbook
export function parseRunbookStep(stepStr) {
  if (!stepStr) return { title: "Step", command: "", dryRun: true };
  const parts = stepStr.split("->");
  if (parts.length >= 2) {
    return {
      title: parts[0].trim(),
      command: parts.slice(1).join("->").trim(),
      dryRun: true,
    };
  }
  return {
    title: stepStr.slice(0, 40),
    command: stepStr,
    dryRun: true,
  };
}

// Group correlated incidents across the fleet.
// A group is only formed when services share a project AND the SAME real top
// driver. Services whose driver breakdown is a placeholder are never grouped,
// so we never invent a relationship the telemetry does not support.
export function getCorrelatedIncidents(services) {
  const atRisk = (services || []).filter((s) => s.risk && s.risk !== STATUS_ENUM.HEALTHY);
  const groups = {};

  atRisk.forEach((s) => {
    const top = getTopContributors(s, 1)[0];
    if (!top) return;
    const key = `${s.project} :: ${top.name}`;
    if (!groups[key]) {
      groups[key] = {
        key,
        project: s.project,
        driverKey: top.name,
        driver: FEATURE_NAMES[top.name] || top.name,
        services: [],
      };
    }
    groups[key].services.push(s);
  });

  return Object.values(groups).filter(g => g.services.length >= 2);
}

// Driver chips for the hero card — icon key + short label + attribution %
export function getDriverChips(service, limit = 3) {
  return getTopContributors(service, limit).map((c) => ({
    name: c.name,
    label: c.label,
    pct: c.pct,
    icon: DRIVER_ICON[c.name] || "activity",
  }));
}

// Time to act (MTTA) — real value ONLY when the backend provides one, else null (hidden)
export function getTimeToAct(service) {
  if (!service) return null;
  const mins = Number(service.mtta_minutes);
  if (Number.isFinite(mins) && mins > 0) return Math.round(mins);
  const secs = Number(service.mtta_seconds);
  if (Number.isFinite(secs) && secs > 0) return Math.round(secs / 60);
  return null;
}

// Early alarm prediction lead time & MTTA breakdown helper
export function getEarlyAlarmLeadTime(service) {
  if (!service) return null;
  const mins = Number(service.mtta_minutes);
  if (Number.isFinite(mins) && mins > 0) {
    const ratePct = service.anticipated_rate;
    const seconds = Number(service.mtta_seconds);
    return {
      minutes: mins,
      formatted: `~${mins.toFixed(1)}m early`,
      ratePct: ratePct != null ? ratePct : null,
      h3Passed: Number.isFinite(seconds) && seconds >= 30,
      source: "empirical_mtta",
    };
  }
  return null;
}

// Fleet pulse — per-sample count of services crossing each threshold, built
// from the REAL recorded samples only (last ~60s window).
export function getFleetPulse(services, policy) {
  const list = (services || []).filter(
    (s) => Array.isArray(s.history) && s.history.length >= 2
  );
  if (list.length === 0) return [];
  const window = 30; // ~60s at one real sample every 2s
  const len = Math.min(window, Math.min(...list.map((s) => s.history.length)));
  if (len < 2) return [];
  const cpuThresh = Number(policy?.cpu_threshold ?? 0.60) * 100;
  const memThresh = Number(policy?.memory_threshold ?? 0.70) * 100;
  const out = [];
  for (let i = 0; i < len; i += 1) {
    let cpuCount = 0;
    let memCount = 0;
    list.forEach((s) => {
      const h = s.history[s.history.length - len + i] || {};
      if (Number(h.cpu) >= cpuThresh) cpuCount += 1;
      if (Number(h.mem) >= memThresh) memCount += 1;
    });
    out.push({ index: i, cpuCount, memCount });
  }
  return out;
}

// Fetch dashboard API
export async function fetchDashboard() {
  const res = await fetch("/api/dashboard", { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
  return res.json();
}

// Backward-compatibility aliases for other tabs
export const fmtPct = fmtPercent;
export const fmtNum = fmtNumber;
export const RISK_ORDER = { CRITICAL: 0, WARNING: 1, HEALTHY: 2, UNKNOWN: 3 };
export const pillClass = (risk) => (risk === "CRITICAL" ? "critical" : risk === "WARNING" ? "warning" : "healthy");
// Save policy thresholds (critical_threshold drives probability-first severity)
export async function savePolicy(cpuThreshold, memoryThreshold, criticalThreshold) {
  const body = {
    cpu_threshold: cpuThreshold,
    memory_threshold: memoryThreshold,
  };
  if (criticalThreshold !== undefined && criticalThreshold !== null) {
    body.critical_threshold = criticalThreshold;
  }
  const res = await fetch("/api/policy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Failed to save policy: ${res.status}`);
  return res.json();
}

// ── Decision-support API clients ──────────────────────────────────────
// These hit the real gateway; they never simulate a result client-side.

async function _json(res) {
  let body = {};
  try {
    body = await res.json();
  } catch {
    body = {};
  }
  if (!res.ok) {
    const err = new Error(body.error || `HTTP ${res.status}`);
    err.body = body;
    throw err;
  }
  return body;
}

// Record a human decision (approve / reject / snooze) in the durable audit log.
// The gateway returns executed:false — no execution API exists in this build.
export async function postApproval({ service, decision, reason = "", minutes, actor = "operator", action, risk }) {
  const res = await fetch("/api/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service, decision, reason, minutes, actor, action, risk }),
  });
  return _json(res);
}

export async function fetchEvents(limit = 60) {
  const res = await fetch(`/api/events?limit=${limit}`, { cache: "no-store" });
  return _json(res);
}

export async function fetchAudit(limit = 200) {
  const res = await fetch(`/api/audit?limit=${limit}`, { cache: "no-store" });
  return _json(res);
}
// advisor-marker

export async function fetchMutes() {
  const res = await fetch("/api/mutes", { cache: "no-store" });
  return _json(res);
}

export async function createMute({ service, minutes = 15, reason = "", actor = "operator" }) {
  const res = await fetch("/api/mutes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service, minutes, reason, actor }),
  });
  return _json(res);
}

export async function clearMute({ service, muteId } = {}) {
  const res = await fetch("/api/mutes", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ service, mute_id: muteId }),
  });
  return _json(res);
}

// ── Explainability & Mitigation (Phase 1) — pure helpers ────────────────────
// Single source of truth for "never display placeholders as data": every value
// renderer in the Explain view goes through these, so missing data renders as
// "unavailable" and never as 0/0.0%.
export const UNAVAILABLE = "unavailable";

export function fmtOrUnavailable(value, formatter = (v) => String(v)) {
  if (value === null || value === undefined || value === "") return UNAVAILABLE;
  if (typeof value === "number" && isNaN(value)) return UNAVAILABLE;
  try {
    return formatter(value);
  } catch {
    return UNAVAILABLE;
  }
}

// A contribution map with fewer than two distinct values carries no
// information (the predictor's equal-split placeholder, e.g. 10.0 for all ten
// features) — must never be charted as an attribution.
export function isPlaceholderContributions(contributions) {
  if (!contributions || typeof contributions !== "object") return true;
  const vals = Object.values(contributions);
  if (vals.length < 2) return true;
  const distinct = new Set(vals.map((v) => Math.round(Number(v) * 1000) / 1000));
  return distinct.size <= 1;
}

// Per-response method badge. Only exact TreeExplainer output may be called
// TreeSHAP; the importance-weighted deviation path is labeled as approximate.
export function attributionBadge(method) {
  if (method === "treeshap") {
    return {
      label: "TreeSHAP",
      detail: "Exact additive Shapley attribution (shap.TreeExplainer).",
      exact: true,
    };
  }
  return {
    label: "Approximate attribution",
    detail: "Approximate attribution: importance-weighted deviation. Not exact TreeSHAP.",
    exact: false,
  };
}

// 180 s cooldown countdown derived from the backend's remaining seconds.
export function cooldownDisplay(remainingSec, totalSec = 180) {
  const total = Number(totalSec) > 0 ? Number(totalSec) : 180;
  const raw = Number(remainingSec);
  const remaining = isNaN(raw) || raw < 0 ? 0 : Math.min(raw, total);
  const m = Math.floor(remaining / 60);
  const s = Math.floor(remaining % 60);
  return {
    active: remaining > 0,
    remainingSec: remaining,
    totalSec: total,
    text: `${m}:${String(s).padStart(2, "0")}`,
    pct: remaining / total,
  };
}

// Circuit-breaker is displayed exactly as the backend normalizes it; this map
// only supplies badge styling/meaning, never invents a state.
export function circuitBreakerInfo(state) {
  switch ((state || "").toUpperCase()) {
    case "CLOSED":
      return { label: "CLOSED", meaning: "Cooldown protecting the pod — escalations suppressed", tone: "warn" };
    case "ACTIVE":
      return { label: "ACTIVE", meaning: "Mitigation active and verified", tone: "danger" };
    case "STANDBY":
      return { label: "STANDBY", meaning: "No mitigation engaged", tone: "ok" };
    default:
      return { label: UNAVAILABLE, meaning: "No mitigation state reported by the engine", tone: "muted" };
  }
}

// Tier ladder rows: mark the active tier from the real mitigation state.
export function tierLadderRows(tiers, activeTier) {
  const list = Array.isArray(tiers) && tiers.length ? tiers : [];
  return list.map((t) => ({ ...t, active: Number(t.tier) === Number(activeTier) }));
}
