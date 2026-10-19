import React, { useState, useRef } from "react";
import { fmtPercent, fmtNumber } from "../utils.js";

/**
 * InteractiveTrendChart — Enterprise NOC time-series chart with:
 * - Real 30-sample rolling time-series
 * - Configurable alarm threshold line
 * - Shaded "predicted breach" forward region
 * - Alarm breach annotation marker
 * - Interactive hover crosshair with exact coordinate tooltip
 * - Auto-hides when history data is empty
 */
export default function InteractiveTrendChart({
  history = [],
  threshold = 0.20,
  thresholdLabel = "Alarm Threshold (20%)",
  metricKey = "probability",
  color = "var(--warning)",
  height = 140,
}) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const containerRef = useRef(null);

  // Extract clean numerical series
  const data = (history || [])
    .map((h, i) => ({
      index: i,
      timestamp: h.timestamp || `T-${history.length - i}s`,
      val: Number(h[metricKey] != null ? h[metricKey] : h.probability || 0),
      cpu: Number(h.cpu || 0),
      queue: Number(h.queue || 0),
    }))
    .filter((d) => Number.isFinite(d.val));

  if (data.length < 2) {
    return null; // Hide chart if no data yet
  }

  const width = 520;
  const paddingX = 16;
  const paddingY = 20;

  const minVal = 0;
  const maxVal = Math.max(1.0, ...data.map((d) => d.val), threshold * 1.2);
  const range = maxVal - minVal || 1;

  const getX = (i) => paddingX + (i / (data.length - 1)) * (width - paddingX * 2);
  const getY = (v) => height - paddingY - ((v - minVal) / range) * (height - paddingY * 2);

  const points = data.map((d, i) => [getX(i), getY(d.val)]);
  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

  const areaD = `${pathD} L ${points[points.length - 1][0].toFixed(1)},${height - paddingY} L ${points[0][0].toFixed(1)},${height - paddingY} Z`;

  // Threshold Y coordinate
  const threshY = getY(threshold);

  // Shaded predicted region (last 6 samples)
  const predStartIndex = Math.max(0, data.length - 6);
  const predX = getX(predStartIndex);
  const predWidth = getX(data.length - 1) - predX;

  // Find first point that breached threshold
  const breachIndex = data.findIndex((d) => d.val >= threshold);
  const breachPoint = breachIndex >= 0 ? points[breachIndex] : null;

  const handleMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const relX = (mouseX / rect.width) * width;

    // Find nearest point
    let nearestIdx = 0;
    let minDist = Infinity;
    points.forEach((p, idx) => {
      const dist = Math.abs(p[0] - relX);
      if (dist < minDist) {
        minDist = dist;
        nearestIdx = idx;
      }
    });
    setHoverIndex(nearestIdx);
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
  };

  const activePoint = hoverIndex !== null ? points[hoverIndex] : null;
  const activeData = hoverIndex !== null ? data[hoverIndex] : null;

  return (
    <div
      style={{
        background: "var(--bg-surface-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: "14px 16px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <div>
          <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--text-primary)" }}>
            Telemetry Trajectory & Alarm Breach Window
          </span>
          <span style={{ fontSize: "13px", color: "var(--text-muted)", marginLeft: "8px" }}>
            30 rolling samples · shaded area = predicted forward risk
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", fontSize: "13px" }}>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "8px", height: "2px", background: color }} />
            Observed
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: "4px" }}>
            <span style={{ width: "8px", height: "2px", background: "var(--critical)", borderTop: "1px dashed var(--critical)" }} />
            Threshold
          </span>
        </div>
      </div>

      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        style={{ width: "100%", height: `${height}px`, position: "relative", cursor: "crosshair" }}
      >
        <svg
          viewBox={`0 0 ${width} ${height}`}
          style={{ width: "100%", height: "100%", overflow: "visible" }}
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.35" />
              <stop offset="100%" stopColor={color} stopOpacity="0.0" />
            </linearGradient>
            <linearGradient id="predGrad" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="var(--warning)" stopOpacity="0.05" />
              <stop offset="100%" stopColor="var(--critical)" stopOpacity="0.20" />
            </linearGradient>
          </defs>

          {/* Shaded "Predicted" region */}
          {predWidth > 0 && (
            <rect
              x={predX}
              y={paddingY}
              width={predWidth}
              height={height - paddingY * 2}
              fill="url(#predGrad)"
              strokeDasharray="2,2"
            />
          )}

          {/* Area fill */}
          <path d={areaD} fill="url(#chartAreaGrad)" />

          {/* Threshold Line */}
          <line
            x1={paddingX}
            y1={threshY}
            x2={width - paddingX}
            y2={threshY}
            stroke="var(--critical)"
            strokeDasharray="4,4"
            strokeWidth="1.2"
          />

          {/* Threshold text */}
          <text
            x={paddingX + 4}
            y={threshY - 4}
            fill="var(--critical)"
            fontSize="9.5"
            fontFamily="var(--font-mono)"
            fontWeight="600"
          >
            {thresholdLabel}
          </text>

          {/* Main trend line */}
          <path d={pathD} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

          {/* Breach annotation marker */}
          {breachPoint && (
            <g transform={`translate(${breachPoint[0]}, ${breachPoint[1]})`}>
              <circle r="4" fill="var(--critical)" stroke="var(--bg-app)" strokeWidth="1.5" />
              <circle r="8" fill="var(--critical)" fillOpacity="0.25" />
            </g>
          )}

          {/* Hover Crosshair & Dot */}
          {activePoint && (
            <>
              <line
                x1={activePoint[0]}
                y1={paddingY}
                x2={activePoint[0]}
                y2={height - paddingY}
                stroke="var(--text-muted)"
                strokeDasharray="2,2"
                strokeWidth="1"
              />
              <circle
                cx={activePoint[0]}
                cy={activePoint[1]}
                r="4.5"
                fill="var(--text-primary)"
                stroke="var(--accent)"
                strokeWidth="2"
              />
            </>
          )}
        </svg>

        {/* Hover Tooltip Overlay */}
        {activePoint && activeData && (
          <div
            style={{
              position: "absolute",
              left: `${Math.min(80, Math.max(10, (activePoint[0] / width) * 100))}%`,
              top: `${Math.max(10, activePoint[1] - 50)}px`,
              background: "var(--bg-surface)",
              border: "1px solid var(--border-muted)",
              borderRadius: "var(--radius-sm)",
              padding: "6px 10px",
              fontSize: "13px",
              boxShadow: "var(--shadow-md)",
              pointerEvents: "none",
              zIndex: 10,
              transform: "translateX(-50%)",
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ color: "var(--text-muted)", fontSize: "13px" }}>{activeData.timestamp}</div>
            <div style={{ display: "flex", gap: "10px", marginTop: "2px" }}>
              <span>
                Risk: <strong style={{ color: "var(--accent-text)" }}>{fmtPercent(activeData.val)}</strong>
              </span>
              <span>
                CPU: <strong className="font-mono">{fmtNumber(activeData.cpu, 1)}%</strong>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
