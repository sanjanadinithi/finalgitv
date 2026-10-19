import React from "react";
import { buildSparkline } from "../utils.js";

export default function Sparkline({
  values = [],
  width = 110,
  height = 28,
  color = "var(--accent)",
  showFill = true,
}) {
  const { line, area, lastPt } = buildSparkline(values, width, height, 2);

  if (!line) {
    return (
      <div
        style={{
          width,
          height,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: "13px",
          color: "var(--text-muted)",
        }}
      >
        No trend
      </div>
    );
  }

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      style={{ width, height, overflow: "visible" }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id={`sparkGrad_${color.replace(/[^a-zA-Z0-9]/g, "")}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      {showFill && area && (
        <path d={area} fill={`url(#sparkGrad_${color.replace(/[^a-zA-Z0-9]/g, "")})`} />
      )}
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {lastPt && (
        <circle
          cx={lastPt[0]}
          cy={lastPt[1]}
          r="2.5"
          fill={color}
          stroke="var(--bg-surface)"
          strokeWidth="1.5"
        />
      )}
    </svg>
  );
}
