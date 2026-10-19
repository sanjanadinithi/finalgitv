"""
Component 3 -- Live Feed Simulator (Optimized with Hot-Reloading & Streaming SHAP)

Replays ml_ready_dataset.csv row-by-row into live_feed.csv using an in-memory
circular buffer (rolling 200 rows) to eliminate disk read bottlenecks.
Calculates live memory predictions using feature engineering, supports model bundle
hot-reloading when modified on disk, and sends streaming SHAP feature attributions
to the Component 4 REST API.
"""

import sys
import os
import time
import json
import urllib.request
import urllib.error
from datetime import datetime
from collections import deque

import warnings
warnings.filterwarnings("ignore")

sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)

import pandas as pd
import numpy as np
import joblib
import shap

# Feature engineering import
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import compute_derived_features, ALL_FEATURES, BASE_FEATURES

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMP1_DATA = os.path.abspath(os.path.join(BASE, "..", "component1", "output", "ml_ready_dataset.csv"))
HPMFD_DATA = os.path.abspath(os.path.join(BASE, "..", "..", "..", "HPMFD", "output", "ml_ready_dataset.csv"))
LOCAL_DATA = os.path.join(BASE, "data", "ml_ready_dataset.csv")


def resolve_input_csv() -> str:
    for path in (COMP1_DATA, HPMFD_DATA, LOCAL_DATA):
        if os.path.exists(path):
            return path
    return LOCAL_DATA


INPUT_CSV = resolve_input_csv()
DATA_DIR = os.path.join(BASE, "data")
LIVE_CSV = os.path.join(DATA_DIR, "live_feed.csv")
PRED_CSV = os.path.join(DATA_DIR, "memory_predictions.csv")
MODEL_PATH = os.path.join(BASE, "models", "memory_leak_rf_model.pkl")
DELAY = 0.3  # seconds between rows

# Component 4 and the dashboard gateway read the two feed files from data/, which
# is git-ignored and therefore absent on a fresh clone — create it up front so the
# first to_csv() does not fail with FileNotFoundError.
os.makedirs(DATA_DIR, exist_ok=True)

FEATURES = ALL_FEATURES

# Model state
model = None
scaler = None
explainer = None
ALARM_THRESHOLD = 0.6
failure_idx = 1
last_model_mtime = 0.0


def check_and_reload_model() -> None:
    """Hot-reload model bundle from disk if missing or if file mtime changed."""
    global model, scaler, explainer, FEATURES, ALARM_THRESHOLD, failure_idx, last_model_mtime

    if not os.path.exists(MODEL_PATH):
        if model is None:
            print(f"[WARNING] Model bundle not found at {MODEL_PATH}. "
                  f"Every prediction will be 0.0000/NORMAL. "
                  f"Run 'python scripts/train_model.py' first.")
        return

    try:
        current_mtime = os.path.getmtime(MODEL_PATH)
        if model is not None and current_mtime <= last_model_mtime:
            return

        print(f"[simulate_live] Loading/Reloading model bundle from {MODEL_PATH}...")
        bundle = joblib.load(MODEL_PATH)
        model = bundle["model"]
        scaler = bundle["scaler"]
        FEATURES = bundle.get("features", ALL_FEATURES)
        ALARM_THRESHOLD = bundle.get("threshold", 0.6)

        if hasattr(model, "classes_"):
            try:
                failure_idx = list(model.classes_).index("FAILURE")
            except ValueError:
                failure_idx = 1
        else:
            failure_idx = 1

        # Pre-build SHAP explainer for tree models
        try:
            if hasattr(model, "feature_importances_"):
                explainer = shap.TreeExplainer(model)
            else:
                explainer = None
        except Exception:
            explainer = None

        last_model_mtime = current_mtime
        print(f"[simulate_live] Model bundle reloaded successfully. Threshold={ALARM_THRESHOLD:.4f}, Features={len(FEATURES)}")

    except Exception as e:
        print(f"[WARNING] Failed to load model bundle: {e}. Running with previous/dummy mode.")


FEATURE_REASON_MAP = {
    "heap_mb_used": "High Heap Memory Saturation",
    "heap_fill_ratio": "Critical Heap Fill Capacity",
    "ram_percent": "High RAM Percentage Usage",
    "ram_std_ratio": "Rapid Memory Growth Volatility",
    "gc_spike_count": "Garbage Collection Frequent Spikes",
    "incident_phase_2": "Sustained Late-Stage Memory Leak Accumulation",
    "incident_phase_1": "Early-Stage Memory Accumulation Trend",
    "gc_efficiency": "Low Garbage Collection Recycling Efficiency",
    "ram_max": "Peak RAM Usage Exceeded Threshold",
    "heap_max": "Maximum Heap Capacity Pressure",
    "memory_growth_velocity": "Rapid Memory Growth Velocity",
    "time_to_oom_slope": "Critical Heap Headroom Depletion (OOM Proximity)",
    "gc_pressure_index": "Garbage Collection Thrashing & Heap Saturation",
    "ram_leak_momentum": "Expanding RAM Volatility Momentum",
}


def derive_alert_reason(shapley_phi_values: dict, row: pd.Series) -> str:
    """Derive human-readable root cause reason for memory leak prediction."""
    if shapley_phi_values:
        # Pick top positive SHAP contributors
        pos_shap = [f for f, v in shapley_phi_values.items() if v > 0]
        if pos_shap:
            pos_shap_sorted = sorted(pos_shap, key=lambda f: shapley_phi_values[f], reverse=True)[:2]
            reasons = [FEATURE_REASON_MAP.get(f, f.replace("_", " ").title()) for f in pos_shap_sorted]
            return ", ".join(reasons)

    # Fallback to feature values if SHAP not available
    reasons = []
    if row.get("heap_mb_used", 0) > 400 or row.get("heap_fill_ratio", 0) > 0.75:
        reasons.append("High Heap Memory Saturation")
    if row.get("ram_percent", 0) > 75:
        reasons.append("High RAM Percentage Usage")
    if row.get("gc_spike_count", 0) > 2:
        reasons.append("Frequent Garbage Collection Spikes")

    return ", ".join(reasons) if reasons else "Sustained Memory Utilization Growth"


def send_prediction_to_comp4(
    service_name: str,
    project_id: str,
    prob: float,
    alert: str,
    label: str,
    shapley_phi_values: dict = None,
    reason: str = "N/A",
) -> tuple[bool, str]:
    url = "http://127.0.0.1:8000/predict"
    payload = {
        "service_name": service_name,
        "project_id": project_id,
        "comp2_cpu": {
            "cpu_percent": 0.0,
            "cpu_velocity": 0.0,
            "cpu_trend_5min": 0.0,
            "cpu_trend_10min": 0.0,
            "in_flight_queue": 0.0,
            "incoming_rate": 0.0,
            "processing_rate": 0.0,
            "queue_growth_rate": 0.0,
            "overload_flag": 0,
            "queue_pressure_index": 0.0,
        },
        "comp3_memory": {
            "memory_prob": round(prob, 4),
            "alert": str(alert).upper(),
            "pred_label": str(label).upper(),
            "reason": reason,
            "shapley_phi_values": shapley_phi_values or {},
        },
    }

    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=1.0) as response:
            return True, response.read().decode("utf-8")
    except urllib.error.URLError as e:
        if isinstance(e.reason, TimeoutError) or "timed out" in str(e.reason).lower():
            return False, "timed out"
        return False, "connection refused"
    except Exception as e:
        return False, str(e)


def predict_row(row) -> tuple:
    """Run the model + streaming SHAP for a single telemetry row.

    Returns (prob_failure, alert, pred_label, shapley_phi_values). Reads the
    module-level model state maintained by check_and_reload_model()."""
    shapley_phi_values = {}
    if model is not None and scaler is not None:
        try:
            row_features = pd.DataFrame([row[FEATURES]])
            X_scaled = scaler.transform(row_features)
            probs = model.predict_proba(X_scaled)
            prob_failure = float(probs[0][failure_idx])

            alert = "TRUE" if prob_failure >= ALARM_THRESHOLD else "FALSE"
            pred_label = "FAILURE" if prob_failure >= ALARM_THRESHOLD else "NORMAL"

            if explainer is not None:
                try:
                    sv = explainer.shap_values(X_scaled)
                    if isinstance(sv, list):
                        sv = sv[failure_idx]
                    elif hasattr(sv, "ndim") and sv.ndim == 3:
                        sv = sv[:, :, failure_idx]
                    sv_flat = sv[0] if sv.ndim > 1 else sv
                    shapley_phi_values = {
                        feat: round(float(val), 4)
                        for feat, val in zip(FEATURES, sv_flat)
                    }
                except Exception:
                    shapley_phi_values = {}
        except Exception as e:
            print(f"  [ERROR] Prediction failed: {e}")
            prob_failure = 0.0
            alert = "FALSE"
            pred_label = "NORMAL"
    else:
        prob_failure = 0.0
        alert = "FALSE"
        pred_label = "NORMAL"
    return prob_failure, alert, pred_label, shapley_phi_values


def main() -> None:
    check_and_reload_model()

    if not os.path.exists(INPUT_CSV):
        print(f"[ERROR] Input CSV not found at {INPUT_CSV}")
        sys.exit(1)

    df_raw = pd.read_csv(INPUT_CSV)
    df_raw.dropna(subset=BASE_FEATURES, inplace=True)

    # Compute derived features on the full dataset once for smooth streaming
    df_engineered = compute_derived_features(df_raw)
    total = len(df_engineered)

    print("\n" + "=" * 65)
    print("  MUP Live Streaming Simulator -- Component 3")
    print("=" * 65)
    print(f"  Source Dataset   : {INPUT_CSV}")
    print(f"  Total Telemetry  : {total} rows")
    print(f"  Stream Interval  : {DELAY}s per row")
    print(f"  Active Model     : {MODEL_PATH}")
    print(f"  Alert Threshold  : {ALARM_THRESHOLD:.4f}")
    print(f"  Target API       : http://127.0.0.1:8000/predict")
    print("=" * 65 + "\n")

    # Per-service latest-row snapshots.
    # Keyed by service_name; only the most recent row for each service is kept.
    # This guarantees every service MUP knows about always appears in the live
    # feed, instead of just whichever service happens to be inside a rolling
    # 200-row window (which left other services' memory details empty).
    # Per-service rolling history for BOTH output files. Keeping a bounded history
    # PER service (instead of one global window) guarantees every monitored service
    # always has rows present, so the dashboard's "last row per service" read still
    # finds the current value while the files also retain recent past readings.
    LIVE_HIST_MAX = 50
    PRED_HIST_MAX = 100
    live_history = {}   # service -> deque of recent telemetry rows (oldest..newest)
    pred_history = {}   # service -> deque of recent prediction rows (oldest..newest)

    def _append_hist(store, key, row, maxlen):
        dq = store.get(key)
        if dq is None:
            dq = deque(maxlen=maxlen)
            store[key] = dq
        dq.append(row)

    def _flatten(store):
        out = []
        for dq in store.values():
            out.extend(list(dq))
        return out

    # Seed the snapshots with the most recent row for every service so the
    # dashboard shows memory details for all services immediately on startup,
    # rather than waiting for the sequential replay (0.3s/row over ~23k rows)
    # to reach each service block.
    seed_rows = {}
    for _, r in df_engineered.iterrows():
        seed_rows[str(r.get("service_name", "unknown"))] = r
    seed_ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    for s_name, r in seed_rows.items():
        p, a, lbl, phi = predict_row(r)
        live_row = r.to_dict()
        live_row["timestamp"] = seed_ts
        _append_hist(live_history, s_name, live_row, LIVE_HIST_MAX)
        _append_hist(pred_history, s_name, {
            "timestamp": seed_ts,
            "service_name": s_name,
            "project_id": str(r.get("project_id", "Proj_01")),
            "memory_prob": round(p, 4),
            "alert": a,
            "pred_label": lbl,
            "reason": derive_alert_reason(phi, r) if a == "TRUE" else "N/A",
        }, PRED_HIST_MAX)
    if live_history:
        pd.DataFrame(_flatten(live_history)).to_csv(LIVE_CSV, index=False)
        pd.DataFrame(_flatten(pred_history)).to_csv(PRED_CSV, index=False)
        print(f"[simulate_live] Seeded {len(live_history)} services into the live feed.\n")

    while True:
        for idx, row in df_engineered.iterrows():
            check_and_reload_model()

            prob_failure, alert, pred_label, shapley_phi_values = predict_row(row)

            timestamp_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            svc = str(row.get("service_name", "unknown"))
            proj = str(row.get("project_id", "Proj_01"))
            reason_str = derive_alert_reason(shapley_phi_values, row) if alert == "TRUE" else "N/A"

            # 1. Update the per-service latest live-feed snapshot and rewrite feed
            live_row = row.to_dict()
            live_row["timestamp"] = timestamp_str
            _append_hist(live_history, svc, live_row, LIVE_HIST_MAX)
            pd.DataFrame(_flatten(live_history)).to_csv(LIVE_CSV, index=False)

            # 2. Update the per-service latest prediction snapshot and rewrite file
            pred_row = {
                "timestamp": timestamp_str,
                "service_name": svc,
                "project_id": proj,
                "memory_prob": round(prob_failure, 4),
                "alert": alert,
                "pred_label": pred_label,
                "reason": reason_str,
            }
            _append_hist(pred_history, svc, pred_row, PRED_HIST_MAX)
            pd.DataFrame(_flatten(pred_history)).to_csv(PRED_CSV, index=False)

            # 3. Send payload to Component 4 REST API
            success, msg = send_prediction_to_comp4(
                svc, proj, prob_failure, alert, pred_label, shapley_phi_values, reason_str
            )
            api_status = "[API: SENT]" if success else f"[API: OFFLINE ({msg})]"

            if alert == "TRUE":
                status_tag = f"⚠️ [ALERT - MEMORY LEAK] (Reason: {reason_str})"
            else:
                status_tag = "✅ [NORMAL]"

            print(
                f"[{timestamp_str}] [{proj:<9}] {svc:<18} | Prob: {prob_failure:.4f} | {status_tag} | {api_status}"
            )

            time.sleep(DELAY)

        print("\n[simulate_live] Telemetry stream end reached. Restarting loop...\n")


if __name__ == "__main__":
    main()
