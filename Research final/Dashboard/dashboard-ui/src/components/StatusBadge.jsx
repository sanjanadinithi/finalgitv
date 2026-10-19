import React from "react";
import { AlertCircle, AlertTriangle, CheckCircle2 } from "lucide-react";
import { STATUS_ENUM } from "../utils.js";

export default function StatusBadge({ status, size = "md", showIcon = true }) {
  const normStatus = (status || STATUS_ENUM.HEALTHY).toUpperCase();

  const config = {
    [STATUS_ENUM.CRITICAL]: {
      label: "Critical",
      className: "critical",
      icon: <AlertCircle size={size === "sm" ? 11 : 13} className="shrink-0" />,
    },
    [STATUS_ENUM.WARNING]: {
      label: "Warning",
      className: "warning",
      icon: <AlertTriangle size={size === "sm" ? 11 : 13} className="shrink-0" />,
    },
    [STATUS_ENUM.HEALTHY]: {
      label: "Healthy",
      className: "healthy",
      icon: <CheckCircle2 size={size === "sm" ? 11 : 13} className="shrink-0" />,
    },
  }[normStatus] || {
    label: normStatus,
    className: "healthy",
    icon: <CheckCircle2 size={12} />,
  };

  return (
    <span
      className={`status-badge ${config.className} ${size === "sm" ? "text-xs py-0.5 px-2" : ""}`}
      role="status"
      aria-label={`Status: ${config.label}`}
    >
      {showIcon && config.icon}
      <span>{config.label}</span>
    </span>
  );
}
