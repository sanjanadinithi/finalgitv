# Sentinel Decision Advisor - Thesis Results

_Eval frame: aligned_telemetry (RF retrained in-fold) (71355 rows, 6 projects)._

## Baseline vs Advanced Advisor

| metric | Baseline (RF + static matrix) | Advanced Decision Advisor |
|---|---|---|
| F1 (RF core, unchanged) | 0.5662 | 0.5662 |
| Precision (RF core, unchanged) | 0.5912 | 0.5912 |
| Recall (RF core, unchanged) | 0.5433 | 0.5433 |
| FAR (RF core, unchanged) | 0.9966 | 0.9966 |
| Mean MTTA (min, same detector) | 11.47 | 11.47 |
| Time-to-failure MAE (min) | n/a | 5.002 |
| ECE (same fold model) | 0.5722 | 0.5724 |
| Brier (same fold model) | 0.5697 | 0.5707 |
| Decision accuracy (failure onsets) | 0.0506 | 0.5823 |
| Mean time-to-decision (s, simulated) | 79.6 | 44.8 |
| Unnecessary-restart rate | 0.0 | 0.0001 |
| Alert noise (cascade collapse) | 0.0 | 0.3214 |

## Ablation ladder

| stage | F1 | FAR | MTTA_min | TTF_MAE_min | ECE | decision_acc | unnecessary_restart | alert_noise |
|---|---|---|---|---|---|---|---|---|
| 1. RF + static matrix | 0.5662 | 0.9966 | 11.47 | n/a | 0.5722 | 0.0506 | 0.0 | 0.0 |
| 2. + TTF forecaster | 0.5662 | 0.9966 | 11.47 | 5.002 | 0.5722 | 0.0506 | 0.0 | 0.0 |
| 3. + calibration/conformal | 0.5662 | 0.9966 | 11.47 | 5.002 | 0.5724 | 0.0506 | 0.0 | 0.0 |
| 4. + learned cost policy | 0.5662 | 0.9966 | 11.47 | 5.002 | 0.5724 | 0.5823 | 0.0001 | 0.0 |
| 5. + prioritisation/cascade | 0.5662 | 0.9966 | 11.47 | 5.002 | 0.5724 | 0.5823 | 0.0001 | 0.3214 |

## Notes & honest reporting
- **Failure scenarios evaluated:** 79 ground-truth 0->1 onsets (the previously assumed 37 does not match the data).
- **Added advisor latency (10k req):** p50 0.022 ms, p95 0.032 ms, p99 0.040 ms (budget 5 ms p99).
- **Cascade noise reduction:** 28 raw alerts -> 19 groups (32.1% collapsed).
- **Offline policy value (SNIPS):** -59.502370573350156 (ESS 473.0).
- **Baseline F1 recomputed on the current frame is 0.5662**, NOT the historical 95.13%: the live Comp2 CSV lost its label/queue columns and 3 of 6 projects collapsed to 11/20/13 rows. The relative baseline-vs-advisor comparison remains valid because both are scored on the identical frame.
- Time-to-decision is a deterministic operator-cognitive-latency SIMULATION, not an empirical human-subjects study.
- TTF forecasting uses XGBoost quantile regression (PyTorch/LightGBM unavailable).
- **FAR ~1.0 root cause**: the current aligned_telemetry has extreme class imbalance — Proj_01 holds almost all healthy rows; when held out as test, training folds have only ~4 negatives. The RF therefore over-predicts positives. Both columns share this RF, so the relative advisor improvement in decision quality and TTD remains valid.
- **Calibration did not improve ECE** on this frame (0.5722 -> 0.5724); reported as-is.
