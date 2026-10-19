# Dashboard Truth Audit — Phase 0

Audit date: 2026-10-19 (gateway `Dashboard/server.py`, UI `Dashboard/dashboard-ui`, sources under `cpu_spike_predictor/`).
Reference: `cpu_spike_predictor/PRESENTATION_GUIDE.md` (10 CPU/queue features, Random Forest, CPU alarm P(CPU)≥0.60, memory alarm alert TRUE or P(Mem)≥0.70 or label WARNING/FAILURE, four decision states, 180 s cooldown).

Every number/label/chart in the UI was traced to its source (file or endpoint + field). Status legend:
**OK** = computed from real outputs · **mislabeled** = real value, wrong label/claim · **stale** = real file, but older than its own inputs · **unsourced** = default/mock/heuristic presented as data.

## 1. Master trace table

| # | UI element | Source (file / endpoint+field) | Verified value | Status | Fix |
|---|------------|-------------------------------|----------------|--------|-----|
| 1 | LOPO per-fold table (ReliabilityTab) | `GET /api/dashboard` → `reliability.cpu_lopo` ← `outputs/lopo_results.csv` read **verbatim** (server.py `build_reliability`, no recomputation) | CSV mtime **2026-08-30 23:40**, input `aligned_telemetry.csv` mtime **2026-08-31 01:36** and `cpu_rf_model.joblib` **2026-08-31 01:36** → outputs older than inputs. Current in-fold eval (`advisor_evaluation_summary.json`, 2026-10-18): baseline **F1 0.5662, FAR 0.9966** vs CSV's F1 0.93–0.97 / FAR 0.011–0.025 | **stale** | UI banner marking the table as the historical 2026-08-30 artifact + current-frame comparison; Data-source strip shows file mtime vs input mtime |
| 2 | LOPO precision / FAR columns | Same CSV. Recomputed from the CSV's own TN/FP/FN/TP (see §2) | recall matches **exactly** for all 6 folds; precision CSV is systematically **lower** (e.g. Proj_01 0.9423 vs 0.9939); FAR CSV is **5–10× higher** (Proj_01 0.0214 vs 0.0021) | **mislabeled / internally inconsistent** | `build_reliability` now recomputes precision/FAR/F1 from TN/FP/FN/TP and flags the divergence (see §2) |
| 3 | ReliabilityTab footer "High F1 and low FAR ensure **zero overfitting**…" | Rhetorical claim, no source | Current-frame FAR is 0.9966; "zero overfitting" is a false absolute | **mislabeled** | Replaced with honest wording (historical artifact + current baseline F1 0.566 / FAR 0.997, high FAR documented as a limitation in PRESENTATION_GUIDE.md) |
| 4 | Memory LOPO table | `reliability.memory_lopo`; MUP fallback dict when `MUP/logs/lopo_results.csv` absent | UI already shows `memory_lopo_is_fallback` banner | OK (already flagged) | none |
| 5 | MTTA strategy panel | `reliability.mtta.strategies` ← `outputs/cpu_mtta_results.csv` (256 event rows + header; strategies CPU_Only / Memory_Only / Joint_AND / Joint_OR) aggregated in `load_mtta_metrics` | File mtime **2026-08-26** → older than inputs; values equal the CSV | **stale** (data itself consistent with file) | Shown with event count n and file date in Data-source strip; ReliabilityTab already shows "X of Y anticipated" counts per strategy |
| 6 | MTTA per-service figures | `reliability.mtta.by_service` ← same CSV + `live_mtta_by_service.json` overlay (`_merge_live_service_mtta`, measured='live' wins) | Live file mtime 2026-10-18 (fresh); offline entries stale as in #5 | OK (n shown: every warning-time figure carries `events_total`/`anticipated` count in the UI) | Event count rendered next to every figure ("n of N") |
| 7 | Live states HEALTHY / WARNING / CRITICAL | `utils.js deriveStatus` on `/api/dashboard` service rows (`cpu_failure_prob`, `memory_alert`, `memory_pred_label`) | CPU alarm at ≥0.60 (default `cpuThreshold=60`), memory alarm on alert TRUE or ≥0.70 or WARNING/FAILURE label; joint AND → CRITICAL | **OK** — matches PRESENTATION_GUIDE.md exactly | none |
| 8 | "Risk" (DecisionHero, advisor panel) | `services[].cpu_failure_prob` / `advisor` block from `live_status.json` written by `src/live_inference.py` → `/predict` | Real model P(imminent failure) | **mislabeled** (no definition shown) | Tooltip added: "Risk = model probability of failure in the next 5 min (P(failure)), 0–100%" |
| 9 | "Confidence (calibrated band)" (DecisionAdvisorPanel) | `advisor.confidence_band` — computed in `api.py` as a **fixed ±0.15 display band** around the point estimate, not a calibrated interval; calibration eval showed ECE did **not** improve (0.572 raw → 0.572 calibrated) | Band = p ± 0.15 | **mislabeled** | Relabeled "Confidence (±0.15 display band — not a calibrated interval)" |
| 10 | "Time to failure" | `advisor.time_to_failure_min` + `time_to_failure_band` ← `advisor/forecast.py` quantile model (p50, p10–p90); TTF MAE 5.0 min on current frame | Real forecast from temporal model (live stream) | **mislabeled** (no units/disclaimer) | Tooltip: "forecast p50, range p10–p90 — a statistical estimate, not a guarantee; MAE ≈ 5 min on offline eval" |
| 11 | "expected cost 53.5" (ranked actions) | `advisor.ranked_actions[].expected_cost` ← `advisor/policy.py score_actions`: `residual×FAILURE_COST(120) + disruption_cost + time_pressure` | Abstract policy **score**, not currency | **mislabeled** | Tooltip: units defined as dimensionless policy cost score (failure cost = 120 units baseline). Value kept |
| 12 | "risk −57%" (ranked actions) | `advisor.ranked_actions[].risk_reduced × 100`; `risk_reduced = p_fail − residual_failure_prob` | Verified live example (microservice-04-azure): p_fail 0.91 → residual 0.2275 ⇒ risk_reduced 0.6825 shown as "−68%" | **mislabeled** (relative base not stated) | Tooltip: "reduction relative to the current joint failure probability p_fail" — kept, defined |
| 13 | Latency badge (~2600 ms, DashboardFooter) | `App.jsx pollTelemetry`: `performance.now()` around `fetchDashboard()` → full gateway **`/api/dashboard` round trip** | NOT the advisor decision latency (advisor bench: p99 0.04 ms in `advisor_evaluation_summary.json`). Cause of ~2600 ms: `build_dashboard` does heavy synchronous work every poll (parses `aligned_telemetry.csv` 71,355 rows for run metadata, aggregates 256-row MTTA CSV, merges live MTTA — including **auto-generating `live_mtta_by_service.json` via a subprocess-style module import if the file is missing**) | **mislabeled** | Badge relabeled "gateway round-trip"; title tooltip explains what is measured; advisor decision p99 shown separately from eval summary |
| 14 | "Blast radius (est.)" (DecisionHero) | `utils.js getBlastRadius` — uses real project fan-out from `/api/dashboard` rows; `estimated:true` flag forces "(est.)" suffix | Derived from co-located services in same project, not call-graph topology | OK (honest "est." label) | none |
| 15 | Impact radius (incident payload / RCA card) | `src/xai.py generate_enterprise_rca_report` → `impact_radius` string chosen by **probability thresholds only** (CRITICAL→"HIGH (Service Outage Imminent)", WARNING→"MODERATE…", NOMINAL→"NONE") | **Not derived from topology at all** | **unsourced** | New Explainability view shows real impact radius as "unavailable (no topology source)"; heuristic severity kept but relabeled |
| 16 | Feature contributor bars (DetailsDrawer) | `services[].feature_contributions` | For placeholder services all values = 10.0 exactly (`live_status.json` microservice-22 case); UI suppresses via `drivers_are_placeholder` → renders nothing | OK (already suppressed) | New view additionally renders "unavailable" instead of zeros |
| 17 | SHAP values / "SHAP +0.494" in copilot brief | `src/xai.py compute_shapley_values` = deviations × `feature_importances_` — an **approximation**, despite xai.py module header claiming "TreeSHAP Additive Shapley Value Attribution"; `advisor/copilot.py attributions()` returns real treeshap only when `shap` is installed and correctly tags method | Current environment: shap unavailable → method='approximate' | **mislabeled** | Method badge added per response ("Approximate attribution: importance-weighted deviation. Not exact TreeSHAP." vs "TreeSHAP"); `attribution_method` field added to API responses; UI label "Feature contribution" |
| 18 | Data-source strip | **Did not exist** | — | gap | Added `DataSourceStrip` on Overview, Reliability and Advisor views: dataset file + row count, run timestamps + mtimes per source, model version, stale warning when output older than input |
| 19 | Placeholder numbers anywhere | Checked all fallbacks: memory LOPO fallback is banner-flagged; `empty_metrics()` renders zeros only when file missing | MTTA file exists, so zeros are never from defaults | OK | Rule enforced in new view: missing data → "unavailable", never 0 |
| 20 | Threshold chips (60/70) in header | `App.jsx` defaults; overridable via `/api/advisor/thresholds` | Matches documented thresholds | OK | none |

## 2. LOPO confusion-matrix recomputation (required check)

Formula verified against `src/validation.py` L110-131: `precision = TP/(TP+FP)`, `recall = TP/(TP+FN)`, `FAR = FP/(TN+FP)`. Recomputed from `outputs/lopo_results.csv`'s own TN/FP/FN/TP columns:

| Fold | precision CSV | precision calc | recall CSV | recall calc | FAR CSV | FAR calc | Verdict |
|------|--------------|----------------|-----------|-------------|---------|----------|---------|
| Proj_01 | 0.9423 | 0.9939 | 0.9351 | 0.9351 ✓ | 0.0214 | 0.0021 | precision ✗ FAR ✗ (10×) |
| Proj_02 | 0.9654 | 0.9918 | 0.9520 | 0.9520 ✓ | 0.0138 | 0.0029 | precision ✗ FAR ✗ (4.8×) |
| Proj_03 | 0.9381 | 0.9923 | 0.9245 | 0.9245 ✓ | 0.0246 | 0.0075 | precision ✗ FAR ✗ (3.3×) |
| Proj_04 | 0.9714 | 0.9750 | 0.9630 | 0.9630 ✓ | 0.0112 | 0.0019 | precision ✗ FAR ✗ (5.9×) |
| Proj_05 | 0.9583 | 0.9586 | 0.9474 | 0.9474 ✓ | 0.0181 | 0.0036 | precision ~✓ FAR ✗ (5.0×) |
| Proj_06 | 0.9620 | 0.9667 | 0.9560 | 0.9560 ✓ | 0.0154 | 0.0028 | precision ✗ FAR ✗ (5.5×) |

**Conclusion:** recall is the only metric column consistent with the stored confusion counts. The CSV cannot have been produced by the current `validation.py` on these counts as a unit — it is a hand-assembled/historical artifact. The dashboard now **recomputes** precision/FAR/F1 from TN/FP/FN/TP at load time and displays a divergence warning; the stored columns remain visible in a "as-stored" toggle note.

## 3. Timestamps & staleness matrix (measured)

| File | mtime | Role |
|------|-------|------|
| `data/processed/aligned_telemetry.csv` (71,355 rows) | 2026-08-31 01:36:32 | input |
| `outputs/cpu_rf_model.joblib` | 2026-08-31 01:36:34 | model |
| `outputs/lopo_results.csv` | **2026-08-30 23:40:00** | output — **older than input → STALE** |
| `outputs/cpu_mtta_results.csv` (256 events) | **2026-08-26 14:58:36** | output — **older than input → STALE** |
| `outputs/advisor_evaluation_summary.json` | 2026-10-18 22:44:51 | output — current |
| `outputs/advisor_baseline_lopo.csv` | 2026-10-18 22:44:51 | current-frame LOPO (written by `advisor/evaluate.py`; does **not** overwrite `lopo_results.csv`) |
| `outputs/live_status.json` | live (rolling) | live inference output |

## 4. Items that could not be fully verified (reported, not guessed)

1. **Provenance of `lopo_results.csv` metric columns** — recall consistent, precision/FAR not; which run produced the mismatched overlay cannot be determined from sources. Reported as internally inconsistent.
2. **Fleet service topology** — no call-graph/dependency file exists in the repo, so a true impact radius cannot be computed anywhere in the system; shown as "unavailable" per spec.
3. **Historical F1 95.13% claim** — PRESENTATION_GUIDE.md itself states current sources cannot regenerate it; the dashboard no longer surfaces it as a current metric.
4. **Exact cause of the ~2600 ms round-trip** — heavy synchronous reads in `build_dashboard` are the mechanism identified in code; per-request attribution would need gateway profiling beyond this audit. Advisor decision compute itself is measured at p99 ≈ 0.04 ms.

## 5. Fixes applied (Phase 0)

1. `server.py build_reliability`: recompute precision/FAR/F1 from TN/FP/FN/TP; emit `metrics_mismatch`, `source_mtime`, `input_mtime`, `stale` flags per LOPO source; emit `provenance` block (dataset file, row count, model path/version, output mtimes).
2. `ReliabilityTab.jsx`: historical-artifact banner on LOPO table with current-frame numbers side by side; divergence warning; footer "zero overfitting" claim removed and replaced with honest statement; MTTA event counts (n) rendered next to every warning-time figure; stale badge per source.
3. `DashboardFooter.jsx`: latency badge relabeled "gateway round-trip" with explanatory tooltip; advisor decision p99 shown as separate figure from the eval summary.
4. `DecisionAdvisorPanel.jsx`: "Confidence" relabeled to "±0.15 display band (not calibrated)"; tooltips on Risk / Time-to-failure / expected cost / risk −X% with units and relative base.
5. `DataSourceStrip.jsx` (new): dataset, row count, run timestamp, model version, stale-data warning; mounted on Overview, Reliability and Decision Advisor views.
6. `src/api.py`: `attribution_method` added to `/predict` and `/api/advisor/decide` responses (values `treeshap` | `approximate`).
