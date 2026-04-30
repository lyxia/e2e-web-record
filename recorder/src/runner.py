import json
import os
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path

from action_timeline import assign_events_to_actions, create_target_context
from evidence import write_route_evidence
from panel_state import compute_panel_state


POLL_MS = 200

ACTION_LISTENER_SCRIPT = r"""
(() => {
  if (window.__coverageActionTimeline) return;
  const list = [];
  window.__coverageActionTimeline = list;
  let nextId = 1;
  const now = () => Date.now();
  const cssPath = (el) => {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return `#${el.id}`;
    const tag = el.tagName.toLowerCase();
    if (el.classList && el.classList.length) return `${tag}.${Array.from(el.classList).slice(0, 2).join('.')}`;
    return tag;
  };
  const push = (kind, extra) => {
    const at = now();
    list.push({
      actionId: `a${nextId++}`,
      kind,
      startedAtMs: at,
      endedAtMs: at,
      urlAfter: location.href,
      ...extra,
    });
  };
  document.addEventListener('click', (event) => push('click', { selector: cssPath(event.target) }), true);
  document.addEventListener('change', (event) => push('change', { selector: cssPath(event.target) }), true);
  document.addEventListener('submit', (event) => push('submit', { selector: cssPath(event.target) }), true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === 'Escape') push('key', { key: event.key });
  }, true);
  let inputTimer;
  document.addEventListener('input', (event) => {
    clearTimeout(inputTimer);
    const target = event.target;
    inputTimer = setTimeout(() => {
      push('input', {
        selector: cssPath(target),
        valueKind: (target && target.type) || 'text',
        valueLength: ((target && target.value) || '').length,
      });
    }, 250);
  }, true);
  window.addEventListener('popstate', () => push('navigation', {}));
})();
"""


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


async def run_recorder(state_dir: Path, panel_html: Path, *, start_route_id: str | None = None):
    manifest = read_json(state_dir / "manifest.json")
    targets = read_json(state_dir / "coverage-targets.json").get("targets", [])
    selected_routes = read_json(state_dir / "route-checklist.json").get("selectedRoutes", [])
    confirmed_target_ids = set()
    confirmed_route_ids = set()
    skipped_route_ids = set()
    skipped_route_reasons = {}

    if start_route_id:
        cur_idx = next(
            (idx for idx, route in enumerate(selected_routes) if route.get("routeId") == start_route_id),
            0,
        )
    else:
        cur_idx = 0

    if not selected_routes:
        panel_state = compute_panel_state(
            targets=targets,
            selected_routes=selected_routes,
            current_route=None,
            detected_target_ids=set(),
            confirmed_target_ids=confirmed_target_ids,
            confirmed_route_ids=confirmed_route_ids,
            skipped_route_ids=skipped_route_ids,
        )
        atomic_write_json(
            state_dir / "runtime-state.json",
            _runtime_state_done(
                panel_state,
                targets,
                skipped_route_ids=skipped_route_ids,
                skipped_route_reasons=skipped_route_reasons,
                confirmed_route_ids=confirmed_route_ids,
            ),
        )
        return

    from playwright.async_api import async_playwright

    runtime = manifest.get("runtime", {})
    baseline_version = manifest.get("baseline", {}).get("version", "unknown")
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

    evidence_idx = 1
    done = False
    route_seen_target_ids = set()
    target_contexts: dict = {}
    console_events: list = []
    network_events: list = []
    error_events: list = []
    screenshot_files: list = []
    aria_snapshot_files: list = []
    last_known_actions: list = []
    next_event_id = 1
    current_trace_file = None

    artifact_dir = state_dir / "runs" / f"baseline-{baseline_version}" / "tmp"
    artifact_dir.mkdir(parents=True, exist_ok=True)

    async with async_playwright() as playwright:
        ctx_app = await playwright.chromium.launch_persistent_context(profile, **app_launch_options)
        browser_panel = await playwright.chromium.launch(**panel_launch_options)
        ctx_panel = await browser_panel.new_context(viewport={"width": panel_width, "height": panel_height})
        page_app = ctx_app.pages[0] if ctx_app.pages else await ctx_app.new_page()
        page_panel = await ctx_panel.new_page()

        await page_app.add_init_script(ACTION_LISTENER_SCRIPT)

        def _push_console(message):
            nonlocal next_event_id
            try:
                text = message.text
                level = message.type
            except Exception:
                return
            console_events.append({
                "id": f"c{next_event_id}",
                "atMs": int(time.time() * 1000),
                "level": level,
                "text": text,
            })
            next_event_id += 1

        def _push_pageerror(error):
            nonlocal next_event_id
            error_events.append({
                "id": f"e{next_event_id}",
                "atMs": int(time.time() * 1000),
                "message": str(error),
            })
            next_event_id += 1

        def _push_request_finished(request):
            nonlocal next_event_id
            try:
                url = request.url
                method = request.method
            except Exception:
                return
            network_events.append({
                "id": f"n{next_event_id}",
                "atMs": int(time.time() * 1000),
                "url": url,
                "method": method,
            })
            next_event_id += 1

        page_app.on("console", _push_console)
        page_app.on("pageerror", _push_pageerror)
        page_app.on("requestfinished", _push_request_finished)

        async def _read_actions():
            try:
                return await page_app.evaluate("Array.from(window.__coverageActionTimeline || [])")
            except Exception:
                return []

        async def _read_aria_snapshot(action_id):
            try:
                snapshot = await page_app.locator("body").aria_snapshot()
            except Exception:
                return None
            target = artifact_dir / "aria-snapshots" / f"{action_id}.yml"
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(snapshot, encoding="utf-8")
            return target

        async def _capture_target_context(target_id, latest_actions):
            if not latest_actions:
                return
            action = latest_actions[-1]
            action_id = action.get("actionId", f"unknown-{len(target_contexts)+1}")
            screenshot_path = artifact_dir / "screenshots" / f"{action_id}.png"
            screenshot_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                await page_app.screenshot(path=str(screenshot_path), full_page=False)
                screenshot_files.append(str(screenshot_path))
            except Exception:
                pass
            aria_path = await _read_aria_snapshot(action_id)
            if aria_path:
                aria_snapshot_files.append(str(aria_path))
            target_contexts[target_id] = create_target_context(
                target_id=target_id,
                action=action,
                screenshot=str(screenshot_path),
                aria_snapshot=str(aria_path) if aria_path else "",
            )

        async def _start_route_trace(route):
            try:
                await ctx_app.tracing.stop()
            except Exception:
                pass
            try:
                await ctx_app.tracing.start(screenshots=True, snapshots=True, sources=True)
            except Exception:
                return None
            return artifact_dir / "traces" / f"{route['routeId']}.zip"

        async def _stop_route_trace(trace_path):
            if not trace_path:
                return None
            trace_path.parent.mkdir(parents=True, exist_ok=True)
            try:
                await ctx_app.tracing.stop(path=str(trace_path))
            except Exception:
                return None
            return trace_path

        async def on_confirm(reason=None):
            nonlocal cur_idx, done, evidence_idx, route_seen_target_ids, target_contexts
            nonlocal console_events, network_events, error_events, screenshot_files, aria_snapshot_files
            nonlocal current_trace_file
            if done or cur_idx >= len(selected_routes):
                return

            route = selected_routes[cur_idx]
            actions = await _read_actions()
            route_seen_target_ids = merge_route_seen_target_ids(
                route,
                route_seen_target_ids,
                await _read_marks(page_app),
            )
            detected = list(route_seen_target_ids)
            confirmed = route_confirmed_target_ids(route, detected)
            confirmed_target_ids.update(confirmed)
            confirmed_route_ids.add(route["routeId"])
            remaining = [
                target_id
                for target_id in route.get("targetIds", [])
                if target_id not in set(confirmed)
            ]

            timeline_actions = assign_events_to_actions(
                actions,
                console_events,
                network_events,
                error_events,
            )
            route_screenshot = await _capture_route_screenshot(page_app, artifact_dir, "route-confirm")
            if route_screenshot:
                screenshot_files.append(str(route_screenshot))
            trace_file = await _stop_route_trace(current_trace_file)

            write_route_evidence(
                state_dir=state_dir,
                baseline_version=baseline_version,
                route=route,
                confirmed_target_ids=confirmed,
                remaining_target_ids=remaining,
                target_contexts=target_contexts,
                interaction_context={"actions": timeline_actions},
                console_events=console_events,
                network_events=network_events,
                error_events=error_events,
                route_note=reason,
                force_confirm_reason=reason if remaining else None,
                screenshot_files=screenshot_files,
                aria_snapshot_files=aria_snapshot_files,
                trace_file=str(trace_file) if trace_file else None,
            )

            evidence_idx += 1
            cur_idx += 1
            route_seen_target_ids = set()
            target_contexts = {}
            console_events = []
            network_events = []
            error_events = []
            screenshot_files = []
            aria_snapshot_files = []
            current_trace_file = None
            try:
                await page_app.evaluate("window.__coverageActionTimeline = []")
            except Exception:
                pass

            if cur_idx >= len(selected_routes):
                done = True
                panel_state = compute_panel_state(
                    targets=targets,
                    selected_routes=selected_routes,
                    current_route=None,
                    detected_target_ids=set(),
                    confirmed_target_ids=confirmed_target_ids,
                    confirmed_route_ids=confirmed_route_ids,
                    skipped_route_ids=skipped_route_ids,
                )
                atomic_write_json(
                    state_dir / "runtime-state.json",
                    _runtime_state_done(
                        panel_state,
                        targets,
                        skipped_route_ids=skipped_route_ids,
                        skipped_route_reasons=skipped_route_reasons,
                        confirmed_route_ids=confirmed_route_ids,
                    ),
                )
                return

            await goto_route(page_app, selected_routes[cur_idx]["url"])
            current_trace_file = await _start_route_trace(selected_routes[cur_idx])

        async def on_skip(reason=None):
            nonlocal cur_idx, done, route_seen_target_ids, current_trace_file
            if done or cur_idx >= len(selected_routes):
                return

            reason_text = str(reason or "").strip()
            if not reason_text:
                raise ValueError("Skip requires a reason.")

            route = selected_routes[cur_idx]
            route_id = route["routeId"]
            skipped_route_ids.add(route_id)
            skipped_route_reasons[route_id] = reason_text
            route_screenshot = await _capture_route_screenshot(page_app, artifact_dir, "route-skip")
            route_screenshot_files = [str(route_screenshot)] if route_screenshot else []
            trace_file = await _stop_route_trace(current_trace_file)

            write_route_evidence(
                state_dir=state_dir,
                baseline_version=baseline_version,
                route=route,
                confirmed_target_ids=[],
                remaining_target_ids=list(route.get("targetIds", [])),
                target_contexts={},
                interaction_context={"actions": []},
                console_events=[],
                network_events=[],
                error_events=[],
                route_note=reason_text,
                skipped=True,
                skipped_reason=reason_text,
                screenshot_files=route_screenshot_files,
                trace_file=str(trace_file) if trace_file else None,
            )

            cur_idx += 1
            route_seen_target_ids = set()
            current_trace_file = None
            if cur_idx >= len(selected_routes):
                done = True
                panel_state = compute_panel_state(
                    targets=targets,
                    selected_routes=selected_routes,
                    current_route=None,
                    detected_target_ids=set(),
                    confirmed_target_ids=confirmed_target_ids,
                    confirmed_route_ids=confirmed_route_ids,
                    skipped_route_ids=skipped_route_ids,
                )
                atomic_write_json(
                    state_dir / "runtime-state.json",
                    _runtime_state_done(
                        panel_state,
                        targets,
                        skipped_route_ids=skipped_route_ids,
                        skipped_route_reasons=skipped_route_reasons,
                        confirmed_route_ids=confirmed_route_ids,
                    ),
                )
                return

            await goto_route(page_app, selected_routes[cur_idx]["url"])
            current_trace_file = await _start_route_trace(selected_routes[cur_idx])

        await page_panel.expose_function("confirmRoute", on_confirm)
        await page_panel.expose_function("skipRoute", on_skip)
        await page_panel.goto(panel_html.resolve().as_uri())
        await goto_route(page_app, selected_routes[cur_idx]["url"])
        current_trace_file = await _start_route_trace(selected_routes[cur_idx])

        try:
            while not done:
                route = selected_routes[cur_idx]
                marks = await _read_marks(page_app)
                actions = await _read_actions()
                last_known_actions = actions
                new_targets = [
                    target_id
                    for target_id in marks
                    if target_id in route.get("targetIds", [])
                    and target_id not in target_contexts
                ]
                for target_id in new_targets:
                    await _capture_target_context(target_id, last_known_actions)

                route_seen_target_ids = merge_route_seen_target_ids(
                    route,
                    route_seen_target_ids,
                    marks,
                )
                panel_state = compute_panel_state(
                    targets=targets,
                    selected_routes=selected_routes,
                    current_route=route,
                    detected_target_ids=route_seen_target_ids,
                    confirmed_target_ids=confirmed_target_ids,
                    confirmed_route_ids=confirmed_route_ids,
                    skipped_route_ids=skipped_route_ids,
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
                        skipped_route_ids=skipped_route_ids,
                        confirmed_route_ids=confirmed_route_ids,
                        skipped_route_reasons=skipped_route_reasons,
                    ),
                )
                await page_app.wait_for_timeout(POLL_MS)
        finally:
            current_state_path = state_dir / "runtime-state.json"
            if done and current_state_path.exists():
                state = read_json(current_state_path)
                state["phase"] = "done"
                state["lastUpdate"] = iso_now()
                state["heartbeatAt"] = iso_now()
                atomic_write_json(current_state_path, state)
            await ctx_panel.close()
            await browser_panel.close()
            await ctx_app.close()


def build_window_args(*, x: int, y: int, width: int, height: int):
    return [f"--window-position={x},{y}", f"--window-size={width},{height}"]


async def goto_route(page, url: str):
    return await page.goto(url, wait_until="domcontentloaded", timeout=60000)


async def _read_marks(page):
    marks = []

    for frame in [page, *getattr(page, "frames", [])]:
        try:
            frame_marks = await frame.evaluate("Array.from(window.__coverageMark__ || [])")
        except Exception:
            continue
        marks.extend(frame_marks)

    seen = set()
    unique_marks = []
    for mark in marks:
        if mark not in seen:
            seen.add(mark)
            unique_marks.append(mark)
    return unique_marks


async def _capture_route_screenshot(page, artifact_dir: Path, name: str):
    screenshot_path = artifact_dir / "screenshots" / f"{name}.png"
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        await page.screenshot(path=str(screenshot_path), full_page=True)
    except Exception:
        return None
    return screenshot_path


def route_confirmed_target_ids(route, detected_target_ids):
    route_target_ids = set(route.get("targetIds", []))
    return [target_id for target_id in detected_target_ids if target_id in route_target_ids]


def merge_route_seen_target_ids(route, seen_target_ids, detected_target_ids):
    route_target_ids = set(route.get("targetIds", []))
    return set(seen_target_ids) | {
        target_id for target_id in detected_target_ids if target_id in route_target_ids
    }


def _runtime_state_baseline(
    *,
    panel_state,
    route,
    current_url,
    remaining_routes_count,
    skipped_route_ids,
    confirmed_route_ids=None,
    skipped_route_reasons=None,
):
    now = iso_now()
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
        "confirmedRouteIds": sorted(confirmed_route_ids or set()),
        "skippedRouteIds": sorted(skipped_route_ids),
        "skippedRouteReasons": dict(skipped_route_reasons or {}),
        "lastUpdate": now,
        "heartbeatAt": now,
    }


def _runtime_state_done(
    panel_state,
    targets,
    skipped_route_ids=None,
    skipped_route_reasons=None,
    confirmed_route_ids=None,
):
    now = iso_now()
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
        "confirmedRouteIds": sorted(confirmed_route_ids or set()),
        "skippedRouteIds": sorted(skipped_route_ids or set()),
        "skippedRouteReasons": dict(skipped_route_reasons or {}),
        "lastUpdate": now,
        "heartbeatAt": now,
    }
