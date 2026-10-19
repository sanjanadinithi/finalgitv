import React, { useState } from "react";
import { Check, Copy } from "lucide-react";

export default function CommandBlock({ command, isDryRun = true }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    if (!command) return;
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="command-block">
      <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
        {isDryRun && (
          <span
            style={{
              fontSize: "13px",
              fontFamily: "var(--font-mono)",
              fontWeight: 700,
              padding: "2px 6px",
              borderRadius: "4px",
              background: "var(--bg-surface-elevated)",
              border: "1px solid var(--border-subtle)",
              color: "var(--accent-text)",
              letterSpacing: "0.5px",
              textTransform: "uppercase",
              flexShrink: 0,
            }}
          >
            dry-run
          </span>
        )}
        <code className="command-code">{command}</code>
      </div>
      <button
        onClick={handleCopy}
        className="copy-btn"
        title="Copy command to clipboard"
        aria-label="Copy command"
      >
        {copied ? (
          <span style={{ display: "flex", alignItems: "center", gap: "4px", color: "var(--healthy)" }}>
            <Check size={12} /> Copied
          </span>
        ) : (
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <Copy size={12} /> Copy
          </span>
        )}
      </button>
    </div>
  );
}
