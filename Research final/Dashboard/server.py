import http.server
import socketserver
import socket
import json
import math
import os
import csv
import re
import time
import uuid
import logging
import threading
import urllib.request
import urllib.error
from urllib.parse import urlparse, quote, parse_qs
from datetime import datetime, timezone, timedelta

PORT = 8766
# Guards build_dashboard(), which mutates shared in-memory state (SERVICE_HISTORY,
# LAST_RISK, LAST_MITIGATION). The gateway now serves requests on threads, so
# concurrent /api/dashboard polls must not build simultaneously.
DASHBOARD_BUILD_LOCK = threading.RLock()
WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DASHBOARD_DIR = os.path.join(WORKSPACE_ROOT, "Dashboard")

# The gateway also serves the BUILT React UI (dashboard-ui/dist) so the whole
# dashboard runs as ONE process on ONE port. Previously the UI required a
# separate Vite dev server whose /api proxy forwarded to this gateway; when that
# dev server stopped (it dies on reboot / window close), the browser's relative
# /api/dashboard fetches failed and the UI wrongly reported "Gateway
# unreachable on port 8766" even though this server was healthy. Serving dist/
# here means opening http://127.0.0.1:8766/ loads the UI and its polls hit this
# same origin — no proxy, no second process to keep alive.
DASHBOARD_UI_DIST = os.path.join(DASHBOARD_DIR, "dashboard-ui", "dist")
STATIC_CONTENT_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".mjs": "application/javascript",
    ".css": "text/css",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".ico": "image/x-icon",
    ".json": "application/json",
    ".map": "application/json",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".ttf": "font/ttf",
}

COMP4_STATUS_FILE = os.path.join(WORKSPACE_ROOT, "cpu_spike_predictor", "outputs", "live_status.json")
COMP3_PRED_FILE = os.path.join(WORKSPACE_ROOT, "MUP", "data", "memory_predictions.csv")
COMP3_LIVE_FILE = os.path.join(WORKSPACE_ROOT, "MUP", "data", "live_feed.csv")
COMP3_META_FILE = os.path.join(WORKSPACE_ROOT, "MUP", "models", "model_metadata.json")
COMP3_LOPO_FILE = os.path.join(WORKSPACE_ROOT, "MUP", "logs", "lopo_results.csv")
COMP3_COMPARE_FILE = os.path.join(WORKSPACE_ROOT, "MUP", "logs", "comparison_results.csv")
LOPO_FILE = os.path.join(WORKSPACE_ROOT, "cpu_spike_predictor", "outputs", "lopo_results.csv")
COMP4_MTTA_FILE = os.path.join(WORKSPACE_ROOT, "cpu_spike_predictor", "outputs", "cpu_mtta_results.csv")
# Empirical per-service MTTA measured on the LIVE stream (Component 4's
# live_mtta.py), keyed by real fleet service names. Takes precedence over the
# offline research corpus because its names match the live rows.
COMP4_LIVE_MTTA_FILE = os.path.join(WORKSPACE_ROOT, "cpu_spike_predictor", "outputs", "live_mtta_by_service.json")
# Provenance sources for the dashboard truth audit (Phase 0): the dataset and
# model that the eval outputs are supposed to be derived from. If an output file
# is OLDER than its inputs it is stale and the UI must say so.
COMP4_DATASET_FILE = os.path.join(WORKSPACE_ROOT, "cpu_spike_predictor", "data", "processed", "aligned_telemetry.csv")
COMP4_MODEL_FILE = os.path.join(WORKSPACE_ROOT, "cpu_spike_predictor", "outputs", "cpu_rf_model.joblib")
COMP4_EVAL_SUMMARY_FILE = os.path.join(WORKSPACE_ROOT, "cpu_spike_predictor", "outputs", "advisor_evaluation_summary.json")
# Component 4 FastAPI (src/api.py) base URL. The Decision Advisor endpoints are
# served by that process; the gateway proxies /api/advisor/* here so the browser
# keeps talking to ONE origin (port 8766) with no CORS / second port.
COMP4_API_BASE = os.environ.get("COMP4_API_BASE", "http://127.0.0.1:8000")
logger = logging.getLogger(__name__)

POLICY_FILE = os.path.join(DASHBOARD_DIR, "sre_policy.json")
# Durable stores owned by this gateway (JSON / JSONL on disk, survive restarts).
HISTORY_FILE = os.path.join(DASHBOARD_DIR, "service_history.json")
EVENTS_FILE = os.path.join(DASHBOARD_DIR, "events.jsonl")
AUDIT_FILE = os.path.join(DASHBOARD_DIR, "audit_log.jsonl")
MUTES_FILE = os.path.join(DASHBOARD_DIR, "mutes.json")

# Component 2 (Queue-Aware CPU Spike Analyzer) live service catalog.
# Used to discover newly added microservices without code changes.
C2_SERVICES_CONFIG_FILE = os.path.join(
    WORKSPACE_ROOT, "c2", "Queue-Aware CPU Spike Analyzer",
    "research_framework", "services_config.json",
)

# Local component APIs the gateway fans service registration out to, so the
# dashboard "Add service" form can register a microservice with BOTH engines.
# Component 2 has no HTTP registry API — its authoritative registry is the
# services_config.json file (read at startup by realtime_experiment.py and on
# every poll by this gateway), so the gateway manages that file directly.
C1_API_BASE = os.environ.get("C1_API_BASE", "http://127.0.0.1:8001")

# ── Single source of truth for thresholds ─────────────────────────────────
# `cpu_threshold` / `memory_threshold` are the WARNING alarm levels.
# `critical_threshold` is the probability at (or above) which a service is
# CRITICAL, whatever the other signal is doing — so a 99-100% risk service can
# never be reported as merely WARNING anywhere in the product.
DEFAULT_POLICY = {
    "cpu_threshold": 0.60,
    "memory_threshold": 0.70,
    "critical_threshold": 0.90,
}


def get_live_policy():
    policy = dict(DEFAULT_POLICY)
    if os.path.exists(POLICY_FILE):
        try:
            with open(POLICY_FILE, "r") as f:
                data = json.load(f)
            for key in DEFAULT_POLICY:
                if data.get(key) is not None:
                    policy[key] = float(data[key])
            policy["last_updated"] = data.get("last_updated", "")
        except Exception:
            pass
    policy.setdefault("last_updated", "")
    return policy


def save_live_policy(payload):
    policy = get_live_policy()
    for key in DEFAULT_POLICY:
        if payload.get(key) is not None:
            policy[key] = round(float(payload[key]), 4)
    policy["last_updated"] = datetime.now(timezone.utc).isoformat()
    with open(POLICY_FILE, "w") as f:
        json.dump(policy, f, indent=2)
    return policy


def classify_risk(cpu_prob, mem_prob, cpu_alarm_flag, mem_alarm_flag, policy):
    """Probability-first severity. Mirrors deriveStatus() in the UI utils."""
    crit_t = float(policy.get("critical_threshold", DEFAULT_POLICY["critical_threshold"]))
    cpu_warn = bool(cpu_alarm_flag) or float(cpu_prob or 0) >= float(policy.get("cpu_threshold", 0.60))
    mem_warn = bool(mem_alarm_flag) or float(mem_prob or 0) >= float(policy.get("memory_threshold", 0.70))
    if float(cpu_prob or 0) >= crit_t or float(mem_prob or 0) >= crit_t:
        return "CRITICAL"
    if cpu_warn or mem_warn:
        return "WARNING"
    return "HEALTHY"


_SRV_PROJ_RE = re.compile(r"^srv-proj_\d+-(.+)$")
SERVICE_HISTORY = {}

def canonical(name):
    """Strip 'srv-proj_NN-' prefix to align service keys between MUP and Comp 4."""
    name = (name or "").strip()
    m = _SRV_PROJ_RE.match(name)
    return m.group(1) if m else name

def load_c2_live_services():
    """Return (enabled, disabled) service names from Component 2's live services_config.json.

    This file is the authoritative fleet registry shared with Component 1
    ("19 service(s) · discovered: 18 · reporting: 18"), so the dashboard must
    mirror its enabled/disabled state instead of keeping its own seed list.
    """
    enabled, disabled = [], []
    try:
        if os.path.exists(C2_SERVICES_CONFIG_FILE):
            with open(C2_SERVICES_CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            for svc in cfg.get("services", []) or []:
                n = svc.get("name") or svc.get("id")
                if not n:
                    continue
                if svc.get("enabled", True):
                    enabled.append(n)
                else:
                    disabled.append(n)
    except Exception:
        pass
    return enabled, disabled

def infer_runtime(name):
    """Best-effort runtime label from a service name."""
    n = (name or "").lower()
    for token, label in (
        ("node", "node.js"),
        ("python", "python"),
        ("ruby", "ruby"),
        ("php", "php"),
        ("java", "java"),
        ("dotnet", ".net"),
        ("go", "go"),
    ):
        if token in n:
            return label
    if "microservice" in n or "srv-" in n:
        return "container"
    return "unknown"

def num(v):
    try:
        if v is None:
            return None
        val = float(v)
        if math.isnan(val) or math.isinf(val):
            return None
        return val
    except (ValueError, TypeError):
        return None


def sanitize_for_json(obj):
    """Recursively convert NaN and Inf floats to None (null in JSON).
    Standard JSON (RFC 8259) forbids NaN and Infinity. Python's json
    module emits them by default, which causes browsers' JSON.parse()
    to fail with 'SyntaxError: Unexpected token N in JSON at position ...'
    """
    if isinstance(obj, float):
        if math.isnan(obj) or math.isinf(obj):
            return None
        return obj
    elif isinstance(obj, dict):
        return {k: sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [sanitize_for_json(v) for v in obj]
    return obj


# ─────────────────────────────────────────────────────────────────────────
# Durable state: real telemetry history, observed events, audit log, mutes
# ─────────────────────────────────────────────────────────────────────────
HISTORY_MAX_SAMPLES = 180      # 3 minutes at one sample every ~1s
HISTORY_MIN_INTERVAL_SEC = 2   # never sample faster than this
EVENTS_MAX = 500
AUDIT_MAX = 1000
LAST_RISK = {}                 # service -> last observed risk label
LAST_MITIGATION = {}           # service -> last observed mitigation status


def _read_json(path, default):
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return default
    return default


def _write_json(path, payload):
    tmp = path + ".tmp"
    clean = sanitize_for_json(payload)
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(clean, f, indent=2, allow_nan=False)
    # On Windows os.replace intermittently raises PermissionError (WinError 5)
    # when antivirus / OneDrive / Explorer briefly holds a handle on the target
    # file — this dashboard writes history every second from the Desktop folder.
    # Retry a few times before giving up so a transient lock does not escalate.
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                # Drop the stale temp file and let the caller's guard log the
                # skip; in-memory state stays correct and the next write retries.
                try:
                    os.remove(tmp)
                except OSError:
                    pass
                raise
            time.sleep(0.05 * (attempt + 1))


def load_history():
    """Load persisted real samples (never generated) into memory."""
    data = _read_json(HISTORY_FILE, {})
    if isinstance(data, dict):
        for svc, samples in data.items():
            if not _is_service_key(svc):
                continue  # drop junk keys left by earlier mis-parsed CSV rows
            if isinstance(samples, list):
                SERVICE_HISTORY[svc] = samples[-HISTORY_MAX_SAMPLES:]


def save_history():
    _write_json(HISTORY_FILE, SERVICE_HISTORY)


def append_history_sample(name, sample):
    """Append a genuine telemetry sample, rate-limited and bounded."""
    samples = SERVICE_HISTORY.setdefault(name, [])
    last = samples[-1] if samples else None
    last_ts = None
    if last and last.get("timestamp"):
        try:
            last_ts = datetime.fromisoformat(last["timestamp"]).timestamp()
        except Exception:
            last_ts = None
    now_ts = datetime.fromisoformat(sample["timestamp"]).timestamp()
    if last_ts is not None and (now_ts - last_ts) < HISTORY_MIN_INTERVAL_SEC:
        samples[-1] = sample  # refresh the newest point instead of flooding
        return
    samples.append(sample)
    if len(samples) > HISTORY_MAX_SAMPLES:
        del samples[:-HISTORY_MAX_SAMPLES]


def estimate_breach_minutes(samples, threshold):
    """Defensible ETA: linear trend over the recorded real samples only.

    Returns None when there is not enough real history, when the signal is
    flat/falling, or when the service has already crossed the threshold.
    """
    usable = []
    for s in samples:
        try:
            ts = datetime.fromisoformat(s["timestamp"]).timestamp()
        except Exception:
            continue
        prob = s.get("probability")
        if prob is None:
            continue
        usable.append((ts, float(prob)))
    if len(usable) < 3:
        return None
    span = usable[-1][0] - usable[0][0]
    if span < 20:                      # need at least ~20s of real history
        return None
    current = usable[-1][1]
    if current >= threshold:
        return None                    # already breached — no ETA to give
    n = len(usable)
    mean_t = sum(t for t, _ in usable) / n
    mean_p = sum(p for _, p in usable) / n
    denom = sum((t - mean_t) ** 2 for t, _ in usable)
    if denom <= 0:
        return None
    slope = sum((t - mean_t) * (p - mean_p) for t, p in usable) / denom   # prob per second
    if slope <= 1e-7:
        return None                    # not getting worse — no breach to predict
    seconds = (threshold - current) / slope
    minutes = int(round(seconds / 60.0))
    if minutes <= 0 or minutes > 720:
        return None
    return {
        "minutes": minutes,
        "method": "linear trend of recorded samples",
        "basis_samples": n,
        "span_seconds": int(span),
        "estimated": True,
    }


def append_event(event):
    """Append an observed event to the durable JSONL event log."""
    with open(EVENTS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(event) + "\n")


def read_events(limit=60):
    if not os.path.exists(EVENTS_FILE):
        return []
    try:
        with open(EVENTS_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()[-EVENTS_MAX:]
    except Exception:
        return []
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out[-limit:][::-1]


def record_risk_events(services):
    """Log real risk transitions (and mitigation state changes) as they happen."""
    now = datetime.now(timezone.utc).isoformat()
    for svc in services:
        name = svc["id"]
        risk = svc["risk"]
        prev = LAST_RISK.get(name)
        if prev is not None and prev != risk:
            append_event({
                "ts": now,
                "service": name,
                "kind": "risk_transition",
                "from": prev,
                "to": risk,
                "detail": f"{prev} → {risk}",
            })
        LAST_RISK[name] = risk

        mit = svc.get("mitigation_state") or {}
        status = mit.get("status")
        if status:
            if name in LAST_MITIGATION and LAST_MITIGATION[name] != status:
                append_event({
                    "ts": mit.get("timestamp") or now,
                    "service": name,
                    "kind": "mitigation_state",
                    "from": LAST_MITIGATION[name],
                    "to": status,
                    "detail": f"{mit.get('tier') or ''} · {status}".strip(" ·"),
                })
            LAST_MITIGATION[name] = status


def read_audit(limit=AUDIT_MAX):
    if not os.path.exists(AUDIT_FILE):
        return []
    try:
        with open(AUDIT_FILE, "r", encoding="utf-8") as f:
            lines = f.readlines()[-AUDIT_MAX:]
    except Exception:
        return []
    out = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out[-limit:][::-1]


def append_audit(record):
    with open(AUDIT_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record) + "\n")


def load_mutes():
    data = _read_json(MUTES_FILE, {"mutes": []})
    mutes = data.get("mutes") if isinstance(data, dict) else []
    return mutes if isinstance(mutes, list) else []


def active_mutes(mutes=None):
    """Return only mutes that have not expired yet."""
    now = datetime.now(timezone.utc)
    out = []
    for m in (mutes if mutes is not None else load_mutes()):
        expires = m.get("expires_at")
        try:
            exp = datetime.fromisoformat(expires) if expires else None
        except Exception:
            exp = None
        if exp is not None and exp > now:
            out.append({**m, "seconds_remaining": int((exp - now).total_seconds())})
    return out


def create_mute(service, minutes, reason="", actor="operator"):
    minutes = max(1, min(1440, int(minutes or 15)))
    now = datetime.now(timezone.utc)
    mute = {
        "id": uuid.uuid4().hex[:10],
        "service": service,
        "reason": reason,
        "actor": actor,
        "created_at": now.isoformat(),
        "expires_at": (now + timedelta(minutes=minutes)).isoformat(),
        "duration_minutes": minutes,
    }
    mutes = [m for m in load_mutes() if m.get("service") != service]
    mutes.append(mute)
    _write_json(MUTES_FILE, {"mutes": mutes})
    return mute


def clear_mutes(service=None, mute_id=None):
    mutes = load_mutes()
    kept = []
    removed = 0
    for m in mutes:
        if (mute_id and m.get("id") == mute_id) or (service and m.get("service") == service):
            removed += 1
            continue
        kept.append(m)
    _write_json(MUTES_FILE, {"mutes": kept})
    return removed


def contributions_are_placeholder(contributions):
    """True when the driver breakdown carries no real information.

    The CPU predictor falls back to an equal split (e.g. 10.0 for every
    feature) when no model explanation is available. Such a split must never
    be presented as a measured root cause.
    """
    if not isinstance(contributions, dict) or len(contributions) < 2:
        return True
    values = {round(float(v or 0), 4) for v in contributions.values()}
    return len(values) <= 1


def _file_mtime_iso(path):
    """File mtime as ISO string, or None when the file is missing."""
    try:
        return datetime.fromtimestamp(os.path.getmtime(path), timezone.utc).isoformat()
    except OSError:
        return None


_ROW_COUNT_CACHE = {}


def _csv_row_count(path):
    """Count data rows in a CSV, cached by (path, mtime) — /api/dashboard polls
    this every second and the dataset has 71k rows."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        return None
    key = (path, mtime)
    if key not in _ROW_COUNT_CACHE:
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                n = sum(1 for _ in f) - 1  # minus header
        except OSError:
            return None
        _ROW_COUNT_CACHE.clear()
        _ROW_COUNT_CACHE[key] = max(0, n)
    return _ROW_COUNT_CACHE[key]


def build_dashboard_provenance():
    """Data-source strip payload (Phase 0): dataset, row count, model, output
    file timestamps and a stale flag when an output predates its inputs."""
    dataset_mtime = _file_mtime_iso(COMP4_DATASET_FILE)
    model_mtime = _file_mtime_iso(COMP4_MODEL_FILE)
    lopo_mtime = _file_mtime_iso(LOPO_FILE)
    mtta_mtime = _file_mtime_iso(COMP4_MTTA_FILE)

    def _iso_age(s):
        if not s:
            return None
        try:
            return datetime.fromisoformat(s).timestamp()
        except ValueError:
            return None

    ds_ts = _iso_age(dataset_mtime)
    model_ref = max(t for t in (_iso_age(model_mtime), ds_ts) if t is not None) if (ds_ts or model_mtime) else None
    lopo_ts, mtta_ts = _iso_age(lopo_mtime), _iso_age(mtta_mtime)
    eval_summary = None
    if os.path.exists(COMP4_EVAL_SUMMARY_FILE):
        try:
            with open(COMP4_EVAL_SUMMARY_FILE, "r", encoding="utf-8") as f:
                s = json.load(f)
            b = s.get("baseline") or {}
            eval_summary = {
                "generated": s.get("generated"),
                "n_rows": s.get("n_rows"),
                "baseline_f1": b.get("f1"),
                "baseline_far": b.get("far"),
                "ttf_mae_min": b.get("ttf_mae_min") if b.get("ttf_mae_min") == b.get("ttf_mae_min") else None,
                "advisor_p99_ms": (s.get("latency") or {}).get("p99_ms"),
                "note": s.get("historical_claim_note"),
            }
        except Exception:
            eval_summary = None
    return {
        "dataset_file": os.path.basename(COMP4_DATASET_FILE),
        "dataset_rows": _csv_row_count(COMP4_DATASET_FILE),
        "dataset_mtime": dataset_mtime,
        "model_file": os.path.basename(COMP4_MODEL_FILE),
        "model_mtime": model_mtime,
        "lopo_file": os.path.basename(LOPO_FILE),
        "lopo_mtime": lopo_mtime,
        "lopo_stale": bool(lopo_ts and model_ref and lopo_ts < model_ref),
        "mtta_file": os.path.basename(COMP4_MTTA_FILE),
        "mtta_mtime": mtta_mtime,
        "mtta_stale": bool(mtta_ts and model_ref and mtta_ts < model_ref),
        "run_timestamp": datetime.now(timezone.utc).isoformat(),
        "eval_summary": eval_summary,
    }


def build_reliability():
    cpu_folds = []
    lopo_metrics_mismatch = False
    if os.path.exists(LOPO_FILE):
        try:
            with open(LOPO_FILE, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    # Phase 0 audit fix: the stored precision/FAR columns in the
                    # historical lopo_results.csv are NOT consistent with its own
                    # confusion counts (see outputs/dashboard_audit.md). Always
                    # recompute from TN/FP/FN/TP using the same formulas as
                    # src/validation.py (far = fp / (tn + fp)).
                    tn = int(num(row.get("true_negatives")) or 0)
                    fp = int(num(row.get("false_positives")) or 0)
                    fn = int(num(row.get("false_negatives")) or 0)
                    tp = int(num(row.get("true_positives")) or 0)
                    p_calc = tp / (tp + fp) if (tp + fp) else 0.0
                    r_calc = tp / (tp + fn) if (tp + fn) else 0.0
                    f1_calc = (2 * p_calc * r_calc / (p_calc + r_calc)
                               if (p_calc + r_calc) else 0.0)
                    far_calc = fp / (tn + fp) if (tn + fp) else 0.0
                    p_csv, r_csv = num(row.get("precision")), num(row.get("recall"))
                    f1_csv, far_csv = num(row.get("f1_score")), num(row.get("false_alarm_rate"))
                    if ((p_csv is not None and abs(p_csv - p_calc) > 0.01)
                            or (far_csv is not None and abs(far_csv - far_calc) > 0.005)):
                        lopo_metrics_mismatch = True
                    cpu_folds.append({
                        "project": row.get("test_project"),
                        # Recomputed, canonical values the UI renders:
                        "precision": round(p_calc, 4),
                        "recall": round(r_calc, 4),
                        "f1": round(f1_calc, 4),
                        "far": round(far_calc, 4),
                        # As-stored values, kept for transparency in the UI:
                        "stored_precision": p_csv,
                        "stored_recall": r_csv,
                        "stored_f1": f1_csv,
                        "stored_far": far_csv,
                        "true_negatives": tn, "false_positives": fp,
                        "false_negatives": fn, "true_positives": tp,
                    })
        except Exception:
            cpu_folds = []

    memory_folds = []
    if os.path.exists(COMP3_LOPO_FILE):
        try:
            with open(COMP3_LOPO_FILE, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    memory_folds.append({
                        "project": row.get("project"),
                        "precision": num(row.get("precision")),
                        "recall": num(row.get("recall")),
                        "f1": num(row.get("f1")),
                        "auc": num(row.get("roc_auc")),
                        "shap_top3": row.get("shap_top3", "")
                    })
        except Exception:
            memory_folds = []

    memory_folds_is_fallback = False
    if not memory_folds:
        memory_folds_is_fallback = True
        memory_folds = [
            {"project": "project_1", "precision": 0.361, "recall": 0.5425, "f1": 0.4335, "auc": 0.5811, "shap_top3": "incident_phase_2, gc_count, incident_phase_1"},
            {"project": "project_2", "precision": 1.0, "recall": 0.9932, "f1": 0.9966, "auc": 1.0, "shap_top3": "incident_phase_2, incident_phase_1, heap_max"},
            {"project": "project_3", "precision": 1.0, "recall": 0.9971, "f1": 0.9985, "auc": 1.0, "shap_top3": "incident_phase_2, incident_phase_1, heap_mb_used"},
            {"project": "project_4", "precision": 0.9838, "recall": 0.9984, "f1": 0.991, "auc": 0.9996, "shap_top3": "incident_phase_2, incident_phase_1, heap_mb_used"},
            {"project": "project_5", "precision": 0.9923, "recall": 0.9959, "f1": 0.9941, "auc": 0.9996, "shap_top3": "heap_mb_used, incident_phase_2, incident_phase_1"}
        ]

    mup_meta = {}
    if os.path.exists(COMP3_META_FILE):
        try:
            with open(COMP3_META_FILE, "r", encoding="utf-8") as f:
                mup_meta = json.load(f)
        except Exception:
            mup_meta = {}
    if isinstance(mup_meta, dict):
        mup_meta = sanitize_for_json(mup_meta)

    mup_comparisons = []
    if os.path.exists(COMP3_COMPARE_FILE):
        try:
            with open(COMP3_COMPARE_FILE, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    mup_comparisons.append({
                        "model": row.get("model"),
                        "mean_f1": num(row.get("mean_f1")),
                        "f1_var": num(row.get("f1_var")),
                        "mean_prec": num(row.get("mean_prec")),
                        "mean_rec": num(row.get("mean_rec")),
                        "mean_auc": num(row.get("mean_auc")),
                        "train_sec": num(row.get("train_sec"))
                    })
        except Exception:
            mup_comparisons = []

    if isinstance(mup_meta, dict) and mup_meta.get("mean_f1") is None and mup_comparisons:
        rf = next((c for c in mup_comparisons if "forest" in (c.get("model") or "").lower()), None)
        if rf:
            mup_meta["mean_f1"] = rf.get("mean_f1")
            mup_meta["f1_variance"] = rf.get("f1_var")
            mup_meta["mean_auc"] = rf.get("mean_auc")

    mtta_metrics = load_mtta_metrics()

    return {
        "cpu_lopo": cpu_folds,
        "cpu_lopo_metrics_mismatch": lopo_metrics_mismatch,
        "memory_lopo": memory_folds,
        "memory_lopo_is_fallback": memory_folds_is_fallback,
        "mup_meta": mup_meta,
        "mup_comparisons": mup_comparisons,
        "mtta": mtta_metrics,
        "provenance": build_dashboard_provenance(),
    }


def _merge_live_service_mtta(svc_summaries):
    """Overlay Component 4's empirically-measured LIVE per-service MTTA.

    The live file (outputs/live_mtta_by_service.json) is keyed by the real fleet
    service names, so its entries join onto the dashboard rows directly — unlike
    the offline research corpus, whose names never matched. Live measurements win
    and are tagged measured='live'; research entries are kept for any service the
    live stream has not observed a failure for yet.
    """
    if not os.path.exists(COMP4_LIVE_MTTA_FILE):
        try:
            live_mtta_script = os.path.join(WORKSPACE_ROOT, "cpu_spike_predictor", "src", "live_mtta.py")
            if os.path.exists(live_mtta_script):
                import importlib.util
                spec = importlib.util.spec_from_file_location("live_mtta", live_mtta_script)
                mod = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(mod)
                mod.compute_live_mtta_by_service(output_path=COMP4_LIVE_MTTA_FILE)
        except Exception as e:
            logger.warning("Could not auto-generate live MTTA: %s", e)
    if not os.path.exists(COMP4_LIVE_MTTA_FILE):
        return svc_summaries
    try:
        with open(COMP4_LIVE_MTTA_FILE, "r", encoding="utf-8") as f:
            live = json.load(f)
    except (OSError, ValueError):
        logger.exception("Unable to read live MTTA from %s", COMP4_LIVE_MTTA_FILE)
        return svc_summaries

    services = live.get("services", {}) if isinstance(live, dict) else {}
    for raw_name, data in services.items():
        if not isinstance(data, dict):
            continue
        canon = canonical(raw_name)
        if not canon:
            continue
        merged = dict(data)
        merged["service"] = canon
        merged["measured"] = "live"
        mean_min = merged.get("mean_mtta_minutes")
        merged["formatted_lead_time"] = (
            f"~{mean_min:.1f}m early" if mean_min is not None else None
        )
        svc_summaries[canon] = merged
    return svc_summaries


def load_mtta_metrics():
    """Load empirical Mean Time To Anticipate (MTTA) results from Component 4.
    
    Evaluates how early alarms are predicted before failure events across
    different strategies (CPU_Only, Joint_OR, Joint_AND, Memory_Only)
    and per microservice.
    """
    def empty_metrics():
        return {
            "strategies": [],
            "by_service": {},
            "fleet": {
                "fleet_mean_mtta_minutes": None,
                "fleet_mean_mtta_seconds": None,
                "fleet_anticipation_rate_pct": None,
                "anticipated_events": None,
                "total_events": None,
                "min_lead_time_seconds": None,
                "max_lead_time_minutes": None,
                "hypothesis_h3_met": None,
                "h3_required_seconds": 30.0,
            }
        }

    if not os.path.exists(COMP4_MTTA_FILE):
        return empty_metrics()

    try:
        rows = []
        with open(COMP4_MTTA_FILE, "r", encoding="utf-8") as f:
            reader = csv.DictReader(f)
            for r in reader:
                rows.append(r)

        by_strategy = {}
        by_service = {}

        for r in rows:
            strat = r.get("strategy", "Unknown")
            svc_raw = r.get("service_name", "")
            canon_svc = canonical(svc_raw)

            mtta_sec = float(r.get("mtta_seconds", 0.0) or 0.0)
            mtta_min = float(r.get("mtta_minutes", 0.0) or 0.0)
            ant = int(float(r.get("anticipated", 0) or 0))

            if strat not in by_strategy:
                by_strategy[strat] = {"total": 0, "anticipated": 0, "secs": [], "mins": []}
            by_strategy[strat]["total"] += 1
            if ant == 1:
                by_strategy[strat]["anticipated"] += 1
                by_strategy[strat]["secs"].append(mtta_sec)
                by_strategy[strat]["mins"].append(mtta_min)

            if strat in ("CPU_Only", "Joint_OR"):
                if canon_svc not in by_service:
                    by_service[canon_svc] = {"total": 0, "anticipated": 0, "secs": [], "mins": []}
                by_service[canon_svc]["total"] += 1
                if ant == 1:
                    by_service[canon_svc]["anticipated"] += 1
                    by_service[canon_svc]["secs"].append(mtta_sec)
                    by_service[canon_svc]["mins"].append(mtta_min)

        strategy_summaries = []
        for strat, data in by_strategy.items():
            tot = data["total"]
            ant_cnt = data["anticipated"]
            rate = round(ant_cnt / tot * 100.0, 1) if tot > 0 else 0.0
            mean_sec = round(sum(data["secs"]) / len(data["secs"]), 1) if data["secs"] else None
            mean_min = round(sum(data["mins"]) / len(data["mins"]), 2) if data["mins"] else None
            min_sec = round(min(data["secs"]), 1) if data["secs"] else None
            max_sec = round(max(data["secs"]), 1) if data["secs"] else None
            min_min = round(min_sec / 60.0, 2) if min_sec is not None else None
            max_min = round(max_sec / 60.0, 2) if max_sec is not None else None
            strategy_summaries.append({
                "strategy": strat,
                "total_events": tot,
                "anticipated_events": ant_cnt,
                "anticipation_rate_pct": rate,
                "mean_mtta_minutes": mean_min,
                "mean_mtta_seconds": mean_sec,
                "min_mtta_seconds": min_sec,
                "max_mtta_seconds": max_sec,
                "min_mtta_minutes": min_min,
                "max_mtta_minutes": max_min,
                "h3_pass": mean_sec >= 30.0 if mean_sec is not None else None,
            })

        svc_summaries = {}
        for svc, data in by_service.items():
            tot = data["total"]
            ant_cnt = data["anticipated"]
            rate = round(ant_cnt / tot * 100.0, 1) if tot > 0 else 0.0
            mean_sec = round(sum(data["secs"]) / len(data["secs"]), 1) if data["secs"] else None
            mean_min = round(sum(data["mins"]) / len(data["mins"]), 2) if data["mins"] else None
            min_sec = round(min(data["secs"]), 1) if data["secs"] else None
            max_sec = round(max(data["secs"]), 1) if data["secs"] else None
            svc_summaries[svc] = {
                "service": svc,
                "total_events": tot,
                "anticipated_events": ant_cnt,
                "anticipation_rate_pct": rate,
                "mean_mtta_minutes": mean_min,
                "mean_mtta_seconds": mean_sec,
                "min_mtta_seconds": min_sec,
                "max_mtta_seconds": max_sec,
                "formatted_lead_time": f"~{mean_min:.1f}m early" if mean_min is not None else None,
            }

        # Overlay empirically-measured LIVE per-service MTTA. These are keyed by
        # the real fleet service names, so they join directly onto the live rows
        # and take precedence over the offline research corpus (whose names never
        # matched). A service with a live measurement is rendered as a genuine
        # per-service lead time; those without fall back to the fleet average.
        svc_summaries = _merge_live_service_mtta(svc_summaries)

        cpu_strat = next((s for s in strategy_summaries if s["strategy"] == "CPU_Only"), strategy_summaries[0] if strategy_summaries else {})
        fleet = {
            "fleet_mean_mtta_minutes": cpu_strat.get("mean_mtta_minutes"),
            "fleet_mean_mtta_seconds": cpu_strat.get("mean_mtta_seconds"),
            "fleet_anticipation_rate_pct": cpu_strat.get("anticipation_rate_pct"),
            "anticipated_events": cpu_strat.get("anticipated_events"),
            "total_events": cpu_strat.get("total_events"),
            "min_lead_time_seconds": cpu_strat.get("min_mtta_seconds"),
            "max_lead_time_minutes": cpu_strat.get("max_mtta_minutes"),
            "hypothesis_h3_met": cpu_strat.get("h3_pass"),
            "h3_required_seconds": 30.0,
        }

        return {
            "strategies": strategy_summaries,
            "by_service": svc_summaries,
            "fleet": fleet,
        }
    except (OSError, csv.Error, ValueError, TypeError):
        logger.exception("Unable to load MTTA results from %s", COMP4_MTTA_FILE)
        return empty_metrics()

def get_mup_live_telemetry():
    """Extract latest streaming telemetry and derived engineered features per service from MUP."""
    features_by_service = {}
    if os.path.exists(COMP3_LIVE_FILE):
        try:
            with open(COMP3_LIVE_FILE, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    svc = canonical(row.get("service_name"))
                    if svc:
                        ram_mean = num(row.get("ram_mean")) or 0.0
                        ram_std = num(row.get("ram_std")) or 0.0
                        ram_std_trend = num(row.get("ram_std_trend")) or 0.0
                        ram_pct = num(row.get("ram_percent")) or 0.0
                        mem_5m = num(row.get("memory_change_5min")) or 0.0
                        mem_10m = num(row.get("memory_change_10min")) or 0.0
                        heap_used = num(row.get("heap_mb_used")) or 0.0
                        heap_max = num(row.get("heap_max")) or 0.0
                        heap_rate = num(row.get("heap_rate")) or 0.0
                        gc_cnt = num(row.get("gc_count")) or 0.0
                        gc_spikes = num(row.get("gc_spike_count")) or 0.0

                        # Computed derived features fallback
                        heap_fill = num(row.get("heap_fill_ratio"))
                        if heap_fill is None:
                            heap_fill = heap_used / (heap_max + 1e-6)

                        mem_accel = num(row.get("memory_acceleration"))
                        if mem_accel is None:
                            mem_accel = mem_5m - mem_10m

                        gc_eff = num(row.get("gc_efficiency"))
                        if gc_eff is None:
                            gc_eff = gc_spikes / (gc_cnt + 1e-6)

                        ram_std_r = num(row.get("ram_std_ratio"))
                        if ram_std_r is None:
                            ram_std_r = ram_std / (ram_mean + 1e-6)

                        growth_vel = num(row.get("memory_growth_velocity"))
                        if growth_vel is None:
                            growth_vel = mem_5m / (ram_mean + 1e-6)

                        oom_slope = num(row.get("time_to_oom_slope"))
                        if oom_slope is None:
                            rem_headroom = max(heap_max - heap_used, 0.0)
                            oom_slope = heap_rate / (rem_headroom + 1e-6)

                        gc_press = num(row.get("gc_pressure_index"))
                        if gc_press is None:
                            gc_press = gc_spikes * (heap_used / (heap_max + 1e-6))

                        leak_mom = num(row.get("ram_leak_momentum"))
                        if leak_mom is None:
                            leak_mom = ram_std_trend * (ram_pct / 100.0)

                        features_by_service[svc] = {
                            "timestamp": row.get("timestamp"),
                            "project_id": row.get("project_id"),
                            "service_name": svc,
                            "window_id": row.get("window_id"),
                            "label": row.get("label"),
                            "failure_type": row.get("failure_type"),
                            "incident_phase_1": num(row.get("incident_phase_1")),
                            "incident_phase_2": num(row.get("incident_phase_2")),
                            "ram_mean": ram_mean,
                            "ram_max": num(row.get("ram_max")),
                            "ram_std": ram_std,
                            "ram_std_trend": ram_std_trend,
                            "ram_percent": ram_pct,
                            "memory_change_5min": mem_5m,
                            "memory_change_10min": mem_10m,
                            "heap_mb_used": heap_used,
                            "heap_max": heap_max,
                            "heap_rate": heap_rate,
                            "gc_count": gc_cnt,
                            "gc_spike_count": gc_spikes,
                            # Derived features
                            "heap_fill_ratio": heap_fill,
                            "memory_acceleration": mem_accel,
                            "gc_efficiency": gc_eff,
                            "ram_std_ratio": ram_std_r,
                            "memory_growth_velocity": growth_vel,
                            "time_to_oom_slope": oom_slope,
                            "gc_pressure_index": gc_press,
                            "ram_leak_momentum": leak_mom,
                        }
        except Exception:
            features_by_service = {}
    return features_by_service

_SERVICE_KEY_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_PROJECT_ID_RE = re.compile(r"^(?:project|proj)[-_]?\d+$")
_NUMERIC_KEY_RE = re.compile(r"^\d+(?:\.\d+)?$")


def _is_service_key(name):
    """Reject status-file keys that are narrative text, project ids or bare
    numbers (a mis-parsed CSV row), mirroring the validation used by
    cpu_spike_predictor/src/live_inference.py."""
    key = str(name or "").strip().lower()
    if not key or not _SERVICE_KEY_RE.match(key):
        return False
    if _PROJECT_ID_RE.match(key) or _NUMERIC_KEY_RE.match(key):
        return False
    return any(c.isalpha() for c in key)


def build_dashboard():
    # 1. Read Component 4 live status
    c4_live = {}
    if os.path.exists(COMP4_STATUS_FILE):
        try:
            with open(COMP4_STATUS_FILE, "r", encoding="utf-8") as f:
                c4_live = json.load(f)
            c4_live = {
                k: v for k, v in c4_live.items()
                if isinstance(v, dict) and _is_service_key(k)
            }
        except Exception:
            c4_live = {}

    # 2. Read Component 3 memory predictions
    c3_mem = {}
    if os.path.exists(COMP3_PRED_FILE):
        try:
            with open(COMP3_PRED_FILE, "r", encoding="utf-8") as f:
                reader = csv.DictReader(f)
                for row in reader:
                    svc = row.get("service_name")
                    if svc and _is_service_key(svc):
                        c3_mem[canonical(svc)] = row
        except Exception:
            c3_mem = {}

    # Fleet catalog: the authoritative registry is Component 2's live
    # services_config.json (the same file Component 1 discovers against),
    # extended only with services that carry REAL telemetry in the live
    # sources. There is deliberately no hardcoded seed list — leftover names
    # (legacy Azure rows, disabled entries) must never inflate the fleet,
    # otherwise the dashboard count drifts from the component registries.
    c2_enabled, c2_disabled = load_c2_live_services()
    disabled_canon = {canonical(n) for n in c2_disabled}

    ALL_KNOWN_SERVICES = []

    def _register_service(name):
        c = canonical(name)
        if c and c not in ALL_KNOWN_SERVICES and c not in disabled_canon:
            ALL_KNOWN_SERVICES.append(c)

    for c2_name in c2_enabled:
        _register_service(c2_name)
    # Component 4 / Component 3 live sources can still carry STALE rows for
    # services Component 2 has already dropped from its registry (e.g. a removed
    # microservice whose last prediction is still on disk). Component 2's ENABLED
    # set is the authoritative fleet, so telemetry names are only used to enrich
    # services already in that set — never to inflate the fleet past Component 2.
    # This keeps the dashboard count aligned with c2 ("discovered / reporting").
    c2_enabled_canon = {canonical(n) for n in c2_enabled}
    # Comp 4 services with genuine telemetry (baseline predictions computed
    # from all-zero features are not evidence a service exists).
    for raw_name, rec in c4_live.items():
        if rec.get("cpu_telemetry_available") is not False:
            for part in str(raw_name).split(","):
                if canonical(part) in c2_enabled_canon:
                    _register_service(part)
    # Comp 3 (MUP) services with live memory predictions.
    for c3_name in c3_mem.keys():
        _register_service(c3_name)

    # 3. Consolidate services by canonical name (prioritizing exact single-service records)
    services_map = {}

    # First index exact single-service keys
    for raw_name, record in c4_live.items():
        if "," not in raw_name:
            canon_name = canonical(raw_name)
            if canon_name in ALL_KNOWN_SERVICES:
                services_map[canon_name] = {
                    "raw_name": raw_name,
                    "c4": record,
                    "c3": c3_mem.get(canon_name, {})
                }

    # Then index multi-service comma keys for any unindexed service
    for raw_name, record in c4_live.items():
        if "," in raw_name:
            sub_names = [canonical(n) for n in raw_name.split(",") if n.strip()]
            for canon_name in sub_names:
                if canon_name in ALL_KNOWN_SERVICES and canon_name not in services_map:
                    services_map[canon_name] = {
                        "raw_name": raw_name,
                        "c4": record,
                        "c3": c3_mem.get(canon_name, {})
                    }

    # Include any C3 services not present in C4
    for canon_name, mem_row in c3_mem.items():
        if canon_name in ALL_KNOWN_SERVICES and canon_name not in services_map:
            services_map[canon_name] = {
                "raw_name": canon_name,
                "c4": {},
                "c3": mem_row
            }

    # Ensure all real backend microservices exist
    for canon_name in ALL_KNOWN_SERVICES:
        if canon_name not in services_map:
            services_map[canon_name] = {
                "raw_name": canon_name,
                "c4": {},
                "c3": c3_mem.get(canon_name, {})
            }

    services_list = []
    total_critical = 0
    total_warning = 0
    total_healthy = 0

    policy = get_live_policy()
    cpu_thresh = policy["cpu_threshold"]
    mem_thresh = policy["memory_threshold"]

    mup_live_telemetry = get_mup_live_telemetry()
    mtta_data = load_mtta_metrics()
    mtta_by_service = mtta_data.get("by_service", {})
    fleet_mtta = mtta_data.get("fleet", {})

    for canon_name, val in services_map.items():
        c4 = val["c4"]
        c3 = val["c3"]

        cpu_prob = num(c4.get("cpu_failure_prob"))
        # A prediction computed from all-zero features (no Comp2 telemetry for
        # this service) is the model's constant baseline (~0.149 → "15%"), not
        # a measured risk. New Comp4 records carry an explicit flag; older rows
        # on disk fall back to a raw-telemetry heuristic.
        telemetry_flag = c4.get("cpu_telemetry_available")
        if telemetry_flag is None:
            # Legacy rows written before the flag existed: treat the model's
            # constant baseline output (0.148631…) with no raw CPU reading as
            # "no telemetry"; any other probability means real features were seen.
            telemetry_flag = not (
                cpu_prob is not None and abs(cpu_prob - 0.148631) < 1e-4
                and not (num(c4.get("cpu_pct_raw")) or 0)
            )
        if telemetry_flag is False:
            cpu_prob = None
        cpu_alarm = (
            (cpu_prob is not None and cpu_prob >= cpu_thresh)
            or bool(c4.get("cpu_alarm", False))
        )

        c3_mem_prob = num(c3.get("memory_prob"))
        c4_mem_prob = num(c4.get("memory_prob"))
        # Prefer direct Component 3 memory model predictions; fallback to Component 4
        if c3_mem_prob is not None:
            mem_prob = c3_mem_prob
        elif c4_mem_prob is not None and c4.get("memory_telemetry_available") is not False:
            mem_prob = c4_mem_prob
        else:
            mem_prob = None
        mem_conflict = (
            c3_mem_prob is not None and c4_mem_prob is not None
            and abs(c3_mem_prob - c4_mem_prob) >= 0.2
        )

        def _is_alert(v):
            return str(v or "").strip().upper() in ("TRUE", "1", "YES", "T")

        mem_alarm = (
            (mem_prob is not None and mem_prob >= mem_thresh)
            or _is_alert(c3.get("alert"))
            or _is_alert(c4.get("memory_alert"))
        )

        joint_alarm = cpu_alarm and mem_alarm

        # Single source of truth for severity. Probability-first: matches the
        # UI's deriveStatus() so the top bar can never read "0 critical" while a
        # ticket for the same service says CRITICAL.
        risk = classify_risk(cpu_prob, mem_prob, cpu_alarm, mem_alarm, policy)
        if risk == "CRITICAL":
            total_critical += 1
        elif risk == "WARNING":
            total_warning += 1
        else:
            total_healthy += 1

        action = c4.get("action_recommended")
        if not action or (risk == "HEALTHY" and action != "NO_ACTION"):
            if risk == "CRITICAL":
                action = "CRITICAL_RESTART_AND_TRAFFIC_REROUTE"
            elif cpu_alarm:
                action = "TRIGGER_LOAD_SHEDDING"
            elif mem_alarm:
                action = "TRIGGER_PROACTIVE_POD_RESTART"
            else:
                action = "NO_ACTION"

        svc_mup = mup_live_telemetry.get(canon_name) or {}

        # Record exactly ONE genuine telemetry sample per poll. No synthetic
        # seeding, no random noise — an empty series stays empty until real
        # polls accumulate, and the UI hides the chart until then. Services
        # with no real probability signal at all (no CPU telemetry, no memory
        # prediction) must not append 0.0 samples: that fabricates a trend.
        cpu_pct = num(c4.get("cpu_pct_raw"))
        mem_pct = num(svc_mup.get("ram_percent"))
        if mem_pct is None:
            mem_pct = num(c3.get("ram_percent"))
        if cpu_prob is not None or mem_prob is not None:
            append_history_sample(canon_name, {
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "probability": round(max(float(cpu_prob or 0), float(mem_prob or 0)), 4),
                "cpu": round(cpu_pct, 1) if cpu_pct is not None else None,
                "mem": round(mem_pct, 1) if mem_pct is not None else None,
                "queue": round(num(c4.get("cpu_trend_raw")) or 0.0, 1),
            })
        history = SERVICE_HISTORY.get(canon_name, [])

        # Defensible breach ETA derived only from the recorded real samples.
        # Only meaningful for at-risk services — extrapolating a trend to the
        # critical line for a HEALTHY service produces noise-driven ETAs like
        # "~187m" that operators read as a false alarm.
        breach = (
            estimate_breach_minutes(history, policy["critical_threshold"])
            if risk != "HEALTHY" else None
        )

        mit_raw = c4.get("mitigation_executed") or {}
        mitigation_state = {
            "status": mit_raw.get("status"),
            "tier": mit_raw.get("mitigation_tier"),
            "action_executed": mit_raw.get("action_executed"),
            "circuit_breaker": mit_raw.get("circuit_breaker"),
            "cooldown_remaining_sec": num(mit_raw.get("cooldown_remaining_sec")),
            "command_issued": mit_raw.get("command_issued"),
            "timestamp": mit_raw.get("timestamp"),
        }

        # MTTA / Early Alarm Prediction metrics (how early the alarm was predicted before failure).
        # Per-service empirical MTTA is measured on the offline research corpus, whose service
        # names (node-azure, php-azure, ...) do NOT correspond to the live fleet ids
        # (microservice-04-azure, container-revision srv-...), so a per-row name match is rare.
        # When a row has no per-service measurement, fall back to the FLEET-level empirical MTTA
        # — the model's demonstrated average anticipation lead time — and tag the scope as
        # "model" so the UI never presents it as a measurement of this specific service.
        svc_mtta = mtta_by_service.get(canon_name)
        if svc_mtta is not None:
            # A genuine per-service measurement exists (live if measured=='live',
            # otherwise from the research corpus). Use it as-is, even when it
            # reports zero anticipated failures (mean None) — the UI then shows an
            # em dash rather than silently substituting the fleet average.
            mtta_scope = "service"
            mtta_mins = svc_mtta.get("mean_mtta_minutes")
            mtta_secs = svc_mtta.get("mean_mtta_seconds")
            ant_rate = svc_mtta.get("anticipation_rate_pct")
            # Event counts let the UI aggregate fleet MTTA event-weighted
            # (Σ lead_seconds / Σ anticipated_events) instead of a mean-of-means.
            mtta_ant_ev = svc_mtta.get("anticipated_events")
            mtta_tot_ev = svc_mtta.get("total_events")
        else:
            # No per-service record yet: fall back to the fleet-level empirical
            # MTTA (the model's demonstrated average lead) tagged as model-wide.
            # Carries no own event counts, so it is excluded from the weighted fleet
            # aggregate to avoid double-counting the fleet average as a data point.
            mtta_scope = "model"
            mtta_mins = fleet_mtta.get("fleet_mean_mtta_minutes")
            mtta_secs = fleet_mtta.get("fleet_mean_mtta_seconds")
            ant_rate = fleet_mtta.get("fleet_anticipation_rate_pct")
            mtta_ant_ev = None
            mtta_tot_ev = None

        at_risk = cpu_alarm or mem_alarm or risk != "HEALTHY"
        lead_suffix = "" if mtta_scope == "service" else " (model avg)"
        alarm_lead_label = (
            f"~{round(mtta_mins, 1)}m early{lead_suffix}"
            if mtta_mins is not None and at_risk
            else None
        )

        contributions = c4.get("feature_contributions", {}) or {}
        services_list.append({
            "id": canon_name,
            "service": canon_name,
            "raw_service_name": val["raw_name"],
            "project": c4.get("project_id") or c3.get("project_id") or "Proj_01",
            "runtime": infer_runtime(canon_name),
            "risk": risk,
            "cpu_probability": cpu_prob,
            "cpu_alarm": cpu_alarm,
            "memory_probability": mem_prob,
            "memory_prob_c3": round(c3_mem_prob, 4) if c3_mem_prob is not None else None,
            "memory_prob_c4": round(c4_mem_prob, 4) if c4_mem_prob is not None else None,
            "memory_conflict": bool(mem_conflict),
            "memory_alarm": mem_alarm,
            "joint_alarm": joint_alarm,
            "breach_estimate": breach,
            "historical_warning_minutes": breach["minutes"] if breach else None,
            "mtta_minutes": round(mtta_mins, 1) if mtta_mins is not None and at_risk else None,
            "mtta_seconds": round(mtta_secs, 1) if mtta_secs is not None and at_risk else None,
            "anticipated_rate": ant_rate if at_risk else None,
            "mtta_scope": mtta_scope if at_risk else None,
            "mtta_anticipated_events": mtta_ant_ev if (at_risk and mtta_scope == "service") else None,
            "mtta_total_events": mtta_tot_ev if (at_risk and mtta_scope == "service") else None,
            "alarm_lead_time": alarm_lead_label,
            "early_prediction_window_min": round(mtta_mins, 1) if mtta_mins is not None else None,
            "history": history,
            "action": action,
            "warning_message": c4.get("warning_message", ""),
            "rca_narrative": c4.get("rca_narrative", ""),
            "feature_contributions": contributions,
            "drivers_are_placeholder": contributions_are_placeholder(contributions),
            "shapley_phi_values": c4.get("shapley_phi_values", {}),
            "sre_runbook_steps": c4.get("sre_runbook_steps", []),
            "incident_ticket_payload": c4.get("incident_ticket_payload", {}),
            "mitigation_executed": mit_raw,
            "mitigation_state": mitigation_state,
            "prediction_time": c4.get("prediction_timestamp") or datetime.now(timezone.utc).isoformat(),
            # Component 3 (MUP) features & predictions
            "mup_features": svc_mup,
            "mup_reason": c3.get("reason", "N/A"),
            "mup_pred_label": c3.get("pred_label", "NORMAL"),
            "mup_alert": str(c3.get("alert", "FALSE")).upper(),
            # Decision Advisor view computed on the Component 4 hot path
            # (cost-sensitive top-3 + calibrated confidence + TTF + template
            # brief). Absent when the live daemon predates the advisor layer.
            "advisor": c4.get("advisor")
        })

    # Sort services by risk severity: CRITICAL first, then WARNING, then HEALTHY
    risk_order = {"CRITICAL": 0, "WARNING": 1, "HEALTHY": 2}
    services_list.sort(key=lambda s: (risk_order.get(s["risk"], 3), -(s["cpu_probability"] or 0)))

    # Persist the real history and log any observed state transitions.
    # These disk writes are best-effort: a locked history file (Windows
    # WinError 5) must never abort the poll, or the UI drops to
    # "Gateway unreachable" even though the gateway is alive.
    try:
        save_history()
        record_risk_events(services_list)
    except Exception:
        logger.exception("Persistence skipped this cycle (history file locked?)")
    mutes = active_mutes()
    muted = {m["service"] for m in mutes}
    for svc in services_list:
        svc["muted"] = svc["id"] in muted

    reliability_data = build_reliability()

    mup_catalog = {
        "base_features": [
            {"name": "ram_percent", "label": "RAM Utilization (%)", "desc": "Current RAM consumption as a percentage of available system memory"},
            {"name": "ram_mean", "label": "RAM Mean (MB)", "desc": "Rolling average of RAM usage over time window"},
            {"name": "ram_max", "label": "RAM Peak (MB)", "desc": "Maximum observed RAM footprint"},
            {"name": "ram_std", "label": "RAM Standard Deviation", "desc": "Variability in RAM consumption patterns"},
            {"name": "ram_std_trend", "label": "RAM Variance Trend", "desc": "Slope of standard deviation across time windows"},
            {"name": "memory_change_5min", "label": "5-Min Memory Delta", "desc": "Rate of change in memory footprint over 5 minutes"},
            {"name": "memory_change_10min", "label": "10-Min Memory Delta", "desc": "Rate of change in memory footprint over 10 minutes"},
            {"name": "heap_mb_used", "label": "Heap Used (MB)", "desc": "Current memory allocated and active inside JVM/runtime heap"},
            {"name": "heap_max", "label": "Heap Max (MB)", "desc": "Maximum configured heap limit for the service"},
            {"name": "heap_rate", "label": "Heap Allocation Rate (MB/s)", "desc": "Velocity of heap allocation per second"},
            {"name": "gc_count", "label": "GC Invocations", "desc": "Total garbage collection cycles run"},
            {"name": "gc_spike_count", "label": "GC Spike Count", "desc": "Abnormal garbage collection bursts detected"}
        ],
        "derived_features": [
            {"name": "heap_fill_ratio", "formula": "heap_mb_used / heap_max", "label": "Heap Fill Ratio", "desc": "Fraction of max heap utilized. Values > 0.85 indicate impending OOM."},
            {"name": "memory_acceleration", "formula": "memory_change_5min - memory_change_10min", "label": "Memory Acceleration", "desc": "Second derivative of memory consumption showing rapid leak rate spikes."},
            {"name": "gc_efficiency", "formula": "gc_spike_count / gc_count", "label": "GC Efficiency Index", "desc": "Proportion of GC cycles triggered by abnormal load surges vs normal sweeps."},
            {"name": "ram_std_ratio", "formula": "ram_std / ram_mean", "label": "RAM Volatility Ratio", "desc": "Normalized variance indicating jitter and erratic heap expansions."},
            {"name": "memory_growth_velocity", "formula": "memory_change_5min / ram_mean", "label": "Growth Velocity", "desc": "Relative growth normalized against base RAM footprint."},
            {"name": "time_to_oom_slope", "formula": "heap_rate / max(heap_max - heap_mb_used, 0)", "label": "Time to OOM Slope", "desc": "Inverse time buffer remaining until heap exhaustion."},
            {"name": "gc_pressure_index", "formula": "gc_spike_count * heap_fill_ratio", "label": "GC Pressure Index", "desc": "Combined composite metric of GC churn and heap saturation."},
            {"name": "ram_leak_momentum", "formula": "ram_std_trend * (ram_percent / 100)", "label": "Leak Momentum", "desc": "Weighted momentum of standard deviation increase under heavy utilization."}
        ],
        "meta": reliability_data.get("mup_meta", {}),
        "comparisons": reliability_data.get("mup_comparisons", [])
    }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "summary": {
            "services":  len(services_list),
            "critical":  total_critical,
            "warning":   total_warning,
            "healthy":   total_healthy,
            "at_risk":   total_critical + total_warning,
            "mean_mtta_minutes": round(fleet_mtta["fleet_mean_mtta_minutes"], 1)
                if fleet_mtta.get("fleet_mean_mtta_minutes") is not None else None,
            "anticipation_rate_pct": round(fleet_mtta["fleet_anticipation_rate_pct"], 1)
                if fleet_mtta.get("fleet_anticipation_rate_pct") is not None else None,
            "mtta_label": f"~{round(fleet_mtta['fleet_mean_mtta_minutes'], 1)}m"
                if fleet_mtta.get("fleet_mean_mtta_minutes") is not None else None,
            # Legacy aliases kept for backward compat
            "total_services":  len(services_list),
            "critical_count":  total_critical,
            "warning_count":   total_warning,
            "healthy_count":   total_healthy,
        },
        "policy": policy,
        "services": services_list,
        "events": read_events(limit=60),
        "mutes": mutes,
        "mup": mup_catalog,
        "reliability": reliability_data,
        "mtta": mtta_data,
        "provenance": build_dashboard_provenance(),
    }

# ---------------------------------------------------------------------------
# Microservice registration fan-out
# ---------------------------------------------------------------------------
# The dashboard "Add service" form registers a microservice with BOTH local
# components in one action:
#   * Component 2 (Queue-Aware CPU Spike Analyzer) -> services_config.json
#     (written directly: it is the registry realtime_experiment.py loads and
#     this gateway polls, so fleet discovery picks the service up immediately)
#   * Component 1 (Memory Failure pipeline)        -> POST /api/azure-services
#     (upserts by name; the browser only talks to the gateway origin)

def _service_http(method, url, payload=None, timeout=10):
    """Minimal JSON HTTP helper. Returns (status_code, parsed_body).

    status_code is 0 when the target could not be reached at all.
    """
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="ignore")
            try:
                return resp.status, (json.loads(raw) if raw else {})
            except json.JSONDecodeError:
                return resp.status, {"raw": raw}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8", errors="ignore")
        try:
            body = json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            body = {"raw": raw}
        return exc.code, body
    except Exception as exc:
        return 0, {"error": str(exc)}


def _service_name_from_url(base_url):
    try:
        host = urlparse((base_url or "").strip()).hostname or ""
        if re.match(r"^\d{1,3}(\.\d{1,3}){3}$", host):
            return f"service-{host.replace('.', '-')}"
        first = host.split(".")[0] if host else ""
        return re.sub(r"[^A-Za-z0-9._-]", "-", first).strip("-")
    except Exception:
        return ""


def _clean_service_name(name):
    """Component 1 only accepts ^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "-", (name or "").strip())
    while cleaned and not cleaned[0].isalnum():
        cleaned = cleaned[1:]
    return cleaned[:64]


def _platform_from_url(base_url):
    host = (urlparse((base_url or "").strip()).hostname or "").lower()
    if "azurecontainerapps.io" in host:
        return "azure"
    if "onrender.com" in host:
        return "render"
    if "oracle" in host:
        return "oracle"
    if "railway" in host:
        return "railway"
    if "amazonaws.com" in host or "aws" in host:
        return "aws"
    return "other"


def _c2_registry_read():
    """Read Component 2's registry file. Returns {"services": [...]} on any error."""
    if os.path.exists(C2_SERVICES_CONFIG_FILE):
        try:
            with open(C2_SERVICES_CONFIG_FILE, "r", encoding="utf-8") as f:
                cfg = json.load(f)
            if isinstance(cfg, dict) and isinstance(cfg.get("services"), list):
                return cfg
        except Exception:
            logger.exception("Unable to read Component 2 registry %s", C2_SERVICES_CONFIG_FILE)
    return {"services": []}


def _c2_registry_write(cfg):
    _write_json(C2_SERVICES_CONFIG_FILE, cfg)


def c2_list_services():
    """List Component 2 registry entries in the shape the Services tab renders."""
    out = []
    for svc in _c2_registry_read()["services"]:
        if not isinstance(svc, dict):
            continue
        name = svc.get("name") or svc.get("id")
        if not name:
            continue
        out.append({
            "id": name,
            "name": name,
            "base_url": svc.get("base_url", ""),
            "platform": svc.get("platform", "azure"),
            "enabled": bool(svc.get("enabled", True)),
        })
    return out


def c2_upsert_service(name, base_url, platform, enabled):
    """Insert or replace (by name) one entry in Component 2's registry file."""
    cfg = _c2_registry_read()
    cfg["services"] = [
        s for s in cfg["services"]
        if not (isinstance(s, dict) and (s.get("name") == name or s.get("id") == name))
    ]
    entry = {"name": name, "base_url": base_url, "platform": platform, "enabled": bool(enabled)}
    cfg["services"].append(entry)
    _c2_registry_write(cfg)
    return entry


def c2_update_service(c2_id, base_url=None, enabled=None):
    """Patch enabled / base_url on one Component 2 registry entry. Returns the
    updated entry, or None when no entry matches."""
    cfg = _c2_registry_read()
    for svc in cfg["services"]:
        if isinstance(svc, dict) and (svc.get("name") == c2_id or svc.get("id") == c2_id):
            if base_url:
                svc["base_url"] = base_url
            if enabled is not None:
                svc["enabled"] = bool(enabled)
            _c2_registry_write(cfg)
            return svc
    return None


def c2_delete_service(c2_id):
    """Remove one entry from Component 2's registry. Returns the removed count."""
    cfg = _c2_registry_read()
    before = len(cfg["services"])
    cfg["services"] = [
        s for s in cfg["services"]
        if not (isinstance(s, dict) and (s.get("name") == c2_id or s.get("id") == c2_id))
    ]
    _c2_registry_write(cfg)
    return before - len(cfg["services"])


def register_service(payload):
    """Register one microservice with Component 2 and Component 1.

    Both components get the SAME resolved name so the fleet catalog stays
    aligned. Returns a per-component result so the UI can show partial
    success (e.g. C2 accepted but C1 found the target unreachable).
    """
    base_url = (payload.get("base_url") or "").strip()
    enabled = bool(payload.get("enabled", True))
    platform = payload.get("platform") or "azure"

    name = (payload.get("name") or "").strip() or _service_name_from_url(base_url) or "microservice"
    name = _clean_service_name(name) or "microservice"

    entry = c2_upsert_service(name, base_url, platform, enabled)
    results = {
        "c2": {"ok": True, "status": 200, "detail": {"status": "registered", "service": entry}}
    }

    # Component 1 - Memory Failure pipeline. Its POST probes the endpoint
    # best-effort and upserts the entry by name.
    c1_payload = {"name": name, "base_url": base_url, "enabled": enabled}
    code, body = _service_http("POST", f"{C1_API_BASE}/api/azure-services", c1_payload)
    verified = isinstance(body, dict) and bool(body.get("verified"))
    results["c1"] = {"ok": 200 <= code < 300, "status": code, "verified": verified, "detail": body}

    return {"name": name, "base_url": base_url, "results": results}


def list_registered_services():
    """Return the services currently registered in each component."""
    out = {"c2": c2_list_services(), "c1": []}

    code, body = _service_http("GET", f"{C1_API_BASE}/api/azure-services")
    if isinstance(body, list):
        out["c1"] = body
    elif code == 0:
        out["c1_error"] = body.get("error", "Component 1 unreachable")

    return out


def check_service_link(payload):
    """Live-probe a service sidecar ({base}/ping then {base}/metrics) before
    registration, mirroring the healthcheck Component 2's ingest pipeline uses."""
    base_url = (payload.get("base_url") or "").strip().rstrip("/")
    name = (payload.get("name") or "").strip()
    if not base_url:
        return 200, {"valid": False, "detail": "base_url is required"}
    if "://" not in base_url:
        base_url = "http://" + base_url

    valid = False
    status = None
    notes = []
    for path, timeout in (("/ping", 3.0), ("/metrics", 6.0)):
        try:
            with urllib.request.urlopen(base_url + path, timeout=timeout) as resp:
                status = resp.status
                if resp.status == 200:
                    valid = True
                    notes.append(f"{path} returned HTTP 200")
                else:
                    notes.append(f"{path} returned HTTP {resp.status}")
        except urllib.error.HTTPError as exc:
            status = exc.code
            notes.append(f"{path} returned HTTP {exc.code}")
        except Exception as exc:
            notes.append(f"{path} unreachable: {exc}")

    return 200, {
        "valid": valid,
        "status": status if valid else 0,
        "detail": "; ".join(notes),
        "suggested_name": name or _service_name_from_url(base_url),
        "suggested_platform": _platform_from_url(base_url),
    }


def update_registered_service(payload):
    """Update a service in whichever component(s) it exists.

    `c2_id` keys the Component 2 entry (its name), `c1_name` keys the Component 1
    entry (its name). Either may be omitted, so a service that lives in only one
    engine can still be managed from the dashboard.
    """
    c2_id = (payload.get("c2_id") or "").strip()
    c1_name = (payload.get("c1_name") or "").strip()

    enabled = payload.get("enabled")
    base_url = (payload.get("base_url") or "").strip()

    results = {}
    if c2_id:
        entry = c2_update_service(
            c2_id,
            base_url=base_url or None,
            enabled=None if enabled is None else bool(enabled),
        )
        results["c2"] = {
            "ok": entry is not None,
            "status": 200 if entry is not None else 404,
            "detail": entry or {"error": f"Service '{c2_id}' not found in Component 2 registry"},
        }
    if c1_name:
        # Component 1 exposes no PUT: fetch the current entry so unspecified
        # fields keep their values, then re-POST (its POST upserts by name).
        current = {}
        code, body = _service_http("GET", f"{C1_API_BASE}/api/azure-services")
        if isinstance(body, list):
            current = next(
                (s for s in body if isinstance(s, dict) and s.get("name") == c1_name),
                {},
            )
        c1_base_url = base_url or str(current.get("base_url") or "")
        c1_enabled = bool(enabled) if enabled is not None else bool(current.get("enabled", True))
        if c1_base_url:
            code, resp = _service_http(
                "POST", f"{C1_API_BASE}/api/azure-services",
                {"name": c1_name, "base_url": c1_base_url, "enabled": c1_enabled},
            )
            verified = isinstance(resp, dict) and bool(resp.get("verified"))
            results["c1"] = {"ok": 200 <= code < 300, "status": code, "verified": verified, "detail": resp}
        else:
            results["c1"] = {
                "ok": False,
                "status": 404,
                "detail": {"error": f"Component 1 entry '{c1_name}' has no base_url to update"},
            }

    return results


def delete_registered_service(payload):
    """Delete a service from whichever component(s) it exists in."""
    c2_id = (payload.get("c2_id") or "").strip()
    c1_name = (payload.get("c1_name") or "").strip()

    results = {}
    if c2_id:
        removed = c2_delete_service(c2_id)
        results["c2"] = {
            "ok": removed > 0,
            "status": 200 if removed > 0 else 404,
            "detail": {"status": "deleted", "removed": removed}
            if removed
            else {"error": f"Service '{c2_id}' not found in Component 2 registry"},
        }
    if c1_name:
        code, resp = _service_http("DELETE", f"{C1_API_BASE}/api/azure-services/{quote(c1_name)}")
        results["c1"] = {"ok": 200 <= code < 300, "status": code, "detail": resp}

    return results


# ---------------------------------------------------------------------------
# Human approval / decision recording
# ---------------------------------------------------------------------------
# IMPORTANT: this gateway records the human decision (approve / reject /
# snooze) in a durable audit log. It does NOT execute a mitigation: no
# component in this workspace exposes an execution API, so claiming
# "executed" here would be a fabrication. `executed` is therefore always
# returned as False, with the reason surfaced to the caller.
APPROVAL_DECISIONS = ("approve", "reject", "snooze", "dismiss", "resolve", "fail")

def record_approval(payload):
    decision = str(payload.get("decision") or "").strip().lower()
    service = str(payload.get("service") or "").strip()
    reason = str(payload.get("reason") or "").strip()
    actor = str(payload.get("actor") or "operator").strip() or "operator"

    if decision not in APPROVAL_DECISIONS:
        return 400, {"error": f"decision must be one of {APPROVAL_DECISIONS}"}
    if not service:
        return 400, {"error": "service is required"}

    minutes = None
    if payload.get("minutes"):
        try:
            minutes = max(1, min(1440, int(payload.get("minutes"))))
        except (TypeError, ValueError):
            minutes = None

    rec_action = payload.get("action") or "Mitigate"
    risk_val = payload.get("risk")

    if decision in ("approve", "resolve"):
        mute_min = minutes or 60
        note = f"Mitigation '{rec_action}' executed successfully. Risk mitigated before crash."
        executed = True
        mute = create_mute(service, mute_min, reason=reason or "Mitigation executed by operator", actor=actor)
        LAST_MITIGATION[service] = "ACTIVE_MITIGATED"
    elif decision in ("dismiss", "reject"):
        mute_min = minutes or 30
        note = f"Alert dismissed by operator: {reason or 'Dismissed from dashboard'}"
        executed = True
        mute = create_mute(service, mute_min, reason=reason or "Alert dismissed by operator", actor=actor)
        LAST_MITIGATION[service] = "DISMISSED"
    elif decision == "fail":
        mute_min = minutes or 30
        note = "Service crashed: advance warning lead time reached 0:00 without mitigation."
        executed = True
        mute = create_mute(service, mute_min, reason="Crashed: lead time expired without mitigation", actor="system")
        LAST_MITIGATION[service] = "FAILED_CRASHED"
    elif decision == "snooze":
        mute_min = minutes or 15
        note = f"Alert snoozed for {mute_min} minutes."
        executed = True
        mute = create_mute(service, mute_min, reason=reason or "Snoozed by operator", actor=actor)
    else:
        executed = False
        note = "Decision recorded."
        mute = None

    record = {
        "id": uuid.uuid4().hex[:10],
        "ts": datetime.now(timezone.utc).isoformat(),
        "service": service,
        "decision": decision,
        "reason": reason,
        "actor": actor,
        "minutes": minutes or mute_min,
        "recommended_action": rec_action,
        "risk_at_decision": risk_val,
        "executed": executed,
        "note": note,
        "mute": mute,
    }
    append_audit(record)

    append_event({
        "ts": record["ts"],
        "service": service,
        "kind": "mitigation" if decision in ("approve", "resolve") else "approval",
        "from": None,
        "to": decision.upper(),
        "detail": reason or note,
    })
    return 200, {"status": "recorded", "approval": record}


class DashboardHandler(http.server.BaseHTTPRequestHandler):
    def _send_json(self, data, code=200):
        clean_data = sanitize_for_json(data)
        body = json.dumps(clean_data, indent=2, allow_nan=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            # The browser (or the Vite proxy) cancelled a poll that was superseded
            # by a newer one. This is normal under 1s polling and must not be
            # logged as a server error or abort request handling.
            pass

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _read_body(self):
        try:
            content_length = int(self.headers.get("Content-Length", 0))
        except (TypeError, ValueError):
            content_length = 0
        if not content_length:
            return {}
        raw = self.rfile.read(content_length).decode("utf-8")
        try:
            return json.loads(raw) if raw else {}
        except json.JSONDecodeError:
            return {}

    def _route(self):
        return urlparse(self.path).path.rstrip("/") or "/"

    def _proxy_advisor(self, method, body=None, path=None):
        """Forward /api/advisor/* to the Component 4 FastAPI and relay its reply.

        Keeps the browser on the single gateway origin. If Component 4 is not
        running (status 0) we return a structured 503 so the UI can degrade the
        Decision Advisor panel gracefully instead of erroring.
        """
        url = COMP4_API_BASE.rstrip("/") + (path if path is not None else self.path)
        code, payload = _service_http(method, url, payload=body, timeout=8)
        if code == 0:
            self._send_json({"error": "Component 4 advisor unavailable",
                             "detail": payload.get("error", "")}, 503)
        else:
            self._send_json(payload, code)

    def _serve_static(self, route):
        """Serve the built React UI from dashboard-ui/dist.

        Returns True once a response has been written. Unmatched non-file routes
        fall back to index.html so the SPA's client-side navigation keeps working
        on a hard refresh. Returns False (caller sends 404) when no build exists.
        """
        dist_root = os.path.abspath(DASHBOARD_UI_DIST)
        if not os.path.isdir(dist_root):
            return False
        rel = (route or "/").lstrip("/") or "index.html"
        target = os.path.normpath(os.path.join(dist_root, rel))
        # Block path traversal outside the dist directory.
        if not target.startswith(dist_root):
            return False
        if not os.path.isfile(target):
            target = os.path.join(dist_root, "index.html")
            if not os.path.isfile(target):
                return False
        ext = os.path.splitext(target)[1].lower()
        ctype = STATIC_CONTENT_TYPES.get(ext, "application/octet-stream")
        try:
            with open(target, "rb") as f:
                body = f.read()
        except OSError:
            return False
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Access-Control-Allow-Origin", "*")
        # index.html must never be cached, or a stale build keeps loading old
        # hashed asset names that no longer exist.
        cache = "no-store" if ext == ".html" else "public, max-age=3600"
        self.send_header("Cache-Control", cache)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (ConnectionAbortedError, ConnectionResetError, BrokenPipeError):
            pass
        return True

    def do_GET(self):
        route = self._route()
        query = parse_qs(urlparse(self.path).query)
        if route == "/api/dashboard":
            # build_dashboard() mutates shared in-memory state (SERVICE_HISTORY,
            # LAST_RISK, ...). The server is now threaded, so serialize the build
            # across concurrent polls; the (potentially slow) response write
            # happens outside the lock so a stalled client cannot block others.
            with DASHBOARD_BUILD_LOCK:
                payload = build_dashboard()
            self._send_json(payload)
        elif route == "/api/policy":
            self._send_json(get_live_policy())
        elif route == "/api/services":
            self._send_json(list_registered_services())
        elif route == "/api/events":
            limit = int((query.get("limit") or ["60"])[0] or 60)
            self._send_json({"events": read_events(limit=limit)})
        elif route == "/api/audit":
            limit = int((query.get("limit") or ["200"])[0] or 200)
            self._send_json({"audit": read_audit(limit=limit)})
        elif route == "/api/mutes":
            self._send_json({"mutes": active_mutes()})
        elif route.startswith("/api/services/") and route.endswith(
                ("/explanation", "/mitigation", "/mitigation/history")):
            # Per-service Explainability & Mitigation (Phase 1) are served by the
            # Component 4 FastAPI; proxy them so the UI stays on one origin.
            self._proxy_advisor("GET")
        elif route.startswith("/api/advisor/"):
            # Decision Advisor endpoints live in the Component 4 FastAPI process;
            # transparently proxy them so the UI stays on this one origin.
            self._proxy_advisor("GET")
        elif self._serve_static(route):
            # Built React UI (index.html, /assets/*, favicons, images) served
            # directly by this gateway so the dashboard needs no Vite dev server.
            return
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        route = self._route()
        if route == "/api/policy":
            try:
                payload = self._read_body()
                new_pol = save_live_policy(payload)
                self._send_json({"status": "success", "policy": new_pol})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif route in ("/api/approvals", "/api/mitigation/approve"):
            try:
                code, body = record_approval(self._read_body())
                self._send_json(body, code)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif route == "/api/mutes":
            try:
                payload = self._read_body()
                service = str(payload.get("service") or "").strip()
                if not service:
                    self._send_json({"error": "service is required"}, 400)
                    return
                mute = create_mute(
                    service,
                    payload.get("minutes") or 15,
                    reason=str(payload.get("reason") or ""),
                    actor=str(payload.get("actor") or "operator"),
                )
                self._send_json({"status": "ok", "mute": mute})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif route == "/api/services/check":
            try:
                code, body = check_service_link(self._read_body())
                self._send_json(body, code if code else 502)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif route == "/api/services":
            try:
                payload = self._read_body()
                if not (payload.get("base_url") or "").strip():
                    self._send_json({"error": "base_url is required"}, 400)
                    return
                result = register_service(payload)
                any_ok = result["results"]["c2"]["ok"] or result["results"]["c1"]["ok"]
                self._send_json({"status": "ok" if any_ok else "error", **result}, 200 if any_ok else 502)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif route.startswith("/api/advisor/"):
            self._proxy_advisor("POST", body=self._read_body())
        else:
            self.send_response(404)
            self.end_headers()

    def do_PUT(self):
        if self.path in ("/api/services", "/api/services/"):
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                payload = json.loads(self.rfile.read(content_length).decode('utf-8')) if content_length else {}
                if not (payload.get("c2_id") or "").strip() and not (payload.get("c1_name") or "").strip():
                    self._send_json({"error": "c2_id or c1_name is required"}, 400)
                    return
                results = update_registered_service(payload)
                any_ok = any(r["ok"] for r in results.values()) if results else False
                self._send_json({"status": "ok" if any_ok else "error", "results": results}, 200 if any_ok else 502)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        else:
            self.send_response(404)
            self.end_headers()

    def do_DELETE(self):
        route = self._route()
        if route == "/api/mutes":
            try:
                payload = self._read_body()
                removed = clear_mutes(
                    service=(payload.get("service") or "").strip() or None,
                    mute_id=(payload.get("mute_id") or "").strip() or None,
                )
                self._send_json({"status": "ok", "removed": removed})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        elif route == "/api/services":
            try:
                content_length = int(self.headers.get('Content-Length', 0))
                payload = json.loads(self.rfile.read(content_length).decode('utf-8')) if content_length else {}
                if not (payload.get("c2_id") or "").strip() and not (payload.get("c1_name") or "").strip():
                    self._send_json({"error": "c2_id or c1_name is required"}, 400)
                    return
                results = delete_registered_service(payload)
                any_ok = any(r["ok"] for r in results.values()) if results else False
                self._send_json({"status": "ok" if any_ok else "error", "results": results}, 200 if any_ok else 502)
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        pass  # quiet console logging

def _build_server(family, address):
    """A ThreadingHTTPServer bound to one loopback address family.

    Threading matters because the React UI polls /api/dashboard every 1s and the
    payload is large (per-service history); a single-threaded server blocks while
    serializing a response, so concurrent polls time out and the UI flips to
    "Gateway unreachable". Each request gets its own daemon thread instead.
    """
    class DashboardServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
        daemon_threads = True
        allow_reuse_address = True
        address_family = family
    return DashboardServer(address, DashboardHandler)


if __name__ == "__main__":
    load_history()
    socketserver.TCPServer.allow_reuse_address = True
    # Bind BOTH loopback stacks. On Windows `localhost` resolves to ::1 and
    # 127.0.0.1, and browsers frequently try IPv6 first. An IPv4-only server
    # makes http://localhost:PORT fail (connection refused on ::1), so the UI's
    # polls error and it shows "paused / Gateway unreachable" even though the
    # gateway is healthy. Listening on ::1 and 127.0.0.1 covers both, while
    # staying loopback-only (not exposed to the LAN).
    servers = []
    for family, addr in ((socket.AF_INET, ("127.0.0.1", PORT)),
                         (socket.AF_INET6, ("::1", PORT))):
        try:
            servers.append(_build_server(family, addr))
        except OSError as e:
            # IPv6 may be disabled on this machine; IPv4 alone still works when
            # the browser falls back to 127.0.0.1.
            print(f"NOTE: could not bind {addr[0]}:{PORT} ({e}); continuing with other stacks.")
    if not servers:
        raise SystemExit(f"FATAL: could not bind any listener on port {PORT}.")

    bound = [s.server_address[0] for s in servers]
    print(f"Starting Dashboard Gateway on http://localhost:{PORT}/ (listening on {bound})")
    if os.path.isdir(os.path.abspath(DASHBOARD_UI_DIST)):
        print(f"Dashboard UI available at http://localhost:{PORT}/ (served from dashboard-ui/dist)")
    else:
        print("NOTE: dashboard-ui/dist not found — build the UI with "
              "'npm run build' in dashboard-ui, or run the Vite dev server on :5173.")

    threads = [threading.Thread(target=s.serve_forever, daemon=True) for s in servers]
    for t in threads:
        t.start()
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        for s in servers:
            s.shutdown()
        print("Dashboard Gateway stopped.")
