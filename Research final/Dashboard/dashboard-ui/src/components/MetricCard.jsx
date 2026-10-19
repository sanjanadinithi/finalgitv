import React from "react";
import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import Sparkline from "./Sparkline.jsx";

export default function MetricCard({
  label,
  value,
  trendDelta,
  trendType = "neutral", // "positive", "negative", "neutral"
  sparkValues = [],
  sparkColor = "var(--accent)",
  isSelected = false,
  onClick,
  tooltip,
}) {
  return (
    <div
      className={`kpi-card ${isSelected ? "selected" : ""}`}
      onClick={onClick}
      title={tooltip || label}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onClick?.(); }}
    >
      <div className="kpi-header">
        <span>{label}</span>
        {trendDelta !== undefined && (
          <span
            className="kpi-trend"
            style={{
              color:
                trendType === "positive"
                  ? "var(--healthy)"
                  : trendType === "negative"
                  ? "var(--critical)"
                  : "var(--text-muted)",
            }}
          >
            {trendType === "positive" ? (
              <TrendingUp size={12} />
            ) : trendType === "negative" ? (
              <TrendingDown size={12} />
            ) : (
              <Minus size={12} />
            )}
            {trendDelta}
          </span>
        )}
      </div>

      <div className="kpi-body">
        <span className="kpi-value tabular-nums">{value}</span>
        {sparkValues && sparkValues.length > 1 && (
          <Sparkline values={sparkValues} color={sparkColor} width={80} height={24} />
        )}
      </div>
    </div>
  );
}
