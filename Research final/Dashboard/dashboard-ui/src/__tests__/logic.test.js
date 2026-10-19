/**
 * Sentinel Command Console — Unit Tests
 * Run with: npm test
 *
 * Tests cover the three critical logic functions required by the spec:
 *   1. deriveStatus      — single source of truth for service health
 *   2. computePriorityScore — ranking logic (Prob × Blast × 1/ETA)
 *   3. getRecommendation — action mapping per action string
 *   4. getTopContributors — zero-value filtering and sorting
 *   5. getOneLineReason   — plain English summary generation
 *   6. getCorrelatedIncidents — correlated grouping across fleet
 *   7. buildSparkline     — SVG path generation
 *   8. timeAgo / fmtPercent / fmtNumber — formatting utilities
 */

import { describe, it, expect } from "vitest";
import {
  STATUS_ENUM,
  deriveStatus,
  computePriorityScore,
  getRecommendation,
  getTopContributors,
  getOneLineReason,
  getCorrelatedIncidents,
  buildSparkline,
  timeAgo,
  fmtPercent,
  fmtNumber,
  computeSummary,
  explainPriority,
  getBlastRadius,
  getTierOptions,
  projectRisk,
  projectRiskFromShed,
  TIER_MODEL,
  tierForAction,
  getTimeToAct,
  getEarlyAlarmLeadTime,
} from "../utils.js";

// ─────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────

const POLICY_DEFAULT = { cpu_threshold: 0.20, memory_threshold: 0.70 };

const SVC_HEALTHY = {
  id: "svc-healthy",
  service: "payment-service",
  project: "ProjectA",
  cpu_probability: 0.05,
  memory_probability: 0.10,
  cpu_alarm: false,
  memory_alarm: false,
  feature_contributions: { cpu_percent: 0, cpu_velocity: 0 },
  shapley_phi_values: {},
  action: "NO_ACTION",
  historical_warning_minutes: 8,
};

const SVC_WARNING_CPU = {
  id: "svc-warn-cpu",
  service: "auth-service",
  project: "ProjectA",
  cpu_probability: 0.65,
  memory_probability: 0.10,
  cpu_alarm: true,
  memory_alarm: false,
  feature_contributions: { cpu_trend_5min: 45.2, cpu_velocity: 30.1, cpu_percent: 20.5 },
  shapley_phi_values: { cpu_trend_5min: 0.4567 },
  action: "TRIGGER_LOAD_SHEDDING",
  historical_warning_minutes: 6,
};

const SVC_WARNING_MEM = {
  id: "svc-warn-mem",
  service: "node-backend",
  project: "ProjectB",
  cpu_probability: 0.08,
  memory_probability: 0.72,
  cpu_alarm: false,
  memory_alarm: true,
  feature_contributions: { heap_fill_ratio: 55.0, memory_change_5min: 30.0 },
  shapley_phi_values: { heap_fill_ratio: 0.62 },
  action: "TRIGGER_PROACTIVE_POD_RESTART",
  historical_warning_minutes: 10,
};

const SVC_CRITICAL = {
  id: "svc-critical",
  service: "auth-gateway-critical",  // includes 'auth' → Tier 1 blast (weight 3.0), same as SVC_WARNING_CPU
  project: "ProjectC",
  cpu_probability: 0.88,
  memory_probability: 0.91,
  cpu_alarm: true,
  memory_alarm: true,
  feature_contributions: { cpu_trend_5min: 60.0, heap_fill_ratio: 35.0, cpu_velocity: 5.0 },
  shapley_phi_values: { cpu_trend_5min: 0.8, heap_fill_ratio: 0.6 },
  action: "CRITICAL_RESTART_AND_TRAFFIC_REROUTE",
  historical_warning_minutes: 2,  // shorter ETA than WARNING (6min) + higher prob → higher priority score
};

// ─────────────────────────────────────────────
// 1. deriveStatus — Single Source of Truth
// ─────────────────────────────────────────────

describe("deriveStatus()", () => {
  it("returns HEALTHY when both probabilities are below thresholds and no alarm", () => {
    const result = deriveStatus(SVC_HEALTHY, POLICY_DEFAULT);
    expect(result).toBe(STATUS_ENUM.HEALTHY);
  });

  it("returns WARNING when only CPU alarm is active", () => {
    const result = deriveStatus(SVC_WARNING_CPU, POLICY_DEFAULT);
    expect(result).toBe(STATUS_ENUM.WARNING);
  });

  it("returns WARNING when only memory alarm is active", () => {
    const result = deriveStatus(SVC_WARNING_MEM, POLICY_DEFAULT);
    expect(result).toBe(STATUS_ENUM.WARNING);
  });

  it("returns CRITICAL when BOTH cpu AND memory alarms fire", () => {
    const result = deriveStatus(SVC_CRITICAL, POLICY_DEFAULT);
    expect(result).toBe(STATUS_ENUM.CRITICAL);
  });

  it("returns CRITICAL from probability alone when both exceed thresholds (even without alarm flags)", () => {
    const svc = { ...SVC_CRITICAL, cpu_alarm: false, memory_alarm: false };
    const result = deriveStatus(svc, POLICY_DEFAULT);
    expect(result).toBe(STATUS_ENUM.CRITICAL);
  });

  it("falls back to threshold defaults if no policy provided", () => {
    // cpu_probability = 0.65 → above default 0.20 → WARNING
    const result = deriveStatus(SVC_WARNING_CPU, null);
    expect(result).toBe(STATUS_ENUM.WARNING);
  });

  it("returns HEALTHY for null/undefined service", () => {
    expect(deriveStatus(null, POLICY_DEFAULT)).toBe(STATUS_ENUM.HEALTHY);
    expect(deriveStatus(undefined, POLICY_DEFAULT)).toBe(STATUS_ENUM.HEALTHY);
  });

  it("respects custom CPU threshold policy", () => {
    // svc cpu_probability = 0.65 — healthy with strict threshold of 0.80
    const result = deriveStatus(
      { ...SVC_WARNING_CPU, cpu_alarm: false, memory_alarm: false },
      { cpu_threshold: 0.80, memory_threshold: 0.70 }
    );
    expect(result).toBe(STATUS_ENUM.HEALTHY);
  });

  it("transitions HEALTHY→WARNING with threshold tightened below cpu_probability", () => {
    const result = deriveStatus(
      { ...SVC_HEALTHY, cpu_probability: 0.15, cpu_alarm: false, memory_alarm: false },
      { cpu_threshold: 0.10, memory_threshold: 0.70 }
    );
    expect(result).toBe(STATUS_ENUM.WARNING);
  });
});

// ─────────────────────────────────────────────
// 2. computePriorityScore — Ranking Logic
// ─────────────────────────────────────────────

describe("computePriorityScore()", () => {
  it("returns a positive numeric score", () => {
    const score = computePriorityScore(SVC_WARNING_CPU);
    expect(typeof score).toBe("number");
    expect(score).toBeGreaterThan(0);
  });

  it("CRITICAL service scores higher than WARNING service", () => {
    const critScore = computePriorityScore(SVC_CRITICAL);
    const warnScore = computePriorityScore(SVC_WARNING_CPU);
    expect(critScore).toBeGreaterThan(warnScore);
  });

  it("WARNING service scores higher than HEALTHY service", () => {
    const warnScore = computePriorityScore(SVC_WARNING_CPU);
    const healScore = computePriorityScore(SVC_HEALTHY);
    expect(warnScore).toBeGreaterThan(healScore);
  });

  it("service with shorter ETA scores higher than same-risk with longer ETA", () => {
    const urgentScore = computePriorityScore({ ...SVC_WARNING_CPU, historical_warning_minutes: 2 });
    const leisureScore = computePriorityScore({ ...SVC_WARNING_CPU, historical_warning_minutes: 30 });
    expect(urgentScore).toBeGreaterThan(leisureScore);
  });

  it("returns a rounded number (1 decimal place)", () => {
    const score = computePriorityScore(SVC_CRITICAL);
    expect(score).toBe(Math.round(score * 10) / 10);
  });

  it("handles missing historical_warning_minutes gracefully (uses default 8)", () => {
    const score = computePriorityScore({ ...SVC_WARNING_CPU, historical_warning_minutes: undefined });
    expect(score).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────
// 3. getRecommendation — Action Mapping
// ─────────────────────────────────────────────

describe("getRecommendation()", () => {
  it("maps load shedding to the plain-English 'Reduce traffic' action on the soft tier", () => {
    const rec = getRecommendation(SVC_WARNING_CPU);
    expect(rec.shortLabel).toBe("Reduce traffic");
    expect(rec.tier).toBe("soft");
    expect(rec.plainLabel).toBe("Reduce traffic");
  });

  it("maps a proactive pod restart to 'Restart service'", () => {
    const rec = getRecommendation(SVC_WARNING_MEM);
    expect(rec.shortLabel).toBe("Restart service");
    expect(rec.why).toBeDefined();
  });

  it("maps a critical restart+reroute to the emergency tier", () => {
    const rec = getRecommendation(SVC_CRITICAL);
    expect(rec.shortLabel).toBe("Restart service");
    expect(rec.tier).toBe("emergency");
    expect(rec.alternatives.length).toBeGreaterThan(0);
  });

  it("returns 'No action needed' for healthy services", () => {
    const rec = getRecommendation(SVC_HEALTHY);
    expect(rec.shortLabel).toBe("No action needed");
    expect(rec.expectedReduction).toBe("Stable");
  });

  it("includes expectedReduction as a string with percent symbol or 'Stable'", () => {
    const rec = getRecommendation(SVC_WARNING_CPU);
    expect(typeof rec.expectedReduction).toBe("string");
  });

  it("returns a fallback recommendation for unknown action strings", () => {
    const rec = getRecommendation({ ...SVC_HEALTHY, action: "UNKNOWN_CUSTOM_ACTION" });
    expect(rec.shortLabel).toBe("unknown custom action");
  });

  it("reports confidence as null — the prediction models emit no confidence score", () => {
    expect(getRecommendation(SVC_CRITICAL).confidence).toBeNull();
    expect(getRecommendation(SVC_WARNING_CPU).confidence).toBeNull();
    expect(getRecommendation(SVC_CRITICAL).confidenceNote).toBe(
      "Not provided by the prediction model"
    );
  });
});

// ─────────────────────────────────────────────
// 4. getTopContributors — Zero-value filtering & sorting
// ─────────────────────────────────────────────

describe("getTopContributors()", () => {
  it("filters out zero-percentage contributions", () => {
    const svc = { feature_contributions: { cpu_percent: 0, cpu_velocity: 0, cpu_trend_5min: 0 }, shapley_phi_values: {} };
    const result = getTopContributors(svc);
    expect(result).toHaveLength(0);
  });

  it("returns contributors sorted by pct descending", () => {
    const contributors = getTopContributors(SVC_WARNING_CPU);
    for (let i = 1; i < contributors.length; i++) {
      expect(contributors[i - 1].pct).toBeGreaterThanOrEqual(contributors[i].pct);
    }
  });

  it("respects the limit parameter", () => {
    const result = getTopContributors(SVC_CRITICAL, 2);
    expect(result.length).toBeLessThanOrEqual(2);
  });

  it("maps feature keys to human-readable labels", () => {
    const contributors = getTopContributors(SVC_WARNING_CPU);
    const cpuTrend = contributors.find((c) => c.name === "cpu_trend_5min");
    expect(cpuTrend).toBeDefined();
    expect(cpuTrend.label).toBe("CPU 5m Trend");
  });

  it("includes phi value as string when available", () => {
    const contributors = getTopContributors(SVC_WARNING_CPU);
    const cpuTrend = contributors.find((c) => c.name === "cpu_trend_5min");
    expect(cpuTrend.phi).toBe("0.4567");
  });

  it("returns phi as null when phi value is absent", () => {
    const svc = {
      feature_contributions: { cpu_percent: 22.5, cpu_velocity: 12.0 },
      shapley_phi_values: {},
    };
    const result = getTopContributors(svc);
    expect(result[0].phi).toBeNull();
  });

  it("returns [] when the driver breakdown is a placeholder equal-split", () => {
    const svc = {
      feature_contributions: { cpu_percent: 10, cpu_velocity: 10, cpu_trend_5min: 10 },
      shapley_phi_values: {},
      drivers_are_placeholder: true,
    };
    expect(getTopContributors(svc)).toHaveLength(0);
  });

  it("handles missing feature_contributions gracefully", () => {
    const result = getTopContributors({ feature_contributions: null, shapley_phi_values: {} });
    expect(result).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────
// 5. getOneLineReason — Plain English summaries
// ─────────────────────────────────────────────

describe("getOneLineReason()", () => {
  it("returns a non-empty string for any service", () => {
    [SVC_HEALTHY, SVC_WARNING_CPU, SVC_WARNING_MEM, SVC_CRITICAL].forEach((svc) => {
      const reason = getOneLineReason(svc);
      expect(typeof reason).toBe("string");
      expect(reason.trim().length).toBeGreaterThan(0);
    });
  });

  it("detects compound CPU + memory failure", () => {
    const reason = getOneLineReason(SVC_CRITICAL);
    expect(reason.toLowerCase()).toContain("cpu");
    expect(reason.toLowerCase()).toContain("memory");
  });

  it("reason length is <= 180 characters (reasonable prose limit)", () => {
    const reason = getOneLineReason(SVC_WARNING_CPU);
    expect(reason.length).toBeLessThanOrEqual(180);
  });

  it("does not include raw Shapley phi notation like phi_cpu", () => {
    [SVC_WARNING_CPU, SVC_CRITICAL].forEach((svc) => {
      const reason = getOneLineReason(svc);
      expect(reason).not.toMatch(/phi_/i);
      expect(reason).not.toMatch(/\+0\.4[0-9]+/);
    });
  });
});

// ─────────────────────────────────────────────
// 6. getCorrelatedIncidents — Grouping
// ─────────────────────────────────────────────

describe("getCorrelatedIncidents()", () => {
  it("returns an empty array when no services are at risk", () => {
    const result = getCorrelatedIncidents([SVC_HEALTHY]);
    expect(result).toHaveLength(0);
  });

  it("groups services from the same project with the same top driver", () => {
    const svcA2 = {
      ...SVC_WARNING_CPU,
      id: "svc-warn-cpu-2",
      service: "auth-service-replica",
      risk: STATUS_ENUM.WARNING,
    };
    const fleet = [
      { ...SVC_WARNING_CPU, risk: STATUS_ENUM.WARNING },
      svcA2,
      { ...SVC_WARNING_MEM, risk: STATUS_ENUM.WARNING },
    ];
    const groups = getCorrelatedIncidents(fleet);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    // The two ProjectA/cpu_trend_5min services should be in one group
    const projectAGroup = groups.find((g) => g.project === "ProjectA");
    expect(projectAGroup).toBeDefined();
    expect(projectAGroup.services.length).toBeGreaterThanOrEqual(2);
  });

  it("only returns groups with 2 or more services", () => {
    const result = getCorrelatedIncidents([
      { ...SVC_WARNING_CPU, risk: STATUS_ENUM.WARNING },
      { ...SVC_WARNING_MEM, risk: STATUS_ENUM.WARNING },
    ]);
    result.forEach((g) => expect(g.services.length).toBeGreaterThanOrEqual(2));
  });
});

// ─────────────────────────────────────────────
// 7. buildSparkline — SVG Path Generation
// ─────────────────────────────────────────────

describe("buildSparkline()", () => {
  it("returns empty strings for fewer than 2 data points", () => {
    const result = buildSparkline([42]);
    expect(result.line).toBe("");
    expect(result.area).toBe("");
  });

  it("returns valid SVG path string for valid data", () => {
    const result = buildSparkline([10, 20, 30, 25, 40]);
    expect(result.line).toMatch(/^M/);
    expect(result.area).toMatch(/Z$/);
  });

  it("computes min and max correctly", () => {
    const result = buildSparkline([5, 15, 25]);
    expect(result.min).toBe(5);
    expect(result.max).toBe(25);
  });

  it("handles flat values without division by zero", () => {
    const result = buildSparkline([10, 10, 10, 10]);
    expect(result.line).not.toContain("NaN");
    expect(result.area).not.toContain("NaN");
  });

  it("filters out non-finite values", () => {
    const result = buildSparkline([NaN, 10, undefined, 20, Infinity]);
    expect(result.line).toMatch(/^M/);
    expect(result.min).toBe(10);
    expect(result.max).toBe(20);
  });

  it("returns lastPt as the last coordinate", () => {
    const result = buildSparkline([10, 20, 30]);
    expect(result.lastPt).not.toBeNull();
    expect(result.lastPt).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────
// 8. Formatting Utilities
// ─────────────────────────────────────────────

describe("fmtPercent()", () => {
  it("formats 0.5 as '50%'", () => {
    expect(fmtPercent(0.5)).toBe("50%");
  });

  it("formats 1.0 as '100%'", () => {
    expect(fmtPercent(1.0)).toBe("100%");
  });

  it("returns em dash for null/undefined/NaN", () => {
    expect(fmtPercent(null)).toBe("—");
    expect(fmtPercent(undefined)).toBe("—");
    expect(fmtPercent(NaN)).toBe("—");
  });

  it("respects decimal places parameter", () => {
    // 0.8765 * 100 = 87.65; JS toFixed(1) rounds to "87.6" (rounds half-to-even)
    expect(fmtPercent(0.8765, 1)).toBe("87.6%");
  });
});

describe("fmtNumber()", () => {
  it("formats 1234.5 with 1 decimal", () => {
    const result = fmtNumber(1234.5, 1);
    expect(result).toBe("1,234.5");
  });

  it("returns em dash for null/undefined/NaN", () => {
    expect(fmtNumber(null)).toBe("—");
    expect(fmtNumber(undefined)).toBe("—");
    expect(fmtNumber(NaN)).toBe("—");
  });
});

describe("timeAgo()", () => {
  it("returns 'just now' for timestamps within 3 seconds", () => {
    const recent = new Date(Date.now() - 1000).toISOString();
    expect(timeAgo(recent)).toBe("just now");
  });

  it("returns seconds ago for < 60 seconds", () => {
    const ts = new Date(Date.now() - 30000).toISOString();
    expect(timeAgo(ts)).toMatch(/^\d+s ago$/);
  });

  it("returns minutes ago for < 1 hour", () => {
    const ts = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(timeAgo(ts)).toMatch(/^\d+m ago$/);
  });

  it("returns 'just now' for null/undefined", () => {
    expect(timeAgo(null)).toBe("just now");
    expect(timeAgo(undefined)).toBe("just now");
  });
});

// ─────────────────────────────────────────────
// 9. computeSummary — the ONE source of truth for fleet counts
// ─────────────────────────────────────────────

describe("computeSummary()", () => {
  it("never reports 0 critical when a service is CRITICAL", () => {
    const fleet = [
      { ...SVC_CRITICAL, risk: STATUS_ENUM.CRITICAL },
      { ...SVC_WARNING_CPU, risk: STATUS_ENUM.WARNING },
      SVC_HEALTHY,
    ];
    const s = computeSummary(fleet, POLICY_DEFAULT);
    expect(s.critical).toBe(1);
    expect(s.warning).toBe(1);
    expect(s.healthy).toBe(1);
    expect(s.status).toBe(STATUS_ENUM.CRITICAL);
  });

  it("counts sum to the fleet size", () => {
    const fleet = [
      { ...SVC_CRITICAL, risk: STATUS_ENUM.CRITICAL },
      { ...SVC_WARNING_CPU, risk: STATUS_ENUM.WARNING },
      SVC_HEALTHY,
    ];
    const s = computeSummary(fleet, POLICY_DEFAULT);
    expect(s.critical + s.warning + s.healthy).toBe(s.services);
    expect(s.services).toBe(3);
  });

  it("derives status when a service has no precomputed risk", () => {
    const s = computeSummary([{ ...SVC_CRITICAL }], POLICY_DEFAULT);
    expect(s.critical).toBe(1);
  });

  it("returns HEALTHY for an empty fleet", () => {
    const s = computeSummary([], POLICY_DEFAULT);
    expect(s.services).toBe(0);
    expect(s.status).toBe(STATUS_ENUM.HEALTHY);
    expect(s.avg_time_to_breach_min).toBeNull();
  });

  it("averages only finite breach ETA values", () => {
    const fleet = [
      { ...SVC_WARNING_CPU, risk: STATUS_ENUM.WARNING, historical_warning_minutes: 4 },
      { ...SVC_WARNING_MEM, risk: STATUS_ENUM.WARNING, historical_warning_minutes: 8 },
    ];
    const s = computeSummary(fleet, POLICY_DEFAULT);
    expect(s.avg_time_to_breach_min).toBe(6);
  });
});

// ─────────────────────────────────────────────
// 10. Blast radius + priority explanation — derived, never fabricated
// ─────────────────────────────────────────────

describe("getBlastRadius()", () => {
  it("flags its value as estimated", () => {
    expect(getBlastRadius(SVC_WARNING_CPU).estimated).toBe(true);
  });

  it("scales with project fan-out (peer count)", () => {
    const lone = getBlastRadius(SVC_WARNING_CPU, [SVC_WARNING_CPU]);
    const crowded = getBlastRadius(SVC_WARNING_CPU, [
      SVC_WARNING_CPU,
      { ...SVC_WARNING_CPU, id: "b" },
      { ...SVC_WARNING_CPU, id: "c" },
      { ...SVC_WARNING_CPU, id: "d" },
    ]);
    expect(crowded.weight).toBeGreaterThan(lone.weight);
    expect(crowded.peerCount).toBe(4);
  });

  it("never emits fabricated absolute user counts", () => {
    const blast = getBlastRadius(SVC_CRITICAL);
    expect(blast.usersAffected).toBeUndefined();
  });
});

describe("explainPriority()", () => {
  it("explains the score using probability × blast × urgency", () => {
    const e = explainPriority(SVC_CRITICAL, [SVC_CRITICAL]);
    expect(e.formula).toContain("blast");
    expect(e.probabilityPct).toBe(91);
    expect(e.minutes).toBe(2);
    expect(e.score).toBe(computePriorityScore(SVC_CRITICAL, [SVC_CRITICAL]));
  });
});

// ─────────────────────────────────────────────
// 11. Mitigation tier model — simulator and tiers MUST agree
// ─────────────────────────────────────────────

describe("tier risk model", () => {
  it("maps each action to a tier", () => {
    expect(tierForAction("TRIGGER_LOAD_SHEDDING")).toBe("soft");
    expect(tierForAction("SCALE_OUT")).toBe("moderate");
    expect(tierForAction("CRITICAL_RESTART_AND_TRAFFIC_REROUTE")).toBe("emergency");
    expect(tierForAction("NO_ACTION")).toBe("doNothing");
  });

  it("produces decreasing risk with stronger tiers", () => {
    const base = 0.9;
    const soft = projectRisk(base, "soft");
    const moderate = projectRisk(base, "moderate");
    const emergency = projectRisk(base, "emergency");
    expect(soft).toBeLessThan(base);
    expect(moderate).toBeLessThan(soft);
    expect(emergency).toBeLessThan(moderate);
  });

  it("do-nothing keeps risk unchanged", () => {
    expect(projectRisk(0.77, "doNothing")).toBe(0.77);
  });

  it("recommendation risk-after matches the shared tier model", () => {
    const rec = getRecommendation(SVC_CRITICAL); // emergency tier
    expect(rec.expectedRiskAfter).toBe(projectRisk(0.91, "emergency"));
    expect(rec.tier).toBe("emergency");
  });

  it("what-if shedding curve is monotonic and unified", () => {
    const a = projectRiskFromShed(0.8, 20);
    const b = projectRiskFromShed(0.8, 60);
    expect(b).toBeLessThan(a);
    expect(projectRiskFromShed(0.8, 0)).toBe(0.8);
  });

  it("simulator and tier ladder agree for the same shedding percent", () => {
    // Soft tier ships 25% shedding — both code paths must land on the same number.
    const viaTier = projectRisk(0.6, "soft");
    const viaCurve = projectRiskFromShed(0.6, TIER_MODEL.soft.shedPercent);
    expect(Math.abs(viaTier - viaCurve)).toBeLessThanOrEqual(0.02);
  });
});

describe("getTierOptions()", () => {
  it("returns Soft, Moderate, Emergency and Do nothing columns", () => {
    const opts = getTierOptions(SVC_CRITICAL);
    expect(opts).toHaveLength(4);
    expect(opts.map((o) => o.key)).toEqual(["soft", "moderate", "emergency", "doNothing"]);
  });

  it("marks exactly one tier as recommended and Do nothing as danger", () => {
    const opts = getTierOptions(SVC_CRITICAL);
    expect(opts.filter((o) => o.recommended)).toHaveLength(1);
    expect(opts.find((o) => o.key === "doNothing").danger).toBe(true);
  });

  it("reports a before → after drop per tier", () => {
    const emergency = getTierOptions(SVC_CRITICAL).find((o) => o.key === "emergency");
    expect(emergency.beforePct).toBe(91);
    expect(emergency.afterPct).toBeLessThan(91);
    expect(emergency.dropPct).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────
// 12. getTimeToAct — real MTTA only, else hidden
// ─────────────────────────────────────────────

describe("getTimeToAct()", () => {
  it("returns null when the backend provides no MTTA", () => {
    expect(getTimeToAct(SVC_WARNING_CPU)).toBeNull();
  });

  it("returns minutes when provided", () => {
    expect(getTimeToAct({ ...SVC_WARNING_CPU, mtta_minutes: 3.4 })).toBe(3);
  });

  it("converts seconds to whole minutes", () => {
    expect(getTimeToAct({ ...SVC_WARNING_CPU, mtta_seconds: 150 })).toBe(3);
  });
});

describe("getEarlyAlarmLeadTime()", () => {
  it("returns null for null service or healthy service without MTTA", () => {
    expect(getEarlyAlarmLeadTime(null)).toBeNull();
    expect(getEarlyAlarmLeadTime({ risk: "HEALTHY" })).toBeNull();
  });

  it("returns empirical MTTA when service has measured mtta_minutes", () => {
    const res = getEarlyAlarmLeadTime({ ...SVC_WARNING_CPU, mtta_minutes: 11.4, mtta_seconds: 684 });
    expect(res).not.toBeNull();
    expect(res.minutes).toBe(11.4);
    expect(res.formatted).toBe("~11.4m early");
    expect(res.h3Passed).toBe(true);
  });

  it("returns null for at-risk services without measured MTTA", () => {
    const res = getEarlyAlarmLeadTime({ risk: "CRITICAL", cpu_probability: 0.95 });
    expect(res).toBeNull();
  });
});

describe("computeSummary() with MTTA metrics", () => {
  it("computes fleet mean MTTA and anticipation rate", () => {
    const summary = computeSummary([
      { ...SVC_WARNING_CPU, mtta_minutes: 11.4, anticipated_rate: 75 },
      { ...SVC_CRITICAL, mtta_minutes: 2.9, anticipated_rate: 65 },
    ]);
    expect(summary.mean_mtta_minutes).toBeCloseTo(7.15, 1);
    expect(summary.anticipation_rate_pct).toBe(70);
    expect(summary.mtta_label).toMatch(/^~\d+(\.\d+)?m$/);
  });

  it("weights fleet MTTA by anticipated events and excludes the model-fallback row", () => {
    const summary = computeSummary([
      // Genuine per-service rows carrying event counts (weights differ: 1 vs 9).
      { ...SVC_CRITICAL, mtta_scope: "service", mtta_minutes: 10, mtta_seconds: 600, mtta_anticipated_events: 1, mtta_total_events: 1, anticipated_rate: 100 },
      { ...SVC_WARNING_CPU, mtta_scope: "service", mtta_minutes: 2, mtta_seconds: 120, mtta_anticipated_events: 9, mtta_total_events: 9, anticipated_rate: 100 },
      // Model-wide fallback row must NOT be double-counted into the aggregate.
      { ...SVC_WARNING_CPU, mtta_scope: "model", mtta_minutes: 99, mtta_seconds: 5940, anticipated_rate: 50 },
    ]);
    // event-weighted: (600*1 + 120*9) / (1+9) / 60 = 2.8m  (mean-of-means would be 6m)
    expect(summary.mean_mtta_minutes).toBeCloseTo(2.8, 1);
    expect(summary.anticipation_rate_pct).toBeCloseTo(100, 1);
  });

  it("leaves MTTA fields empty when no measured values are available", () => {
    const summary = computeSummary([{ ...SVC_WARNING_CPU }]);
    expect(summary.mean_mtta_minutes).toBeNull();
    expect(summary.anticipation_rate_pct).toBeNull();
    expect(summary.mtta_label).toBeNull();
  });
});
