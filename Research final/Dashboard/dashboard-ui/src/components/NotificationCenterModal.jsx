import React, { useMemo, useState } from "react";
import { Bell, X, Volume2, VolumeX, CheckCircle2, ChevronDown, ChevronRight } from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import { fmtPercent, getRecommendation, getBreachEstimate } from "../utils.js";

const MUTE_OPTIONS = [
  { id: 15, label: "15m" },
  { id: 60, label: "1h" },
  { id: 240, label: "4h" },
];

export default function NotificationCenterModal({
  isOpen,
  onClose,
  services = [],
  onSelectService,
  onMuteService,
}) {
  const [muteMinutes, setMuteMinutes] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());

  const groups = useMemo(() => {
    const byAction = {};
    services
      .filter((s) => s.risk !== "HEALTHY")
      .forEach((s) => {
        const rec = getRecommendation(s);
        const key = rec.shortLabel;
        if (!byAction[key]) byAction[key] = [];
        byAction[key].push({ service: s, rec });
      });
    return Object.entries(byAction)
      .map(([action, items]) => ({ action, items }))
      .sort((a, b) => b.items.length - a.items.length);
  }, [services]);

  if (!isOpen) return null;

  const totalAlerts = groups.reduce((n, g) => n + g.items.length, 0);

  const toggle = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="details-drawer"
        style={{ width: "480px" }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Notification center"
      >
        <div className="drawer-header">
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <Bell size={18} color="var(--accent)" />
            <h2 style={{ fontSize: "15px", fontWeight: 700 }}>Alerts</h2>
            <span className="rail-count">{totalAlerts}</span>
          </div>
          <button onClick={onClose} className="icon-btn" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="drawer-mute-bar">
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            {muteMinutes ? <VolumeX size={15} color="var(--warning)" /> : <Volume2 size={15} color="var(--healthy)" />}
            <span style={{ fontWeight: 600 }}>
              {muteMinutes ? `Muted (${muteMinutes}m)` : "Alerts active"}
            </span>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            {MUTE_OPTIONS.map((o) => (
              <button
                key={o.id}
                className="filter-chip"
                onClick={() => setMuteMinutes(o.id)}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="drawer-body">
          {groups.length === 0 ? (
            <div style={{ padding: "40px", textAlign: "center", color: "var(--healthy)" }}>
              <CheckCircle2 size={32} style={{ margin: "0 auto 10px" }} />
              <div>No active alerts across the fleet.</div>
            </div>
          ) : (
            groups.map((g) => {
              const isOpen = expanded.has(g.action);
              const label =
                g.items.length > 1
                  ? `${g.items.length} services · ${g.action}`
                  : g.items[0].service.service;
              return (
                <div key={g.action} className="alert-group">
                  <button
                    className="alert-group-head"
                    onClick={() => toggle(g.action)}
                    aria-expanded={isOpen}
                  >
                    {g.items.length > 1 &&
                      (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />)}
                    <span className="alert-group-label">{label}</span>
                    {g.items.length === 1 && <StatusBadge status={g.items[0].service.risk} size="sm" />}
                  </button>

                  {(isOpen || g.items.length === 1) && (
                    <div className="alert-group-body">
                      {g.items.map(({ service, rec }) => {
                        const breach = getBreachEstimate(service);
                        const maxProb = Math.max(
                          Number(service.cpu_probability || 0),
                          Number(service.memory_probability || 0)
                        );
                        return (
                          <div
                            key={service.id}
                            className="alert-item"
                            onClick={() => {
                              onSelectService(service);
                              onClose();
                            }}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                onSelectService(service);
                                onClose();
                              }
                            }}
                          >
                            <div className="alert-item-top">
                              <span className="alert-item-name">{service.service}</span>
                              <StatusBadge status={service.risk} size="sm" />
                            </div>
                            <div className="text-muted-13">
                              Risk {fmtPercent(maxProb)} · {breach ? `breach ~${Math.round(breach.minutes)}m` : "no reliable ETA"}
                              {service.muted ? " · muted" : ""}
                            </div>
                            <div className="alert-item-actions">
                              <button
                                className="btn-secondary btn-compact"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onMuteService?.(service, muteMinutes || 15);
                                  setMuteMinutes(null);
                                }}
                              >
                                Mute
                              </button>
                              <span className="text-muted-13">{rec.shortLabel}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
