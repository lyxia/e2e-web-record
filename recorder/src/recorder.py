import argparse
import asyncio
import os
from pathlib import Path

from panel_state import compute_panel_state
from runner import atomic_write_json, iso_now, read_json, run_recorder


def dry_run(state_dir: Path):
    manifest = read_json(state_dir / "manifest.json")
    target_packages = manifest.get("runtime", {}).get("targetPackages")
    if (
        not isinstance(target_packages, list)
        or not target_packages
        or any(not isinstance(package_name, str) or not package_name for package_name in target_packages)
    ):
        raise ValueError("manifest.runtime.targetPackages must be a non-empty array of strings")

    targets = read_json(state_dir / "coverage-targets.json").get("targets", [])
    selected_routes = read_json(state_dir / "route-checklist.json").get("selectedRoutes", [])
    current_route = selected_routes[0] if selected_routes else None
    panel_state = compute_panel_state(
        targets=targets,
        selected_routes=selected_routes,
        current_route=current_route,
        detected_target_ids=set(),
        confirmed_target_ids=set(),
    )

    if current_route is None:
        runtime_state = {
            "schemaVersion": 1,
            "phase": "done",
            "currentRouteId": None,
            "currentUrl": None,
            "currentRoutePath": "",
            "detectedTargetIds": [],
            "currentRouteRemaining": [],
            "totalRuntimeTargets": len(targets),
            "confirmedTotal": 0,
            "panelState": panel_state,
            "remainingRoutesCount": 0,
            "lastUpdate": iso_now(),
        }
    else:
        runtime_state = {
            "schemaVersion": 1,
            "phase": "baseline",
            "currentRouteId": current_route["routeId"],
            "currentUrl": current_route["url"],
            "currentRoutePath": current_route.get("path", ""),
            "detectedTargetIds": [],
            "currentRouteRemaining": [target["id"] for target in panel_state["currentRouteRemaining"]],
            "totalRuntimeTargets": panel_state["totalRuntimeTargets"],
            "confirmedTotal": panel_state["confirmedTotal"],
            "panelState": panel_state,
            "remainingRoutesCount": len(selected_routes),
            "lastUpdate": iso_now(),
        }

    atomic_write_json(state_dir / "runtime-state.json", runtime_state)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)

    state_dir = Path(os.environ.get("STATE_DIR", "coverage-state")).resolve()
    panel_html = (Path(__file__).parent / "panel" / "index.html").resolve()
    if args.dry_run:
        dry_run(state_dir)
        return

    asyncio.run(run_recorder(state_dir, panel_html))


if __name__ == "__main__":
    main()
