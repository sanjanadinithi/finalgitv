import { useEffect, useRef, useState } from "react";

/**
 * FleetPulse — smooth live area chart of threshold crossings.
 *
 * Pass the CURRENT counts on every /api/dashboard poll:
 *   <FleetPulse
 *     cpuCount={services.filter(s => s.cpu >= policy.cpu_threshold).length}
 *     memCount={services.filter(s => s.mem >= policy.memory_threshold).length}
 *     cpuThreshold={policy.cpu_threshold}
 *     memThreshold={policy.memory_threshold} />
 *
 * A sample is stored every `intervalMs` (3 s), the chart scrolls continuously,
 * the y-axis auto-scales and the latest point pulses.
 */

const CPU = "#f59e0b";
const MEM = "#3b82f6";
const THEMES = {
  dark: { grid: "rgba(148,163,184,0.16)", text: "#94a3b8", strong: "#e2e8f0", bg: "#0b1220", tip: "#111b2e" },
  light: { grid: "rgba(51,65,85,0.16)", text: "#475569", strong: "#0f172a", bg: "#ffffff", tip: "#ffffff" },
};
const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export default function FleetPulse({
  cpuCount,
  memCount,
  pulse,
  policy,
  services,
  cpuThreshold,
  memThreshold,
  intervalMs = 3000,
  maxPoints = 40,
  theme,
  height = 150,
  compact = false,
}) {
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

  const effectiveCpuCount =
    cpuCount != null
      ? cpuCount
      : Array.isArray(pulse) && pulse.length > 0
      ? pulse[pulse.length - 1]?.cpuCount ?? 0
      : Array.isArray(services)
      ? services.filter(
          (s) =>
            Number(s.cpu != null ? s.cpu : s.cpu_percent != null ? s.cpu_percent : (s.cpu_probability || 0) * 100) >=
            resolvedCpuThresh
        ).length
      : 0;

  const effectiveMemCount =
    memCount != null
      ? memCount
      : Array.isArray(pulse) && pulse.length > 0
      ? pulse[pulse.length - 1]?.memCount ?? 0
      : Array.isArray(services)
      ? services.filter(
          (s) =>
            Number(
              s.mem != null
                ? s.mem
                : s.ram_percent != null
                ? s.ram_percent
                : s.memory_percent != null
                ? s.memory_percent
                : (s.memory_probability || 0) * 100
            ) >= resolvedMemThresh
        ).length
      : 0;

  const effectiveTheme =
    theme ||
    (typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-theme") === "light"
      ? "light"
      : "dark");

  const canvasRef = useRef(null);
  const pointsRef = useRef([]);
  const latest = useRef({ cpu: effectiveCpuCount, mem: effectiveMemCount });
  const hoverRef = useRef(null);
  const live = useRef({});
  const [stats, setStats] = useState({
    cpu: effectiveCpuCount,
    mem: effectiveMemCount,
    dCpu: 0,
    dMem: 0,
    peak: Math.max(effectiveCpuCount, effectiveMemCount),
  });
  const [tip, setTip] = useState(null);

  latest.current = { cpu: effectiveCpuCount, mem: effectiveMemCount };
  live.current = { theme: effectiveTheme, intervalMs, maxPoints };

  // ---- sample every intervalMs ----
  useEffect(() => {
    const push = () => {
      const pts = pointsRef.current;
      const prev = pts[pts.length - 1];
      const p = { t: performance.now(), ...latest.current };
      pts.push(p);
      const keep = maxPoints + 3;
      if (pts.length > keep) pts.splice(0, pts.length - keep);
      setStats({
        cpu: p.cpu,
        mem: p.mem,
        dCpu: prev ? p.cpu - prev.cpu : 0,
        dMem: prev ? p.mem - prev.mem : 0,
        peak: Math.max(...pts.map((q) => Math.max(q.cpu, q.mem))),
      });
    };
    push();
    const id = setInterval(push, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs, maxPoints]);

  // ---- draw loop ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let raf;
    let w = 0;
    let h = 0;
    let ymax = 4;
    let lastT = performance.now();

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

    const layout = () => {
      const padL = 26,
        padR = 10,
        padT = 8,
        padB = 6;
      return { padL, padR, padT, padB, pw: w - padL - padR, ph: h - padT - padB };
    };

    const smoothPath = (pts) => {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i - 1] || pts[i];
        const p1 = pts[i];
        const p2 = pts[i + 1];
        const p3 = pts[i + 2] || p2;
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = Math.min(p1.y + (p2.y - p0.y) / 6, layout().padT + layout().ph);
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = Math.min(p2.y - (p3.y - p1.y) / 6, layout().padT + layout().ph);
        ctx.bezierCurveTo(c1x, c1y, c2x, c2y, p2.x, p2.y);
      }
    };

    const frame = (now) => {
      const dt = Math.min(64, now - lastT);
      lastT = now;
      const { theme: th, intervalMs: iv, maxPoints: mp } = live.current;
      const T = THEMES[th] || THEMES.dark;
      const reduced = reducedMotion();
      const L = layout();
      const windowMs = mp * iv;
      ctx.clearRect(0, 0, w, h);

      const real = pointsRef.current;
      const xOf = (t) => L.padL + L.pw - ((now - t) / windowMs) * L.pw;

      // visible points + the one just off the left edge, plus a virtual "now" point
      const vis = real.filter((p) => now - p.t <= windowMs + iv);
      const maxVal = vis.reduce((m, p) => Math.max(m, p.cpu, p.mem), 0);
      const target = Math.max(4, Math.ceil(maxVal * 1.25));
      ymax += (target - ymax) * (reduced ? 1 : 1 - Math.exp(-dt / 250));
      const yOf = (v) => L.padT + (1 - v / ymax) * L.ph;

      // grid + y labels
      ctx.font = "10px Inter, system-ui, sans-serif";
      ctx.textAlign = "right";
      ctx.lineWidth = 1;
      [0, 0.5, 1].forEach((f) => {
        const v = f * ymax;
        const y = yOf(v);
        ctx.beginPath();
        ctx.moveTo(L.padL, y);
        ctx.lineTo(w - L.padR, y);
        ctx.strokeStyle = T.grid;
        ctx.stroke();
        ctx.fillStyle = T.text;
        ctx.fillText(String(Math.round(v)), L.padL - 6, y + 3);
      });

      if (vis.length) {
        const lastP = vis[vis.length - 1];
        const series = (key) => [
          ...vis.map((p) => ({ x: xOf(p.t), y: yOf(p[key]) })),
          { x: L.padL + L.pw, y: yOf(lastP[key]) },
        ];

        ctx.save();
        ctx.beginPath();
        ctx.rect(L.padL, 0, L.pw + 4, h);
        ctx.clip();

        [
          ["mem", MEM],
          ["cpu", CPU],
        ].forEach(([key, color]) => {
          const pts = series(key);
          if (pts.length < 2) return;
          const base = L.padT + L.ph;
          const g = ctx.createLinearGradient(0, L.padT, 0, base);
          g.addColorStop(0, color + "66");
          g.addColorStop(1, color + "00");
          ctx.beginPath();
          smoothPath(pts);
          ctx.lineTo(pts[pts.length - 1].x, base);
          ctx.lineTo(pts[0].x, base);
          ctx.closePath();
          ctx.fillStyle = g;
          ctx.fill();
          ctx.beginPath();
          smoothPath(pts);
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.lineJoin = "round";
          ctx.stroke();
        });
        ctx.restore();

        // pulsing latest point
        const ex = L.padL + L.pw;
        [
          ["mem", MEM],
          ["cpu", CPU],
        ].forEach(([key, color]) => {
          const y = yOf(lastP[key]);
          if (!reduced) {
            const ph = (now % 1500) / 1500;
            ctx.beginPath();
            ctx.arc(ex, y, 4 + ph * 9, 0, Math.PI * 2);
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.6 * (1 - ph);
            ctx.lineWidth = 1.5;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
          ctx.beginPath();
          ctx.arc(ex, y, 3.5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        });

        // hover crosshair
        const hv = hoverRef.current;
        if (hv) {
          const p = real.find((q) => q.t === hv.t);
          if (p) {
            const x = xOf(p.t);
            ctx.beginPath();
            ctx.moveTo(x, L.padT);
            ctx.lineTo(x, L.padT + L.ph);
            ctx.strokeStyle = T.text;
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            ctx.stroke();
            ctx.setLineDash([]);
            [
              ["mem", MEM],
              ["cpu", CPU],
            ].forEach(([key, color]) => {
              ctx.beginPath();
              ctx.arc(x, yOf(p[key]), 4, 0, Math.PI * 2);
              ctx.fillStyle = T.bg;
              ctx.fill();
              ctx.strokeStyle = color;
              ctx.lineWidth = 2;
              ctx.stroke();
            });
          }
        }
      }
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
    const now = performance.now();
    const windowMs = maxPoints * intervalMs;
    const padL = 26,
      padR = 10;
    const pw = rect.width - padL - padR;
    let best = null;
    let bd = Infinity;
    pointsRef.current.forEach((p) => {
      const x = padL + pw - ((now - p.t) / windowMs) * pw;
      const d = Math.abs(x - mx);
      if (d < bd) {
        bd = d;
        best = { p, x };
      }
    });
    if (best && bd < 40) {
      hoverRef.current = { t: best.p.t };
      setTip({ x: best.x, cpu: best.p.cpu, mem: best.p.mem, ago: Math.round((now - best.p.t) / 1000) });
    } else {
      hoverRef.current = null;
      setTip(null);
    }
  };

  const T = THEMES[effectiveTheme] || THEMES.dark;
  const delta = (d) =>
    d === 0 ? (
      <span style={{ color: T.text }}> – 0</span>
    ) : d > 0 ? (
      <span style={{ color: "#ef4444" }}> ▲{d}</span>
    ) : (
      <span style={{ color: "#10b981" }}> ▼{-d}</span>
    );
  const pill = (color) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 5,
    padding: "2px 8px",
    borderRadius: 999,
    fontSize: 11,
    fontWeight: 700,
    border: `1px solid ${color}66`,
    background: `${color}1a`,
    color: T.strong,
  });
  const sq = (color) => ({ width: 7, height: 7, borderRadius: 2, background: color, display: "inline-block" });

  return (
    <div
      style={{
        background: T.bg,
        border: `1px solid ${T.grid}`,
        borderRadius: 14,
        padding: compact ? "12px 14px" : 16,
        color: T.strong,
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <i style={{ width: 8, height: 8, borderRadius: 8, background: "#10b981", boxShadow: "0 0 8px #10b981" }} />
        <strong style={{ fontSize: 14 }}>Fleet pulse</strong>
        <span style={{ color: T.text, fontSize: 11 }}>Threshold crossings · {Math.round(intervalMs / 1000)}s</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
          <span style={pill(CPU)}>
            <i style={sq(CPU)} />CPU {stats.cpu}
            {delta(stats.dCpu)}
          </span>
          <span style={pill(MEM)}>
            <i style={sq(MEM)} />Mem {stats.mem}
            {delta(stats.dMem)}
          </span>
          <span style={{ color: T.text, fontSize: 11 }}>Peak {stats.peak}</span>
        </span>
      </div>

      <div style={{ position: "relative", marginTop: 8 }}>
        <canvas
          ref={canvasRef}
          style={{ width: "100%", height, display: "block" }}
          onPointerMove={onMove}
          onPointerLeave={() => {
            hoverRef.current = null;
            setTip(null);
          }}
        />
        {tip && (
          <div
            style={{
              position: "absolute",
              top: 4,
              left: Math.min(tip.x + 10, 9999),
              transform: tip.x > 240 ? "translateX(calc(-100% - 20px))" : "none",
              pointerEvents: "none",
              background: T.tip,
              border: `1px solid ${T.grid}`,
              borderRadius: 8,
              padding: "6px 10px",
              fontSize: 12,
              whiteSpace: "nowrap",
              boxShadow: "0 6px 20px rgba(0,0,0,.35)",
            }}
          >
            <span style={{ color: CPU, fontWeight: 700 }}>CPU {tip.cpu}</span>
            <span style={{ color: T.text }}> · </span>
            <span style={{ color: MEM, fontWeight: 700 }}>Memory {tip.mem}</span>
            <span style={{ color: T.text }}>, {tip.ago} s ago</span>
          </div>
        )}
      </div>

      <div style={{ display: "flex", gap: 14, fontSize: 11, color: T.text, marginTop: 6 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <i style={sq(CPU)} />CPU ≥ {resolvedCpuThresh}%
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
          <i style={sq(MEM)} />Memory ≥ {resolvedMemThresh}%
        </span>
        <span style={{ marginLeft: "auto" }}>now</span>
      </div>
    </div>
  );
}
