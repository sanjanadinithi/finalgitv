"""
tests/test_explain_api.py - Phase 1 read-only explainability/mitigation endpoints
=================================================================================

Covers the task's test contract:
- Endpoints exist and are Pydantic-validated.
- attribution_method is present per response; impact_radius is "unavailable"
  (no topology source exists — never invented).
- Placeholder (uniform) contributions => data_available False, empty charts.
- Missing data renders "unavailable", not zeros.
- Cooldown math matches the seeded real mitigation state (180 s policy).
- GET endpoints NEVER execute or mutate mitigation state (no execute path).
"""

from __future__ import annotations

import json
import os
import time

import pytest

os.chdir(os.path.join(os.path.dirname(__file__), ".."))

from fastapi.testclient import TestClient

from src.api import app


@pytest.fixture
def isolated_status(tmp_path, monkeypatch):
    """Point the API's live-status file at a temp copy we control."""
    import src.api as api_module
    status_file = tmp_path / "live_status.json"
    monkeypatch.setattr(api_module, "LIVE_STATUS_FILE", str(status_file))
    return status_file


def _write_status(status_file, payload: dict):
    status_file.write_text(json.dumps(payload), encoding="utf-8")


def _rich_record(svc: str) -> dict:
    """A realistic scored record with varied (non-placeholder) contributions."""
    return {
        "service_name": svc,
        "project_id": "project_2",
        "prediction_timestamp": "2026-10-18T10:00:00+00:00",
        "cpu_failure_prob": 0.81,
        "cpu_alarm": True,
        "memory_prob": 0.05,
        "state_machine": "WARNING",
        "cpu_telemetry_available": True,
        "attribution_method": "treeshap",
        "action_recommended": "LOAD_SHEDDING",
        "advisor": {"recommended_action": "LOAD_SHEDDING"},
        "rca_narrative": "Queue growth is driving the CPU spike risk.",
        "feature_contributions": {
            "in_flight_queue": 34.1, "cpu_percent": 22.7, "queue_growth_rate": 18.9,
            "incoming_rate": 9.2, "cpu_velocity": 6.0, "processing_rate": 3.4,
            "overload_flag": 2.1, "queue_pressure_index": 1.6,
            "cpu_trend_5min": 1.0, "cpu_trend_10min": 0.3,
        },
        "shapley_phi_values": {k: v / 100.0 for k, v in {
            "in_flight_queue": 34.1, "cpu_percent": 22.7}.items()},
        "sre_runbook_steps": ["Shed 25% of ingress traffic."],
        "incident_ticket_payload": {
            "ticket_id": "INC-C4-EXPLAIN", "severity": "WARNING",
            "summary": "Predicted CPU spike", "impact_radius": "project_2 (5 peers)",
        },
    }


def _placeholder_record(svc: str) -> dict:
    rec = _rich_record(svc)
    rec["feature_contributions"] = {f"feat_{i}": 10.0 for i in range(10)}
    rec["cpu_telemetry_available"] = False
    rec["attribution_method"] = "approximate"
    return rec


class TestExplanationEndpoint:
    def test_rich_record_returns_real_attribution(self, isolated_status):
        _write_status(isolated_status, {"svc-a": _rich_record("svc-a")})
        with TestClient(app) as c:
            r = c.get("/api/services/svc-a/explanation")
        assert r.status_code == 200
        d = r.json()
        assert d["data_available"] is True
        assert d["attribution_method"] == "treeshap"
        assert d["primary_cause"]["feature"] == "in_flight_queue"
        assert d["secondary_cause"]["feature"] == "cpu_percent"
        assert d["primary_cause"]["contribution_pct"] == pytest.approx(34.1)
        # Field name kept for compatibility, populated with real values.
        assert d["shapley_phi_values"]
        assert d["runbook_id"] == "RB-01"
        assert len(d["runbook_checklist"]) >= 3

    def test_impact_radius_never_invented(self, isolated_status):
        _write_status(isolated_status, {"svc-a": _rich_record("svc-a")})
        with TestClient(app) as c:
            d = c.get("/api/services/svc-a/explanation").json()
        assert d["impact_radius"] == "unavailable"
        assert "topology" in d["impact_radius_note"].lower()
        # The heuristic co-location figure is quarantined in its own field.
        assert d["impact_radius_heuristic"] == "project_2 (5 peers)"

    def test_placeholder_renders_unavailable_not_zeros(self, isolated_status):
        _write_status(isolated_status, {"svc-p": _placeholder_record("svc-p")})
        with TestClient(app) as c:
            d = c.get("/api/services/svc-p/explanation").json()
        assert d["data_available"] is False
        assert d["feature_contributions"] == {}
        assert d["shapley_phi_values"] == {}
        assert d["primary_cause"] is None
        assert "placeholder" in d["reason"] or "telemetry" in d["reason"]
        # Nothing in the payload collapses to a 0.0% attribution.
        assert "0.0" != json.dumps(d["feature_contributions"])

    def test_method_badge_defaults_to_approximate(self, isolated_status):
        rec = _rich_record("svc-m")
        rec.pop("attribution_method")
        _write_status(isolated_status, {"svc-m": rec})
        with TestClient(app) as c:
            d = c.get("/api/services/svc-m/explanation").json()
        assert d["attribution_method"] == "approximate"

    def test_unknown_service_is_404(self, isolated_status):
        _write_status(isolated_status, {})
        with TestClient(app) as c:
            assert c.get("/api/services/no-such-svc/explanation").status_code == 404

    def test_simulated_payloads_flagged(self, isolated_status):
        _write_status(isolated_status, {"svc-a": _rich_record("svc-a")})
        with TestClient(app) as c:
            d = c.get("/api/services/svc-a/explanation").json()
        assert "SIMULATED" in d["pagerduty_payload"]["note"]
        assert "SIMULATED" in d["servicenow_payload"]["note"]


class TestMitigationEndpoint:
    def test_no_state_yields_unavailable_not_invented_numbers(self, isolated_status):
        _write_status(isolated_status, {})
        with TestClient(app) as c:
            d = c.get("/api/services/svc-x/mitigation").json()
        assert d["data_available"] is False
        assert d["status"] == "unavailable"
        assert d["active_tier"] == 0
        assert d["circuit_breaker"] == "STANDBY"
        assert d["cooldown_remaining_sec"] == 0
        assert d["simulated"] is True

    def test_cooldown_matches_seeded_process_state(self, monkeypatch):
        """The displayed countdown must equal 180 - elapsed from the REAL state."""
        import src.mitigation as mit
        monkeypatch.setattr(mit, "_SERVICE_STATE", {})
        mit._SERVICE_STATE["svc-live"] = {"tier": 2, "last_action_ts": time.time() - 60.0,
                                          "history": []}
        with TestClient(app) as c:
            d = c.get("/api/services/svc-live/mitigation").json()
        assert d["data_available"] is True
        assert d["source"] == "process_state"
        assert d["active_tier"] == 2
        # 180 s policy minus 60 s elapsed -> ~120 s remaining (bounded, sane).
        assert 115 <= d["cooldown_remaining_sec"] <= 120
        assert d["cooldown_total_sec"] == 180
        assert d["circuit_breaker"] == "CLOSED"
        assert "kubectl scale deployment/svc-live" in d["command_preview"]

    def test_get_never_executes_or_mutates(self, monkeypatch):
        """Read-only contract: importing/calling the GET must not touch execute."""
        import src.mitigation as mit
        monkeypatch.setattr(mit, "_SERVICE_STATE", {})

        def _boom(*a, **k):
            raise AssertionError("execute_mitigation_action called by a GET endpoint")

        monkeypatch.setattr(mit, "execute_mitigation_action", _boom)
        import src.api as api_module
        monkeypatch.setattr(api_module, "execute_mitigation_action", _boom, raising=False)

        with TestClient(app) as c:
            for path in ("/api/services/svc-y/mitigation",
                         "/api/services/svc-y/mitigation/history",
                         "/api/services/svc-y/explanation"):
                assert c.get(path).status_code in (200, 404)
        assert mit._SERVICE_STATE == {}  # no state created by reads

    def test_tier_ladder_ships_three_tiers(self, isolated_status):
        _write_status(isolated_status, {})
        with TestClient(app) as c:
            d = c.get("/api/services/svc-z/mitigation").json()
        tiers = {t["tier"] for t in d["tiers"]}
        assert tiers == {1, 2, 3}
        assert any("25%" in t["detail"] for t in d["tiers"])


class TestHistoryEndpoint:
    def test_empty_history_says_so(self):
        import src.mitigation as mit
        snapshot = dict(mit._SERVICE_STATE)
        try:
            mit._SERVICE_STATE.pop("__hist_svc__", None)
            with TestClient(app) as c:
                d = c.get("/api/services/__hist_svc__/mitigation/history").json()
            assert d["entries"] == []
            assert d["count"] == 0
            assert d["note"]
        finally:
            mit._SERVICE_STATE.clear()
            mit._SERVICE_STATE.update(snapshot)

    def test_recorded_escalation_appears(self):
        import src.mitigation as mit
        snapshot = dict(mit._SERVICE_STATE)
        try:
            mit._SERVICE_STATE["__hist_svc2__"] = {
                "tier": 1, "last_action_ts": time.time(),
                "history": [{"timestamp": "2026-10-18T09:00:00+00:00", "tier": 1,
                             "action": "LOAD_SHEDDING", "command": "envoy-cli ...(simulated)"}],
            }
            with TestClient(app) as c:
                d = c.get("/api/services/__hist_svc2__/mitigation/history").json()
            assert d["count"] == 1
            assert d["entries"][0]["action"] == "LOAD_SHEDDING"
        finally:
            mit._SERVICE_STATE.clear()
            mit._SERVICE_STATE.update(snapshot)
