import React, { useState, useEffect } from "react";
import { Search, X, ShieldAlert, Sliders, ArrowRight } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";

export default function CommandPalette({
  isOpen,
  onClose,
  services = [],
  onSelectService,
  onOpenPolicy,
  onOpenHandoff,
}) {
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  if (!isOpen) return null;

  const filtered = services.filter((s) => {
    const q = query.toLowerCase();
    return (
      s.service.toLowerCase().includes(q) ||
      (s.project || "").toLowerCase().includes(q) ||
      (s.action || "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 540 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", padding: "14px 16px", borderBottom: "1px solid var(--border-subtle)" }}>
          <Search size={16} color="var(--text-muted)" />
          <input
            autoFocus
            type="text"
            placeholder="Search services, incidents, actions, or type a command…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text-primary)",
              fontSize: "13.5px",
            }}
          />
          <kbd className="kbd-badge">ESC</kbd>
        </div>

        <div style={{ maxHeight: "360px", overflowY: "auto", padding: "8px" }}>
          {/* Quick Actions */}
          {!query && (
            <div style={{ padding: "4px 8px 8px 8px" }}>
              <div style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "4px" }}>
                Quick Navigation
              </div>
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                className="dense-table"
                onClick={() => { onOpenPolicy?.(); onClose(); }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <Sliders size={14} color="var(--accent)" /> Adjust Alarm Policy Thresholds
                </span>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Ctrl+P</span>
              </div>
              <div
                style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px", borderRadius: "var(--radius-sm)", cursor: "pointer" }}
                className="dense-table"
                onClick={() => { onOpenHandoff?.(); onClose(); }}
              >
                <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <ShieldAlert size={14} color="var(--healthy)" /> Generate SRE Shift Handoff
                </span>
                <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Ctrl+E</span>
              </div>
            </div>
          )}

          {/* Service Results */}
          <div style={{ padding: "4px 8px" }}>
            <div style={{ fontSize: "13px", fontWeight: 700, textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "6px" }}>
              Microservices ({filtered.length})
            </div>
            {filtered.map((s) => (
              <div
                key={s.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 10px",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
                className="dense-table"
                onClick={() => {
                  onSelectService?.(s);
                  onClose();
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <strong style={{ fontSize: "13px" }}>{s.service}</strong>
                  <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>({s.project})</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <StatusBadge status={s.risk} size="sm" />
                  <ArrowRight size={12} color="var(--text-muted)" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
