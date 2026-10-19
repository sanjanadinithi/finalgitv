# CPU Spike Predictor: Beginner Code Guide

This guide explains the Python application code in this folder for a reader who
has never programmed before. It follows each file from top to bottom and groups
nearby lines when they do one small job together. It explains the code's purpose,
inputs, and outputs without changing the program itself.

## What is included

The guide covers the application modules in [`src/`](src/):

- the main predictor and its command-line/API entry points;
- the live CSV-reading process;
- the model, explanations, mitigation recommendations, and timing analysis;
- every module in [`src/advisor/`](src/advisor/), which adds forecasting,
  confidence, action ranking, drift checks, operator feedback, and evaluation.

It does not explain Python installed in `.venv`, generated output files, or test
files. Those are not runtime application modules.

## 1. The whole program in everyday language

Think of the application as a helper for a team that keeps many software
services running:

1. **Component 2** sends measurements about processor usage and work queues.
2. **Component 3** sends a separate estimate of memory risk.
3. The predictor checks and organizes historical files, then trains a model
   using Component 2 measurements only.
4. When new measurements arrive, the saved model estimates the chance of an
   upcoming CPU-related failure.
5. Rules combine the CPU estimate and the separate memory estimate into an
   alarm and a suggested action.
6. The result can include an explanation, a runbook, and an incident-ticket
   description, and is written to output files or returned through an API.
7. The optional Decision Advisor adds a time estimate, confidence information,
   ranked actions, and fleet prioritisation.

The normal model inputs are these ten Component 2 measurements:

`cpu_percent`, `cpu_velocity`, `cpu_trend_5min`, `cpu_trend_10min`,
`in_flight_queue`, `incoming_rate`, `processing_rate`, `queue_growth_rate`,
`queue_pressure_index`, and `overload_flag`.

**Important boundary:** memory values can help the decision rules decide what
to recommend, but they are deliberately not inputs used to train the CPU
classifier. In machine learning, an input measurement is often called a
**feature**.

### Two ways to use the system

- **Offline workflow:** read old CSV files, create training labels, train and
  validate a model, and save result tables and charts.
- **Live workflow:** load a previously trained model, watch the Component 2/3
  CSV files for new data, make predictions, and save the latest results.

The live workflows do not train a model on every new row. They load a model
artifact produced earlier by the training command.

## 2. Tiny Python glossary

These ideas recur throughout the code. Read this once before the file tour.

| Code term | Beginner meaning |
|---|---|
| `import` | Ask Python to make another library or project file available here. |
| `from x import y` | Import a particular name `y` from library/module `x`. |
| `=` | Store the value on the right under the name on the left. It does not mean “is equal to” as in a maths equation. |
| `==` | Compare two values and produce `True` or `False`. |
| `def name(...):` | Define a reusable action (a function). The indented lines below it are that function's body. |
| `return value` | Finish a function and give its result back to whoever called it. |
| `class` | Define a kind of object that can hold related data and functions. |
| `self` | Inside a class, refers to the particular object currently being used. |
| `None` | “No value is available.” |
| `True` / `False` | The two yes/no values Python understands. |
| `if` / `elif` / `else` | Choose which indented instructions to run based on a condition. |
| `for` | Repeat instructions once for each item in a collection. |
| `try` / `except` | Try an operation; if a named error happens, run the recovery instructions. |
| `[]` / list | An ordered collection, such as a list of feature names. |
| `{}` / dictionary | A collection of named values, such as `{"service_name": "checkout"}`. |
| `df` / DataFrame | A pandas table: rows are observations and columns are measurements. |
| `df["name"]` | Select one named column from a pandas table. |
| `df.iloc[0]` | Select a row by its numeric position; positions start at zero. |
| `logger.info(...)` | Write an informational message to the program log. |
| `@app.get(...)` / `@app.post(...)` | Register a function as a web API endpoint. `GET` reads; `POST` receives data or requests work. |
| `Path`, CSV, JSON | A file location; a comma-separated table; and a structured text format for data. |
| `model.fit(X, y)` | Teach a model from inputs `X` and known answers `y`. |
| `predict_proba(...)` | Ask a trained model for a probability-like score. |
| `if __name__ == "__main__":` | Run the following block only when this file is started directly, not when another file imports it. |

Names ending in `_df` generally hold tables. Names ending in `_prob` generally
hold probabilities from 0 to 1. A probability of `0.8` is displayed as 80% by
multiplying it by 100.

## 3. Main application files

### [`src/cli.py`](src/cli.py) — the command menu

**Imports and logging at the top:** the file imports Python's command-line
argument parser, logging, operating-system helpers, Uvicorn (the web server),
and functions from the project's other modules. The logging setup chooses the
message format and sends messages to the terminal.

**`run_pipeline(...)`:** this is the offline validation workflow. It loads the
CPU table and memory table separately, creates a merged analysis table, saves
that table, runs project-based model validation, saves predictions/metrics,
calculates warning lead times, and creates charts. The comments and function
calls make a key distinction: memory data is merged for analysis, not added as
a CPU-model training feature.

**`train_production_model(...)`:** loads both input datasets and aligns them,
then asks `get_features_and_target` for the model inputs and answer column.
`train_model` learns the classifier and `save_model` writes it to disk. The
memory table is available to downstream decision logic but is excluded from
the input matrix.

**`start_server(...)`:** starts Uvicorn and points it at the FastAPI object in
`src.api`. `host` controls the network address and `port` controls the network
port.

**`start_live_inference(...)`:** constructs a `LiveInferenceEngine` with the
provided file locations and polling interval. It checks startup before entering
the ongoing polling loop. A failed startup exits with a non-zero status instead
of pretending the process is ready.

**`main()`:** builds the command menu:

- `validate` runs the offline validation and chart workflow.
- `train` creates the production model file.
- `serve` starts the HTTP API.
- `live` starts the CSV-watching process.

`argparse` reads the words and options typed after the Python command.
`args.command` chooses which function runs. If no known command is selected,
the program prints help and exits with an error status. The final `__main__`
check calls `main()` only when this file is started as the program.

### [`src/ingestion.py`](src/ingestion.py) — reading and preparing tables

**Imports and path constants:** pandas reads CSV tables; NumPy supports numeric
work; `os.path` builds file locations. `_WORKSPACE_ROOT` is calculated from
this file's own location, so default input paths do not depend on which folder
the user happened to open in a terminal. The two defaults point to Component
2's research CSV and Component 3's memory-prediction CSV.

**Required-column sets:** `COMP2_REQUIRED_COLUMNS` and
`COMP3_REQUIRED_COLUMNS` list the column names each input file must contain.
These are contracts: a wrong or incomplete input file should produce a clear
error rather than an invented replacement dataset.

**`add_lead_time_labels(df, lead_time_minutes)`:** creates
`imminent_failure`, the answer the classifier learns. A row is marked positive
if a recorded failure occurs at that row or within the configured number of
following rows. The helper reverses a series to calculate a forward-looking
rolling maximum. When project/service identifiers are available, it performs
that calculation separately for each group so one service's future failure
does not label another service's row.

**`_validate_comp2_schema(...)` and `_validate_comp3_schema(...)`:** compare the
actual CSV headings with the required headings. `set(df.columns)` is the set
of names found in the table; subtracting it from the required set finds missing
names. A `ValueError` explains which expected columns are absent.

**`load_cpu_features(...)`:** finds the Component 2 CSV (using the configured
default when appropriate), reads it with `pd.read_csv`, then validates it.
It derives `ground_truth_failure` from the existing `label` when needed, fills
missing target values, and supplies project/service names if absent. It parses
the timestamp into a standard datetime column, fills missing CPU feature values
with zero (and makes `overload_flag` an integer), then creates the future
failure label. The returned table contains prepared CPU data.

**`load_memory_predictions(...)`:** reads and validates Component 3's file.
It creates `memory_leak_prob` as a backward-compatible alternate name, fills
missing identity/alert/probability values with defined defaults, and converts
timestamps to datetimes. The special `MM:SS`-like format is converted to a
datetime using a fixed base date. It also creates `alert_bool`, a true/false
column that recognizes text such as `TRUE`, `1`, `YES`, and `T`.

**`merge_datasets(cpu_df, mem_df)`:** joins the two sources for analysis. It
fills absent service/project names with defaults, groups rows by
`project_id` and `service_name`, sorts each group by time, and pairs CPU and
memory rows by their positions in those sorted groups. If no matching memory
row exists, it uses explicit zero/normal memory values. It then joins the
pieces and sorts the final table. This is row-position alignment, not a claim
that exact timestamps matched.

**`save_aligned_telemetry(...)`:** creates the output folder and writes the
integrated table as CSV and Parquet. Parquet is a compact table format. A
Parquet-writing error is logged, while the CSV remains the main fallback.
The function returns both output file paths.

**`load_aligned_telemetry(...)`:** tries to read the Parquet file first; if it
does not exist, it reads the CSV. If neither is present, it raises
`FileNotFoundError`.

The final `__main__` block is a manual smoke check: it loads both inputs,
merges/saves them, and prints basic information. It is not the web server.

### [`src/model.py`](src/model.py) — CPU failure classifier

**Imports/constants:** pandas represents feature tables, NumPy handles arrays,
Joblib saves/loads trained Python models, and scikit-learn supplies the
Random Forest algorithm. `COMP2_CPU_FEATURE_COLS` is the exact allowed input
list. `TARGET_COL` names the answer (`imminent_failure`).

**`get_features_and_target(df, target_col)`:** chooses the available allowed
CPU columns into `X`, the model-input table. It warns if some expected
features are absent. Missing feature values become zero; `overload_flag`
becomes an integer. The target column becomes integer values in `y`. It returns
the pair `(X, y)`.

**`train_model(X, y, ...)`:** creates a Random Forest with the requested number
of trees. `class_weight="balanced"` tells the model to give extra weight to
rare labels, which can help when failure rows are less common. `random_state`
makes training more repeatable; `n_jobs=-1` lets training use available CPU
workers. `fit` is the step that learns from the examples.

**`save_model(...)`:** creates the destination folder and serializes the model
to a Joblib file, which is later called a model artifact.

**`load_model(...)`:** checks that the saved artifact exists and loads it.
After loading, it sets `n_jobs` to 1 when supported so small live predictions
do not repeatedly create a large worker pool.

**`predict_probabilities(model, X)`:** prepares inputs in the feature order the
model expects. A short NumPy array is padded with zero columns; a DataFrame is
filled with missing expected columns and reordered. It handles a model trained
on only one class by returning all-zero or all-one probabilities; otherwise it
returns the class-1 probability for each row.

**`get_feature_importances(model)`:** pairs the model's learned importance
numbers with the feature names. Any name without a corresponding importance is
given `0.0`.

### [`src/validation.py`](src/validation.py) — checking predictions on held-out data

**`run_lopo_cross_validation(merged_df, alarm_threshold)`:** LOPO means
Leave-One-Project-Out. With several projects, the code holds one whole project
back, trains on the others, and tests only on the held-out project. It repeats
this for each project. This tests whether learned patterns transfer to a
project not used in training.

If the table has only one project, LOPO is impossible, so the function uses a
stratified 80/20 train/test split instead. For each test set, it gets the CPU
features and target, trains a model, predicts probabilities, and turns those
probabilities into alarms using `alarm_threshold` (default `0.6`).

The remaining block computes precision, recall, F1, and a confusion matrix.
The confusion matrix counts true negatives, false positives, false negatives,
and true positives. The false-alarm rate is false positives divided by all
actual negatives. Memory columns may be copied to the output for downstream
analysis; they are not passed to the model's feature-selection function.
Finally, it combines per-project metrics and predictions, sorts predictions,
logs averages, and returns both tables.

**`save_validation_results(...)`:** creates the output folder and writes the
per-project metrics and row-level predictions to CSV files.

The `__main__` block lets the file run its own validation workflow when started
directly; it logs a failure if the self-test cannot complete.

### [`src/mtta.py`](src/mtta.py) — warning-time measurement

MTTA here means **Mean Time To Anticipate**: how long before a failure the
earliest alarm was raised.

**`compute_mtta_for_alarm_type(df, alarm_col, window_minutes)`:** sorts the
table by project and time. For each project it detects a failure start: a row
where `ground_truth_failure` changes from 0 to 1. For each start, it looks
backward within the allowed time window. If it finds an alarm in the named
alarm column, it records the earliest alarm and calculates the time difference.
If not, `anticipated` is 0 and no warning time is recorded.

**`analyze_mtta_strategies(...)`:** loads prediction CSV data, standardizes the
timestamp, and supplies a memory-probability alias/default if needed. It makes
four alarm columns: CPU-only, memory-only, both CPU and memory (AND), and
either CPU or memory (OR). It calculates the warning-time table for each,
logs the anticipation rate and mean/range, combines all rows, and saves the
result to CSV.

The bottom `__main__` block runs that analysis when this module is launched
directly.

### [`src/visualization.py`](src/visualization.py) — MTTA charts

**Imports and plotting style:** Matplotlib creates figures; Seaborn adds
statistical chart styles; pandas reads the MTTA output. The `rcParams`
assignments configure fonts and axis appearance.

**`create_mtta_visualizations(...)`:** checks that the MTTA CSV exists, then
loads it. `plt.subplots(2, 1)` creates two vertically stacked charts. The first
groups anticipated events by strategy and draws average warning time bars with
error bars and anticipation-rate labels. The second filters to CPU-only
anticipated events, then draws a box plot and individual points by project.
Labels, titles, grid lines, and axis bounds make the graphs readable. The
function creates the output folder, saves a high-resolution PNG, and closes
the figure to release memory.

The `__main__` block calls the chart function and logs a clear failure if it
cannot run.

### [`src/xai.py`](src/xai.py) — explanation and runbook builder

XAI means Explainable AI; RCA means Root Cause Analysis.

**Names and baselines:** `FEATURE_DISPLAY_NAMES` translates machine column
names into readable labels. `BASELINE_VALUES` and `SCALE_VALUES` are reference
numbers used by the approximate explanation calculation.

**`compute_shapley_values(...)`:** if no model exists, it returns a baseline
and zero feature contributions. Otherwise, it reads model feature importance,
gets the current input values, measures how far each is above the reference
baseline, and combines those deviations with model importance. It estimates
how much each feature contributes to the probability increase and returns a
base value, per-feature contributions (`phi`), and percentages.

**Important accuracy note:** this function's local calculation is an
importance-weighted approximation; by itself it is not a full mathematical
SHAP computation. The separate advisor copilot may use a real SHAP
TreeExplainer when installed and falls back to this approximation if needed.

**`generate_enterprise_rca_report(...)`:** ensures there is an input table,
using zeros only when the caller provided no usable input. It ranks features
by contribution, picks primary and secondary explanations, and uses CPU and
memory probability thresholds to choose CRITICAL, WARNING, or NOMINAL
severity. It then chooses a narrative branch based on CPU trend, CPU level,
queue pressure, overload, or generally elevated risk.

The next block selects a runbook: critical response steps, warning-level
memory/CPU steps, or a healthy-state message. Finally it assembles an incident
ticket dictionary and returns a larger dictionary with severity, explanation,
feature contributions, narrative, runbook, and ticket data.

### [`src/mitigation.py`](src/mitigation.py) — stateful action tracking

**Module settings:** `_SERVICE_STATE` keeps in-memory state for each service.
`COOLDOWN_SECONDS` is three minutes. The module uses the system clock and
UTC timestamps to record actions.

**`get_mitigation_history(service_name)`:** returns the list of previously
recorded actions for that service, or an empty list if it has none.

**`execute_mitigation_action(...)`:** creates a default state record for a new
service. If the service is still inside its cooldown, it returns a
suppressed-action response. `NO_ACTION` clears the tier and returns a healthy
response. Otherwise it selects a tier and builds a command string based on
the requested action. It records that string in a short rolling history and
returns the action, status, cooldown, and command details.

**Important operational note:** this function constructs and reports command
strings such as `kubectl ...` and `envoy-cli ...`; it does not launch those
commands. The `SUCCESS` status is this module's result record, not proof that
Kubernetes or Envoy carried out the command. An external executor would be
needed to perform and verify real infrastructure changes.

### [`src/api.py`](src/api.py) — web service and prediction endpoints

**Imports and logging:** the module brings in FastAPI for HTTP routes, Pydantic
for request/response validation, pandas/NumPy for model inputs, and project
functions for model loading/prediction. `LIVE_STATUS_FILE` is the latest
per-service JSON snapshot; `LIVE_LOG_FILE` is a line-by-line JSON history.

**CPU freshness helpers:** `_cpu_telemetry_present` checks whether any of the
ten CPU inputs is non-zero. `_read_live_status` reads the status JSON with a
guard for missing/unreadable data. `_carried_cpu_measurement` retrieves a
previous CPU result only when telemetry was real and the record is fresh
(under 30 seconds old). This prevents a memory-only update from replacing a
real CPU result with a score computed from an all-zero row.
`_write_live_status` updates one service's current record.
`_append_live_log` appends JSON records and keeps only the newest 500 lines.

**Pydantic classes:** `Component2Payload` defines the expected CPU/queue
fields and validation limits. `Component3Payload` defines memory probability,
alert, and label. `TelemetryPayload` packages service identity plus both
components. `PredictionResponse` defines the exact fields returned by the
single prediction route. `BatchTelemetryPayload` wraps a list of services.
The later advisor classes define the request and response shapes for advisor,
feedback, ranked action, and threshold requests. `Field(...)` supplies a
required value or a default and can add checks such as `ge=0` and `le=1`.

**Metrics and `app`:** `API_METRICS` starts in-memory counters at zero.
`FastAPI(...)` creates the web application and its documentation metadata.
`model` starts as `None`; `MODEL_PATH` points to the trained Random Forest
artifact.

**`_build_model_input_df(payload)`:** copies only the ten Component 2 fields
into a one-row pandas table in the exact feature order expected by the model.
No Component 3 field is included.

**`startup_event()`:** FastAPI calls this when the web server starts. The
function checks for the trained model artifact and loads it if present. If it
is missing or cannot load, the API does not train a replacement; readiness
will fail and prediction routes return an unavailable-model error.

**Health and metrics routes:** `/health` and `/healthz/liveness` report that
the process is alive. `/healthz/readiness` reports whether a model loaded.
`/metrics` returns the counters as JSON or as Prometheus text, a format used
by monitoring tools.

**`_make_decision(...)`:** compares the CPU probability (0.6 cutoff) with the
memory alert, memory probability (0.7 cutoff), and memory label. Both signals
mean a critical restart/reroute recommendation; CPU alone means load shedding;
memory alone means a proactive pod-restart recommendation; neither means no
action. It returns an action name and readable warning string.

**`predict(payload)`, route `POST /predict`:** first refuses to predict if the
model did not load. It detects whether the CPU fields contain real telemetry.
For memory-only requests it may reuse a recent CPU result; otherwise it builds
the CPU-only input row and calls `predict_probabilities`. It normalizes the
memory alert text, creates CPU/memory/joint alarm booleans, and asks
`_make_decision` for an action.

The route then generates an RCA report (or reuses the saved CPU explanation
when carrying forward a fresh result), records mitigation decision state,
updates counters, calculates request latency, builds a validated response,
and writes both the current status JSON and append-only log. It returns the
response object to the HTTP caller.

**`batch_predict(...)`, route `POST /batch_predict`:** loops over each service
in the request and calls the same `predict` function. It returns the list of
responses, so single and batch requests use the same decision path.

**Decision Advisor helper functions:** `_get_forecaster` loads a saved
time-to-failure model only once and never trains it during a request.
`_ttf_proxy_from_risk` estimates a time range from the risk score when no
trained temporal model is available. `_ttf_from_history` constructs a short
time series from supplied history and asks a loaded forecaster for p10/p50/p90
time estimates; if that cannot run, it logs the problem and lets the caller
use the proxy.

**`advisor_decide(...)`, route `POST /api/advisor/decide`:** checks model
availability, computes the CPU risk, chooses a history-based or proxy TTF,
marks the 0.45–0.65 CPU-risk band for human review, and asks the policy module
to rank actions. It builds a short explanation and returns confidence,
fallback action, TTF range, ranked alternatives, and latency. This route
provides advice; it is distinct from the `/predict` response.

**Other advisor routes:**

- `GET /api/advisor/brief/{service}` reads the saved live record and builds a
  fresh text brief.
- `POST /api/advisor/feedback` validates and logs an operator's accepted,
  ignored, or overridden decision.
- `GET /api/advisor/drift` reads a saved drift report if one exists.
- `GET /api/advisor/thresholds` returns previously recorded suggestions.
- `POST /api/advisor/thresholds` records a threshold proposal that has a named
  human approver. The code explicitly leaves applying it as a separate step.

The final `__main__` block runs the API locally through Uvicorn if `api.py` is
started directly.

### [`src/live_inference.py`](src/live_inference.py) — watching live CSV files

This is a second live-running mode separate from the HTTP API. It reads
Component 2 and Component 3 CSV files and writes live prediction records.

**Imports and defaults:** the module imports file, JSON, time, logging, signal,
pandas, NumPy, and timestamp utilities. Its default source paths come from
`ingestion.py`. Other constants name the trained model, output, status, and
checkpoint files. `LIVE_TAIL_ROWS` and `LIVE_INFERENCE_BATCH` prevent a
cold-start process from replaying a huge old CSV history.

**`_advisor_ttf_proxy(...)`:** converts risk to a bounded rough estimate of
minutes-to-failure. It is a deterministic shortcut, not a trained time model.

**`CheckpointManager`:** remembers progress across restarts.

- `__init__` loads JSON state, removes a legacy Component 2 key list, and
  prepares a row cursor and a fast set of processed Component 3 keys.
- `_load` reads saved state or starts with empty defaults after a missing or
  unreadable checkpoint.
- `save` writes a temporary file and replaces the old checkpoint so a crash
  is less likely to leave half-written JSON.
- `get_comp2_cursor` and `set_comp2_cursor` read/update how many Component 2
  data rows were consumed.
- `is_comp3_processed` checks if a memory row was seen before.
- `mark_comp3_processed` adds newly seen keys, keeps the key history bounded,
  and saves it.
- `reset` clears both components' progress.

**`safe_read_csv(...)`:** returns `None` when the file does not exist. It tries
to read the CSV, optionally skipping old data rows, and drops a final
all-empty row that may mean another program was halfway through writing. It
retries common “file is incomplete/locked” errors with an increasing wait.
Unexpected read errors are logged and return `None`.

**Record-key helpers:** `make_comp2_record_key` combines Component 2 incident
and timestamp values into a string. `make_comp3_record_key` combines memory
timestamp, service, and project. A combined key helps identify a previously
seen row.

**`normalize_comp2_live_schema(...)`:** copies the input table, normalizes
alternate service and queue-pressure column names, then checks the required
inference columns. It raises a clear error if the live CSV cannot supply them.

**`preprocess_comp2_for_inference(...)`:** applies live-safe preparation to
Component 2 rows. It parses times, derives project/service identity when
missing, and fills the ten feature columns using the same zero/default rules
as training. It deliberately does not need the historical target label.

**`preprocess_comp3_for_inference(...)`:** copies the memory table, creates
the alternate memory-probability name, fills missing values, parses supported
timestamp formats, and converts alert strings to `alert_bool`.

**`build_feature_matrix(...)`:** selects the ten CPU features in model order
and fills missing values. This is the final table sent into the classifier.

**`align_comp2_comp3(...)`:** aligns new CPU records with available memory
records using project/service groups, sorted time, and row position. If no
memory records are available, it adds explicit “no memory observation”
defaults. These defaults do not change the fact that the classifier itself
uses only the CPU columns.

**`LiveInferenceEngine.__init__(...)`:** stores all file paths and polling
settings, creates a checkpoint manager, and sets the run state to stopped.

**`startup()`:** checks and loads the already-trained model; checks that both
CSV inputs exist; validates their schemas; optionally generates the
per-service live MTTA file; and logs the checkpoint and output locations.
It returns `True` only when the engine is ready.

**`_count_data_rows(path)`:** counts newline characters in chunks of a file
without parsing every CSV field. This lets the engine estimate file length.

**`_read_new_comp2()`:** uses the row cursor to identify new rows in
Component 2's append-only CSV. On first run it starts near the file's newest
rows rather than replaying all history. On each poll it reads only the latest
batch, validates its columns, and moves the cursor forward.

**`_read_new_comp3()`:** reads Component 3's CSV, validates required columns,
builds a key for each row, and returns only rows not already in the checkpoint.

**`_run_inference(aligned_df, comp3_keys)`:** returns immediately for an empty
table. Otherwise it creates the CPU-only model input, predicts probabilities,
and creates one result for every row. The alarm rules mirror the API:
CPU at 0.6, memory at 0.7/alert/label, and joint alarm only when both CPU and
memory alarms are true. It selects an action, creates an explanation, and
tries to add advisor rankings and a brief. Advisor enrichment is wrapped so
its failure does not stop prediction for the row.

Each result is appended as one JSON object per line to the prediction JSONL
file. The status JSON stores the latest result per service, plus raw signal
values for the dashboard. The function trims old prediction lines, rereads
the status file before merging its new values to avoid discarding API-written
service entries, writes the merged status, records Component 3 keys as
processed, and logs a summary.

**`run()`:** registers Ctrl+C/system-stop handlers, then repeats: read new
rows, pause if there are no new CPU rows, preprocess both sources, align them,
make predictions, and sleep for the remainder of the poll interval. A
per-cycle exception is logged so one bad read does not terminate the whole
loop. The loop stops when its running flag is cleared.

**`main()`:** defines command-line options for both CSVs, model, outputs,
checkpoint, and poll interval; creates the engine; requires successful
startup; and then runs it. The final `__main__` check invokes this entry point
only when launched directly.

### [`src/live_mtta.py`](src/live_mtta.py) — per-service warning lead times

**Path constants:** the code builds a path to Component 2's research dataset
and a path for a JSON output file.

**`compute_live_mtta_by_service(...)`:** reads only the columns it needs:
service, timestamp, failure flag, and system state. For every service it finds
the beginning of each failure, then looks backward up to `window_minutes` for
the earliest `DANGEROUS` system state. It calculates how many seconds/minutes
of warning were available and the percentage of failures that had a warning.
It writes a JSON object keyed by service. If the source file is missing, it
logs a warning and returns an empty dictionary.

The final `__main__` block runs this calculation directly.

## 4. Decision Advisor files

The advisor is extra decision support layered on top of the CPU model. It
does not change the ten-feature model input boundary.

### [`src/advisor/__init__.py`](src/advisor/__init__.py) — shared rules

`COMP2_CPU_FEATURE_COLS` is the one shared list of permitted raw CPU/queue
features; `RANDOM_STATE` makes random operations repeatable. A regular
expression `_MEMORY_LEAK_PATTERN` identifies column names that look like
memory-derived inputs.

`is_memory_derived(column)` checks one name. `assert_no_memory_leakage(...)`
raises a `ValueError` if any supplied feature name looks memory-derived.
`allowed_comp2_only(...)` first runs the same safety check, then filters the
list. Other advisor modules import these names so they use the same boundary.

### [`src/advisor/forecast.py`](src/advisor/forecast.py) — estimating time to failure

**Constants:** `MAX_TTF_MIN` caps the forecast at 30 minutes.
`QUANTILES` asks for low, middle, and high estimates (p10, p50, p90).
`_LAGS` and `_ROLL` define how many earlier rows to look at.

**`build_temporal_features(...)`:** sorts observations by project/service/time.
For each allowed CPU signal it creates lag columns, rolling means, rolling
standard deviations, and first differences. Missing start-of-history values
are filled with zero. A final leakage guard checks every generated feature
name before returning the feature table and column list.

**`_grouper(...)`:** provides pandas with the service/project grouping keys;
when no such keys exist, it makes one common group.

**`add_time_to_failure_target(...)`:** for each row, finds the next failure in
the same group and calculates minutes until it. A row already in failure gets
zero; a row with no failure within the configured horizon gets the maximum
time. The result is stored as `time_to_failure_min`.

**`_make_regressor(...)`:** tries to create an XGBoost quantile model. If the
optional XGBoost import or setup fails, it logs the issue and creates a
scikit-learn quantile model instead. In the fallback, the code trains a
median estimate and later creates a band from the training residual spread.

**`TimeToFailureForecaster`:** its constructor remembers quantiles, backend,
feature names, and whether fitting has happened. `fit` checks the feature
names for memory leakage, converts inputs to numeric arrays, clips target
times to the allowed range, and trains the underlying model. For the
scikit-learn fallback, it estimates a residual spread for the uncertainty
band. `predict_quantiles` refuses to run before training, predicts p10/p50/p90
or constructs the fallback band, and clips all values. `save` serializes the
model and metadata; class method `load` rebuilds an already-fitted object.

**`_binary_metrics(...)`:** turns a time forecast into alarm-quality measures
by counting correct and incorrect positive/negative predictions.

**`evaluate_forecaster_lopo(...)`:** prepares temporal features and targets,
then holds one project out at a time (or uses a one-project split). It trains
the time forecaster on the remaining rows, predicts time ranges on held-out
rows, and flags rows whose median estimate is within the lead-time window. It
calculates classification scores and time-estimate error, combines fold
results, and writes CSV and JSON summaries.

The bottom block loads aligned telemetry and runs the evaluation when this
module is started directly.

### [`src/advisor/calibration.py`](src/advisor/calibration.py) — probability trust and uncertainty

**`expected_calibration_error(...)`:** divides scores into probability ranges
and compares each range's average predicted probability with the actual
failure fraction. Lower ECE means those scores better match observed rates.

**`brier_score(...)`:** calculates the average squared distance between each
probability and its known 0/1 answer. Lower is better.

**`calibrate_fold(...)`:** obtains CPU-only inputs, checks for memory leakage,
trains the base Random Forest, and fits a probability calibration wrapper
using only the current training fold. It chooses a feasible number of inner
folds based on how many examples the minority class has. If there are too few
examples, it returns no calibrated wrapper so later code uses raw model
probabilities.

**`_predict_calibrated(...)`:** generates calibrated class probabilities and
selects the probability column corresponding to failure class `1`.

**`SplitConformalClassifier`:** `fit` compares each known answer with its
probability, calculates a cutoff `q_hat`, and stores it. `predict_sets`
requires prior fitting, then returns possible answer sets. A set containing
both 0 and 1 is ambiguous and sets the “needs human review” flag.

**`run_calibration_lopo(...)`:** holds projects out one at a time (or makes an
80/20 split for a single project), optionally downsamples large training folds
while trying to keep both classes, skips unusable folds, and trains/calibrates
inside each remaining fold. It calculates raw/calibrated ECE and Brier score,
fits conformal cutoffs from training data only, then measures coverage and
human-review rate on the held-out project. It writes per-fold CSV and summary
JSON files.

### [`src/advisor/policy.py`](src/advisor/policy.py) — choosing a suggested action

**Action catalogue:** `MITIGATION_TIER` gives each action a severity tier;
`MITIGATION_COMMAND` maps advisor action names to the action words understood
by the mitigation module. `ActionSpec` stores an action's tier, disruption
cost, effectiveness, time needed, and description. `ACTIONS` is the catalogue.
`FAILURE_COST` describes the model's assumed cost of an unmitigated failure.
`Decision` is the structured result returned by the policy.

**`matrix_fallback(...)`:** implements a fixed rule: CPU only -> load shedding;
memory only -> proactive restart; both -> critical restart/reroute; neither ->
no action. This is kept as a fallback alongside the cost-based recommendation.

**`_feasibility(...)`:** estimates what fraction of an action's benefit can be
realized before the predicted failure time. An action taking too long gets
less credit.

**`score_actions(...)`:** combines CPU and memory probabilities into a joint
risk estimate, then scores every action. For each action it estimates
remaining failure risk after its effectiveness, adds disruption cost and
time-pressure cost, and sorts from lowest expected cost to highest.

**`_confidence(...)`:** calculates a simple confidence score from the cost
difference between the best and second-best action. A close tie means less
confidence.

**`decide(...)`:** ranks the top three actions, explains why each alternative
lost, caps confidence if human review is required, and builds a `Decision`.
Actions above the configured approval tier are marked as requiring operator
approval. It returns a recommendation, not proof that an action ran.

**Offline evaluation helpers:** `behaviour_policy_propensities` gives actions
soft probabilities for a simulated historical policy.
`simulate_incident_log` samples prediction rows and creates a demonstration
log with simulated action/reward outcomes. `_target_policy_action` selects
the cost policy's preferred action. `evaluate_offline_policy` estimates
policy value using IPS, SNIPS, or DR formulas and reports effective sample
size. These estimates operate on the supplied/simulated log; they are not
measurements of a real human or infrastructure intervention.

### [`src/advisor/prioritise.py`](src/advisor/prioritise.py) — ranking services and grouping cascades

**Weights:** `W_RISK`, `W_TIME`, `W_CRIT`, and `W_FANOUT` control how the
urgency score blends failure risk, time pressure, business criticality, and
downstream impact. `MAX_FANOUT` scales the dependency count.

**`ServiceSignal`:** a dataclass, meaning a compact class for one service's
probabilities, failure-time estimate, criticality, dependencies, and alert
state.

**`_risk(...)`:** combines CPU and memory probabilities with a formula that
estimates the chance at least one independent signal is risky.
`_time_pressure(...)` maps a short forecast runway to a larger urgency value.
`urgency_score(...)` combines the weighted values while allowing risk to
reduce the urgency of a healthy service.

**`prioritise_fleet(...)`:** converts each service to a result row, sorts by
highest urgency first, and assigns ranks.

**`_UnionFind`:** a small grouping helper. `find` discovers a group's
representative; `union` joins two groups.
`group_cascades(...)` connects services sharing dependencies or incident IDs,
then summarizes each group. The highest-urgency member is called
`patient_zero` in the result; this is a ranking label, not proof of the true
technical root cause.

**`prioritise_from_dataframe(...)`:** converts prediction-table rows into
`ServiceSignal` objects and calls `prioritise_fleet`. Optional maps provide
business criticality and dependency count.

The bottom block creates demonstration service records and prints their ranks
and cascade groups when run directly.

### [`src/advisor/drift.py`](src/advisor/drift.py) — checking whether patterns changed

**Constants:** PSI thresholds distinguish stable/moderate/severe distribution
changes; `KS_ALPHA` is the statistical-test cutoff; `VERSION` labels the
registry format.

**`population_stability_index(...)`:** compares reference probability scores
with current scores by putting both into bins and measuring how much their
distributions differ.
`ks_drift(...)` runs a two-sample Kolmogorov–Smirnov test and returns its
distance statistic and p-value.

**`PageHinkley`:** tracks a stream of errors/residuals. `reset` clears its
running counters; `update` adds one new value and signals when cumulative
change exceeds the threshold; `run` repeats that process over a whole series.

**`ADWINWindow`:** keeps a bounded list of recent values. `update` tests
candidate splits between old and new portions of that list; a sufficiently
large mean difference signals a change and shortens the window. `run` resets
the detector and processes a series.

**Threshold helpers:** `project_far_recall` counts alarms and calculates
false-alarm rate and recall for one threshold.
`suggest_thresholds` tries several thresholds and chooses the one with the
lowest false-alarm rate that still meets the requested minimum recall (or the
closest recall if none qualify).

**`advise_for_service(...)`:** calculates PSI, KS, Page-Hinkley, and ADWIN
results. It combines those indicators into `KEEP_THRESHOLDS`,
`ADJUST_THRESHOLD`, or `RETRAIN_RECOMMENDED`. Suggestions require human
approval; this logic does not silently retrain or replace the live model.

**`RetrainRegistry`:** reads/writes a versioned JSON file of proposals.
`record` adds an advisory entry and trims old entries; `rollback` changes the
recorded active version; `_save` writes through a temporary file before
replacing the registry file.

**`run_drift_report(...)`:** uses prediction probabilities as reference and
current service groups, skips groups that are too small, calculates advice,
records each service in the registry, and writes a CSV report.

The bottom block runs a small generated-data demonstration; it is not the
production data feed.

### [`src/advisor/copilot.py`](src/advisor/copilot.py) — short human-readable decision brief

**Settings:** `MAX_BRIEF_WORDS` limits the brief. `RUNBOOK_BY_ACTION` maps
action names to runbook identifiers. `_EXPLAINER_CACHE` remembers expensive
SHAP explainer objects by model identity.

**`_get_explainer(model)`:** tries to import SHAP and build a tree explainer
once per model. If that fails, it remembers that no explainer is available.
`attributions(...)` then either reads SHAP values in the supported result
shapes or uses the approximate explanation from `src.xai`. It returns
feature contributions, a baseline, and the method name.
`top_driver(...)` chooses the contribution with the largest absolute value.

**Template brief:** `_truncate_words` limits text length.
`build_brief_template(...)` combines service, risk, confidence, time estimate,
recommended action, runbook, and top feature into a deterministic sentence.
It adds a human-review note when the result is uncertain.

**Optional LLM:** `_llm_enabled` checks the environment flag.
`_facts_json` packages already-known structured facts into JSON.
`build_brief(...)` always creates a local template first. It contacts an
external configured endpoint only when both the caller opts in and the
environment flag is enabled. It uses a timeout and accepts only the expected
JSON response; if the optional enrichment cannot be used, the template remains
the guaranteed result. The default path is local and deterministic.

### [`src/advisor/feedback.py`](src/advisor/feedback.py) — operator decision log

**Constants:** the default JSONL file path and valid decision words are defined
once.

**`FeedbackLogger.__init__(...)`:** stores the file path and creates a lock so
two threads in this process do not write at the same time.

**`log(...)`:** rejects a decision outside `accepted`, `ignored`, and
`overridden`; creates a timestamped record; chooses the appropriate final
action; locks; appends the record atomically; and returns it.

**`_append_atomic(...)`:** reads existing content, appends one JSON line to a
temporary file, then replaces the old file. `_maybe_trim(...)` keeps only the
newest configured number of records.

**`read_all()` and `override_rate()`:** read valid JSON lines, skip/log
corrupted lines, and calculate the fractions of accepted/ignored/overridden
decisions.

`get_default_logger(...)` reuses one module-level logger instance for the same
path. The final block is a small demonstration that writes sample records and
then removes that demo file.

### [`src/advisor/evaluate.py`](src/advisor/evaluate.py) — research comparison runner

This module is an offline evaluation/report generator, not a live endpoint.

**Imports/constants:** it combines baseline validation, forecast, calibration,
policy, prioritisation, copilot, drift, and MTTA helpers. The constants define
thresholds and documented values for a simulated operator-response-time
comparison.

**Input and metric helpers:** `_load_eval_frame` loads aligned telemetry,
normalizes timestamps, supplies expected columns if absent, and records the
data source in DataFrame metadata. `_rowwise` calculates classification
metrics. `_mean_mtta` calculates average warning time when any failure was
anticipated.

**Baseline and advisor experiments:** `eval_baseline` runs the Random Forest
LOPO workflow and calculates raw probability scores. `eval_forecaster` runs
time-to-failure validation. `fit_full_forecaster` trains a final forecaster
artifact for later use. `eval_calibration` measures raw/calibrated scores and
uncertainty.

- `_oracle_action` chooses the action that would minimize the configured cost
  using the known outcome; it is an evaluation reference, not a live predictor.
- `eval_decision_quality` compares baseline and advisor decisions with that
  reference and counts unnecessary restarts on healthy rows.
- `_failure_onsets` identifies the rows where a service's recorded failure
  changes from 0 to 1.
- `eval_prioritisation_noise` groups related alerts and measures how many
  would be collapsed into fewer cascade groups.
- `latency_bench` times repeated local policy decisions and template briefs.
- `eval_ope` creates a demonstration incident log and runs the policy-value
  estimators against it.
- `_write_thesis_markdown` writes the comparison tables and caveats as a
  readable Markdown report.

`run_all` calls these pieces in order and saves the combined outputs.

**`run_all(...)`:** runs the entire evaluation sequence, builds baseline vs
advisor and staged ablation tables, saves CSV/JSON results, writes a
thesis-style Markdown table, and returns a summary dictionary. Some values
are explicitly simulations, such as the assumed operator reaction time and
the reward data created for off-policy evaluation. The module's header
documents data limitations; the report should not be mistaken for an
empirical human study or a real production intervention.

**`_write_thesis_markdown(...)`:** converts the comparison and ablation tables
to Markdown and writes explanatory caveats beside the results.

The final `__main__` block runs all offline evaluations and prints selected
summary information.

## 5. How to read a prediction, end to end

For a typical live request:

1. The API receives JSON and Pydantic checks its shape.
2. `src/api.py` extracts the ten CPU values into a one-row table.
3. `src/model.py` asks the saved Random Forest for the class-1 probability.
4. `src/api.py` applies the CPU/memory thresholds and picks a rule-based action.
5. `src/xai.py` builds an explanation and runbook.
6. `src/mitigation.py` records a mitigation tier and returns a command string;
   actual command execution is not performed there.
7. The API response returns to the caller and a latest-status/history copy is
   saved under `outputs/`.

For the CSV-watching workflow, `src/live_inference.py` performs the same basic
feature/prediction/decision sequence, but it first detects new CSV rows using a
checkpoint and writes results to JSONL and status files.

## 6. Common beginner questions

**What is a probability in the output?** A number from 0 to 1. For example,
`0.6` is 60%. It is a model score interpreted as failure risk, not a promise
that a failure will happen.

**What does a threshold do?** It is a cutoff. If CPU probability is at least
`0.6`, the code marks a CPU alarm. Changing a threshold changes alarm behavior.

**Why are there two memory/CPU data paths?** Component 2 owns CPU/queue
measurements and Component 3 owns memory predictions. The classifier learns
from CPU/queue signals; the separate decision layer combines CPU and memory
signals after prediction.

**What does “fallback” mean?** A simpler safe/default route used when an
optional or advanced operation is unavailable, such as the risk-to-time
estimate when a trained temporal forecaster is not loaded.

**What are JSONL and checkpoints?** JSONL means one JSON record per text-file
line, convenient for appending a history. A checkpoint is a small saved note
of how far a background reader progressed, so a restart need not reprocess all
old rows.

**What should I read first in the real code?** Start with `src/cli.py`, then
`src/ingestion.py`, `src/model.py`, and `src/validation.py`. After those,
follow one live path in `src/api.py` or `src/live_inference.py`.
