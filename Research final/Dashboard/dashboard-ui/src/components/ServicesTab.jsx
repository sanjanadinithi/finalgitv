import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Server,
  Plus,
  RefreshCw,
  Power,
  Edit3,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Globe,
  Radio,
  ExternalLink,
  ShieldCheck,
  Search,
} from "lucide-react";
import StatusBadge from "./StatusBadge.jsx";

/* JSON helpers that never throw on a non-JSON body. */
async function sendJSON(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON response */
  }
  return { ok: res.ok, status: res.status, data };
}

function ResultPill({ ok }) {
  return ok ? (
    <span className="status-badge healthy">
      <CheckCircle2 size={12} /> OK
    </span>
  ) : (
    <span className="status-badge critical">
      <AlertCircle size={12} /> Failed
    </span>
  );
}

function detailText(r, okText) {
  if (!r) return "—";
  const d = r.detail;
  const err = typeof d === "string" ? d : d?.error || d?.detail || d?.raw;
  if (err) return err;
  if (r.ok) return r.verified === false ? `${okText} · not live-verified` : okText;
  return d?.message || "No response";
}

export default function ServicesTab() {
  const [baseUrl, setBaseUrl] = useState("");
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState("azure");
  const [enabled, setEnabled] = useState(true);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [lists, setLists] = useState({ c2: [], c1: [] });
  const [refreshing, setRefreshing] = useState(false);
  const [rowNote, setRowNote] = useState(null);
  const [filterSearch, setFilterSearch] = useState("");

  const loadLists = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch("/api/services", { cache: "no-store" });
      if (res.ok) setLists(await res.json());
    } catch {
      /* keep last known lists */
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    loadLists();
  }, [loadLists]);

  const c2ByName = useMemo(() => {
    const m = new Map();
    (lists.c2 || []).forEach((s) => {
      if (s?.name) m.set(s.name, s);
    });
    return m;
  }, [lists.c2]);
  const c1Names = useMemo(() => new Set((lists.c1 || []).map((s) => s.name)), [lists.c1]);

  const probe = async () => {
    if (!baseUrl.trim()) {
      setCheck({ tone: "err", text: "Please enter a service base URL first." });
      return;
    }
    setCheck({ text: "Probing endpoint health & metrics…" });
    const r = await sendJSON("POST", "/api/services/check", {
      base_url: baseUrl.trim(),
      name: name.trim(),
    });
    const d = r.data || {};
    if (d.valid) {
      if (!name.trim() && d.suggested_name) setName(d.suggested_name);
      if (d.suggested_platform) setPlatform(d.suggested_platform);
      setCheck({ tone: "ok", text: `Endpoint verified · Status ${d.status} — ${d.detail}` });
    } else {
      setCheck({ tone: "err", text: d.detail || "Unable to reach service sidecar." });
    }
  };

  const addService = async (ev) => {
    ev.preventDefault();
    if (!baseUrl.trim()) {
      setCheck({ tone: "err", text: "Please enter a service base URL." });
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const r = await sendJSON("POST", "/api/services", {
        name: name.trim() || undefined,
        base_url: baseUrl.trim(),
        platform,
        enabled,
      });
      setResult(r.data);
      await loadLists();
    } catch (e) {
      setResult({ error: e.message });
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setBaseUrl("");
    setName("");
    setPlatform("azure");
    setEnabled(true);
    setCheck(null);
    setResult(null);
  };

  const toggleService = async (svc, kind) => {
    const body =
      kind === "c2"
        ? { c2_id: svc.id, c1_name: c1Names.has(svc.name) ? svc.name : undefined, enabled: !svc.enabled }
        : { c1_name: svc.name, c2_id: c2ByName.get(svc.name)?.id, enabled: !svc.enabled };
    setRowNote(`Updating ${svc.name}…`);
    const r = await sendJSON("PUT", "/api/services", body);
    setRowNote(`${svc.name} ${svc.enabled ? "disabled" : "enabled"} · ${r.ok ? "Success" : "Partial update"}`);
    await loadLists();
  };

  const editService = async (svc, kind) => {
    const next = window.prompt(`New base URL for ${svc.name}:`, svc.base_url || "");
    if (next === null) return;
    const body =
      kind === "c2"
        ? { c2_id: svc.id, c1_name: c1Names.has(svc.name) ? svc.name : undefined, base_url: next.trim() }
        : { c1_name: svc.name, c2_id: c2ByName.get(svc.name)?.id, base_url: next.trim() };
    setRowNote(`Updating ${svc.name} URL…`);
    const r = await sendJSON("PUT", "/api/services", body);
    const snap = r.data?.results || {};
    const failed = Object.entries(snap)
      .filter(([, v]) => !v.ok)
      .map(([k, v]) => `${k}: ${v.detail?.error || "failed"}`)
      .join("; ");
    setRowNote(`${svc.name} URL updated · ${r.ok ? "Success" : failed || "Partial"}`);
    await loadLists();
  };

  const deleteService = async (svc, kind) => {
    if (!window.confirm(`Delete ${svc.name}? Telemetry ingestion will cease within ~10 seconds.`)) return;
    const body =
      kind === "c2"
        ? { c2_id: svc.id, c1_name: c1Names.has(svc.name) ? svc.name : undefined }
        : { c1_name: svc.name, c2_id: c2ByName.get(svc.name)?.id };
    setRowNote(`Deleting ${svc.name}…`);
    const r = await sendJSON("DELETE", "/api/services", body);
    setRowNote(`${svc.name} deleted · ${r.ok ? "Success" : "Partial"}`);
    await loadLists();
  };

  const results = result && result.results;

  const actions = (svc, kind) => (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <button
        className="btn-secondary"
        style={{ padding: "4px 8px", fontSize: "13px", gap: "4px" }}
        title={svc.enabled ? "Disable monitoring" : "Enable monitoring"}
        onClick={() => toggleService(svc, kind)}
      >
        <Power size={12} color={svc.enabled !== false ? "var(--healthy)" : "var(--text-muted)"} />
        {svc.enabled !== false ? "Disable" : "Enable"}
      </button>
      <button
        className="btn-secondary"
        style={{ padding: "4px 8px", fontSize: "13px", gap: "4px" }}
        title="Edit endpoint URL"
        onClick={() => editService(svc, kind)}
      >
        <Edit3 size={12} />
        Edit
      </button>
      <button
        className="btn-secondary"
        style={{ padding: "4px 8px", fontSize: "13px", gap: "4px", color: "var(--critical)" }}
        title="Delete service registration"
        onClick={() => deleteService(svc, kind)}
      >
        <Trash2 size={12} />
      </button>
    </div>
  );

  const c2Services = (lists.c2 || []).filter((s) =>
    filterSearch ? s.name.toLowerCase().includes(filterSearch.toLowerCase()) || s.base_url?.toLowerCase().includes(filterSearch.toLowerCase()) : true
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "12px" }}>
        <div>
          <h1 style={{ fontSize: "18px", fontWeight: 800, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: "8px" }}>
            <Server size={20} color="var(--accent)" />
            Microservices Registry & Telemetry Feed
          </h1>
          <p style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
            Register endpoints once — live syncs to Component 1 (Memory Engine) and Component 2 (CPU Spike Analyzer).
          </p>
        </div>
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button className="btn-secondary" onClick={loadLists} disabled={refreshing}>
            <RefreshCw size={14} className={refreshing ? "spin-pulse" : ""} />
            {refreshing ? "Syncing Fleet…" : "Refresh Fleet"}
          </button>
        </div>
      </div>

      {/* Row note message */}
      {rowNote && (
        <div
          style={{
            background: "var(--bg-surface-elevated)",
            border: "1px solid var(--accent-border)",
            color: "var(--accent-text)",
            padding: "8px 14px",
            borderRadius: "var(--radius-md)",
            fontSize: "13px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}
        >
          <Radio size={14} />
          {rowNote}
        </div>
      )}

      {/* Register new service form */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: "18px 20px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "14px" }}>
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "var(--radius-md)",
              background: "var(--accent-bg)",
              border: "1px solid var(--accent-border)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--accent)",
            }}
          >
            <Plus size={18} />
          </div>
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
              Register & Probe New Service Endpoint
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              Probed live via HTTP healthcheck before propagation to dual prediction engines.
            </div>
          </div>
        </div>

        <form onSubmit={addService} onReset={reset} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: "12px" }}>
            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>
                Service Base URL *
              </label>
              <input
                type="url"
                required
                placeholder="https://my-service.onrender.com or http://10.0.0.12:8080"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setCheck(null);
                }}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "13px",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>
                Service Name (Auto-detected if blank)
              </label>
              <input
                type="text"
                placeholder="e.g. auth-gateway-prod"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "13px",
                }}
              />
            </div>

            <div>
              <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>
                Target Cloud Platform
              </label>
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value)}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  background: "var(--bg-input)",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md)",
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                <option value="azure">Azure Cloud</option>
                <option value="render">Render Cloud</option>
                <option value="oracle">Oracle Cloud</option>
                <option value="railway">Railway</option>
                <option value="aws">AWS EC2/EKS</option>
                <option value="other">On-Prem / Other</option>
              </select>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px", marginTop: "4px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", color: "var(--text-secondary)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                style={{ accentColor: "var(--accent)" }}
              />
              Enable telemetry collection immediately upon save
            </label>

            <div style={{ display: "flex", gap: "8px" }}>
              <button type="button" className="btn-secondary" onClick={probe}>
                <Radio size={13} />
                Live Probe Link
              </button>
              <button type="submit" className="btn-primary" disabled={busy}>
                <Plus size={14} />
                {busy ? "Registering…" : "Register Service"}
              </button>
              <button type="reset" className="btn-secondary">
                Clear
              </button>
            </div>
          </div>
        </form>

        {/* Live probe alert banner */}
        {check && (
          <div
            style={{
              marginTop: "12px",
              padding: "10px 14px",
              borderRadius: "var(--radius-md)",
              fontSize: "13px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              background: check.tone === "ok" ? "var(--healthy-bg)" : check.tone === "err" ? "var(--critical-bg)" : "var(--warning-bg)",
              border: `1px solid ${
                check.tone === "ok" ? "var(--healthy-border)" : check.tone === "err" ? "var(--critical-border)" : "var(--warning-border)"
              }`,
              color: check.tone === "ok" ? "var(--healthy-text)" : check.tone === "err" ? "var(--critical-text)" : "var(--warning-text)",
            }}
          >
            {check.tone === "ok" ? <CheckCircle2 size={15} /> : <AlertCircle size={15} />}
            <span>{check.text}</span>
          </div>
        )}

        {/* Result summary */}
        {result && (
          <div style={{ marginTop: "14px" }}>
            {result.error ? (
              <div
                style={{
                  background: "var(--critical-bg)",
                  border: "1px solid var(--critical-border)",
                  color: "var(--critical-text)",
                  padding: "10px 14px",
                  borderRadius: "var(--radius-md)",
                  fontSize: "13px",
                }}
              >
                {result.error}
              </div>
            ) : (
              <div style={{ background: "var(--bg-surface-elevated)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)", padding: "12px" }}>
                <div style={{ fontSize: "13px", fontWeight: 700, marginBottom: "8px", color: "var(--text-primary)" }}>
                  Registration Results for <span className="font-mono">{result.name}</span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                  {["c2", "c1"].map((k) => {
                    const r = (results && results[k]) || {};
                    return (
                      <div
                        key={k}
                        style={{
                          background: "var(--bg-input)",
                          padding: "10px 12px",
                          borderRadius: "var(--radius-sm)",
                          border: "1px solid var(--border-subtle)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                        }}
                      >
                        <div>
                          <div style={{ fontSize: "13px", fontWeight: 700 }}>
                            {k === "c2" ? "Component 2 (CPU Spike Engine)" : "Component 1 (Memory Engine)"}
                          </div>
                          <div style={{ fontSize: "13px", color: "var(--text-secondary)", marginTop: "2px" }}>
                            {detailText(r, "Synced & Active")}
                          </div>
                        </div>
                        <ResultPill ok={r.ok} />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Registered Services Table */}
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "10px",
          }}
        >
          <div>
            <div style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
              Fleet Registered Microservices ({(lists.c2 || []).length} Total)
            </div>
            <div style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
              Active instances sending metric telemetry into the streaming ingest pipeline.
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                background: "var(--bg-input)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md)",
                padding: "4px 10px",
              }}
            >
              <Search size={14} color="var(--text-muted)" />
              <input
                type="text"
                placeholder="Filter services by name or URL…"
                value={filterSearch}
                onChange={(e) => setFilterSearch(e.target.value)}
                style={{ background: "transparent", border: "none", fontSize: "13px", color: "var(--text-primary)", outline: "none", width: "200px" }}
              />
            </div>
          </div>
        </div>

        <div style={{ overflowX: "auto" }}>
          <table className="dense-table">
            <thead>
              <tr>
                <th>Service Name</th>
                <th>Cloud Platform</th>
                <th>Sidecar Base URL</th>
                <th>Ingestion State</th>
                <th>Live Status</th>
                <th style={{ textAlign: "right" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {c2Services.length ? (
                c2Services.map((s) => (
                  <tr key={s.id || s.name}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <div style={{ width: "8px", height: "8px", borderRadius: "50%", background: s.enabled !== false ? "var(--healthy)" : "var(--text-muted)" }} />
                        <span style={{ fontWeight: 700 }}>{s.name}</span>
                      </div>
                    </td>
                    <td>
                      <span className="status-badge" style={{ background: "var(--bg-surface-elevated)", border: "1px solid var(--border-subtle)", color: "var(--text-secondary)" }}>
                        {s.platform || "azure"}
                      </span>
                    </td>
                    <td>
                      <span className="font-mono" style={{ fontSize: "13px", color: "var(--accent-text)" }}>
                        {s.base_url}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge ${s.enabled !== false ? "healthy" : "warning"}`}>
                        {s.enabled !== false ? "Monitored" : "Paused"}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: "13px", color: "var(--text-secondary)" }}>
                        {s.status || "Healthy (OK)"}
                      </span>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {actions(s, "c2")}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="6" style={{ textAlign: "center", padding: "30px", color: "var(--text-muted)" }}>
                    No services found matching search query.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
