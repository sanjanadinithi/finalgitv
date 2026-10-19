import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def test_missing_mtta_file_returns_empty_measured_values(tmp_path, monkeypatch):
    monkeypatch.setattr(server, "COMP4_MTTA_FILE", str(tmp_path / "missing.csv"))

    metrics = server.load_mtta_metrics()

    assert metrics["strategies"] == []
    assert metrics["by_service"] == {}
    assert metrics["fleet"]["fleet_mean_mtta_minutes"] is None
    assert metrics["fleet"]["fleet_anticipation_rate_pct"] is None
    assert metrics["fleet"]["hypothesis_h3_met"] is None


def test_mtta_without_anticipated_events_has_no_mean_lead_time(tmp_path, monkeypatch):
    results_path = tmp_path / "mtta.csv"
    results_path.write_text(
        "strategy,service_name,mtta_seconds,mtta_minutes,anticipated\n"
        "CPU_Only,api,0,0,0\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(server, "COMP4_MTTA_FILE", str(results_path))

    metrics = server.load_mtta_metrics()

    assert metrics["fleet"]["fleet_mean_mtta_minutes"] is None
    assert metrics["fleet"]["fleet_mean_mtta_seconds"] is None
    assert metrics["fleet"]["fleet_anticipation_rate_pct"] == 0
    assert metrics["fleet"]["hypothesis_h3_met"] is None
    assert metrics["strategies"][0]["mean_mtta_minutes"] is None
