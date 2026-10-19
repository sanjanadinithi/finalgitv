import React, { useState } from "react";
import { Activity, History, BellOff } from "lucide-react";
import { FEATURE_NAMES, timeAgo } from "../utils.js";
import FleetRadar from "./FleetRadar.jsx";
import FleetPulse from "./FleetPulse.jsx";

export default function RightRail({ dashboard, pulse, onSelectService, onSelectServiceByName }) {
  const services = dashboard?.services || [];
  const events = dashboard?.events || [];
  const mutes = dashboard?.mutes || [];
  const policy = dashboard?.policy;
  const [showAllEvents, setShowAllEvents] = useState(false);

  // Aggregated fleet root-cause drivers. Services whose breakdown is a
  // placeholder equal-split are excluded so nothing fabricated is aggregated.
  const aggregatedDrivers = React.useMemo(() => {
    const sums = {};
    let contributors = 0;

    services.forEach((s) => {
      if (s.drivers_are_placeholder) return;
      const contribs = s.feature_contributions || {};
      const values = Object.values(contribs).map((v) => Number(v || 0));
      if (values.length < 2 || new Set(values).size <= 1) return;
      Object.entries(contribs).forEach(([k, v]) => {
        const num = Number(v || 0);
        if (num > 0) sums[k] = (sums[k] || 0) + num;
      });
      contributors += 1;
    });

    if (contributors === 0) return { rows: [], contributors: 0 };

    const rows = Object.entries(sums)
      .map(([k, sum]) => ({
        key: k,
        label: FEATURE_NAMES[k] || k.replaceAll("_", " "),
        avgPct: Math.round((sum / contributors) * 10) / 10,
      }))
      .sort((a, b) => b.avgPct - a.avgPct)
      .slice(0, 5);

    return { rows, contributors };
  }, [services]);

  const visibleEvents = showAllEvents ? events.slice(0, 20) : events.slice(0, 5);

  return (
    <aside className="right-rail">
      {/* Live Visualizations */}
      <div className="rail-visuals">
        <FleetRadar 
          services={services} 
          policy={policy} 
          onSelectService={onSelectService} 
          compact={true}
        />
        <FleetPulse 
          pulse={pulse} 
          policy={policy} 
          compact={true}
        />
      </div>

      {/* Active mutes */}
      {mutes.length > 0 && (
        <div className="table-panel rail-panel">
          <div className="rail-title">
            <BellOff size={16} color="var(--accent)" />
            <span>Muted services</span>
            <span className="rail-count">{mutes.length}</span>
          </div>
          {mutes.map((m) => (
            <div key={m.id || m.service} className="rail-row">
              <span className="rail-name">{m.service}</span>
              <span className="rail-note">
                {Math.max(0, Math.round((m.seconds_remaining || 0) / 60))}m left
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Fleet root-cause drivers */}
      <div className="table-panel rail-panel">
        <div className="rail-title">
          <Activity size={16} color="var(--accent)" />
          <span>What is driving fleet risk</span>
        </div>
        {aggregatedDrivers.rows.length === 0 ? (
          <div className="rail-note">
            {services.length} services · no measured driver breakdown reported
          </div>
        ) : (
          <>
            <div className="rail-note" style={{ marginBottom: "10px" }}>
              Mean contribution across {aggregatedDrivers.contributors} services
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {aggregatedDrivers.rows.map((driver) => {
                const maxAvg = aggregatedDrivers.rows[0]?.avgPct || 100;
                const fill = Math.min(100, Math.round((driver.avgPct / maxAvg) * 100));
                return (
                  <div key={driver.key}>
                    <div className="rail-row">
                      <span className="rail-name">{driver.label}</span>
                      <span className="rail-note tabular-nums font-mono">{driver.avgPct}%</span>
                    </div>
                    <div className="rail-bar">
                      <div style={{ width: `${fill}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Recent events — real, timestamped gateway log */}
      <div className="table-panel rail-panel">
        <div className="rail-title">
          <History size={16} color="var(--accent)" />
          <span>Recent events</span>
          <span className="rail-count">{events.length}</span>
        </div>
        {events.length === 0 ? (
          <div className="rail-note">No transitions recorded yet.</div>
        ) : (
          <>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {visibleEvents.map((e, i) => (
                <button
                  key={`${e.ts}-${i}`}
                  className="event-row"
                  onClick={() => onSelectServiceByName?.(e.service)}
                  title={e.detail || e.kind}
                >
                  <span
                    className="event-dot"
                    style={{
                      background:
                        e.kind === "risk_transition" && e.to === "CRITICAL"
                          ? "var(--critical)"
                          : e.kind === "approval"
                          ? "var(--accent)"
                          : "var(--warning)",
                    }}
                  />
                  <span className="event-service">{e.service}</span>
                  <span className="event-detail">{e.detail || e.kind}</span>
                  <span className="event-time">{timeAgo(e.ts)}</span>
                </button>
              ))}
            </div>
            {events.length > 5 && (
              <button
                className="btn-secondary"
                style={{ marginTop: "10px", width: "100%", justifyContent: "center" }}
                onClick={() => setShowAllEvents((v) => !v)}
              >
                {showAllEvents ? "Show fewer" : `View more (${events.length})`}
              </button>
            )}
          </>
        )}
      </div>
    </aside>
  );
}
