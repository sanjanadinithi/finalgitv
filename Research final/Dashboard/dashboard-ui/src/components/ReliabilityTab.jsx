import React, { useState } from "react";
import {
  Activity,
  ShieldCheck,
  BarChart2,
  Cpu,
  Layers,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
  Info,
  Clock,
  Zap,
} from "lucide-react";
import { fmtPercent } from "../utils.js";
import DataSourceStrip from "./DataSourceStrip.jsx";

export default function ReliabilityTab({ reliability, provenance }) {
  const [activeModel, setActiveModel] = useState("all"); // "all", "cpu", "memory", "mtta"

  if (!reliability) {
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
        No LOPO validation telemetry is currently available from the gateway.
      </div>
    );
  }

  const folds = reliability.cpu_lopo || [];
  const memFolds = reliability.memory_lopo || [];
  const mtta = reliability.mtta || {};
  const fleetMtta = mtta.fleet || {};
  const strategies = mtta.strategies || [];
  const svcMtta = mtta.by_service || {};

  const avg = (arr, key) =>
    arr.length ? arr.reduce((a, f) => a + (f[key] || 0), 0) / arr.length : 0;

  const cpuF1 = avg(folds, "f1");
  const memF1 = avg(memFolds, "f1");
  const cpuFar = avg(folds, "far");
  const memAuc = avg(memFolds, "auc");
  const cpuPrec = avg(folds, "precision");
  const cpuRec = avg(folds, "recall");
  const memPrec = avg(memFolds, "precision");
  const memRec = avg(memFolds, "recall");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "18px", fontWeight: 800, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
            <Activity size={20} color="var(--accent)" />
            Model Generalization & LOPO Validation Studio
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
            Leave-One-Project-Out (LOPO) cross-validation and MTTA early alarm prediction — evaluates how well machine learning models generalize and how early alarms anticipate failures.
          </p>
        </div>

        {/* Model Filter */}
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {[
            { id: "all", label: "Dual Models" },
            { id: "cpu", label: "CPU Predictor" },
            { id: "memory", label: "Memory Detector" },
            { id: "mtta", label: "Early Alarm (MTTA)" },
          ].map((m) => (
            <button
              key={m.id}
              className={`filter-chip ${activeModel === m.id ? "active" : ""}`}
              onClick={() => setActiveModel(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Data source provenance strip (Phase 0 audit) */}
      <DataSourceStrip provenance={reliability.provenance || provenance} />

      {/* Data-integrity banner: the CPU LOPO table may be a historical artifact */}
      {(provenance?.lopo_stale || reliability.cpu_lopo_metrics_mismatch) && (
        <div className="error-banner" style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning-text)" }}>
          <AlertTriangle size={15} />
          <span>
            <strong>CPU LOPO table:</strong>{" "}
            {provenance?.lopo_stale && (
              <>source file <code>{provenance.lopo_file}</code> ({provenance.lopo_mtime?.slice(0, 16).replace("T", " ")}) is older than the current dataset/model — this is the historical artifact run, not the current evaluation. </>
            )}
            {reliability.cpu_lopo_metrics_mismatch && (
              <>Stored precision/FAR columns in the CSV do not match its own confusion counts; values below are <strong>recomputed from TN/FP/FN/TP</strong> (recall is unchanged). </>
            )}
            {provenance?.eval_summary?.baseline_f1 != null && (
              <>Current-frame baseline: F1 {Number(provenance.eval_summary.baseline_f1).toFixed(3)}, FAR {Number(provenance.eval_summary.baseline_far).toFixed(3)} (advisor_evaluation_summary.json, {provenance.eval_summary.generated?.slice(0, 10)}). The historically claimed F1 95.13% is not reproducible from present sources.</>
            )}
          </span>
        </div>
      )}

      {/* Data-integrity banner: memory LOPO values are a fallback, not measured */}
      {reliability.memory_lopo_is_fallback && (
        <div className="error-banner" style={{ background: "var(--warning-bg)", borderColor: "var(--warning-border)", color: "var(--warning-text)" }}>
          <AlertTriangle size={15} />
          <span>
            Memory LOPO metrics below are a fallback copy, not measured cross-validation — treat them as indicative only.
          </span>
        </div>
      )}

      {/* Model Health Overview Cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: "14px" }}>
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>
              CPU Model F1 (LOPO)
            </span>
            <Cpu size={14} color="var(--accent)" />
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: "24px", fontWeight: 800, color: "var(--accent-text)", marginTop: "6px" }}>
            {fmtPercent(cpuF1, 1)}
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
            Mean across {folds.length} held-out projects
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>
              CPU False Alarm Rate
            </span>
            <ShieldCheck size={14} color={cpuFar < 0.15 ? "var(--healthy)" : "var(--warning)"} />
          </div>
          <div
            className="font-mono tabular-nums"
            style={{
              fontSize: "24px",
              fontWeight: 800,
              color: cpuFar < 0.15 ? "var(--healthy)" : "var(--warning)",
              marginTop: "6px",
            }}
          >
            {fmtPercent(cpuFar, 1)}
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
            Controlled baseline alert fatigue
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>
              Memory Model F1
            </span>
            <Layers size={14} color="var(--healthy)" />
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: "24px", fontWeight: 800, color: "var(--healthy)", marginTop: "6px" }}>
            {fmtPercent(memF1, 1)}
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
            High-order heap leakage sensitivity
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>
              Memory ROC AUC
            </span>
            <BarChart2 size={14} color="var(--accent)" />
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: "24px", fontWeight: 800, color: "var(--accent-text)", marginTop: "6px" }}>
            {fmtPercent(memAuc, 1)}
          </div>
          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "4px" }}>
            Area under discrimination curve
          </div>
        </div>

        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "16px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)" }}>
              Alarm Lead Time (MTTA)
            </span>
            <Clock size={14} color="var(--accent)" />
          </div>
          <div className="font-mono tabular-nums" style={{ fontSize: "24px", fontWeight: 800, color: "var(--accent-text)", marginTop: "6px" }}>
            {fleetMtta.fleet_mean_mtta_minutes != null ? `~${fleetMtta.fleet_mean_mtta_minutes}m` : ""}
          </div>
          <div style={{ fontSize: "13px", color: "var(--healthy)", marginTop: "4px" }}>
            {fleetMtta.fleet_anticipation_rate_pct != null
              ? `${fleetMtta.fleet_anticipation_rate_pct}% anticipated (H3 ${
                  fleetMtta.hypothesis_h3_met == null
                    ? "status unavailable"
                    : fleetMtta.hypothesis_h3_met
                      ? "≥ 30s ✓"
                      : "< 30s"
                })`
              : ""}
          </div>
        </div>
      </div>

      {/* CPU Model Section */}
      {(activeModel === "all" || activeModel === "cpu") && (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Cpu size={16} color="var(--accent)" />
              <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
                Component 2: CPU Spike Predictor — Cross-Project F1 Breakdown
              </h2>
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              {folds.length} held-out tenant clusters evaluated
            </div>
          </div>

          {/* Precision / Recall stats strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "16px" }}>
            <div style={{ background: "var(--bg-surface-elevated)", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase" }}>Mean Precision</div>
              <div className="font-mono tabular-nums" style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginTop: "2px" }}>
                {fmtPercent(cpuPrec, 1)}
              </div>
            </div>
            <div style={{ background: "var(--bg-surface-elevated)", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase" }}>Mean Recall</div>
              <div className="font-mono tabular-nums" style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginTop: "2px" }}>
                {fmtPercent(cpuRec, 1)}
              </div>
            </div>
            <div style={{ background: "var(--bg-surface-elevated)", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase" }}>Mean F1 Score</div>
              <div className="font-mono tabular-nums" style={{ fontSize: "15px", fontWeight: 700, color: "var(--accent-text)", marginTop: "2px" }}>
                {fmtPercent(cpuF1, 1)}
              </div>
            </div>
          </div>

          {/* LOPO Table */}
          <div style={{ overflowX: "auto" }}>
            <table className="dense-table">
              <thead>
                <tr>
                  <th>Held-out Project</th>
                  <th>Precision</th>
                  <th>Recall</th>
                  <th>F1 Score</th>
                  <th>False Alarm Rate</th>
                  <th>Generalization</th>
                </tr>
              </thead>
              <tbody>
                {folds.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <strong style={{ color: "var(--text-primary)" }}>{f.project}</strong>
                    </td>
                    <td className="font-mono">{fmtPercent(f.precision, 1)}</td>
                    <td className="font-mono">{fmtPercent(f.recall, 1)}</td>
                    <td className="font-mono" style={{ fontWeight: 700, color: "var(--accent-text)" }}>
                      {fmtPercent(f.f1, 1)}
                    </td>
                    <td className="font-mono">{fmtPercent(f.far, 1)}</td>
                    <td>
                      <span className={`status-badge ${(f.f1 || 0) >= 0.7 ? "healthy" : "warning"}`}>
                        {(f.f1 || 0) >= 0.7 ? "Generalizes" : "Acceptable"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Memory Model Section */}
      {(activeModel === "all" || activeModel === "memory") && (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Layers size={16} color="var(--healthy)" />
              <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
                Component 1: Memory Leak Detector (MUP) — LOPO Validation
              </h2>
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              {memFolds.length} held-out tenant clusters evaluated
            </div>
          </div>

          {/* Stats strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "12px", marginBottom: "16px" }}>
            <div style={{ background: "var(--bg-surface-elevated)", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase" }}>Mean Precision</div>
              <div className="font-mono tabular-nums" style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginTop: "2px" }}>
                {fmtPercent(memPrec, 1)}
              </div>
            </div>
            <div style={{ background: "var(--bg-surface-elevated)", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase" }}>Mean Recall</div>
              <div className="font-mono tabular-nums" style={{ fontSize: "15px", fontWeight: 700, color: "var(--text-primary)", marginTop: "2px" }}>
                {fmtPercent(memRec, 1)}
              </div>
            </div>
            <div style={{ background: "var(--bg-surface-elevated)", padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "13px", color: "var(--text-muted)", textTransform: "uppercase" }}>Mean ROC AUC</div>
              <div className="font-mono tabular-nums" style={{ fontSize: "15px", fontWeight: 700, color: "var(--healthy)", marginTop: "2px" }}>
                {fmtPercent(memAuc, 1)}
              </div>
            </div>
          </div>

          {/* Memory LOPO Table */}
          <div style={{ overflowX: "auto" }}>
            <table className="dense-table">
              <thead>
                <tr>
                  <th>Held-out Project</th>
                  <th>Precision</th>
                  <th>Recall</th>
                  <th>F1 Score</th>
                  <th>ROC AUC</th>
                  <th>Top SHAP Driver</th>
                </tr>
              </thead>
              <tbody>
                {memFolds.map((f, i) => (
                  <tr key={i}>
                    <td>
                      <strong style={{ color: "var(--text-primary)" }}>{f.project}</strong>
                    </td>
                    <td className="font-mono">{fmtPercent(f.precision, 1)}</td>
                    <td className="font-mono">{fmtPercent(f.recall, 1)}</td>
                    <td className="font-mono" style={{ fontWeight: 700, color: "var(--healthy)" }}>
                      {fmtPercent(f.f1, 1)}
                    </td>
                    <td className="font-mono">{fmtPercent(f.auc, 1)}</td>
                    <td>
                      <span
                        style={{
                          fontSize: "13px",
                          fontFamily: "var(--font-mono)",
                          background: "var(--bg-surface-elevated)",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          border: "1px solid var(--border-subtle)",
                          color: "var(--accent-text)",
                        }}
                      >
                        {f.shap_top3 || "Not reported"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Early Alarm Prediction & Mean Time To Anticipate (MTTA) Section */}
      {(activeModel === "all" || activeModel === "mtta") && (
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-lg)",
            padding: "20px",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <Clock size={16} color="var(--accent)" />
              <h2 style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
                Early Alarm Prediction: Mean Time To Anticipate (MTTA) &amp; Hypothesis H3
              </h2>
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
              Evaluates how early alarms are triggered before failure onset (window: 20 min lookback)
            </div>
          </div>

          {/* MTTA Metric Overview Strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "12px", marginBottom: "20px" }}>
            <div style={{ background: "var(--bg-surface-elevated)", padding: "12px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                Mean Alarm Lead Time (MTTA)
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: "20px", fontWeight: 800, color: "var(--accent-text)", marginTop: "4px" }}>
                {fleetMtta.fleet_mean_mtta_minutes != null ? `~${fleetMtta.fleet_mean_mtta_minutes}m` : ""}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                {fleetMtta.fleet_mean_mtta_seconds != null
                  ? `${Math.round(fleetMtta.fleet_mean_mtta_seconds)}s advance warning`
                  : ""}
              </div>
            </div>

            <div style={{ background: "var(--bg-surface-elevated)", padding: "12px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                Early Anticipation Rate
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: "20px", fontWeight: 800, color: "var(--healthy)", marginTop: "4px" }}>
                {fleetMtta.fleet_anticipation_rate_pct != null ? `${fleetMtta.fleet_anticipation_rate_pct}%` : "—"}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                {fleetMtta.anticipated_events != null && fleetMtta.total_events != null
                  ? `${fleetMtta.anticipated_events} of ${fleetMtta.total_events} failure events anticipated strictly in advance`
                  : ""}
              </div>
            </div>

            <div style={{ background: "var(--bg-surface-elevated)", padding: "12px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                Min Advance Warning
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: "20px", fontWeight: 800, color: "var(--text-primary)", marginTop: "4px" }}>
                {fleetMtta.min_lead_time_seconds != null ? `${fleetMtta.min_lead_time_seconds}s` : ""}
              </div>
              <div style={{ fontSize: "12px", color: "var(--healthy)", marginTop: "2px" }}>
                {fleetMtta.hypothesis_h3_met == null
                  ? ""
                  : fleetMtta.hypothesis_h3_met
                    ? "✓ Hypothesis H3 (≥ 30s target met)"
                    : "Hypothesis H3 (< 30s target)"}
              </div>
            </div>

            <div style={{ background: "var(--bg-surface-elevated)", padding: "12px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-subtle)" }}>
              <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: 700 }}>
                Max Lookback Horizon
              </div>
              <div className="font-mono tabular-nums" style={{ fontSize: "20px", fontWeight: 800, color: "var(--text-primary)", marginTop: "4px" }}>
                {fleetMtta.max_lead_time_minutes != null ? `${fleetMtta.max_lead_time_minutes}m` : ""}
              </div>
              <div style={{ fontSize: "12px", color: "var(--text-secondary)", marginTop: "2px" }}>
                Maximum alarm anticipation window
              </div>
            </div>
          </div>

          {/* Strategy Comparison Table */}
          <div style={{ marginBottom: "20px" }}>
            <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase" }}>
              Alarm Strategy Lead Time Comparison
            </h3>
            <div style={{ overflowX: "auto" }}>
              <table className="dense-table">
                <thead>
                  <tr>
                    <th>Strategy</th>
                    <th>Failures Evaluated</th>
                    <th>Anticipated Early</th>
                    <th>Anticipation Rate</th>
                    <th>Mean MTTA (Min)</th>
                    <th>Mean MTTA (Sec)</th>
                    <th>Lead Time Range</th>
                    <th>H3 Target (&gt;= 30s)</th>
                  </tr>
                </thead>
                <tbody>
                  {(strategies || []).map((s, idx) => (
                    <tr key={idx}>
                      <td><strong style={{ color: "var(--text-primary)" }}>{s.strategy}</strong></td>
                      <td className="font-mono">{s.total_events}</td>
                      <td className="font-mono">{s.anticipated_events}</td>
                      <td className="font-mono" style={{ fontWeight: 700, color: s.anticipation_rate_pct > 0 ? "var(--healthy)" : "inherit" }}>
                        {s.anticipation_rate_pct}%
                      </td>
                      <td className="font-mono" title={`computed over ${s.total_events} observed failure events, ${s.anticipated_events} anticipated`}>{s.mean_mtta_minutes > 0 ? `~${s.mean_mtta_minutes}m` : ""} <span style={{ color: "var(--text-muted)" }}>(n={s.total_events ?? 0})</span></td>
                      <td className="font-mono" title={`computed over ${s.total_events} observed failure events`}>{s.mean_mtta_seconds > 0 ? `${s.mean_mtta_seconds}s` : ""}</td>
                      <td className="font-mono">{s.anticipated_events > 0 ? `[${s.min_mtta_seconds}s, ${s.max_mtta_seconds}s]` : "—"}</td>
                      <td>
                        <span className={`status-badge ${s.h3_pass ? "healthy" : "neutral"}`}>
                          {s.h3_pass ? "Passed (>=30s)" : s.anticipated_events > 0 ? "Marginal" : "N/A"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Per-Service Breakdown Table */}
          {Object.keys(svcMtta).length > 0 && (
            <div>
              <h3 style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-secondary)", marginBottom: "8px", textTransform: "uppercase" }}>
                Per-Microservice Alarm Prediction Lead Time
              </h3>
              <div style={{ overflowX: "auto" }}>
                <table className="dense-table">
                  <thead>
                    <tr>
                      <th>Service Name</th>
                      <th>Observed Incidents</th>
                      <th>Anticipated Early</th>
                      <th>Success Rate</th>
                      <th>Mean Lead Time (Min)</th>
                      <th>Mean Lead Time (Sec)</th>
                      <th>Warning Lead Time</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(svcMtta).map(([svcName, s], idx) => (
                      <tr key={idx}>
                        <td><strong style={{ color: "var(--text-primary)" }}>{svcName}</strong></td>
                        <td className="font-mono">{s.total_events}</td>
                        <td className="font-mono">{s.anticipated_events}</td>
                        <td className="font-mono" style={{ fontWeight: 700, color: s.anticipation_rate_pct > 50 ? "var(--healthy)" : "var(--warning)" }}>
                          {s.anticipation_rate_pct}%
                        </td>
                        <td className="font-mono" style={{ fontWeight: 700, color: "var(--accent-text)" }}>
                          {s.mean_mtta_minutes > 0 ? `~${s.mean_mtta_minutes}m` : ""}
                        </td>
                        <td className="font-mono">{s.mean_mtta_seconds > 0 ? `${s.mean_mtta_seconds}s` : ""}</td>
                        <td>
                          <span className={`status-badge ${s.mean_mtta_seconds >= 30 ? "healthy" : s.mean_mtta_seconds != null ? "warning" : "neutral"}`}>
                            {s.formatted_lead_time || (s.mean_mtta_minutes > 0 ? `~${s.mean_mtta_minutes}m early` : "—")}
                            {" "}
                            <span style={{ color: "var(--text-muted)" }} title="Observed failure events behind this warning-time figure">
                              (n={s.total_events ?? 0})
                            </span>
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Explanatory footer banner */}
      <div
        style={{
          background: "var(--bg-surface-elevated)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-md)",
          padding: "12px 16px",
          display: "flex",
          alignItems: "center",
          gap: "10px",
          fontSize: "13px",
          color: "var(--text-secondary)",
        }}
      >
        <Info size={15} color="var(--accent)" />
        <span>
          <strong>LOPO Methodology:</strong> Models are retrained with each customer/project's historical traffic completely withheld from the training partition, then scored on that held-out slice. The fold figures above come from the historical <code>lopo_results.csv</code> run (see staleness banner); on the current evaluation frame the baseline scores F1 ≈ 0.57 with FAR ≈ 1.0 — the high false-alarm rate is a documented limitation, not a solved problem. No metric here can "guarantee" absence of overfitting.
        </span>
      </div>
    </div>
  );
}
