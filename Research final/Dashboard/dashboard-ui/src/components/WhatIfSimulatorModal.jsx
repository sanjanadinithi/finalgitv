import React, { useState } from "react";
import { X, Sliders, ArrowRight, ShieldCheck } from "lucide-react";
import RiskGauge from "./RiskGauge.jsx";
import { fmtPercent, projectRisk, projectRiskFromShed, riskProbability, TIER_MODEL } from "../utils.js";

export default function WhatIfSimulatorModal({ service, onClose, onApplyAction }) {
  const [shedPercent, setShedPercent] = useState(TIER_MODEL.soft.shedPercent);
  const [restartReplicas, setRestartReplicas] = useState(false);

  if (!service) return null;

  const initialProb = riskProbability(service);
  const cpuProb = Number(service.cpu_probability || 0);
  const memProb = Number(service.memory_probability || 0);

  // The SAME model the mitigation ladder uses — no separate curve, so the
  // numbers shown here always match the Options tab.
  const afterShed = projectRiskFromShed(initialProb, shedPercent);
  const afterRestart = projectRisk(initialProb, "emergency");
  const simulatedProb = restartReplicas ? Math.min(afterShed, afterRestart) : afterShed;

  // Scale both signals by the same ratio so the breakdown stays consistent.
  const ratio = initialProb > 0 ? simulatedProb / initialProb : 0;
  const simulatedCpu = cpuProb * ratio;
  const simulatedMem = memProb * ratio;

  const reductionPct = Math.round((initialProb - simulatedProb) * 100);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Sliders size={18} color="var(--accent)" />
            <h3 style={{ fontSize: "15px", fontWeight: 700 }}>
              What-if simulator — {service.service}
            </h3>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "18px" }}>
          <div className="text-muted-13">
            Same risk model as the mitigation options — numbers always agree.
          </div>

          <div className="sim-grid">
            <div className="sim-card">
              <div className="sim-label">Current risk</div>
              <RiskGauge value={initialProb} size={54} strokeWidth={5} />
              <div className="text-muted-13">
                CPU {fmtPercent(cpuProb)} · Mem {fmtPercent(memProb)}
              </div>
            </div>

            <div className="sim-arrow">
              <ArrowRight size={20} color="var(--accent)" />
            </div>

            <div className="sim-card">
              <div className="sim-label is-healthy">Projected risk</div>
              <RiskGauge value={simulatedProb} size={54} strokeWidth={5} />
              <div className="text-muted-13">
                CPU {fmtPercent(simulatedCpu)} · Mem {fmtPercent(simulatedMem)}
              </div>
            </div>
          </div>

          <div className="sim-controls">
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span>Traffic shed</span>
                <strong className="font-mono" style={{ color: "var(--accent)" }}>{shedPercent}%</strong>
              </div>
              <input
                type="range"
                min="0"
                max="80"
                step="5"
                value={shedPercent}
                onChange={(e) => setShedPercent(parseInt(e.target.value, 10))}
                style={{ width: "100%", accentColor: "var(--accent)" }}
                aria-label="Traffic shed percentage"
              />
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: "10px", paddingTop: "4px" }}>
              <input
                type="checkbox"
                id="chk-restart"
                checked={restartReplicas}
                onChange={(e) => setRestartReplicas(e.target.checked)}
                style={{ accentColor: "var(--accent)", width: 16, height: 16 }}
              />
              <label htmlFor="chk-restart" style={{ cursor: "pointer" }}>
                Also restart pods ({TIER_MODEL.emergency.plainLabel})
              </label>
            </div>
          </div>

          <div className="text-muted-13" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <ShieldCheck size={14} color="var(--healthy)" />
            <span>
              Expected reduction: {reductionPct}pp · effect {TIER_MODEL.emergency.timeToEffect} with restart.
              Estimated by the shared model.
            </span>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
            <button className="btn-secondary" onClick={onClose}>Cancel</button>
            <button
              className="btn-primary"
              onClick={() => {
                onApplyAction?.(service, shedPercent, restartReplicas);
                onClose();
              }}
            >
              Record this decision
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
