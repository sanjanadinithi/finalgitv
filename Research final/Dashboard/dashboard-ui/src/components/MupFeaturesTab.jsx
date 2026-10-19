import React, { useState } from "react";
import {
  Layers,
  Database,
  TrendingUp,
  AlertTriangle,
  Cpu,
  CheckCircle2,
  Filter,
  ArrowRight,
  Code2,
} from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import { fmtPercent, fmtNumber } from "../utils.js";

export default function MupFeaturesTab({ dashboard, onSelectService }) {
  const [selectedSvc, setSelectedSvc] = useState("all");

  if (!dashboard) {
    return (
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px dashed var(--border-muted)",
          borderRadius: "var(--radius-lg)",
          padding: "40px",
          textAlign: "center",
          color: "var(--text-muted)",
        }}
      >
        No MUP telemetry data is currently available from the gateway.
      </div>
    );
  }

  const mup = dashboard.mup || {};
  // Services with memory alarm or elevated memory risk (> 0.20)
  const services = (dashboard.services || []).filter(
    (s) => s.memory_alarm || (s.memory_probability || 0) > 0.2
  );
  const derivedFeatures = mup.derived_features || [];

  const filteredServices =
    selectedSvc === "all" ? services : services.filter((s) => s.service === selectedSvc);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Tab Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "18px", fontWeight: 800, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
            <Layers size={20} color="var(--accent)" />
            Memory Leak Telemetry & Heap Engineering Signals (Component 3)
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
            High-order memory derivatives detecting progressive leak patterns prior to JVM/container OOMKill eviction.
          </p>
        </div>

        {/* Microservice Filter Dropdown */}
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "var(--text-secondary)" }}>
            <Filter size={14} />
            <span>Target Service:</span>
          </div>
          <select
            value={selectedSvc}
            onChange={(e) => setSelectedSvc(e.target.value)}
            style={{
              padding: "7px 12px",
              borderRadius: "var(--radius-md)",
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-input)",
              color: "var(--text-primary)",
              fontSize: "13px",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            <option value="all">All Elevated Services ({services.length})</option>
            {services.map((s) => (
              <option key={s.service} value={s.service}>
                {s.service} ({s.runtime})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Live Service Cards Grid */}
      {services.length === 0 ? (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px dashed var(--border-muted)",
            borderRadius: "var(--radius-lg)",
            padding: "36px",
            textAlign: "center",
            color: "var(--healthy)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "10px",
          }}
        >
          <CheckCircle2 size={18} />
          <span>All monitored services report nominal heap saturation and stable garbage collection profiles.</span>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(360px, 1fr))", gap: "16px" }}>
          {filteredServices.map((s) => {
            const m = s.mup_features || {};
            const memProb = Number(s.memory_probability || 0);
            const isAlarm = Boolean(s.memory_alarm);
            const heapFill =
              m.heap_fill_ratio != null
                ? m.heap_fill_ratio
                : m.heap_max
                ? m.heap_mb_used / m.heap_max
                : 0;

            const heapColor =
              heapFill > 0.85 ? "var(--critical)" : heapFill > 0.65 ? "var(--warning)" : "var(--healthy)";

            return (
              <div
                key={s.service}
                style={{
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border-subtle)",
                  borderLeft: `4px solid ${isAlarm ? "var(--critical)" : "var(--warning)"}`,
                  borderRadius: "var(--radius-lg)",
                  padding: "16px 18px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "12px",
                  cursor: "pointer",
                  transition: "transform var(--transition-fast), border-color var(--transition-fast)",
                }}
                onClick={() => onSelectService?.(s)}
              >
                {/* Card Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span style={{ fontWeight: 800, fontSize: "14px", color: "var(--text-primary)" }}>
                        {s.service}
                      </span>
                      <span
                        style={{
                          fontSize: "13px",
                          fontFamily: "var(--font-mono)",
                          background: "var(--bg-surface-elevated)",
                          padding: "2px 6px",
                          borderRadius: "4px",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--text-secondary)",
                        }}
                      >
                        {s.runtime}
                      </span>
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "2px" }}>
                      Project: {s.project} · Status:{" "}
                      <span style={{ fontWeight: 700, color: isAlarm ? "var(--critical)" : "var(--warning)" }}>
                        {isAlarm ? "MEMORY ALARM" : "MEMORY ELEVATED"}
                      </span>
                    </div>
                  </div>

                  <div style={{ textAlign: "right" }}>
                    <div
                      className="font-mono tabular-nums"
                      style={{ fontSize: "18px", fontWeight: 800, color: isAlarm ? "var(--critical)" : "var(--text-primary)" }}
                    >
                      {fmtPercent(memProb)}
                    </div>
                    <div style={{ fontSize: "13px", textTransform: "uppercase", color: "var(--text-muted)" }}>
                      Failure Prob
                    </div>
                  </div>
                </div>

                {/* Heap Saturation Bar */}
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: "13px", marginBottom: "4px" }}>
                    <span style={{ color: "var(--text-secondary)", fontWeight: 600 }}>Heap Allocation Headroom</span>
                    <span className="font-mono" style={{ fontWeight: 700, color: heapColor }}>
                      {(heapFill * 100).toFixed(1)}% ({m.heap_mb_used != null ? Math.round(m.heap_mb_used) : "—"} /{" "}
                      {m.heap_max != null ? Math.round(m.heap_max) : "—"} MB)
                    </span>
                  </div>
                  <div
                    style={{
                      width: "100%",
                      height: "6px",
                      background: "var(--bg-input)",
                      borderRadius: "3px",
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${Math.min(100, Math.max(0, heapFill * 100))}%`,
                        height: "100%",
                        background: heapColor,
                        borderRadius: "3px",
                        transition: "width 0.3s ease",
                      }}
                    />
                  </div>
                </div>

                {/* 4-Metric Primary Grid */}
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "8px",
                    background: "var(--bg-surface-elevated)",
                    padding: "10px 12px",
                    borderRadius: "var(--radius-md)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                      RAM Utilization
                    </div>
                    <div className="font-mono tabular-nums" style={{ fontSize: "13px", fontWeight: 700 }}>
                      {m.ram_percent != null ? `${fmtNumber(m.ram_percent, 1)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                      5m Memory Delta
                    </div>
                    <div
                      className="font-mono tabular-nums"
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: (m.memory_change_5min || 0) > 0 ? "var(--warning)" : "inherit",
                      }}
                    >
                      {m.memory_change_5min != null ? `${m.memory_change_5min > 0 ? "+" : ""}${fmtNumber(m.memory_change_5min, 1)} MB` : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                      GC Bursts / Total
                    </div>
                    <div className="font-mono tabular-nums" style={{ fontSize: "13px", fontWeight: 700 }}>
                      {m.gc_spike_count != null ? m.gc_spike_count : "—"} / {m.gc_count != null ? m.gc_count : "—"}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 600 }}>
                      Time-to-OOM Slope
                    </div>
                    <div
                      className="font-mono tabular-nums"
                      style={{
                        fontSize: "13px",
                        fontWeight: 700,
                        color: (m.time_to_oom_slope || 0) > 0.05 ? "var(--critical)" : "inherit",
                      }}
                    >
                      {m.time_to_oom_slope != null ? fmtNumber(m.time_to_oom_slope, 4) : "—"}
                    </div>
                  </div>
                </div>

                {/* Engineered Feature Signals */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 12px", fontSize: "13px" }}>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Acceleration:</span>
                    <span className="font-mono" style={{ fontWeight: 600 }}>
                      {m.memory_acceleration != null ? fmtNumber(m.memory_acceleration, 2) : "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>GC Pressure:</span>
                    <span className="font-mono" style={{ fontWeight: 600 }}>
                      {m.gc_pressure_index != null ? fmtNumber(m.gc_pressure_index, 3) : "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Growth Velocity:</span>
                    <span className="font-mono" style={{ fontWeight: 600 }}>
                      {m.memory_growth_velocity != null ? fmtNumber(m.memory_growth_velocity, 4) : "—"}
                    </span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between" }}>
                    <span style={{ color: "var(--text-muted)" }}>Leak Momentum:</span>
                    <span className="font-mono" style={{ fontWeight: 600 }}>
                      {m.ram_leak_momentum != null ? fmtNumber(m.ram_leak_momentum, 3) : "—"}
                    </span>
                  </div>
                </div>

                {/* Trigger reason banner if present */}
                {s.mup_reason && s.mup_reason !== "N/A" && (
                  <div
                    style={{
                      padding: "6px 10px",
                      background: "var(--warning-bg)",
                      border: "1px solid var(--warning-border)",
                      borderRadius: "var(--radius-sm)",
                      fontSize: "13px",
                      color: "var(--warning-text)",
                    }}
                  >
                    <strong>Primary Trigger:</strong> {s.mup_reason}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Feature Engineering Architecture & Formulas */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: "18px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
          <Code2 size={16} color="var(--accent)" />
          <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
            Engineered Memory Derivatives & Mathematical Formulas
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "12px" }}>
          {derivedFeatures.map((feat) => (
            <div
              key={feat.name}
              style={{
                background: "var(--bg-surface-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                padding: "12px 14px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                <span style={{ fontWeight: 700, fontSize: "13px", color: "var(--text-primary)" }}>{feat.label}</span>
                <span
                  style={{
                    fontSize: "13px",
                    fontFamily: "var(--font-mono)",
                    background: "var(--accent-bg)",
                    color: "var(--accent-text)",
                    padding: "1px 6px",
                    borderRadius: "4px",
                  }}
                >
                  Derivative
                </span>
              </div>
              <div
                className="font-mono"
                style={{
                  fontSize: "13px",
                  padding: "6px 8px",
                  background: "var(--bg-input)",
                  borderRadius: "4px",
                  marginBottom: "6px",
                  color: "var(--accent-text)",
                  border: "1px solid var(--border-subtle)",
                  overflowX: "auto",
                }}
              >
                {feat.formula}
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", lineHeight: 1.4 }}>
                {feat.desc}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
