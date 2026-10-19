import React, { useState } from "react";
import { X, GitCompare, Cpu, HardDrive, Clock } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import Sparkline from "./Sparkline.jsx";
import { fmtPercent, getTopContributors, getRecommendation } from "../utils.js";

export default function CompareModal({ services = [], initialSelected = [], onClose }) {
  const [selectedIds, setSelectedIds] = useState(
    initialSelected.length >= 2
      ? initialSelected
      : services.slice(0, 3).map((s) => s.id)
  );

  const selectedServices = services.filter((s) => selectedIds.includes(s.id));

  const handleToggle = (id) => {
    if (selectedIds.includes(id)) {
      if (selectedIds.length > 2) setSelectedIds(selectedIds.filter((x) => x !== id));
    } else {
      if (selectedIds.length < 4) setSelectedIds([...selectedIds, id]);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 840 }} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <GitCompare size={18} color="var(--accent)" />
            <h3 style={{ fontSize: "15px", fontWeight: 700 }}>
              Incident Side-by-Side Comparison ({selectedServices.length}/4 Selected)
            </h3>
          </div>
          <button onClick={onClose} className="btn-secondary" style={{ padding: "4px 8px" }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "16px", maxHeight: "75vh", overflowY: "auto" }}>
          {/* Service Selector Chips */}
          <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
            <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Compare:</span>
            {services.slice(0, 10).map((s) => {
              const active = selectedIds.includes(s.id);
              return (
                <button
                  key={s.id}
                  onClick={() => handleToggle(s.id)}
                  className={`filter-chip ${active ? "active" : ""}`}
                  style={{ fontSize: "13px" }}
                >
                  {s.service}
                </button>
              );
            })}
          </div>

          {/* Comparison Matrix */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${selectedServices.length}, 1fr)`, gap: "12px" }}>
            {selectedServices.map((s) => {
              const topDriver = getTopContributors(s, 1)[0];
              const rec = getRecommendation(s);
              const probHistory = (s.history || []).map((h) => Number(h.probability || 0));

              return (
                <div
                  key={s.id}
                  style={{
                    background: "var(--bg-surface-elevated)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)",
                    padding: "14px",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                  }}
                >
                  {/* Service Header */}
                  <div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "4px" }}>
                      <strong style={{ fontSize: "13px" }}>{s.service}</strong>
                      <StatusBadge status={s.risk} size="sm" />
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                      {s.project} · {s.runtime}
                    </div>
                  </div>

                  {/* Sparkline */}
                  <div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "4px" }}>Failure Risk Trend (30s)</div>
                    <div style={{ width: "100%", height: 32 }}>
                      <Sparkline values={probHistory} width={180} height={30} color={s.risk === "CRITICAL" ? "var(--critical)" : "var(--warning)"} />
                    </div>
                  </div>

                  {/* Metrics */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", fontSize: "13px" }}>
                    <div style={{ background: "var(--bg-app)", padding: "6px 8px", borderRadius: "4px" }}>
                      <span style={{ color: "var(--text-muted)" }}>CPU Risk</span>
                      <div className="font-mono tabular-nums" style={{ fontWeight: 700, marginTop: "2px" }}>{fmtPercent(s.cpu_probability)}</div>
                    </div>
                    <div style={{ background: "var(--bg-app)", padding: "6px 8px", borderRadius: "4px" }}>
                      <span style={{ color: "var(--text-muted)" }}>Memory Risk</span>
                      <div className="font-mono tabular-nums" style={{ fontWeight: 700, marginTop: "2px" }}>{fmtPercent(s.memory_probability)}</div>
                    </div>
                  </div>

                  {/* Top Driver */}
                  <div style={{ fontSize: "13px" }}>
                    <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>Top Contributing Driver:</span>
                    <div style={{ fontWeight: 600, color: "var(--text-primary)", marginTop: "2px" }}>
                      {topDriver ? `${topDriver.label} (${topDriver.pct}%)` : "Nominal"}
                    </div>
                  </div>

                  {/* Recommended Action */}
                  <div style={{ fontSize: "13px", background: "var(--bg-app)", padding: "8px", borderRadius: "4px" }}>
                    <span style={{ color: "var(--text-muted)", fontSize: "13px", textTransform: "uppercase", fontWeight: 700 }}>Remediation</span>
                    <div style={{ fontWeight: 600, color: "var(--accent-text)", marginTop: "2px" }}>
                      {rec.shortLabel}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button className="btn-secondary" onClick={onClose}>
              Close Comparison
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
