import React from "react";

export default function RiskGauge({ value = 0, size = 48, strokeWidth = 4, showLabel = true }) {
  const pct = Math.min(100, Math.max(0, Math.round(Number(value) * 100)));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (pct / 100) * circumference;

  let color = "var(--healthy)";
  if (pct >= 80) color = "var(--critical)";
  else if (pct >= 20) color = "var(--warning)";

  return (
    <div style={{ position: "relative", width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }} aria-hidden="true">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--border-subtle)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 300ms ease" }}
        />
      </svg>
      {showLabel && (
        <span
          className="tabular-nums font-mono"
          style={{
            position: "absolute",
            fontSize: size > 40 ? "11px" : "9.5px",
            fontWeight: 800,
            color: "var(--text-primary)",
          }}
        >
          {pct}%
        </span>
      )}
    </div>
  );
}
