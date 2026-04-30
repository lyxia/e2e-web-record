import argparse
import asyncio
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from playwright.async_api import async_playwright


def now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def select_routes(plan, route_ids):
    wanted = set(route_ids or [])
    routes = [route for route in plan.get("routes", []) if not wanted or route.get("routeId") in wanted]
    missing = wanted - {route.get("routeId") for route in routes}
    if missing:
        raise SystemExit(f"Unknown routeId(s): {', '.join(sorted(missing))}")
    return routes


def load_playbook(route_dir: Path):
    path = route_dir / "playbook.json"
    if not path.exists():
        return {"steps": []}
    playbook = read_json(path)
    steps = playbook.get("steps")
    if not isinstance(steps, list):
        raise ValueError(f"{path} must contain a steps array")
    return playbook


async def run_playbook(page, playbook):
    for step in playbook.get("steps", []):
        step_type = step.get("type")
        if step_type == "wait":
            await page.wait_for_timeout(int(step.get("ms", 800)))
            continue
        if step_type == "click":
            await click_step(page, step)
            continue
        if step_type == "select":
            if not await click_selectors(page, step.get("selectors", []), int(step.get("timeout", 1200))):
                continue
            await click_texts(page, step.get("options", []), int(step.get("timeout", 1200)))
            continue
        if step_type == "clickFirstRowText":
            await click_first_row_text(page, step.get("texts", []), int(step.get("timeout", 1200)))
            continue
        if step_type == "clickTabs":
            await click_tabs(page, int(step.get("max", 5)), int(step.get("timeout", 1200)))
            continue
        raise ValueError(f"Unsupported playbook step type: {step_type}")


async def click_step(page, step):
    timeout = int(step.get("timeout", 1200))
    if await click_selectors(page, step.get("selectors", []), timeout):
        return True
    return await click_texts(page, step.get("texts", []), timeout)


async def click_selectors(page, selectors, timeout):
    for selector in selectors or []:
        try:
            await page.locator(selector).first.click(timeout=timeout)
            await page.wait_for_timeout(800)
            return True
        except Exception:
            continue
    return False


async def click_texts(page, texts, timeout):
    for text in texts or []:
        try:
            await page.get_by_text(text, exact=False).first.click(timeout=timeout)
            await page.wait_for_timeout(800)
            return True
        except Exception:
            continue
    return False


async def click_first_row_text(page, texts, timeout):
    row = page.locator(".ant-table-tbody tr").first
    for text in texts or []:
        try:
            await row.get_by_text(text, exact=False).first.click(timeout=timeout)
            await page.wait_for_timeout(800)
            return True
        except Exception:
            continue
    return False


async def click_tabs(page, max_tabs, timeout):
    count = min(max_tabs, await page.locator("[role=tab]").count())
    for index in range(count):
        try:
            await page.locator("[role=tab]").nth(index).click(timeout=timeout)
            await page.wait_for_timeout(1000)
        except Exception:
            continue


async def record_phase(context, route, phase, *, playbook, after_root: Path):
    route_id = route["routeId"]
    phase_dir = after_root / route_id / phase
    if phase_dir.exists():
        shutil.rmtree(phase_dir)
    (phase_dir / "screenshots").mkdir(parents=True, exist_ok=True)
    (phase_dir / "aria-snapshots").mkdir(parents=True, exist_ok=True)

    network = []
    console = []
    errors = []
    page = await context.new_page()
    page.on("console", lambda msg: console.append({"type": msg.type, "text": msg.text}))
    page.on("pageerror", lambda err: errors.append({"message": str(err)}))
    page.on("request", lambda req: network.append({"type": "request", "method": req.method, "url": req.url}))
    page.on("response", lambda res: network.append({"type": "response", "status": res.status, "url": res.url}))

    await context.tracing.start(screenshots=True, snapshots=True, sources=True)
    await page.goto(route["url"], wait_until="domcontentloaded", timeout=60000)
    await page.wait_for_timeout(5000)
    if phase == "final":
        await run_playbook(page, playbook)
        await page.wait_for_timeout(2500)

    marks = await page.evaluate("Array.from(window.__coverageMark__ || [])")
    body_text = await page.locator("body").inner_text(timeout=5000)
    await page.screenshot(path=str(phase_dir / "screenshots" / "final.png"), full_page=True)
    expected = route["expectedTargetIds"]
    missing = [target for target in expected if target not in marks]
    write_json(phase_dir / "coverage.json", {
        "schemaVersion": 1,
        "createdAt": now_iso(),
        "routeId": route_id,
        "routePath": route.get("routePath", ""),
        "url": route["url"],
        "expectedTargetIds": expected,
        "confirmedTargetIds": [target for target in expected if target in marks],
        "allMarkedTargetIds": marks,
        "missingTargetIds": missing,
    })
    write_json(phase_dir / "interaction-context.json", {
        "schemaVersion": 1,
        "createdAt": now_iso(),
        "routeId": route_id,
        "routePath": route.get("routePath", ""),
        "url": route["url"],
        "phase": phase,
        "bodyTextHead": body_text[:1200],
        "actions": playbook.get("steps", []) if phase == "final" else [{"type": "auto", "description": "load route"}],
    })
    write_json(phase_dir / "console.json", console)
    write_json(phase_dir / "network.json", network)
    write_json(phase_dir / "errors.json", errors)
    (phase_dir / "aria-snapshots" / "final.yml").write_text(body_text[:4000], encoding="utf-8")
    await context.tracing.stop(path=str(phase_dir / "trace.zip"))
    video_path = await page.video.path()
    await page.close()
    shutil.move(video_path, phase_dir / "video.webm")
    return missing


async def run_after_runtime_recorder(state_dir: Path, route_ids=None):
    manifest = read_json(state_dir / "manifest.json")
    plan = read_json(state_dir / "after-runtime-plan.json")
    after_root = state_dir / "runs" / "after" / "routes"
    video_dir = state_dir / "runs" / "after" / "_videos"
    video_dir.mkdir(parents=True, exist_ok=True)
    proxy = manifest.get("runtime", {}).get("proxy")
    profile_root = Path(manifest.get("runtime", {}).get("playwrightProfile") or state_dir / ".playwright-profile")

    async with async_playwright() as playwright:
        for route in select_routes(plan, route_ids):
            route_id = route["routeId"]
            route_dir = after_root / route_id
            playbook = load_playbook(route_dir)
            print(f"ROUTE {route_id}", flush=True)
            profile = Path(tempfile.mkdtemp(prefix=f"after-{route_id}-", dir=str(profile_root.parent)))
            if profile_root.exists():
                shutil.copytree(profile_root, profile, dirs_exist_ok=True)
            context = await playwright.chromium.launch_persistent_context(
                str(profile),
                headless=True,
                proxy={"server": proxy} if proxy else None,
                ignore_https_errors=True,
                viewport={"width": 1440, "height": 900},
                record_video_dir=str(video_dir),
                record_video_size={"width": 1440, "height": 900},
            )
            try:
                await record_phase(context, route, "initial", playbook={"steps": []}, after_root=after_root)
                missing = await record_phase(context, route, "final", playbook=playbook, after_root=after_root)
                result = {
                    "status": "passed" if not missing else "failed",
                    "expectedTargetIds": route["expectedTargetIds"],
                    "missingTargetIds": missing,
                }
                write_json(route_dir / "result.json", result)
                write_json(route_dir / "fixes.json", {"fixes": []})
                print(json.dumps({"routeId": route_id, **result}, ensure_ascii=False), flush=True)
            finally:
                await context.close()
                shutil.rmtree(profile, ignore_errors=True)
    shutil.rmtree(video_dir, ignore_errors=True)


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument("--state-dir", default=None)
    parser.add_argument("--route-id", action="append", default=[])
    args = parser.parse_args(argv)
    state_dir = Path(args.state_dir or os.environ.get("STATE_DIR", "coverage-state")).resolve()
    asyncio.run(run_after_runtime_recorder(state_dir, route_ids=args.route_id))


if __name__ == "__main__":
    main()
