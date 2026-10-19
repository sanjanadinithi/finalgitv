import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  LayoutDashboard,
  Server,
  Layers,
  AlertTriangle,
  Zap,
  BookOpen,
  FileText,
  Settings as SettingsIcon,
  ChevronsLeft,
  ChevronsRight,
  Flame,
  ExternalLink,
  Sparkles,
  Lightbulb,
  ShieldCheck,
} from "lucide-react";

import DashboardHeader from "./components/DashboardHeader.jsx";
import DashboardFooter from "./components/DashboardFooter.jsx";
import MetricCard from "./components/MetricCard.jsx";
import DecisionHero from "./components/DecisionHero.jsx";
import CpuSpikeDecisionHelper from "./components/CpuSpikeDecisionHelper.jsx";
import DecisionAdvisorPanel from "./components/DecisionAdvisorPanel.jsx";
import RiskTable from "./components/RiskTable.jsx";
import RightRail from "./components/RightRail.jsx";
import DetailsDrawer from "./components/DetailsDrawer.jsx";
import WhatIfSimulatorModal from "./components/WhatIfSimulatorModal.jsx";
import CompareModal from "./components/CompareModal.jsx";
import CommandPalette from "./components/CommandPalette.jsx";
import KeyboardShortcutsModal from "./components/KeyboardShortcutsModal.jsx";
import ToastContainer from "./components/Toast.jsx";
import NotificationCenterModal from "./components/NotificationCenterModal.jsx";
import RejectMitigationModal from "./components/RejectMitigationModal.jsx";

import ReliabilityTab from "./components/ReliabilityTab.jsx";
import MupFeaturesTab from "./components/MupFeaturesTab.jsx";
import ServicesTab from "./components/ServicesTab.jsx";
import ExplainMitigationTab from "./components/ExplainMitigationTab.jsx";
import DataSourceStrip from "./components/DataSourceStrip.jsx";
import { SettingsPanel, RunbooksPage, ReportsPage } from "./components/UtilityPanels.jsx";

import {
  fetchDashboard,
  deriveStatus,
  STATUS_ENUM,
  getRecommendation,
  computeSummary,
  getFleetPulse,
  postApproval,
} from "./utils.js";
import "./index.css";

const NAV_ITEMS = [
  { id: "command", label: "Command Center", icon: LayoutDashboard },
  { id: "advisor", label: "Decision Advisor", icon: Sparkles },
  { id: "explain", label: "Explainability & Mitigation", icon: Lightbulb },
  { id: "services", label: "Services", icon: Server },
  { id: "settings", label: "Settings", icon: SettingsIcon },
];

const ANALYZER_ITEMS = [
  { id: "reliability", label: "Model Reliability", icon: ShieldCheck },
  { id: "cpupredict", label: "CPU Analyzer", icon: Zap },
  { id: "mup", label: "Memory Analyzer", icon: Layers },
];

export default function App() {
  const [navPage, setNavPage] = useState("command");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("sentinel_sidebar_collapsed") === "1"
  );

  useEffect(() => {
    localStorage.setItem("sentinel_sidebar_collapsed", sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  // Core telemetry state
  const [dashboard, setDashboard] = useState(null);
  const [loadError, setLoadError] = useState("");
  const inFlightRef = useRef(false);
  const [lastPollAt, setLastPollAt] = useState(() => Date.now());
  const [latencyMs, setLatencyMs] = useState(null);
  const [latencyHistory, setLatencyHistory] = useState([]);
  const [apiStatus, setApiStatus] = useState("ok");

  // Theme: dark-first NOC with localStorage persistence
  const [theme, setTheme] = useState(() => localStorage.getItem("sentinel_theme") || "dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("sentinel_theme", theme);
  }, [theme]);

  const toggleTheme = () => setTheme((prev) => (prev === "dark" ? "light" : "dark"));

  // Modals & Panels
  const [selectedService, setSelectedService] = useState(null);
  const [whatIfService, setWhatIfService] = useState(null);
  const [rejectingService, setRejectingService] = useState(null);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isShortcutsOpen, setIsShortcutsOpen] = useState(false);
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);

  // Filter & Selection State
  const [kpiFilter, setKpiFilter] = useState("all");
  const [selectedTableIds, setSelectedTableIds] = useState(new Set());
  const [timeRange, setTimeRange] = useState("realtime");

  // Toasts
  const [toasts, setToasts] = useState([]);

  const addToast = useCallback((title, message, type = "success", canUndo = false) => {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    setToasts((prev) => [...prev, { id, title, message, type, canUndo }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 5000);
  }, []);

  const dismissToast = (id) => setToasts((prev) => prev.filter((t) => t.id !== id));

  // Telemetry Ingestion Polling Loop (1s)
  const pollTelemetry = useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    const t0 = performance.now();
    try {
      const data = await fetchDashboard();
      const elapsed = performance.now() - t0;
      setLatencyMs(elapsed);
      setLatencyHistory((prev) => [...prev.slice(-19), elapsed]);
      setLastPollAt(Date.now());
      setApiStatus(elapsed > 800 ? "degraded" : "ok");

      if (data?.services && data?.policy) {
        data.services = data.services.map((svc) => ({
          ...svc,
          risk: deriveStatus(svc, data.policy),
        }));
      }

      setDashboard(data);
      setLoadError("");
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
      setApiStatus("down");
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  useEffect(() => {
    pollTelemetry();
    const interval = setInterval(pollTelemetry, 1000);
    return () => clearInterval(interval);
  }, [pollTelemetry]);

  const services = useMemo(() => dashboard?.services || [], [dashboard]);
  const projectsCount = useMemo(() => {
    return new Set(services.map((s) => s.project || "default")).size;
  }, [services]);

  // ONE engine for every count on the page (top bar, KPIs, heatmap, drawer).
  const summary = useMemo(() => computeSummary(services, dashboard?.policy), [services, dashboard]);

  // Real per-sample fleet pulse (services crossing each threshold over time).
  const pulse = useMemo(() => getFleetPulse(services, dashboard?.policy), [services, dashboard]);
  const cpuSpark = useMemo(() => pulse.map((p) => p.cpuCount), [pulse]);
  const memSpark = useMemo(() => pulse.map((p) => p.memCount), [pulse]);
  const riskSpark = useMemo(() => pulse.map((p) => Math.max(p.cpuCount, p.memCount)), [pulse]);
  const seriesDelta = (arr) => (arr && arr.length > 1 ? arr[arr.length - 1] - arr[0] : null);
  const toneFor = (d) => (d == null ? "neutral" : d > 0 ? "negative" : d < 0 ? "positive" : "neutral");
  const arrowFor = (d) => (d == null ? undefined : d > 0 ? `+${d}` : `${d}`);

  // ── Human decisions ────────────────────────────────────────────────
  const recordDecision = useCallback(
    async (svc, decision, reason = "", minutes) => {
      const rec = getRecommendation(svc);
      try {
        const res = await postApproval({
          service: svc.service,
          decision,
          reason,
          minutes,
          action: rec.actionTitle,
          risk: Math.max(Number(svc.cpu_probability || 0), Number(svc.memory_probability || 0)),
        });
        const executed = res?.approval?.executed;
        const labelMap = {
          approve: "Mitigation Executed",
          resolve: "Incident Solved",
          dismiss: "Alert Dismissed",
          reject: "Alert Dismissed (Rejected)",
          snooze: "Alert Snoozed",
          fail: "Failure Recorded",
        };
        const label = labelMap[decision] || decision;
        const msg = res?.approval?.note || (executed ? "Action executed successfully." : "Decision recorded.");
        const toastType = (decision === "approve" || decision === "resolve")
          ? "success"
          : decision === "fail"
            ? "critical"
            : "warning";
        addToast(`${label}: ${svc.service}`, msg, toastType, true);
        pollTelemetry();
      } catch (err) {
        addToast("Decision failed", err instanceof Error ? err.message : String(err), "warning");
      }
    },
    [addToast, pollTelemetry]
  );

  const handleApproveAction = useCallback(
    (svc, remainingSecs) => {
      const leadNote = remainingSecs
        ? `Solved before crash (${Math.floor(remainingSecs / 60)}m ${remainingSecs % 60}s advance lead time remaining)`
        : "Mitigation executed before crash";
      recordDecision(svc, "approve", leadNote);
    },
    [recordDecision]
  );

  const handleDismissAction = useCallback(
    (svc, reason) => recordDecision(svc, "dismiss", reason || "Dismissed from dashboard", 30),
    [recordDecision]
  );

  const handleFailAction = useCallback(
    (svc) => recordDecision(svc, "fail", "Advance warning lead time reached 0:00 without mitigation — service crashed", 30),
    [recordDecision]
  );

  const handleSnoozeAction = useCallback(
    (svc) => recordDecision(svc, "snooze", "Snoozed from console", 15),
    [recordDecision]
  );

  const handleConfirmReject = useCallback(
    (svc, reason) => {
      setRejectingService(null);
      recordDecision(svc, "reject", reason || "Rejected and dismissed from console", 30);
    },
    [recordDecision]
  );

  // Keyboard Shortcuts Listener
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;
      const key = e.key.toLowerCase();

      if ((e.metaKey || e.ctrlKey) && key === "k") {
        e.preventDefault();
        setIsCommandPaletteOpen((prev) => !prev);
      } else if (e.key === "/") {
        e.preventDefault();
        setIsCommandPaletteOpen(true);
      } else if (e.key === "?") {
        e.preventDefault();
        setIsShortcutsOpen((prev) => !prev);
      } else if (key === "w" && selectedService) {
        e.preventDefault();
        setWhatIfService(selectedService);
      } else if (key === "c") {
        e.preventDefault();
        setIsCompareOpen(true);
      } else if (key === "e") {
        e.preventDefault();
        setNavPage("reports");
      } else if (key === "s" && selectedService) {
        e.preventDefault();
        handleSnoozeAction(selectedService);
      } else if (key === "a" && selectedService) {
        e.preventDefault();
        handleApproveAction(selectedService);
      } else if (e.key === "Escape") {
        setSelectedService(null);
        setWhatIfService(null);
        setIsCompareOpen(false);
        setIsCommandPaletteOpen(false);
        setIsShortcutsOpen(false);
      } else if (key === "j" || key === "k") {
        const atRiskServices = services.filter((s) => s.risk !== STATUS_ENUM.HEALTHY);
        if (atRiskServices.length === 0) return;
        const currentIndex = atRiskServices.findIndex((s) => s.id === selectedService?.id);
        let nextIndex = 0;
        if (key === "j") nextIndex = currentIndex < atRiskServices.length - 1 ? currentIndex + 1 : 0;
        else nextIndex = currentIndex > 0 ? currentIndex - 1 : atRiskServices.length - 1;
        setSelectedService(atRiskServices[nextIndex]);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [services, selectedService, handleApproveAction, handleSnoozeAction]);

  // Multi-select helpers
  const handleToggleSelectId = (id) => {
    setSelectedTableIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSelectAll = () => {
    if (selectedTableIds.size === services.length) setSelectedTableIds(new Set());
    else setSelectedTableIds(new Set(services.map((s) => s.id)));
  };

  const badgeFor = (item) => {
    if (item.badge === "critical") return summary.critical;
    return 0;
  };

  return (
    <div className={`sentinel-layout ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
      {/* ── Sidebar: icons WITH labels, collapsible ── */}
      <aside className={`sentinel-sidebar ${sidebarCollapsed ? "collapsed" : ""}`}>
        <div className="sidebar-logo" title="Sentinel AIOps Command Center">
          ◤
        </div>

        <nav className="sidebar-nav" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const count = badgeFor(item);
            return (
              <button
                key={item.id}
                className={`nav-item ${navPage === item.id ? "active" : ""}`}
                onClick={() => setNavPage(item.id)}
                title={item.label}
                aria-current={navPage === item.id ? "page" : undefined}
              >
                <span className="nav-icon">
                  <Icon size={19} />
                  {count > 0 && <span className="nav-badge">{count}</span>}
                </span>
                {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />

        <div className="sidebar-footer">
          {ANALYZER_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={`nav-item ${navPage === item.id ? "active" : ""}`}
                onClick={() => setNavPage(item.id)}
                title={item.label}
                aria-current={navPage === item.id ? "page" : undefined}
              >
                <span className="nav-icon">
                  <Icon size={18} />
                </span>
                {!sidebarCollapsed && <span className="nav-label">{item.label}</span>}
              </button>
            );
          })}
          <a
            href="http://localhost:8081"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-item"
            title="Component 2: CPU Spike Analyzer Console"
          >
            <span className="nav-icon">
              <Flame size={18} />
            </span>
            {!sidebarCollapsed && <span className="nav-label">Analyzer console</span>}
          </a>
          <a
            href="http://localhost:8001"
            target="_blank"
            rel="noopener noreferrer"
            className="nav-item"
            title="Component 1: Ingestion API"
          >
            <span className="nav-icon">
              <ExternalLink size={18} />
            </span>
            {!sidebarCollapsed && <span className="nav-label">Ingestion API</span>}
          </a>
          <button
            className="nav-item"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <span className="nav-icon">
              {sidebarCollapsed ? <ChevronsRight size={18} /> : <ChevronsLeft size={18} />}
            </span>
            {!sidebarCollapsed && <span className="nav-label">Collapse</span>}
          </button>
        </div>
      </aside>

      {/* ── Main Command Console ── */}
      <div className="sentinel-main">
        <DashboardHeader
          critical={summary.critical}
          warning={summary.warning}
          lastUpdated={lastPollAt}
          live={!loadError}
          theme={theme}
          onToggleTheme={toggleTheme}
          notifications={summary.at_risk ?? (summary.critical + summary.warning)}
          onSearch={() => setIsCommandPaletteOpen(true)}
          onCompare={() => setIsCompareOpen(true)}
          onReports={() => setNavPage("reports")}
          onSettings={() => setNavPage("settings")}
          onNotifications={() => setIsNotificationCenterOpen(true)}
          onShortcuts={() => setIsShortcutsOpen(true)}
        />

        {loadError && (
          <div className="error-banner">
            <AlertTriangle size={14} />
            <span>
              {loadError.toLowerCase().includes("failed to fetch") || loadError.toLowerCase().includes("networkerror")
                ? "Gateway unreachable on port 8766 — showing last valid telemetry."
                : `Gateway error: ${loadError} — showing last valid telemetry.`}
            </span>
          </div>
        )}

        <div className="sentinel-content">
          {navPage === "command" && (
            <>
              <DataSourceStrip provenance={dashboard?.provenance} />
              <div className="kpi-strip">
                <MetricCard
                  label="Critical"
                  value={summary.critical}
                  trendDelta={arrowFor(seriesDelta(memSpark))}
                  trendType={toneFor(seriesDelta(memSpark))}
                  sparkValues={memSpark}
                  sparkColor="var(--critical)"
                  isSelected={kpiFilter === "critical"}
                  onClick={() => setKpiFilter("critical")}
                  tooltip="Services at or above the critical risk threshold"
                />

                <MetricCard
                  label="Warning"
                  value={summary.warning}
                  trendDelta={arrowFor(seriesDelta(cpuSpark))}
                  trendType={toneFor(seriesDelta(cpuSpark))}
                  sparkValues={cpuSpark}
                  sparkColor="var(--warning)"
                  isSelected={kpiFilter === "at_risk"}
                  onClick={() => setKpiFilter("at_risk")}
                  tooltip="Services past one alarm threshold"
                />

                <MetricCard
                  label="Need attention"
                  value={summary.needs_attention}
                  trendType="neutral"
                  isSelected={kpiFilter === "breaches"}
                  onClick={() => setKpiFilter("breaches")}
                  tooltip="All services requiring a decision (critical + warning)"
                />

                <MetricCard
                  label="Active mitigations"
                  value={summary.active_mitigations}
                  trendType="neutral"
                  tooltip="Services with an active mitigation state reported by the predictor"
                />

                <MetricCard
                  label="Alarm Lead Time (MTTA)"
                  value={summary.mean_mtta_minutes != null ? `~${summary.mean_mtta_minutes}m` : ""}
                  trendDelta={summary.anticipation_rate_pct != null ? `${summary.anticipation_rate_pct}% anticipated` : undefined}
                  trendType="positive"
                  sparkColor="var(--accent)"
                  onClick={() => setNavPage("reliability")}
                  tooltip="Mean Time To Anticipate (MTTA) — event-weighted average advance warning: total alarm-to-failure lead time divided by the number of failures anticipated (each service weighted by its own anticipated-failure count). The percentage is the share of observed failures caught ahead of time, not a lead time."
                />
              </div>

              <div className="console-split">
                <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                  <DecisionHero
                    services={services}
                    onSelectService={(svc) => setSelectedService(svc)}
                    onApproveAction={handleApproveAction}
                    onSnoozeAction={handleSnoozeAction}
                    onDismissAction={handleDismissAction}
                    onFailAction={handleFailAction}
                    onRejectModal={(svc) => setRejectingService(svc)}
                  />

                  <RiskTable
                    services={services}
                    selectedService={selectedService}
                    onSelectService={(svc) => setSelectedService(svc)}
                    searchQuery=""
                    selectedIds={selectedTableIds}
                    onToggleSelectId={handleToggleSelectId}
                    onSelectAll={handleSelectAll}
                    onApproveAction={handleApproveAction}
                    kpiFilter={kpiFilter}
                  />
                </div>

                <RightRail
                  dashboard={dashboard}
                  pulse={pulse}
                  onPolicyUpdated={pollTelemetry}
                  onSelectService={(svc) => setSelectedService(svc)}
                  onSelectServiceByName={(name) => {
                    const match = services.find((s) => s.service === name);
                    if (match) setSelectedService(match);
                  }}
                />
              </div>
            </>
          )}

          {navPage === "incidents" && (
            <RiskTable
              services={services}
              selectedService={selectedService}
              onSelectService={(svc) => setSelectedService(svc)}
              searchQuery=""
              selectedIds={selectedTableIds}
              onToggleSelectId={handleToggleSelectId}
              onSelectAll={handleSelectAll}
              onApproveAction={handleApproveAction}
              kpiFilter="all"
            />
          )}

          {navPage === "advisor" && (
            <DecisionAdvisorPanel
              services={services}
              selectedService={selectedService}
              onSelectService={(svc) => setSelectedService(svc)}
              provenance={dashboard?.provenance}
            />
          )}

          {navPage === "explain" && (
            <ExplainMitigationTab
              services={services}
              selectedService={selectedService}
              onSelectService={(svc) => setSelectedService(svc)}
              provenance={dashboard?.provenance}
            />
          )}

          {navPage === "cpupredict" && (
            <CpuSpikeDecisionHelper
              services={services}
              selectedService={selectedService}
              onSelectService={(svc) => setSelectedService(svc)}
              onExecuteTierAction={(svc, tier, shedRatio) =>
                recordDecision(
                  svc,
                  "approve",
                  `Tier ${tier} request (${tier === 1 ? `shed ${shedRatio}%` : tier === 2 ? "add capacity" : "restart"})`
                )
              }
            />
          )}

          {navPage === "services" && <ServicesTab />}

          {navPage === "mup" && (
            <MupFeaturesTab
              dashboard={dashboard}
              onSelectService={(svc) => setSelectedService(svc)}
            />
          )}

          {navPage === "reliability" && <ReliabilityTab reliability={dashboard?.reliability} provenance={dashboard?.provenance} />}

          {navPage === "runbooks" && (
            <RunbooksPage
              services={services}
              onSelectService={(svc) => setSelectedService(svc)}
            />
          )}

          {navPage === "reports" && <ReportsPage dashboard={dashboard} services={services} />}

          {navPage === "settings" && (
            <SettingsPanel
              dashboard={dashboard}
              onPolicyUpdated={pollTelemetry}
              theme={theme}
              onToggleTheme={toggleTheme}
            />
          )}
        </div>

        <DashboardFooter
          apiStatus={apiStatus}
          latencyMs={latencyMs}
          latencyHistory={latencyHistory}
          lastSync={lastPollAt}
          pollIntervalMs={1000}
          services={services.length}
          projects={projectsCount}
          cpuThreshold={dashboard?.policy?.cpu_threshold ?? 60}
          memThreshold={dashboard?.policy?.memory_threshold ?? 70}
          theme={theme}
          provenance={dashboard?.provenance}
          version="1.0.0"
          onShortcuts={() => setIsShortcutsOpen(true)}
        />
      </div>

      {selectedService && (
        <DetailsDrawer
          service={selectedService}
          policy={dashboard?.policy}
          onClose={() => setSelectedService(null)}
          onApproveAction={handleApproveAction}
          onSnoozeAction={handleSnoozeAction}
          onOpenSimulator={(svc) => setWhatIfService(svc)}
        />
      )}

      {whatIfService && (
        <WhatIfSimulatorModal
          service={whatIfService}
          onClose={() => setWhatIfService(null)}
          onApplyAction={(svc, shedRatio, restart) =>
            recordDecision(
              svc,
              "approve",
              `Simulated ${shedRatio}% load shed${restart ? " with pod restart" : ""}`
            )
          }
        />
      )}

      {isCompareOpen && (
        <CompareModal
          services={services}
          initialSelected={Array.from(selectedTableIds)}
          onClose={() => setIsCompareOpen(false)}
        />
      )}

      <CommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        services={services}
        onSelectService={(svc) => setSelectedService(svc)}
        onOpenPolicy={() => setNavPage("settings")}
        onOpenHandoff={() => setNavPage("reports")}
      />

      <KeyboardShortcutsModal isOpen={isShortcutsOpen} onClose={() => setIsShortcutsOpen(false)} />

      {rejectingService && (
        <RejectMitigationModal
          service={rejectingService}
          onClose={() => setRejectingService(null)}
          onConfirmReject={handleConfirmReject}
        />
      )}

      <NotificationCenterModal
        isOpen={isNotificationCenterOpen}
        onClose={() => setIsNotificationCenterOpen(false)}
        services={services}
        onSelectService={(svc) => setSelectedService(svc)}
        onMuteService={(svc, minutes) => recordDecision(svc, "snooze", "Muted from notification center", minutes)}
      />

      <ToastContainer
        toasts={toasts}
        onDismiss={dismissToast}
        onUndo={(id) => {
          dismissToast(id);
          addToast("Acknowledged", "The recorded decision stays in the audit log.", "success");
        }}
      />
    </div>
  );
}
