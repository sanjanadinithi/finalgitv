// DataSourceStrip.jsx — "Data source" provenance bar (Phase 0 audit fix)
// -----------------------------------------------------------------------
// Rendered on every major view. Shows the dataset file + row count, per-output
// file timestamps, model artifact, and the gateway run timestamp. When an
// output file is older than its inputs the backend flags it (*_stale) and we
// show an explicit stale-data warning instead of presenting old numbers as
// current. Missing values render as "unavailable" — never as zeros.
import { Database, CalendarClock, AlertTriangle, Cpu } from "lucide-react";
import { UNAVAILABLE } from "../utils.js";

function fmtDate(iso) {
  if (!iso) return UNAVAILABLE;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return UNAVAILABLE;
  return d.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtNum(n) {
  return n === null || n === undefined ? UNAVAILABLE : Number(n).toLocaleString();
}

export default function DataSourceStrip({ provenance }) {
  const p = provenance;
  if (!p) {
    return (
      <div className="data-source-strip">
        <span className="dss-item"><Database size={13} /> Data source: {UNAVAILABLE}</span>
      </div>
    );
  }
  const staleOutputs = [
    p.lopo_stale ? p.lopo_file : null,
    p.mtta_stale ? p.mtta_file : null,
  ].filter(Boolean);
  const ev = p.eval_summary || {};

  return (
    <div className="data-source-strip" role="note" aria-label="Data source provenance">
      <span className="dss-item" title="Offline evaluation dataset behind the reliability figures">
        <Database size={13} />
        <strong>{p.dataset_file || UNAVAILABLE}</strong>
        <span className="dss-sep">·</span>{fmtNum(p.dataset_rows)} rows
        <span className="dss-sep">·</span>built {fmtDate(p.dataset_mtime)}
      </span>
      <span className="dss-item" title="Random Forest model artifact serving live prediction">
        <Cpu size={13} />
        <strong>{p.model_file || UNAVAILABLE}</strong>
        <span className="dss-sep">·</span>trained {fmtDate(p.model_mtime)}
      </span>
      <span className="dss-item" title="Eval outputs feeding this view">
        <CalendarClock size={13} />
        {p.lopo_file || UNAVAILABLE}: {fmtDate(p.lopo_mtime)}
        <span className="dss-sep">·</span>
        {p.mtta_file || UNAVAILABLE}: {fmtDate(p.mtta_mtime)}
      </span>
      {ev.baseline_f1 != null && (
        <span
          className="dss-item dss-current"
          title={ev.note || "Current-frame baseline from advisor_evaluation_summary.json"}
        >
          current frame (eval {fmtDate(ev.generated)}): F1 {Number(ev.baseline_f1).toFixed(3)} · FAR{" "}
          {Number(ev.baseline_far).toFixed(3)}
        </span>
      )}
      {staleOutputs.length > 0 && (
        <span className="dss-item dss-stale-warning" role="alert">
          <AlertTriangle size={13} />
          Stale data: {staleOutputs.join(", ")} older than dataset/model — figures are the
          historical artifact, not the current run
        </span>
      )}
      <span className="dss-item dss-run" title="Gateway render time of this payload">
        rendered {fmtDate(p.run_timestamp)}
      </span>
    </div>
  );
}
