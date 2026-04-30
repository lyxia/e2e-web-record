"""Evidence writer for baseline coverage routes.

For each confirmed (or skipped/forced) baseline route, this module writes the
full artifact set under `<state-dir>/runs/baseline-<version>/routes/<route-id>/`:

- coverage.json
- interaction-context.json
- console.json / network.json / errors.json
- screenshots/   (copies of the screenshot files captured during the route)
- aria-snapshots/
- trace.zip

Action timeline events reference event ids; the full event payloads live in
`console.json`/`network.json`/`errors.json` so that recorded action windows
remain compact.
"""

import json
import os
import shutil
import tempfile
from pathlib import Path
from datetime import datetime, timezone


def _iso_now():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


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


def write_route_evidence(
    *,
    state_dir,
    baseline_version,
    route,
    confirmed_target_ids,
    remaining_target_ids,
    target_contexts,
    interaction_context,
    console_events,
    network_events,
    error_events,
    route_note=None,
    force_confirm_reason=None,
    skipped=False,
    skipped_reason=None,
    screenshot_files=None,
    aria_snapshot_files=None,
    trace_file=None,
):
    state_dir = Path(state_dir)
    route_id = route["routeId"]
    route_dir = state_dir / "runs" / f"baseline-{baseline_version}" / "routes" / route_id
    route_dir.mkdir(parents=True, exist_ok=True)

    coverage = {
        "schemaVersion": 1,
        "createdAt": _iso_now(),
        "routeId": route_id,
        "routePath": route.get("path", ""),
        "url": route.get("url"),
        "expectedTargetIds": list(route.get("targetIds", [])),
        "confirmedTargetIds": list(confirmed_target_ids),
        "remainingTargetIds": list(remaining_target_ids),
        "targetContexts": dict(target_contexts or {}),
        "operatorNote": route_note,
        "forceConfirmReason": force_confirm_reason,
        "skipped": bool(skipped),
        "skippedReason": skipped_reason,
        "trace": "trace.zip" if trace_file else None,
        "reviewStatus": _review_status(remaining_target_ids, force_confirm_reason, skipped),
    }
    atomic_write_json(route_dir / "coverage.json", coverage)
    atomic_write_json(
        route_dir / "interaction-context.json",
        _build_interaction_context(
            route=route,
            route_note=route_note,
            force_confirm_reason=force_confirm_reason,
            target_contexts=target_contexts,
            interaction_context=interaction_context,
            trace_file=trace_file,
        ),
    )
    atomic_write_json(route_dir / "console.json", list(console_events or []))
    atomic_write_json(route_dir / "network.json", list(network_events or []))
    atomic_write_json(route_dir / "errors.json", list(error_events or []))

    _copy_files(screenshot_files, route_dir / "screenshots")
    _copy_files(aria_snapshot_files, route_dir / "aria-snapshots")
    _copy_trace(trace_file, route_dir / "trace.zip")
    return route_dir


def _copy_files(files, target_dir):
    target_dir.mkdir(parents=True, exist_ok=True)
    for src in files or []:
        src_path = Path(src)
        if not src_path.exists():
            continue
        shutil.copy2(src_path, target_dir / src_path.name)


def _copy_trace(trace_file, target):
    if not trace_file:
        return
    src_path = Path(trace_file)
    if not src_path.exists():
        return
    shutil.copy2(src_path, target)


def _build_interaction_context(
    *,
    route,
    route_note,
    force_confirm_reason,
    target_contexts,
    interaction_context,
    trace_file,
):
    interaction = dict(interaction_context or {})
    return {
        "route": {
            "routeId": route["routeId"],
            "routePath": route.get("path", ""),
            "url": route.get("url"),
            "operatorNote": route_note,
            "forceConfirmReason": force_confirm_reason,
        },
        "actions": list(interaction.get("actions") or []),
        "targetContexts": dict(target_contexts or {}),
        "artifacts": {
            "coverage": "coverage.json",
            "console": "console.json",
            "network": "network.json",
            "errors": "errors.json",
            "trace": "trace.zip" if trace_file else None,
        },
    }


def _review_status(remaining_target_ids, force_confirm_reason, skipped):
    if skipped:
        return "skipped"
    if remaining_target_ids and force_confirm_reason:
        return "force-confirmed"
    if not remaining_target_ids:
        return "visual-ok"
    return "incomplete"
