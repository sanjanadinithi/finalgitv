import React, { useState, useMemo } from "react";
import {
  ArrowUpDown,
  Filter,
  Layers,
  ChevronDown,
  ChevronRight,
  CheckSquare,
  Square,
} from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";
import {
  STATUS_ENUM,
  STATUS_ORDER,
  fmtPercent,
  getTopContributors,
  getRecommendation,
  getBreachEstimate,
} from "../utils.js";

export default function RiskTable({
  services = [],
  selectedService,
  onSelectService,
  searchQuery = "",
  selectedIds = new Set(),
  onToggleSelectId,
  onSelectAll,
  onApproveAction,
  kpiFilter = "all",
}) {
  const [sortKey, setSortKey] = useState("risk");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterPreset, setFilterPreset] = useState("all"); // "all", "critical", "warning", "memory", "decisions"
  const [groupByProject, setGroupByProject] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState(new Set());

  // Synchronize KPI strip filter selections with table
  React.useEffect(() => {
    if (kpiFilter === "critical") {
      setFilterPreset("critical");
    } else if (kpiFilter === "at_risk" || kpiFilter === "breaches") {
      setFilterPreset("decisions");
    } else if (kpiFilter === "mttf") {
      setSortKey("eta");
      setSortAsc(true);
    } else if (kpiFilter === "all") {
      setFilterPreset("all");
    }
  }, [kpiFilter]);

  // Filter logic
  const filtered = useMemo(() => {
    let list = [...services];

    // Text search query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter(
        (s) =>
          s.service.toLowerCase().includes(q) ||
          (s.project || "").toLowerCase().includes(q) ||
          (s.runtime || "").toLowerCase().includes(q) ||
          (s.action || "").toLowerCase().includes(q)
      );
    }

    // Filter presets
    if (filterPreset === "critical") {
      list = list.filter((s) => s.risk === STATUS_ENUM.CRITICAL);
    } else if (filterPreset === "warning") {
      list = list.filter((s) => s.risk === STATUS_ENUM.WARNING);
    } else if (filterPreset === "memory") {
      list = list.filter((s) => s.memory_alarm || Number(s.memory_probability || 0) > 0.3);
    } else if (filterPreset === "decisions") {
      list = list.filter((s) => s.risk !== STATUS_ENUM.HEALTHY);
    }

    // Sorting
    list.sort((a, b) => {
      let diff = 0;
      if (sortKey === "risk") {
        diff = (STATUS_ORDER[a.risk] ?? 3) - (STATUS_ORDER[b.risk] ?? 3);
        if (diff === 0) diff = (b.cpu_probability || 0) - (a.cpu_probability || 0);
      } else if (sortKey === "service") {
        diff = a.service.localeCompare(b.service);
      } else if (sortKey === "project") {
        diff = (a.project || "").localeCompare(b.project || "");
      } else if (sortKey === "cpu") {
        diff = (b.cpu_probability || 0) - (a.cpu_probability || 0);
      } else if (sortKey === "memory") {
        diff = (b.memory_probability || 0) - (a.memory_probability || 0);
      } else if (sortKey === "eta") {
        const aVal = getBreachEstimate(a)?.minutes ?? a.mtta_minutes ?? Number.POSITIVE_INFINITY;
        const bVal = getBreachEstimate(b)?.minutes ?? b.mtta_minutes ?? Number.POSITIVE_INFINITY;
        diff = aVal - bVal;
      }
      return sortAsc ? diff : -diff;
    });

    return list;
  }, [services, searchQuery, filterPreset, sortKey, sortAsc]);

  const toggleSort = (key) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else {
      setSortKey(key);
      setSortAsc(true);
    }
  };

  const toggleGroupCollapse = (proj) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(proj)) next.delete(proj);
      else next.add(proj);
      return next;
    });
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selectedIds.has(s.id));

  // Render Table Row
  const renderRow = (s) => {
    const isSelected = selectedService?.id === s.id;
    const isChecked = selectedIds.has(s.id);
    const topDriver = getTopContributors(s, 1)[0];
    const rec = getRecommendation(s);
    const breach = getBreachEstimate(s);
    const mitStatus = s.mitigation_state?.status;
    const stateLabel = s.muted ? "Muted" : mitStatus || "Not executed";

    return (
      <tr
        key={s.id}
        className={`${isSelected ? "selected" : ""}`}
        onClick={() => onSelectService(s)}
      >
        <td onClick={(e) => { e.stopPropagation(); onToggleSelectId?.(s.id); }} style={{ width: 36 }}>
          {isChecked ? (
            <CheckSquare size={14} color="var(--accent)" />
          ) : (
            <Square size={14} color="var(--border-muted)" />
          )}
        </td>
        <td style={{ width: 100 }}>
          <StatusBadge status={s.risk} size="sm" />
        </td>
        <td style={{ fontWeight: 600 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span>{s.service}</span>
            <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>({s.runtime})</span>
          </div>
        </td>
        <td style={{ color: "var(--text-secondary)" }}>{s.project}</td>
        <td className="tabular-nums font-mono" style={{ color: s.cpu_alarm ? "var(--warning)" : "inherit" }}>
          {fmtPercent(s.cpu_probability)}
        </td>
        <td className="tabular-nums font-mono" style={{ color: s.memory_alarm ? "var(--critical)" : "inherit" }}>
          {fmtPercent(s.memory_probability)}
        </td>
        <td className="tabular-nums font-mono">
          {s.risk !== STATUS_ENUM.HEALTHY && breach ? (
            <span title={`Estimated breach in ~${Math.round(breach.minutes)}m${s.mtta_minutes != null ? ` (MTTA early warning: ~${s.mtta_minutes}m${s.mtta_scope === "model" ? ", model-wide average" : ""})` : ""}`}>
              ~{Math.round(breach.minutes)}m
              {s.mtta_minutes != null && (
                <span style={{ fontSize: "11px", color: "var(--accent-text)", marginLeft: "4px" }}>
                  (~{s.mtta_minutes}m early{s.mtta_scope === "model" ? " · model avg" : ""})
                </span>
              )}
            </span>
          ) : s.mtta_minutes != null && s.risk !== STATUS_ENUM.HEALTHY ? (
            <span
              style={{ color: "var(--accent-text)", fontWeight: 700 }}
              title={
                s.mtta_scope === "model"
                  ? "Mean Time To Anticipate (MTTA): this model's demonstrated fleet-wide average advance warning"
                  : "Mean Time To Anticipate (MTTA): measured advance warning for this service"
              }
            >
              ~{s.mtta_minutes}m early{s.mtta_scope === "model" ? " (model avg)" : ""}
            </span>
          ) : (
            "\u2014"
          )}
        </td>
        <td style={{ maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={topDriver?.plainDesc || "No measured driver breakdown"}>
          {topDriver ? `${topDriver.label} (${topDriver.pct}%)` : "—"}
        </td>
        <td>
          <span className="cell-note">{stateLabel}</span>
        </td>
        <td onClick={(e) => e.stopPropagation()}>
          {s.risk !== STATUS_ENUM.HEALTHY ? (
            <button
              className="btn-secondary btn-compact"
              onClick={() => onApproveAction?.(s)}
              title={`Recommend: ${rec.actionTitle}`}
            >
              {rec.shortLabel}
            </button>
          ) : (
            <span className="cell-note">Nominal</span>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div className="table-panel">
      {/* Table Toolbar */}
      <div className="table-toolbar">
        <div className="table-filter-group">
          <Filter size={14} color="var(--text-muted)" />
          <button
            className={`filter-chip ${filterPreset === "all" ? "active" : ""}`}
            onClick={() => setFilterPreset("all")}
          >
            All ({services.length})
          </button>
          <button
            className={`filter-chip ${filterPreset === "decisions" ? "active" : ""}`}
            onClick={() => setFilterPreset("decisions")}
          >
            Needs Decision ({services.filter((s) => s.risk !== STATUS_ENUM.HEALTHY).length})
          </button>
          <button
            className={`filter-chip ${filterPreset === "critical" ? "active" : ""}`}
            onClick={() => setFilterPreset("critical")}
          >
            Critical ({services.filter((s) => s.risk === STATUS_ENUM.CRITICAL).length})
          </button>
          <button
            className={`filter-chip ${filterPreset === "warning" ? "active" : ""}`}
            onClick={() => setFilterPreset("warning")}
          >
            Warning ({services.filter((s) => s.risk === STATUS_ENUM.WARNING).length})
          </button>
          <button
            className={`filter-chip ${filterPreset === "memory" ? "active" : ""}`}
            onClick={() => setFilterPreset("memory")}
          >
            Memory Risk ({services.filter((s) => s.memory_alarm || (s.memory_probability || 0) > 0.3).length})
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <button
            className={`filter-chip ${groupByProject ? "active" : ""}`}
            onClick={() => setGroupByProject(!groupByProject)}
            title="Toggle project grouping"
          >
            <Layers size={12} style={{ display: "inline", marginRight: "4px" }} />
            Group by Project
          </button>
        </div>
      </div>

      {/* Dense Table */}
      <div className="dense-table-container">
        <table className="dense-table">
          <thead>
            <tr>
              <th style={{ width: 36 }} onClick={onSelectAll}>
                {allFilteredSelected ? (
                  <CheckSquare size={14} color="var(--accent)" />
                ) : (
                  <Square size={14} color="var(--border-muted)" />
                )}
              </th>
              <th onClick={() => toggleSort("risk")}>
                Severity <ArrowUpDown size={11} style={{ display: "inline" }} />
              </th>
              <th onClick={() => toggleSort("service")}>
                Service <ArrowUpDown size={11} style={{ display: "inline" }} />
              </th>
              <th onClick={() => toggleSort("project")}>
                Project <ArrowUpDown size={11} style={{ display: "inline" }} />
              </th>
              <th onClick={() => toggleSort("cpu")}>
                CPU Risk <ArrowUpDown size={11} style={{ display: "inline" }} />
              </th>
              <th onClick={() => toggleSort("memory")}>
                Memory Risk <ArrowUpDown size={11} style={{ display: "inline" }} />
              </th>
              <th onClick={() => toggleSort("eta")} title="Estimated time to breach & Early alarm prediction lead time (MTTA)">
                ETA / Lead Time <ArrowUpDown size={11} style={{ display: "inline" }} />
              </th>
              <th>Top Driver</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} style={{ textAlign: "center", padding: "36px", color: "var(--text-muted)" }}>
                  No services matching the selected filters.
                </td>
              </tr>
            ) : !groupByProject ? (
              filtered.map(renderRow)
            ) : (
              Object.entries(
                filtered.reduce((acc, s) => {
                  const p = s.project || "Ungrouped";
                  if (!acc[p]) acc[p] = [];
                  acc[p].push(s);
                  return acc;
                }, {})
              ).map(([project, groupServices]) => {
                const isCollapsed = collapsedGroups.has(project);
                const critCount = groupServices.filter((s) => s.risk === STATUS_ENUM.CRITICAL).length;

                return (
                  <React.Fragment key={project}>
                    <tr
                      style={{ background: "var(--bg-surface-elevated)", cursor: "pointer" }}
                      onClick={() => toggleGroupCollapse(project)}
                    >
                      <td colSpan={10} style={{ padding: "8px 14px", fontWeight: 700, fontSize: "13px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                          {isCollapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                          <span>{project}</span>
                          <span style={{ color: "var(--text-muted)", fontWeight: 500 }}>
                            ({groupServices.length} services{critCount > 0 ? ` · ${critCount} critical` : ""})
                          </span>
                        </div>
                      </td>
                    </tr>
                    {!isCollapsed && groupServices.map(renderRow)}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
