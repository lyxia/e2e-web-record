import json
from pathlib import Path

import pytest

from evidence import write_route_evidence


def _ensure(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"binary placeholder")


def _make_route():
    return {
        "routeId": "course-center",
        "path": "/course-center",
        "url": "https://example.test/course-center",
        "targetIds": ["src/A.tsx#Modal#L8#C1", "src/A.tsx#Drawer#L20#C2"],
        "targetCount": 2,
    }


def test_write_route_evidence_writes_full_artifact_set(tmp_path):
    route = _make_route()
    screenshot = tmp_path / "tmp" / "screenshots" / "a1.png"
    aria = tmp_path / "tmp" / "aria-snapshots" / "a1.yml"
    trace = tmp_path / "tmp" / "traces" / "course-center.zip"
    _ensure(screenshot)
    _ensure(aria)
    _ensure(trace)

    target_contexts = {
        "src/A.tsx#Modal#L8#C1": {
            "targetId": "src/A.tsx#Modal#L8#C1",
            "firstSeenActionId": "a1",
            "firstSeenAtMs": 1500,
            "firstSeenUrl": "https://example.test/course-center",
            "screenshot": "screenshots/a1.png",
            "ariaSnapshot": "aria-snapshots/a1.yml",
        }
    }

    write_route_evidence(
        state_dir=tmp_path,
        baseline_version="1.0.0",
        route=route,
        confirmed_target_ids=["src/A.tsx#Modal#L8#C1"],
        remaining_target_ids=["src/A.tsx#Drawer#L20#C2"],
        target_contexts=target_contexts,
        interaction_context={
            "actions": [
                {
                    "actionId": "a1",
                    "startedAtMs": 1000,
                    "endedAtMs": 1500,
                    "kind": "click",
                    "selector": "button.open",
                    "summary": "Clicked button: Open modal",
                    "selectorCandidates": ["role=button[name='Open modal']", "css=button.open"],
                    "targetSnapshot": {"tag": "BUTTON", "role": "button", "text": "Open modal"},
                    "newTargetIdsAfter": ["src/A.tsx#Modal#L8#C1"],
                    "detectedTargetIdsAfter": ["src/A.tsx#Modal#L8#C1"],
                    "screenshot": "screenshots/a1.png",
                    "ariaSnapshot": "aria-snapshots/a1.yml",
                    "consoleEventIds": [],
                    "networkEventIds": [],
                    "errorEventIds": [],
                }
            ]
        },
        console_events=[{"id": "c1", "atMs": 1100, "level": "log", "text": "open"}],
        network_events=[],
        error_events=[],
        route_note="ok",
        force_confirm_reason=None,
        screenshot_files=[str(screenshot)],
        aria_snapshot_files=[str(aria)],
        trace_file=str(trace),
    )

    route_dir = tmp_path / "runs" / "baseline-1.0.0" / "routes" / "course-center"
    coverage = json.loads((route_dir / "coverage.json").read_text(encoding="utf-8"))
    assert coverage["confirmedTargetIds"] == ["src/A.tsx#Modal#L8#C1"]
    assert coverage["remainingTargetIds"] == ["src/A.tsx#Drawer#L20#C2"]
    assert "src/A.tsx#Modal#L8#C1" in coverage["targetContexts"]
    assert coverage["operatorNote"] == "ok"
    assert coverage["trace"] == "trace.zip"

    interaction = json.loads((route_dir / "interaction-context.json").read_text(encoding="utf-8"))
    assert interaction["route"]["routeId"] == "course-center"
    assert interaction["route"]["url"] == "https://example.test/course-center"
    assert interaction["route"]["operatorNote"] == "ok"
    assert interaction["actions"][0]["actionId"] == "a1"
    assert interaction["actions"][0]["summary"] == "Clicked button: Open modal"
    assert interaction["targetContexts"]["src/A.tsx#Modal#L8#C1"]["screenshot"] == "screenshots/a1.png"
    assert interaction["artifacts"] == {
        "coverage": "coverage.json",
        "console": "console.json",
        "network": "network.json",
        "errors": "errors.json",
        "trace": "trace.zip",
    }

    console = json.loads((route_dir / "console.json").read_text(encoding="utf-8"))
    assert console[0]["id"] == "c1"
    network = json.loads((route_dir / "network.json").read_text(encoding="utf-8"))
    errors = json.loads((route_dir / "errors.json").read_text(encoding="utf-8"))
    assert network == []
    assert errors == []

    assert (route_dir / "screenshots" / "a1.png").exists()
    assert (route_dir / "aria-snapshots" / "a1.yml").exists()
    assert (route_dir / "trace.zip").exists()


def test_write_route_evidence_records_force_confirm_reason(tmp_path):
    route = _make_route()
    write_route_evidence(
        state_dir=tmp_path,
        baseline_version="1.0.0",
        route=route,
        confirmed_target_ids=[],
        remaining_target_ids=route["targetIds"],
        target_contexts={},
        interaction_context={"actions": []},
        console_events=[],
        network_events=[],
        error_events=[],
        route_note=None,
        force_confirm_reason="cannot reproduce drawer",
    )

    coverage = json.loads(
        (tmp_path / "runs" / "baseline-1.0.0" / "routes" / "course-center" / "coverage.json").read_text(encoding="utf-8")
    )
    assert coverage["forceConfirmReason"] == "cannot reproduce drawer"
    assert coverage["operatorNote"] is None
