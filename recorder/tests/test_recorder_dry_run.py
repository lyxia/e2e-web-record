import json

from recorder import dry_run
from recorder import resolve_panel_html
from runner import route_confirmed_target_ids


def write_json(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def test_dry_run_writes_initial_runtime_state(tmp_path):
    write_json(
        tmp_path / "manifest.json",
        {
            "baseline": {"version": "1.2.3"},
            "runtime": {"targetPackages": ["@example/ui"]},
        },
    )
    write_json(
        tmp_path / "coverage-targets.json",
        {
            "targets": [
                {
                    "targetId": "src/A.tsx#Widget#L4#C10",
                    "importedName": "Widget",
                    "file": "src/A.tsx",
                    "line": 4,
                }
            ]
        },
    )
    write_json(
        tmp_path / "route-checklist.json",
        {
            "selectedRoutes": [
                {
                    "routeId": "p1",
                    "path": "/p1",
                    "url": "http://app.test/p1",
                    "targetIds": ["src/A.tsx#Widget#L4#C10"],
                    "targetCount": 1,
                }
            ]
        },
    )

    dry_run(tmp_path)

    state = json.loads((tmp_path / "runtime-state.json").read_text(encoding="utf-8"))
    assert state["phase"] == "baseline"
    assert state["currentRouteId"] == "p1"
    assert state["currentUrl"] == "http://app.test/p1"
    assert state["remainingRoutesCount"] == 1
    assert state["detectedTargetIds"] == []
    assert state["currentRouteRemaining"] == ["src/A.tsx#Widget#L4#C10"]
    assert state["totalRuntimeTargets"] == 1
    assert state["confirmedTotal"] == 0
    assert state["panelState"]["totalRuntimeTargets"] == 1
    assert state["panelState"]["currentRouteRemaining"] == [
        {
            "id": "src/A.tsx#Widget#L4#C10",
            "importedName": "Widget",
            "file": "src/A.tsx",
            "line": 4,
        }
    ]


def test_dry_run_empty_selected_routes_writes_done_without_indexing(tmp_path):
    write_json(tmp_path / "manifest.json", {"runtime": {"targetPackages": ["@example/ui"]}})
    write_json(tmp_path / "coverage-targets.json", {"targets": []})
    write_json(tmp_path / "route-checklist.json", {"selectedRoutes": []})

    dry_run(tmp_path)

    state = json.loads((tmp_path / "runtime-state.json").read_text(encoding="utf-8"))
    assert state["phase"] == "done"
    assert state["currentRouteId"] is None
    assert state["currentUrl"] is None
    assert state["remainingRoutesCount"] == 0
    assert state["detectedTargetIds"] == []
    assert state["currentRouteRemaining"] == []
    assert state["totalRuntimeTargets"] == 0
    assert state["confirmedTotal"] == 0
    assert state["panelState"]["totalRuntimeTargets"] == 0


def test_confirm_filters_detected_markers_to_current_route_targets():
    route = {"targetIds": ["route-a", "route-b"]}

    assert route_confirmed_target_ids(route, ["layout-x", "route-a", "route-b"]) == ["route-a", "route-b"]


def test_resolve_panel_html_finds_repo_panel_dist():
    assert resolve_panel_html().name == "index.html"
    assert resolve_panel_html().exists()
