import argparse
import asyncio
import os
import sys
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


def resolve_panel_html_arg(value):
    """Validate the --panel-html argument and return an absolute Path.

    Required for live recording. Errors out clearly if the file is missing
    so the caller does not silently fall back to a wrong location.
    """

    if not value:
        raise SystemExit(
            "recorder.py: --panel-html is required (set to <skill>/scripts/panel/index.html)"
        )
    panel_html = Path(value).expanduser().resolve()
    if not panel_html.is_file():
        raise SystemExit(f"recorder.py: --panel-html path does not exist or is not a file: {panel_html}")
    return panel_html


def validate_runtime_python_environment(manifest):
    runtime = manifest.get("runtime", {})
    expected_python = runtime.get("pythonPath")
    if expected_python:
        actual_python = Path(sys.executable).resolve()
        expected_python_path = Path(expected_python).expanduser().resolve()
        if actual_python != expected_python_path:
            raise SystemExit(
                "recorder.py: current Python does not match manifest.runtime.pythonPath\n"
                f"  current:  {actual_python}\n"
                f"  expected: {expected_python_path}\n"
                "Run the recorder with manifest.runtime.pythonPath."
            )

    expected_playwright = runtime.get("playwrightPackagePath")
    if expected_playwright:
        try:
            import playwright
        except Exception as exc:
            raise SystemExit(
                "recorder.py: manifest.runtime.playwrightPackagePath is set, but Playwright "
                f"cannot be imported by {sys.executable}: {exc}"
            )
        actual_playwright = Path(playwright.__file__).resolve()
        expected_playwright_path = Path(expected_playwright).expanduser().resolve()
        if expected_playwright_path not in [actual_playwright, *actual_playwright.parents]:
            raise SystemExit(
                "recorder.py: imported Playwright does not match manifest.runtime.playwrightPackagePath\n"
                f"  current:  {actual_playwright}\n"
                f"  expected: {expected_playwright_path}"
            )


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--state-dir", default=None)
    parser.add_argument("--route", default=None, help="Resume from this routeId.")
    parser.add_argument(
        "--panel-html",
        default=None,
        help="Absolute path to the recorder panel HTML (skill: $SKILL_DIR/scripts/panel/index.html).",
    )
    args = parser.parse_args(argv)

    state_dir = Path(args.state_dir or os.environ.get("STATE_DIR", "coverage-state")).resolve()
    if args.dry_run:
        dry_run(state_dir)
        return

    manifest = read_json(state_dir / "manifest.json")
    validate_runtime_python_environment(manifest)
    panel_html = resolve_panel_html_arg(args.panel_html)
    asyncio.run(run_recorder(state_dir, panel_html, start_route_id=args.route))


if __name__ == "__main__":
    main()
