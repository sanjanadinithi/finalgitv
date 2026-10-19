import React, { useState } from "react";
import { X, ShieldAlert, AlertTriangle, CheckCircle2 } from "lucide-react";

export default function RejectMitigationModal({ service, onClose, onConfirmReject }) {
  const [selectedReason, setSelectedReason] = useState("maintenance");
  const [customNotes, setCustomNotes] = useState("");

  if (!service) return null;

  const reasons = [
    { id: "maintenance", label: "Planned Maintenance / Scheduled Deployment", desc: "Service is currently undergoing intentional restart or synthetic load test." },
    { id: "false_positive", label: "False Positive / Known Acceptable Spike", desc: "Telemetry fluctuation is expected behavior for current operational cycle." },
    { id: "upstream", label: "Mitigating at Upstream Gateway / Network Layer", desc: "Traffic throttling is being applied globally at the edge ingress mesh." },
    { id: "other", label: "Custom Operational Rationale", desc: "Provide specific rationale below for the compliance audit trail." },
  ];

  const handleSubmit = (e) => {
    e.preventDefault();
    const reasonText =
      selectedReason === "other"
        ? customNotes.trim() || "Operator overridden with custom rationale"
        : reasons.find((r) => r.id === selectedReason)?.label;

    onConfirmReject(service, reasonText);
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "520px" }}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reject-modal-title"
      >
        <div className="modal-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <ShieldAlert size={18} color="var(--warning)" />
            <span id="reject-modal-title">Dismiss / Reject Mitigation Recommendation</span>
          </div>
          <button onClick={onClose} className="btn-secondary" style={{ padding: "4px" }} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div
              style={{
                background: "var(--bg-surface-elevated)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                padding: "12px",
                fontSize: "13px",
              }}
            >
              <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>Target Microservice:</div>
              <div style={{ fontWeight: 700, fontSize: "14px", color: "var(--text-primary)", marginTop: "2px" }}>
                {service.service} <span style={{ color: "var(--text-muted)", fontWeight: 400 }}>({service.project})</span>
              </div>
              <div style={{ color: "var(--text-secondary)", fontSize: "13px", marginTop: "4px" }}>
                Pending Action: <strong>{service.action?.replaceAll("_", " ")}</strong>
              </div>
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 700, color: "var(--text-primary)", marginBottom: "8px" }}>
                Select Mandatory Audit Reason:
              </label>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {reasons.map((r) => (
                  <label
                    key={r.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "10px",
                      padding: "10px 12px",
                      borderRadius: "var(--radius-md)",
                      border: `1px solid ${selectedReason === r.id ? "var(--accent)" : "var(--border-subtle)"}`,
                      background: selectedReason === r.id ? "var(--accent-bg)" : "var(--bg-surface-elevated)",
                      cursor: "pointer",
                    }}
                  >
                    <input
                      type="radio"
                      name="rejectReason"
                      value={r.id}
                      checked={selectedReason === r.id}
                      onChange={() => setSelectedReason(r.id)}
                      style={{ marginTop: "3px", accentColor: "var(--accent)" }}
                    />
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: 600, color: "var(--text-primary)" }}>{r.label}</div>
                      <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>{r.desc}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            {selectedReason === "other" && (
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>
                  Additional Notes (Saved to SRE audit log):
                </label>
                <textarea
                  required
                  rows={3}
                  value={customNotes}
                  onChange={(e) => setCustomNotes(e.target.value)}
                  placeholder="Explain why this mitigation is being bypassed…"
                  style={{
                    width: "100%",
                    padding: "8px 10px",
                    background: "var(--bg-input)",
                    border: "1px solid var(--border-subtle)",
                    borderRadius: "var(--radius-md)",
                    fontSize: "13px",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
            )}
          </div>

          <div className="modal-footer">
            <button type="button" className="btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" style={{ background: "var(--critical)" }}>
              Confirm Rejection & Log Audit
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
