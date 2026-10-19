import React from "react";
import { CheckCircle2, AlertTriangle, X, RotateCcw } from "lucide-react";

export default function ToastContainer({ toasts = [], onDismiss, onUndo }) {
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container" role="region" aria-live="polite">
      {toasts.map((toast) => (
        <div key={toast.id} className="toast">
          {toast.type === "success" ? (
            <CheckCircle2 size={16} color="var(--healthy)" />
          ) : (
            <AlertTriangle size={16} color="var(--warning)" />
          )}

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: "13px" }}>{toast.title}</div>
            {toast.message && (
              <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
                {toast.message}
              </div>
            )}
          </div>

          {toast.canUndo && (
            <button
              onClick={() => onUndo?.(toast.id)}
              className="btn-secondary"
              style={{ padding: "3px 8px", fontSize: "13px" }}
              title="Undo this action"
            >
              <RotateCcw size={11} /> Undo
            </button>
          )}

          <button
            onClick={() => onDismiss?.(toast.id)}
            style={{ color: "var(--text-muted)", padding: "2px" }}
            aria-label="Dismiss notification"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
