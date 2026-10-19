import React from "react";
import { X, Keyboard } from "lucide-react";

export default function KeyboardShortcutsModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const shortcuts = [
    { key: "J / K", desc: "Navigate down / up through the incident table" },
    { key: "A", desc: "Authorize recommended mitigation action for focused service" },
    { key: "/", desc: "Focus global search filter" },
    { key: "Cmd/Ctrl + K", desc: "Open global command palette" },
    { key: "S", desc: "Snooze active incident alerts for 15 minutes" },
    { key: "W", desc: "Launch What-If mitigation simulator" },
    { key: "C", desc: "Open side-by-side incident compare view" },
    { key: "E", desc: "Export SRE shift handoff report" },
    { key: "Esc", desc: "Close drawer or active modal" },
    { key: "?", desc: "Show this keyboard shortcuts cheat-sheet" },
  ];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ maxWidth: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Keyboard size={18} color="var(--accent)" />
            <h3 style={{ fontSize: "15px", fontWeight: 700 }}>
              SRE Keyboard Navigation Shortcuts
            </h3>
          </div>
          <button onClick={onClose} className="btn-secondary" style={{ padding: "4px 8px" }}>
            <X size={14} />
          </button>
        </div>

        <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: "10px" }}>
          {shortcuts.map((sc, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: i < shortcuts.length - 1 ? "1px solid var(--border-subtle)" : "none",
                fontSize: "13px",
              }}
            >
              <span style={{ color: "var(--text-secondary)" }}>{sc.desc}</span>
              <kbd className="kbd-badge">{sc.key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
