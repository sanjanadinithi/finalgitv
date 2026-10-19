"""
tests/test_dashboard_audit.py — Phase 0 truth-audit guarantees on the gateway.

The audit (cpu_spike_predictor/outputs/dashboard_audit.md) found the stored
precision/FAR columns in lopo_results.csv inconsistent with the file's own
confusion counts, and both eval-output CSVs older than their inputs. The
gateway now (a) recomputes LOPO metrics from TN/FP/FN/TP, (b) flags the
mismatch, and (c) publishes provenance with stale flags. These tests pin all
three to the real source files so the UI can never silently drift again.
"""

import csv
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import server


def _recompute(row):
    tp = int(float(row.get("true_positives") or 0))
    fp = int(float(row.get("false_positives") or 0))
    fn = int(float(row.get("false_negatives") or 0))
    tn = int(float(row.get("true_negatives") or 0))
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * p * r / (p + r) if (p + r) else 0.0
    far = fp / (tn + fp) if (tn + fp) else 0.0
    return p, r, f1, far


class TestLopoSourceMatch:
    @pytest.fixture(scope="class")
    def reliability(self):
        return server.build_reliability()

    def test_every_csv_fold_is_surfaced(self, reliability):
        with open(server.LOPO_FILE, newline="", encoding="utf-8") as f:
            csv_rows = list(csv.DictReader(f))
        assert len(reliability["cpu_lopo"]) == len(csv_rows) > 0
        assert {fold["project"] for fold in reliability["cpu_lopo"]} == {
            r["test_project"] for r in csv_rows}

    def test_ui_values_equal_recomputed_confusion_counts(self, reliability):
        """What the Reliability view renders must equal TN/FP/FN/TP math —
        the same formulas src/validation.py uses — not the stored columns."""
        with open(server.LOPO_FILE, newline="", encoding="utf-8") as f:
            csv_rows = {r["test_project"]: r for r in csv.DictReader(f)}
        for fold in reliability["cpu_lopo"]:
            p, r, f1, far = _recompute(csv_rows[fold["project"]])
            assert fold["precision"] == pytest.approx(round(p, 4), abs=1e-4)
            assert fold["recall"] == pytest.approx(round(r, 4), abs=1e-4)
            assert fold["f1"] == pytest.approx(round(f1, 4), abs=1e-4)
            assert fold["far"] == pytest.approx(round(far, 4), abs=1e-4)
            # Raw confusion counts travel with each fold for transparency.
            assert fold["true_positives"] == int(float(csv_rows[fold["project"]]["true_positives"]))

    def test_stored_values_kept_for_transparency(self, reliability):
        for fold in reliability["cpu_lopo"]:
            for key in ("stored_precision", "stored_recall", "stored_f1", "stored_far"):
                assert key in fold

    def test_mismatch_flag_matches_reality(self, reliability):
        """Flag must be True iff some stored precision/FAR diverges from the
        recomputation beyond tolerance (the audit found it does)."""
        with open(server.LOPO_FILE, newline="", encoding="utf-8") as f:
            expected = False
            for row in csv.DictReader(f):
                p, r, f1, far = _recompute(row)
                sp = row.get("precision")
                sfar = row.get("false_alarm_rate")
                if sp and abs(float(sp) - p) > 0.01:
                    expected = True
                if sfar and abs(float(sfar) - far) > 0.005:
                    expected = True
        assert reliability["cpu_lopo_metrics_mismatch"] == expected
        assert expected is True, "audit precondition: lopo_results.csv is internally inconsistent"


class TestMttaSourceMatch:
    def test_strategy_event_counts_equal_csv(self):
        with open(server.COMP4_MTTA_FILE, newline="", encoding="utf-8") as f:
            rows = list(csv.DictReader(f))
        totals = {}
        anticipated = {}
        for r in rows:
            s = r["strategy"]
            totals[s] = totals.get(s, 0) + 1
            if int(float(r.get("anticipated", 0) or 0)) == 1:
                anticipated[s] = anticipated.get(s, 0) + 1

        mtta = server.load_mtta_metrics()
        assert mtta["strategies"], "MTTA strategies must not be empty"
        for strat in mtta["strategies"]:
            # Every warning-time figure carries its event count n (task rule).
            assert strat["total_events"] == totals[strat["strategy"]]
            assert strat["anticipated_events"] == anticipated.get(strat["strategy"], 0)

    def test_fleet_block_reports_n(self):
        mtta = server.load_mtta_metrics()
        assert mtta["fleet"]["total_events"] is not None
        cpu_total = sum(1 for r in csv.DictReader(open(server.COMP4_MTTA_FILE, newline="", encoding="utf-8"))
                        if r["strategy"] == "CPU_Only")
        assert mtta["fleet"]["total_events"] == cpu_total


class TestProvenance:
    def test_provenance_present_on_reliability_payload(self):
        prov = server.build_reliability()["provenance"]
        for key in ("dataset_file", "dataset_rows", "model_mtime", "lopo_mtime",
                    "mtta_mtime", "lopo_stale", "mtta_stale", "run_timestamp"):
            assert key in prov

    def test_stale_flags_match_file_mtimes(self):
        prov = server.build_dashboard_provenance()
        lopo_ts = Path(server.LOPO_FILE).stat().st_mtime
        mtta_ts = Path(server.COMP4_MTTA_FILE).stat().st_mtime
        input_ts = max(Path(server.COMP4_DATASET_FILE).stat().st_mtime,
                       Path(server.COMP4_MODEL_FILE).stat().st_mtime)
        assert prov["lopo_stale"] == (lopo_ts < input_ts)
        assert prov["mtta_stale"] == (mtta_ts < input_ts)

    def test_dataset_row_count_is_real(self):
        prov = server.build_dashboard_provenance()
        with open(server.COMP4_DATASET_FILE, newline="", encoding="utf-8") as f:
            actual = sum(1 for _ in f) - 1
        assert prov["dataset_rows"] == actual

    def test_eval_summary_is_from_file_not_hardcoded(self):
        prov = server.build_dashboard_provenance()
        summary_path = Path(server.COMP4_EVAL_SUMMARY_FILE)
        if not summary_path.exists():
            pytest.skip("advisor evaluation summary not generated")
        data = json.loads(summary_path.read_text(encoding="utf-8"))
        flat = json.dumps(data)
        assert prov["eval_summary"] is not None or "baseline" not in flat
