/**
 * Phase 1 explain/mitigation pure-helper tests.
 * Run with: npm test (from dashboard-ui)
 *
 * Contract under test: missing data must render "unavailable", never zeros;
 * the attribution badge must be honest per response; the cooldown math must
 * mirror the 180 s policy the backend enforces.
 */

import { describe, it, expect } from "vitest";
import {
  UNAVAILABLE,
  fmtOrUnavailable,
  isPlaceholderContributions,
  attributionBadge,
  cooldownDisplay,
  circuitBreakerInfo,
  tierLadderRows,
} from "../utils.js";

describe("fmtOrUnavailable — never display placeholders as data", () => {
  it("returns 'unavailable' for missing values, not 0", () => {
    expect(fmtOrUnavailable(null)).toBe(UNAVAILABLE);
    expect(fmtOrUnavailable(undefined)).toBe(UNAVAILABLE);
    expect(fmtOrUnavailable("")).toBe(UNAVAILABLE);
    expect(fmtOrUnavailable(NaN)).toBe(UNAVAILABLE);
    expect(fmtOrUnavailable(null, (v) => `${v}%`)).toBe(UNAVAILABLE);
  });

  it("formats real values, including 0 (zero is data, not a placeholder)", () => {
    expect(fmtOrUnavailable(0, (v) => `${v}%`)).toBe("0%");
    expect(fmtOrUnavailable(42.56, (v) => v.toFixed(1))).toBe("42.6");
    expect(fmtOrUnavailable("RB-01")).toBe("RB-01");
  });

  it("falls back to 'unavailable' when the formatter throws", () => {
    expect(fmtOrUnavailable("x", (v) => v.toFixed(2))).toBe(UNAVAILABLE);
  });
});

describe("isPlaceholderContributions — equal-split placeholder detection", () => {
  it("flags the 10-feature uniform 10.0 placeholder", () => {
    const placeholder = Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`feat_${i}`, 10.0])
    );
    expect(isPlaceholderContributions(placeholder)).toBe(true);
  });

  it("flags empty/missing/null input", () => {
    expect(isPlaceholderContributions({})).toBe(true);
    expect(isPlaceholderContributions(null)).toBe(true);
    expect(isPlaceholderContributions({ only: 7.3 })).toBe(true);
  });

  it("accepts genuine varied contributions", () => {
    expect(
      isPlaceholderContributions({ cpu: 41.2, queue: 33.7, mem: 25.1 })
    ).toBe(false);
  });
});

describe("attributionBadge — honest per-response method label", () => {
  it("only 'treeshap' earns the TreeSHAP label", () => {
    const b = attributionBadge("treeshap");
    expect(b.label).toBe("TreeSHAP");
    expect(b.exact).toBe(true);
  });

  it("approximate/unknown/missing methods are labeled approximate, never TreeSHAP", () => {
    for (const m of ["approximate", undefined, null, "kernel", ""]) {
      const b = attributionBadge(m);
      expect(b.exact).toBe(false);
      expect(b.label).not.toBe("TreeSHAP");
      expect(b.detail).toContain("Not exact TreeSHAP");
    }
  });
});

describe("cooldownDisplay — mirrors the 180 s policy", () => {
  it("formats remaining seconds as m:ss and clamps to the total", () => {
    const c = cooldownDisplay(95);
    expect(c.active).toBe(true);
    expect(c.text).toBe("1:35");
    expect(c.pct).toBeCloseTo(95 / 180, 5);
  });

  it("clamps values above the total and floors negatives to ready", () => {
    expect(cooldownDisplay(300).remainingSec).toBe(180);
    expect(cooldownDisplay(-4).active).toBe(false);
    expect(cooldownDisplay(null).text).toBe("0:00");
  });

  it("0 remaining is 'ready', not an invented countdown", () => {
    const c = cooldownDisplay(0);
    expect(c.active).toBe(false);
    expect(c.remainingSec).toBe(0);
  });
});

describe("circuitBreakerInfo — never invents a state", () => {
  it("maps the three normalized backend states", () => {
    expect(circuitBreakerInfo("STANDBY").label).toBe("STANDBY");
    expect(circuitBreakerInfo("CLOSED").tone).toBe("warn");
    expect(circuitBreakerInfo("ACTIVE").tone).toBe("danger");
    expect(circuitBreakerInfo("closed").label).toBe("CLOSED");
  });

  it("unknown/missing state renders 'unavailable'", () => {
    expect(circuitBreakerInfo(undefined).label).toBe(UNAVAILABLE);
    expect(circuitBreakerInfo("HALF_OPEN").label).toBe(UNAVAILABLE);
  });
});

describe("tierLadderRows — active tier highlight comes from real state", () => {
  const tiers = [
    { tier: 1, label: "Load shedding" },
    { tier: 2, label: "Scale out" },
    { tier: 3, label: "Drain & restart" },
  ];

  it("marks exactly the active tier", () => {
    const rows = tierLadderRows(tiers, 2);
    expect(rows.filter((r) => r.active).map((r) => r.tier)).toEqual([2]);
  });

  it("no tier is active when state says 0/null", () => {
    expect(tierLadderRows(tiers, 0).some((r) => r.active)).toBe(false);
    expect(tierLadderRows(tiers, null).some((r) => r.active)).toBe(false);
  });

  it("missing ladder data yields empty rows (UI shows 'unavailable')", () => {
    expect(tierLadderRows(undefined, 1)).toEqual([]);
    expect(tierLadderRows([], 1)).toEqual([]);
  });
});
