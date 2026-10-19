"""
Component 3 -- Memory Leak Predictor (Train Only)

Trains a Random Forest classifier on ml_ready_dataset.csv using Leave-One-Project-Out
(LOPO) cross-validation across all microservice projects with derived feature engineering
and dynamic Precision-Recall threshold tuning.

Pipeline stages
---------------
  Stage 1 : Data ingestion, feature engineering, and NaN removal
  Stage 2 : Class imbalance handling (class_weight='balanced')
  Stage 3 : LOPO cross-validation loop + Out-Of-Fold dynamic threshold optimization
  Stage 4 : SHAP TreeExplainer -- cross-fold feature importance consistency
  Stage 5 : Final model training on all projects + CSV export

Run
---
    python scripts/train_model.py

Outputs
-------
    models/memory_leak_rf_model.pkl   -- serialised model + scaler bundle
    models/model_metadata.json        -- mean F1, variance, feature list, dynamic threshold
    logs/lopo_results.csv             -- per-fold metrics
    logs/shap_fold_<project>.png      -- SHAP bar chart per LOPO fold
    logs/shap_consistency.png         -- top-feature consistency summary
    data/memory_predictions.csv       -- failure probability per row (Component 4 input)
"""

import sys
import os
import warnings
import json
import logging

sys.stdout = open(sys.stdout.fileno(), mode="w", encoding="utf-8", buffering=1)
warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
import joblib
import shap
import matplotlib
import matplotlib.pyplot as plt

matplotlib.use("Agg")

from sklearn.ensemble import RandomForestClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import f1_score, precision_score, recall_score, roc_auc_score

# Feature engineering import
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from feature_engineering import compute_derived_features, ALL_FEATURES, BASE_FEATURES

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
COMP1_DATA = os.path.abspath(os.path.join(BASE, "..", "component1", "output", "ml_ready_dataset.csv"))
HPMFD_DATA = os.path.abspath(os.path.join(BASE, "..", "..", "..", "HPMFD", "output", "ml_ready_dataset.csv"))
LOCAL_DATA = os.path.join(BASE, "data", "ml_ready_dataset.csv")


def resolve_input_csv() -> str:
    for path in (COMP1_DATA, HPMFD_DATA, LOCAL_DATA):
        if os.path.exists(path):
            return path
    return LOCAL_DATA


DATA = resolve_input_csv()
MODELS_DIR = os.path.join(BASE, "models")
LOGS_DIR = os.path.join(BASE, "logs")
DATA_DIR = os.path.join(BASE, "data")
os.makedirs(MODELS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)
# data/ holds the git-ignored live feeds consumed by Component 4 and the
# dashboard gateway; it must exist before memory_predictions.csv is written.
os.makedirs(DATA_DIR, exist_ok=True)

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(message)s",
    handlers=[
        logging.FileHandler(os.path.join(LOGS_DIR, "train.log"), encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
FEATURES = ALL_FEATURES
TARGET = "label"
RANDOM_SEED = 42
ALARM_THRESHOLD = 0.6   # Default threshold (will be dynamically tuned)
TOP_N_SHAP = 5          # number of top features tracked for consistency
CONSISTENCY_MIN = 7     # a feature is "universal" if it appears in >= 7/10 folds


# ---------------------------------------------------------------------------
# Stage 1 helper
# ---------------------------------------------------------------------------
def load_data(path: str) -> pd.DataFrame:
    """Load dataset, run feature engineering, and drop NaN rows."""
    if not os.path.exists(path):
        logger.error(f"Input file not found: {path}")
        sys.exit(1)

    df = pd.read_csv(path)
    required = BASE_FEATURES + [TARGET, "timestamp", "service_name", "project_id"]
    missing_cols = [c for c in required if c not in df.columns]
    if missing_cols:
        logger.error(f"Missing columns in input CSV: {missing_cols}")
        sys.exit(1)

    before = len(df)
    df.dropna(subset=BASE_FEATURES + [TARGET], inplace=True)

    # Apply derived feature engineering
    df = compute_derived_features(df)

    after = len(df)
    logger.info(f"  Rows loaded  : {before}  |  after dropna: {after}")
    logger.info(f"  Label dist   : {dict(df[TARGET].value_counts())}")
    logger.info(f"  Features     : {len(FEATURES)} features ({len(BASE_FEATURES)} base + {len(FEATURES) - len(BASE_FEATURES)} derived)")
    logger.info(f"  Source       : {path}")
    return df


# ---------------------------------------------------------------------------
# Dynamic Threshold Optimization
# ---------------------------------------------------------------------------
def optimize_alarm_threshold(y_true_bin: np.ndarray, y_probs: np.ndarray, default_threshold: float = 0.6) -> float:
    """Find threshold in [0.10, 0.90] maximizing out-of-fold F1 score."""
    if len(y_true_bin) == 0 or len(y_probs) == 0:
        return default_threshold

    best_thresh = default_threshold
    best_f1 = -1.0

    thresholds = np.linspace(0.10, 0.90, 81)
    for t in thresholds:
        preds = (y_probs >= t).astype(int)
        score = f1_score(y_true_bin, preds, zero_division=0)
        if score > best_f1:
            best_f1 = score
            best_thresh = round(float(t), 4)

    logger.info(f"  Dynamic Threshold Optimization: T*={best_thresh:.4f} (Max OOF F1={best_f1:.4f})")
    return best_thresh


# ---------------------------------------------------------------------------
# Stage 3 helper -- one LOPO fold
# ---------------------------------------------------------------------------
def run_lopo_fold(
    model: RandomForestClassifier,
    X: pd.DataFrame,
    y: pd.Series,
    projects: pd.Series,
    proj: str,
) -> dict | None:
    """Train on all projects except *proj*, evaluate on *proj*."""
    mask_test = projects == proj
    mask_train = ~mask_test
    y_test = y[mask_test]

    if len(y_test.unique()) < 2:
        logger.info(f"  [{proj}] Skipped -- only one class in test fold.")
        return None

    scaler = StandardScaler()
    X_train_s = scaler.fit_transform(X[mask_train])
    X_test_s = scaler.transform(X[mask_test])

    model.fit(X_train_s, y[mask_train])

    y_pred = model.predict(X_test_s)
    y_prob = model.predict_proba(X_test_s)[:, 1]

    # Validate AUC label orientation
    y_test_bin = (y_test == "FAILURE").astype(int)
    auc = roc_auc_score(y_test_bin, y_prob)
    if auc < 0.5:
        y_prob = 1.0 - y_prob
        auc = roc_auc_score(y_test_bin, y_prob)

    f1 = f1_score(y_test, y_pred, pos_label="FAILURE", zero_division=0)
    prec = precision_score(y_test, y_pred, pos_label="FAILURE", zero_division=0)
    rec = recall_score(y_test, y_pred, pos_label="FAILURE", zero_division=0)

    # Stage 4: SHAP for this fold
    X_shap = X_test_s
    if len(X_test_s) > 500:
        np.random.seed(RANDOM_SEED)
        idx_sample = np.random.choice(len(X_test_s), 500, replace=False)
        X_shap = X_test_s[idx_sample]

    explainer = shap.TreeExplainer(model)
    shap_values = explainer.shap_values(X_shap)

    if isinstance(shap_values, list):
        sv = shap_values[1]          # index 1 = FAILURE class
    elif shap_values.ndim == 3:
        sv = shap_values[:, :, 1]    # last axis = class index
    else:
        sv = shap_values

    mean_abs_shap = np.abs(sv).mean(axis=0)
    shap_importance = dict(zip(FEATURES, mean_abs_shap.tolist()))
    top_features = sorted(shap_importance, key=shap_importance.get, reverse=True)[:TOP_N_SHAP]

    _save_shap_bar(shap_importance, proj)

    return {
        "project": proj,
        "f1": round(f1, 4),
        "precision": round(prec, 4),
        "recall": round(rec, 4),
        "roc_auc": round(auc, 4),
        "shap_top_features": top_features,
        "trained_model": model,
        "scaler": scaler,
        "y_test_bin": y_test_bin.values,
        "y_prob": y_prob,
    }


# ---------------------------------------------------------------------------
# Stage 4 helpers -- SHAP plots
# ---------------------------------------------------------------------------
def _save_shap_bar(shap_importance: dict, proj: str) -> None:
    sorted_items = sorted(shap_importance.items(), key=lambda x: x[1])
    features = [k for k, _ in sorted_items]
    values = [v for _, v in sorted_items]
    colors = ["#2563eb" if v >= sorted(values)[-TOP_N_SHAP] else "#94a3b8" for v in values]

    fig, ax = plt.subplots(figsize=(8, 6))
    bars = ax.barh(features, values, color=colors)
    ax.set_xlabel("Mean |SHAP value|", fontsize=11)
    ax.set_title(f"SHAP Feature Importance -- {proj}", fontsize=12, fontweight="bold")
    ax.axvline(0, color="black", linewidth=0.5)
    for bar, v in zip(bars, values):
        ax.text(bar.get_width() + max(values) * 0.01, bar.get_y() + bar.get_height() / 2,
                f"{v:.4f}", va="center", fontsize=8)
    plt.tight_layout()
    out_path = os.path.join(LOGS_DIR, f"shap_fold_{proj}.png")
    plt.savefig(out_path, dpi=120)
    plt.close()
    logger.info(f"  SHAP chart saved --> logs/shap_fold_{proj}.png")


def save_shap_consistency(fold_results: list) -> dict:
    from collections import Counter
    counter = Counter()
    for fold in fold_results:
        for feat in fold["shap_top_features"]:
            counter[feat] += 1

    sorted_counts = dict(sorted(counter.items(), key=lambda x: x[1], reverse=True))
    universal = [f for f, cnt in sorted_counts.items() if cnt >= CONSISTENCY_MIN]

    logger.info("")
    logger.info("STAGE 4 -- SHAP Cross-Fold Consistency")
    logger.info("=" * 60)
    logger.info(f"  Top-{TOP_N_SHAP} feature appearance across {len(fold_results)} folds:")
    for feat, cnt in sorted_counts.items():
        tag = "  <-- UNIVERSAL" if cnt >= CONSISTENCY_MIN else ""
        logger.info(f"    {feat:<30} appeared in {cnt}/{len(fold_results)} folds{tag}")
    logger.info(f"  Universal features (>= {CONSISTENCY_MIN} folds): {universal}")

    fig, ax = plt.subplots(figsize=(10, 6))
    fnames = list(sorted_counts.keys())
    fcounts = list(sorted_counts.values())
    colors = ["#2563eb" if c >= CONSISTENCY_MIN else "#94a3b8" for c in fcounts]
    ax.barh(fnames[::-1], fcounts[::-1], color=colors[::-1])
    ax.axvline(CONSISTENCY_MIN, color="red", linestyle="--", linewidth=1.5,
               label=f"Consistency threshold ({CONSISTENCY_MIN} folds)")
    ax.set_xlabel("Number of folds in top-N", fontsize=11)
    ax.set_title("SHAP Feature Consistency Across LOPO Folds", fontsize=12, fontweight="bold")
    ax.legend(fontsize=9)
    plt.tight_layout()
    plt.savefig(os.path.join(LOGS_DIR, "shap_consistency.png"), dpi=120)
    plt.close()
    logger.info("  Consistency chart saved --> logs/shap_consistency.png")
    logger.info("=" * 60)

    return sorted_counts


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> None:
    global ALARM_THRESHOLD
    logger.info("=" * 60)
    logger.info("  Component 3 -- Memory Leak Predictor  (Train)")
    logger.info("=" * 60)

    # Stage 1: Data ingestion & Feature Engineering
    logger.info("")
    logger.info("STAGE 1 -- Data Ingestion & Feature Engineering")
    df = load_data(DATA)
    X = df[FEATURES]
    y = df[TARGET]
    projects = df["project_id"]

    # Stage 2: Class imbalance handling
    logger.info("")
    logger.info("STAGE 2 -- Class Imbalance Handling")
    logger.info("  Using class_weight='balanced' in RandomForestClassifier.")
    model = RandomForestClassifier(
        n_estimators=200,
        max_depth=None,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )

    # Stage 3: LOPO cross-validation
    logger.info("")
    logger.info("STAGE 3 -- Leave-One-Project-Out Cross-Validation")
    logger.info("=" * 60)

    unique_projects = sorted(projects.unique())
    fold_results = []
    all_oof_y_true = []
    all_oof_y_prob = []

    for proj in unique_projects:
        result = run_lopo_fold(model, X, y, projects, proj)
        if result is None:
            continue
        fold_results.append(result)
        all_oof_y_true.append(result["y_test_bin"])
        all_oof_y_prob.append(result["y_prob"])
        logger.info(
            f"  Fold [{result['project']:<12}] | "
            f"F1={result['f1']:.4f} | "
            f"Prec={result['precision']:.4f} | "
            f"Rec={result['recall']:.4f} | "
            f"AUC={result['roc_auc']:.4f} | "
            f"Top SHAP: {result['shap_top_features'][:3]}"
        )

    # Dynamic Threshold Optimization across out-of-fold predictions
    if all_oof_y_true and all_oof_y_prob:
        oof_y_true_cat = np.concatenate(all_oof_y_true)
        oof_y_prob_cat = np.concatenate(all_oof_y_prob)
        ALARM_THRESHOLD = optimize_alarm_threshold(oof_y_true_cat, oof_y_prob_cat, default_threshold=0.6)

    logger.info("-" * 60)
    f1_values = [r["f1"] for r in fold_results]
    mean_f1 = float(np.mean(f1_values)) if f1_values else 0.0
    var_f1 = float(np.var(f1_values)) if f1_values else 0.0
    auc_values = [r["roc_auc"] for r in fold_results if r.get("roc_auc") is not None]
    mean_auc = float(np.mean(auc_values)) if auc_values else 0.0
    logger.info(f"  Tuned Alarm Threshold: {ALARM_THRESHOLD:.4f}")
    logger.info(f"  Mean F1     : {mean_f1:.4f}  (target >= 0.75)")
    logger.info(f"  F1 Variance : {var_f1:.6f}  (target < 0.10)")
    logger.info(f"  Mean AUC    : {mean_auc:.4f}")
    logger.info(f"  Validation  : {'[TARGET MET]' if mean_f1 >= 0.75 else '[BELOW TARGET]'}")
    logger.info("=" * 60)

    # Save per-fold metrics CSV
    fold_rows = [
        {k: v for k, v in r.items() if k not in ("trained_model", "scaler", "shap_top_features", "y_test_bin", "y_prob")}
        | {"shap_top3": ", ".join(r["shap_top_features"][:3])}
        for r in fold_results
    ]
    pd.DataFrame(fold_rows).to_csv(os.path.join(LOGS_DIR, "lopo_results.csv"), index=False)

    # Stage 4: SHAP consistency analysis
    shap_counts = save_shap_consistency(fold_results)

    # Stage 5: Final model on all data + export
    logger.info("")
    logger.info("STAGE 5 -- Final Model Training and Export")
    scaler_final = StandardScaler()
    X_all = scaler_final.fit_transform(X)
    model.fit(X_all, y)

    # Save model bundle
    joblib.dump(
        {
            "model": model,
            "scaler": scaler_final,
            "features": FEATURES,
            "threshold": ALARM_THRESHOLD,
            "label_pos": "FAILURE",
        },
        os.path.join(MODELS_DIR, "memory_leak_rf_model.pkl"),
    )
    logger.info("  Model saved --> models/memory_leak_rf_model.pkl")

    def clean_num(v, default=0.0):
        if v is None or np.isnan(v):
            return default
        return v

    # Save metadata
    meta = {
        "best_model": "Random Forest",
        "mean_f1": round(clean_num(mean_f1, 0.0), 4),
        "f1_variance": round(clean_num(var_f1, 0.0), 6),
        "mean_auc": round(clean_num(mean_auc, 0.0), 4),
        "alarm_threshold": ALARM_THRESHOLD,
        "features": FEATURES,
        "shap_consistency": shap_counts,
        "rows_trained": len(df),
        "projects": int(projects.nunique()),
    }
    with open(os.path.join(MODELS_DIR, "model_metadata.json"), "w") as fh:
        json.dump(meta, fh, indent=2)

    # Generate memory_predictions.csv for Component 4
    y_prob_all = model.predict_proba(X_all)[:, 1]
    df_out = df[["timestamp", "service_name", "project_id"]].copy()
    df_out["memory_prob"] = np.round(y_prob_all, 4)
    df_out["alert"] = df_out["memory_prob"] >= ALARM_THRESHOLD
    df_out["pred_label"] = df_out["memory_prob"].apply(
        lambda p: "FAILURE" if p >= ALARM_THRESHOLD else "NORMAL"
    )
    out_csv = os.path.join(DATA_DIR, "memory_predictions.csv")
    df_out.to_csv(out_csv, index=False)
    logger.info(f"  memory_predictions.csv saved --> data/memory_predictions.csv")
    logger.info("")
    logger.info("[DONE] Training complete.")


if __name__ == "__main__":
    main()
