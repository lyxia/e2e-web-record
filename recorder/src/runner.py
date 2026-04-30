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
    launch_options = {"headless": False}
    if proxy:
        launch_options["proxy"] = proxy

    cur_idx = 0
    evidence_idx = 1
    done = False

    async with async_playwright() as playwright:
        ctx = await playwright.chromium.launch_persistent_context(profile, **launch_options)
        page_app = await ctx.new_page()
        page_panel = await ctx.new_page()

        async def on_confirm():
            nonlocal cur_idx, done, evidence_idx
            if done or cur_idx >= len(selected_routes):
                return

            route = selected_routes[cur_idx]
            detected = await _read_marks(page_app)
            confirmed_target_ids.update(detected)

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
                    "confirmedTargetIds": detected,
                    "screenshot": str(screenshot),
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
            await ctx.close()


async def _read_marks(page):
    return await page.evaluate("Array.from(window.__coverageMark__ || [])")


def _runtime_state_baseline(*, panel_state, route, current_url, remaining_routes_count):
    return {
        "schemaVersion": 1,
        "phase": "baseline",
        "currentRouteId": route["routeId"],
        "currentUrl": current_url,
        "currentRoutePath": route.get("path", ""),
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
        "panelState": panel_state,
        "totalRuntimeTargets": len(targets),
        "remainingRoutesCount": 0,
        "lastUpdate": iso_now(),
    }
