"""
live_mtta.py — Empirical Per-Service Mean Time To Anticipate (MTTA) Generator
=============================================================================
Calculates the advance warning lead time (MTTA) and anticipation rate for each
individual microservice in the live fleet using the research dataset.

Keyed by real fleet service names (e.g., microservice-06-azure, srv-da5trtu..., etc.)
so that the dashboard can display authentic per-service advance warning times
rather than a single model-wide fallback average.
"""

import os
import json
import logging
import pandas as pd
import numpy as np

logger = logging.getLogger(__name__)

_CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
_WORKSPACE_ROOT = os.path.dirname(os.path.dirname(_CURRENT_DIR))

DEFAULT_C2_DATASET = os.path.join(
    _WORKSPACE_ROOT, "c2", "Queue-Aware CPU Spike Analyzer",
    "research_framework", "final_research_dataset.csv"
)

DEFAULT_OUTPUT_JSON = os.path.join(
    _WORKSPACE_ROOT, "cpu_spike_predictor", "outputs", "live_mtta_by_service.json"
)


def compute_live_mtta_by_service(
    dataset_path: str = DEFAULT_C2_DATASET,
    output_path: str = DEFAULT_OUTPUT_JSON,
    window_minutes: int = 20,
) -> dict:
    """
    Computes empirical MTTA and anticipation metrics for each service in the dataset.
    
    For each failure start (actual_failure transition 0 -> 1):
      Looks back up to `window_minutes` (default 20 minutes) for the earliest
      danger alarm (system_state == 'DANGEROUS').
      MTTA = T_failure - T_earliest_alarm (in seconds/minutes).
    """
    if not os.path.exists(dataset_path):
        logger.warning("C2 dataset not found at %s", dataset_path)
        return {}

    logger.info("Computing per-service live MTTA from %s...", dataset_path)
    df = pd.read_csv(
        dataset_path,
        usecols=["service", "timestamp", "actual_failure", "system_state"]
    )

    services_mtta = {}
    window_seconds = window_minutes * 60

    for svc in df["service"].unique():
        sub = df[df["service"] == svc].sort_values("timestamp").reset_index(drop=True)
        sub["fail_start"] = (sub["actual_failure"] == 1) & (sub["actual_failure"].shift(1, fill_value=0) == 0)
        fails = sub[sub["fail_start"] == True]["timestamp"].tolist()
        
        if not fails:
            continue

        leads = []
        for tf in fails:
            win = sub[(sub["timestamp"] >= tf - window_seconds) & (sub["timestamp"] < tf)]
            alarms = win[win["system_state"] == "DANGEROUS"]
            if not alarms.empty:
                ta = alarms["timestamp"].min()
                leads.append(tf - ta)

        tot = len(fails)
        ant = len(leads)
        rate = round(ant / tot * 100.0, 1) if tot > 0 else 0.0
        mean_sec = round(float(np.mean(leads)), 1) if leads else None
        mean_min = round(mean_sec / 60.0, 1) if mean_sec is not None else None
        min_sec = round(float(min(leads)), 1) if leads else None
        max_sec = round(float(max(leads)), 1) if leads else None

        services_mtta[svc] = {
            "service": svc,
            "total_events": tot,
            "anticipated_events": ant,
            "anticipation_rate_pct": rate,
            "mean_mtta_seconds": mean_sec,
            "mean_mtta_minutes": mean_min,
            "min_mtta_seconds": min_sec,
            "max_mtta_seconds": max_sec,
            "formatted_lead_time": f"~{mean_min}m early" if mean_min is not None else None,
        }

    payload = {
        "generated_at": pd.Timestamp.now().isoformat(),
        "source": os.path.basename(dataset_path),
        "window_minutes": window_minutes,
        "services": services_mtta,
    }

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)

    logger.info("Saved per-service MTTA for %d services to %s", len(services_mtta), output_path)
    return payload


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    compute_live_mtta_by_service()
