import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def test_dashboard_lists_enabled_component2_registry_services(tmp_path, monkeypatch):
    services = [
        {"name": f"service-{index:02d}", "enabled": index != 5}
        for index in range(13)
    ]
    config_path = tmp_path / "services_config.json"
    config_path.write_text(json.dumps({"services": services}), encoding="utf-8")
    monkeypatch.setattr(server, "C2_SERVICES_CONFIG_FILE", str(config_path))
    monkeypatch.setattr(server, "COMP4_STATUS_FILE", str(tmp_path / "missing-status.json"))
    monkeypatch.setattr(server, "COMP3_PRED_FILE", str(tmp_path / "missing-memory.csv"))
    monkeypatch.setattr(server, "COMP3_LIVE_FILE", str(tmp_path / "missing-live.csv"))

    dashboard = server.build_dashboard()

    assert dashboard["summary"]["services"] == 12
    assert {service["service"] for service in dashboard["services"]} == {
        f"service-{index:02d}" for index in range(13) if index != 5
    }
