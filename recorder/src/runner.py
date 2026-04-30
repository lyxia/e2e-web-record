import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from panel_state import compute_panel_state


POLL_MS = 200


def iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def atomic_write_json(path: Path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as tmp:
            json.dump(value, tmp, ensure_ascii=False, indent=2)
            tmp.write("\n")
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


async def run_recorder(state_dir: Path, panel_html: Path):
    manifest = read_json(state_dir / "manifest.json")
    targets = read_json(state_dir / "coverage-targets.json").get("targets", [])
    selected_routes = read_json(state_dir / "route-checklist.json").get("selectedRoutes", [])
    confirmed_target_ids = set()

    if not selected_routes:
        panel_state = compute_panel_state(
            targets=targets,
            selected_routes=selected_routes,
            current_route=None,
            detected_target_ids=set(),
            confirmed_target_ids=confirmed_target_ids,
        )
        atomic_write_json(state_dir / "runtime-state.json", _runtime_state_done(panel_state, targets))
        return

    from playwright.async_api import async_playwright

    runtime = manifest.get("runtime", {})
    profile = runtime.get("playwrightProfile") or str(state_dir / ".playwright-profile")
    proxy = runtime.get("proxy")
    app_width = int(runtime.get("appWindowWidth", 1100))
    app_height = int(runtime.get("appWindowHeight", 900))
    panel_width = int(runtime.get("panelWindowWidth", 520))
    panel_height = int(runtime.get("panelWindowHeight", app_height))

    app_launch_options = {
        "headless": False,
        "args": [
            "--ignore-certificate-errors",
            *build_window_args(x=0, y=0, width=app_width, height=app_height),
        ],
        "viewport": {"width": app_width, "height": app_height},
    }
    if proxy:
        app_launch_options["proxy"] = {"server": proxy}

    panel_launch_options = {
        "headless": False,
        "args": build_window_args(x=app_width, y=0, width=panel_width, height=panel_height),
    }

    cur_idx = 0
    evidence_idx = 1
    done = False

    async with async_playwright() as playwright:
        ctx_app = await playwright.chromium.launch_persistent_context(profile, **app_launch_options)
        browser_panel = await playwright.chromium.launch(**panel_launch_options)
        ctx_panel = await browser_panel.new_context(viewport={"width": panel_width, "height": panel_height})
        page_app = ctx_app.pages[0] if ctx_app.pages else await ctx_app.new_page()
        page_panel = await ctx_panel.new_page()

        async def on_confirm():
            nonlocal cur_idx, done, evidence_idx
            if done or cur_idx >= len(selected_routes):
                return

            route = selected_routes[cur_idx]
            detected = await _read_marks(page_app)
            confirmed = route_confirmed_target_ids(route, detected)
            confirmed_target_ids.update(confirmed)

            baseline_version = manifest.get("baseline", {}).get("version", "unknown")
            ev_dir = state_dir / "runs" / f"baseline-{baseline_version}" / "pages" / route["routeId"]
            ev_dir.mkdir(parents=True, exist_ok=True)
            screenshot = ev_dir / "screenshot.png"
            await page_app.screenshot(path=str(screenshot), full_page=True)
            atomic_write_json(
                ev_dir / "coverage.json",
                {
                    "evidenceId": f"baseline-{evidence_idx:03d}",
                    "createdAt": iso_now(),
                    "url": page_app.url,
                    "routeId": route["routeId"],
                    "detectedTargetIds": detected,
                    "confirmedTargetIds": confirmed,
                    "screenshot": "screenshot.png",
                    "reviewStatus": "visual-ok",
                },
            )

            evidence_idx += 1
            cur_idx += 1
            if cur_idx >= len(selected_routes):
                done = True
                panel_state = compute_panel_state(
                    targets=targets,
                    selected_routes=selected_routes,
                    current_route=None,
                    detected_target_ids=set(),
                    confirmed_target_ids=confirmed_target_ids,
                )
                atomic_write_json(state_dir / "runtime-state.json", _runtime_state_done(panel_state, targets))
                return

            await page_app.goto(selected_routes[cur_idx]["url"])

        await page_panel.expose_function("confirmRoute", on_confirm)
        await page_panel.goto(panel_html.resolve().as_uri())
        await page_app.goto(selected_routes[0]["url"])

        try:
            while not done:
                route = selected_routes[cur_idx]
                detected = await _read_marks(page_app)
                panel_state = compute_panel_state(
                    targets=targets,
                    selected_routes=selected_routes,
                    current_route=route,
                    detected_target_ids=set(detected),
                    confirmed_target_ids=confirmed_target_ids,
                )
                try:
                    await page_panel.evaluate("(s) => window.updatePanel && window.updatePanel(s)", panel_state)
                except Exception:
                    pass
                atomic_write_json(
                    state_dir / "runtime-state.json",
                    _runtime_state_baseline(
                        panel_state=panel_state,
                        route=route,
                        current_url=page_app.url,
                        remaining_routes_count=len(selected_routes) - cur_idx,
                    ),
                )
                await page_app.wait_for_timeout(POLL_MS)
        finally:
            current_state_path = state_dir / "runtime-state.json"
            if done and current_state_path.exists():
                state = read_json(current_state_path)
                state["phase"] = "done"
                state["lastUpdate"] = iso_now()
                atomic_write_json(current_state_path, state)
            await ctx_panel.close()
            await browser_panel.close()
            await ctx_app.close()


def build_window_args(*, x: int, y: int, width: int, height: int):
    return [f"--window-position={x},{y}", f"--window-size={width},{height}"]


async def _read_marks(page):
    try:
        return await page.evaluate("Array.from(window.__coverageMark__ || [])")
    except Exception:
        return []


def route_confirmed_target_ids(route, detected_target_ids):
    route_target_ids = set(route.get("targetIds", []))
    return [target_id for target_id in detected_target_ids if target_id in route_target_ids]


def _runtime_state_baseline(*, panel_state, route, current_url, remaining_routes_count):
    return {
        "schemaVersion": 1,
        "phase": "baseline",
        "currentRouteId": route["routeId"],
        "currentUrl": current_url,
        "currentRoutePath": route.get("path", ""),
        "detectedTargetIds": [target["id"] for target in panel_state["currentDetected"]],
        "currentRouteRemaining": [target["id"] for target in panel_state["currentRouteRemaining"]],
        "totalRuntimeTargets": panel_state["totalRuntimeTargets"],
        "confirmedTotal": panel_state["confirmedTotal"],
        "panelState": panel_state,
        "remainingRoutesCount": remaining_routes_count,
        "lastUpdate": iso_now(),
    }


def _runtime_state_done(panel_state, targets):
    return {
        "schemaVersion": 1,
        "phase": "done",
        "currentRouteId": None,
        "currentUrl": None,
        "currentRoutePath": "",
        "detectedTargetIds": [],
        "currentRouteRemaining": [],
        "totalRuntimeTargets": len(targets),
        "confirmedTotal": panel_state["confirmedTotal"],
        "panelState": panel_state,
        "remainingRoutesCount": 0,
        "lastUpdate": iso_now(),
    }
