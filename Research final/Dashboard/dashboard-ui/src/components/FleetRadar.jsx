import { useEffect, useMemo, useRef, useState } from "react";

/**
 * FleetRadar — live radar replacement for the "Fleet map" grid.
 *
 * services: [{ id, name, project, status?, risk (0..1), cpu (0..100), mem (0..100), p_breach? }]
 *   status: "critical" | "warning" | "healthy" | "nodata"  (derived from risk if omitted)
 *
 * Distance from the centre is set by the selected mode (Risk / CPU / Memory):
 * high value = close to the centre. Dashed rings are the real alarm levels.
 */

const STATUS = {
  critical: { color: "#ef4444", label: "Critical" },
  warning: { color: "#f59e0b", label: "Warning" },
  healthy: { color: "#10b981", label: "Healthy" },
  nodata: { color: "#64748b", label: "No data" },
};
const MODES = [
  ["risk", "Risk"],
  ["cpu", "CPU"],
  ["memory", "Memory"],
];
const TAU = Math.PI * 2;

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function statusOf(s) {
  if (s.status) return s.status;
  if (s.risk == null) return "nodata";
  return s.risk >= 0.9 ? "critical" : s.risk >= 0.4 ? "warning" : "healthy";
}

function valueOf(s, mode) {
  if (statusOf(s) === "nodata") return null;
  const v = mode === "cpu" ? s.cpu : mode === "memory" ? s.mem : (s.risk ?? 0) * 100;
  return v == null ? null : Math.max(0, Math.min(100, v));
}

const radiusOf = (v, R, inner) => (v == null ? R : inner + (R - inner) * (1 - v / 100));

const THEMES = {
  dark: { grid: "rgba(148,163,184,0.20)", text: "#94a3b8", strong: "#e2e8f0", sweep: "16,185,129" },
  light: { grid: "rgba(51,65,85,0.22)", text: "#475569", strong: "#0f172a", sweep: "5,150,105" },
};

function normalizeService(s, policy) {
  const id = s.id || s.service || s.name || String(Math.random());
  const name = s.name || s.service || id;
  const project = s.project || "Ungrouped";

  let risk = s.risk;
  if (typeof risk === "string") {
    risk = risk === "CRITICAL" ? 0.95 : risk === "WARNING" ? 0.65 : 0.15;
  } else if (risk == null) {
    risk = Math.max(Number(s.cpu_probability || 0), Number(s.memory_probability || 0));
  }

  let status = s.status ? String(s.status).toLowerCase() : undefined;
  if (!status) {
    if (s.predicted_state) {
      status = /FAILED|CRITICAL/i.test(s.predicted_state)
        ? "critical"
        : /DANGEROUS|DEGRADED|QUEUE_BOUND|CPU_BOUND/i.test(s.predicted_state)
        ? "warning"
        : "healthy";
    } else if (risk != null) {
      status = risk >= 0.9 ? "critical" : risk >= 0.4 ? "warning" : "healthy";
    }
  }

  const cpu =
    s.cpu != null
      ? Number(s.cpu)
      : Number(s.cpu_percent != null ? s.cpu_percent : Number(s.cpu_probability || 0) * 100);

  const mem =
    s.mem != null
      ? Number(s.mem)
      : Number(
          s.ram_percent != null
            ? s.ram_percent
            : s.memory_percent != null
            ? s.memory_percent
            : Number(s.memory_probability || 0) * 100
        );

  const p_breach =
    s.p_breach ??
    (s.cpu_probability != null
      ? Math.max(Number(s.cpu_probability || 0), Number(s.memory_probability || 0))
      : undefined);

  return {
    ...s,
    id,
    name,
    project,
    status,
    risk,
    cpu,
    mem,
    p_breach,
  };
}

export default function FleetRadar({
  services: rawServices = [],
  policy,
  defaultMode = "risk",
  cpuThreshold,
  memThreshold,
  theme,
  height = 360,
  onSelect,
  onSelectService,
  compact = false,
}) {
  const [mode, setMode] = useState(defaultMode);
  const [atRiskOnly, setAtRiskOnly] = useState(false);
  const [hover, setHover] = useState(null);

  const resolvedCpuThresh =
    cpuThreshold != null
      ? cpuThreshold > 1
        ? cpuThreshold
        : Math.round(cpuThreshold * 100)
      : policy?.cpu_threshold != null
      ? Math.round(Number(policy.cpu_threshold) * 100)
      : 60;

  const resolvedMemThresh =
    memThreshold != null
      ? memThreshold > 1
        ? memThreshold
        : Math.round(memThreshold * 100)
      : policy?.memory_threshold != null
      ? Math.round(Number(policy.memory_threshold) * 100)
      : 70;

  const effectiveTheme =
    theme ||
    (typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark");

  const services = useMemo(
    () => (rawServices || []).map((s) => normalizeService(s, policy)),
    [rawServices, policy]
  );

  const canvasRef = useRef(null);
  const dotsRef = useRef(new Map()); // id -> { a, r } animated polar position
  const hitRef = useRef([]); // screen positions for hit-testing
  const hoverIdRef = useRef(null);
  const live = useRef({});
  live.current = {
    services,
    mode,
    atRiskOnly,
    cpuThreshold: resolvedCpuThresh,
    memThreshold: resolvedMemThresh,
    theme: effectiveTheme,
    hoverId: hover?.s.id,
  };

  const counts = useMemo(() => {
    const c = { critical: 0, warning: 0, healthy: 0, nodata: 0 };
    services.forEach((s) => (c[statusOf(s)] += 1));
    return c;
  }, [services]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let last = performance.now();
    let sweep = -Math.PI / 2;
    let w = 0;
    let h = 0;

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);

    const frame = (now) => {
      const dt = Math.min(64, now - last);
      last = now;
      const P = live.current;
      const reduced = reducedMotion();
      const T = THEMES[P.theme] || THEMES.dark;

      const cx = w / 2;
      const cy = h / 2;
      const R = Math.max(40, Math.min(w, h) / 2 - 26);
      const inner = R * 0.2;

      ctx.clearRect(0, 0, w, h);

      // ---- layout: one sector per project ----
      const list = P.services.filter(
        (s) => !P.atRiskOnly || ["critical", "warning"].includes(statusOf(s))
      );
      const projects = [...new Set(list.map((s) => s.project ?? "—"))].sort();
      const sector = TAU / Math.max(1, projects.length);
      const targets = new Map();
      projects.forEach((p, pi) => {
        const group = list
          .filter((s) => (s.project ?? "—") === p)
          .sort((a, b) => (valueOf(b, P.mode) ?? -1) - (valueOf(a, P.mode) ?? -1));
        const pad = Math.min(0.14, sector * 0.12);
        group.forEach((s, i) => {
          const a =
            -Math.PI / 2 + pi * sector + pad + ((i + 0.5) / group.length) * (sector - 2 * pad);
          targets.set(s.id, { a, r: radiusOf(valueOf(s, P.mode), R, inner), s });
        });
      });
      for (const id of dotsRef.current.keys()) if (!targets.has(id)) dotsRef.current.delete(id);

      // ---- rings (real alarm levels) ----
      const thr = P.mode === "cpu" ? P.cpuThreshold : P.mode === "memory" ? P.memThreshold : null;
      const levels = [...new Set([90, thr, 40].filter((v) => v != null))];
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.textAlign = "left";
      levels.forEach((v) => {
        const r = radiusOf(v, R, inner);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.setLineDash([4, 5]);
        ctx.strokeStyle = T.grid;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = T.text;
        ctx.fillText(`${v}%`, cx + 4, cy - r - 3);
      });
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, TAU);
      ctx.strokeStyle = T.grid;
      ctx.stroke();

      // ---- sector dividers + project labels ----
      if (projects.length > 1) {
        projects.forEach((p, pi) => {
          const a0 = -Math.PI / 2 + pi * sector;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a0) * inner, cy + Math.sin(a0) * inner);
          ctx.lineTo(cx + Math.cos(a0) * R, cy + Math.sin(a0) * R);
          ctx.strokeStyle = T.grid;
          ctx.stroke();
          const am = a0 + sector / 2;
          ctx.fillStyle = T.strong;
          ctx.font = "600 11px Inter, system-ui, sans-serif";
          ctx.textAlign = Math.cos(am) > 0.2 ? "left" : Math.cos(am) < -0.2 ? "right" : "center";
          ctx.fillText(p, cx + Math.cos(am) * (R + 10), cy + Math.sin(am) * (R + 14));
        });
      }

      // ---- sweep ----
      if (!reduced) {
        sweep = (sweep + (dt / 9000) * TAU) % TAU;
        const slices = 28;
        for (let i = 0; i < slices; i++) {
          const a1 = sweep - i * 0.035;
          ctx.beginPath();
          ctx.moveTo(cx, cy);
          ctx.arc(cx, cy, R, a1 - 0.035, a1);
          ctx.closePath();
          ctx.fillStyle = `rgba(${T.sweep},${0.17 * (1 - i / slices)})`;
          ctx.fill();
        }
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + Math.cos(sweep) * R, cy + Math.sin(sweep) * R);
        ctx.strokeStyle = `rgba(${T.sweep},0.55)`;
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      // ---- dots (glide to targets) ----
      const k = reduced ? 1 : 1 - Math.exp(-dt / 220);
      const hits = [];
      const order = [...targets.entries()].sort(
        (x, y) =>
          ["nodata", "healthy", "warning", "critical"].indexOf(statusOf(x[1].s)) -
          ["nodata", "healthy", "warning", "critical"].indexOf(statusOf(y[1].s))
      );
      order.forEach(([id, t]) => {
        let d = dotsRef.current.get(id);
        if (!d) {
          d = { a: t.a, r: reduced ? t.r : R };
          dotsRef.current.set(id, d);
        }
        d.a += (t.a - d.a) * k;
        d.r += (t.r - d.r) * k;
        const x = cx + Math.cos(d.a) * d.r;
        const y = cy + Math.sin(d.a) * d.r;
        const st = statusOf(t.s);
        const color = STATUS[st].color;
        const isHover = P.hoverId === id;
        hits.push({ s: t.s, x, y });

        if (st === "critical" && !reduced) {
          const ph = ((now + ((id.length || 1) * 137) % 900) % 1100) / 1100;
          ctx.beginPath();
          ctx.arc(x, y, 6 + ph * 14, 0, TAU);
          ctx.strokeStyle = color;
          ctx.globalAlpha = 0.55 * (1 - ph);
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.beginPath();
        ctx.arc(x, y, (st === "critical" ? 6 : 5) + (isHover ? 2 : 0), 0, TAU);
        ctx.fillStyle = color;
        ctx.globalAlpha = st === "healthy" || st === "nodata" ? 0.85 : 1;
        if (st === "critical") {
          ctx.shadowColor = color;
          ctx.shadowBlur = 12;
        }
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.globalAlpha = 1;
        if (isHover) {
          ctx.strokeStyle = T.strong;
          ctx.lineWidth = 1.5;
          ctx.stroke();
        }
      });
      hitRef.current = hits;

      // ---- centre readout ----
      const atRisk = P.services.filter((s) => ["critical", "warning"].includes(statusOf(s))).length;
      ctx.textAlign = "center";
      ctx.fillStyle = T.strong;
      ctx.font = "700 22px Inter, system-ui, sans-serif";
      ctx.fillText(String(atRisk), cx, cy + 4);
      ctx.fillStyle = T.text;
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.fillText("at risk", cx, cy + 18);

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  const onMove = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    let best = null;
    let bd = 14;
    hitRef.current.forEach((p) => {
      const d = Math.hypot(p.x - mx, p.y - my);
      if (d < bd) {
        bd = d;
        best = p;
      }
    });
    const id = best ? best.s.id : null;
    if (id !== hoverIdRef.current) {
      hoverIdRef.current = id;
      setHover(best ? { s: best.s, x: best.x, y: best.y } : null);
    }
  };

  const handleSelect = onSelect || onSelectService;
  const c = THEMES[effectiveTheme] || THEMES.dark;
  const dark = effectiveTheme === "dark";
  const chip = (active) => ({
    padding: "4px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 600,
    cursor: "pointer",
    border: `1px solid ${active ? "#3b82f6" : c.grid}`,
    background: active ? "rgba(59,130,246,0.15)" : "transparent",
    color: active ? "#3b82f6" : c.text,
  });
  const badge = (color) => ({
    padding: "3px 10px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    color,
    border: `1px solid ${color}55`,
    background: `${color}1f`,
  });

  return (
    <div
      style={{
        background: dark ? "#0b1220" : "#ffffff",
        border: `1px solid ${c.grid}`,
        borderRadius: 14,
        padding: compact ? "12px 14px" : 16,
        color: c.strong,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 14 }}>Fleet map</strong>
        <span style={{ color: c.text, fontSize: 11 }}>{services.length} services</span>
      </div>

      <div style={{ display: "flex", gap: 6, margin: "10px 0", flexWrap: "wrap", alignItems: "center" }}>
        {MODES.map(([key, label]) => (
          <button key={key} style={chip(mode === key)} onClick={() => setMode(key)}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height, display: "block", cursor: hover ? "pointer" : "default" }}
          onPointerMove={onMove}
          onPointerLeave={() => {
            hoverIdRef.current = null;
            setHover(null);
          }}
          onClick={() => hover && handleSelect && handleSelect(hover.s)}
        />
        {hover && (
          <div
            style={{
              position: "absolute",
              left: hover.x + 14,
              top: hover.y - 10,
              pointerEvents: "none",
              background: dark ? "#111b2e" : "#fff",
              border: `1px solid ${c.grid}`,
              borderRadius: 8,
              padding: "8px 10px",
              fontSize: 12,
              minWidth: 150,
              boxShadow: "0 6px 20px rgba(0,0,0,.35)",
              zIndex: 2,
            }}
          >
            <div style={{ fontWeight: 700 }}>{hover.s.name}</div>
            <div style={{ color: STATUS[statusOf(hover.s)].color, fontWeight: 600 }}>
              {STATUS[statusOf(hover.s)].label}
              <span style={{ color: c.text, fontWeight: 400 }}> · {hover.s.project}</span>
            </div>
            <div style={{ color: c.text, marginTop: 4 }}>
              Risk {Math.round((hover.s.risk ?? 0) * 100)}% · CPU {Math.round(hover.s.cpu ?? 0)}% · Mem{" "}
              {Math.round(hover.s.mem ?? 0)}%
            </div>
            {hover.s.p_breach != null && (
              <div style={{ color: c.text }}>Breach probability {Math.round(hover.s.p_breach * 100)}%</div>
            )}
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, fontSize: 11, color: c.text, marginTop: 6, flexWrap: "wrap" }}>
        {Object.entries(STATUS).map(([k, v]) => (
          <span key={k} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <i style={{ width: 8, height: 8, borderRadius: 2, background: v.color, display: "inline-block" }} />
            {v.label}
          </span>
        ))}
        <span style={{ marginLeft: "auto" }}>{MODES.find((m) => m[0] === mode)[1]}</span>
      </div>
    </div>
  );
}
