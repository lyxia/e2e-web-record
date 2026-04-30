import json

import pytest

from recorder import dry_run
from recorder import resolve_panel_html_arg
from runner import _read_marks
from runner import _runtime_state_baseline
from runner import _runtime_state_done
from runner import merge_route_seen_target_ids
from runner import build_window_args
from runner import route_confirmed_target_ids


def write_json(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


class FakeFrame:
    def __init__(self, marks=None, error=None):
        self.marks = marks or []
        self.error = error

    async def evaluate(self, _script):
        if self.error:
            raise self.error
        return self.marks


class FakePage(FakeFrame):
    def __init__(self, marks=None, frames=None):
        super().__init__(marks)
        self.frames = frames or []


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


def test_merge_route_seen_target_ids_keeps_unmounted_targets_seen():
    route = {"targetIds": ["modal", "table", "other-route"]}
    seen = {"modal"}

    assert merge_route_seen_target_ids(route, seen, ["table"]) == {"modal", "table"}


def test_build_window_args_positions_independent_chrome_windows():
    assert build_window_args(x=1100, y=0, width=520, height=900) == [
        "--window-position=1100,0",
        "--window-size=520,900",
    ]


def test_runtime_state_records_skip_reasons():
    panel_state = {
        "totalRuntimeTargets": 0,
        "confirmedTotal": 0,
        "currentDetected": [],
        "currentRouteRemaining": [],
    }
    route = {"routeId": "p1", "path": "/p1"}
    skipped_route_ids = {"p1"}
    skipped_route_reasons = {"p1": "no menu entry in business system"}

    baseline = _runtime_state_baseline(
        panel_state=panel_state,
        route=route,
        current_url="http://app.test/p1",
        remaining_routes_count=1,
        skipped_route_ids=skipped_route_ids,
        skipped_route_reasons=skipped_route_reasons,
    )
    done = _runtime_state_done(
        panel_state,
        [],
        skipped_route_ids=skipped_route_ids,
        skipped_route_reasons=skipped_route_reasons,
    )

    assert baseline["skippedRouteReasons"] == skipped_route_reasons
    assert done["skippedRouteReasons"] == skipped_route_reasons


@pytest.mark.asyncio
async def test_read_marks_collects_markers_from_all_frames():
    page = FakePage(
        marks=["top"],
        frames=[
            FakeFrame(["top", "child-a"]),
            FakeFrame(error=Exception("cross-origin blocked")),
            FakeFrame(["child-b"]),
        ],
    )

    assert await _read_marks(page) == ["top", "child-a", "child-b"]


def test_resolve_panel_html_arg_returns_absolute_path_when_file_exists(tmp_path):
    panel = tmp_path / "panel" / "index.html"
    panel.parent.mkdir(parents=True)
    panel.write_text("<html></html>", encoding="utf-8")
    resolved = resolve_panel_html_arg(str(panel))
    assert resolved == panel.resolve()


def test_resolve_panel_html_arg_errors_when_value_missing():
    with pytest.raises(SystemExit):
        resolve_panel_html_arg(None)


def test_resolve_panel_html_arg_errors_when_path_does_not_exist(tmp_path):
    missing = tmp_path / "panel" / "nope.html"
    with pytest.raises(SystemExit):
        resolve_panel_html_arg(str(missing))
