def compute_panel_state(
    *,
    targets,
    selected_routes,
    current_route,
    detected_target_ids,
    confirmed_target_ids,
):
    target_by_id = {target["targetId"]: target for target in targets}
    detected_ids = set(detected_target_ids)
    confirmed_ids = set(confirmed_target_ids) & set(target_by_id)
    route_target_ids = list(current_route.get("targetIds", [])) if current_route else []

    current_detected_ids = [
        target_id
        for target_id in route_target_ids
        if target_id in detected_ids and target_id not in confirmed_ids
    ]
    current_remaining_ids = [
        target_id
        for target_id in route_target_ids
        if target_id not in detected_ids and target_id not in confirmed_ids
    ]

    return {
        "totalRuntimeTargets": len(targets),
        "confirmedTotal": len(confirmed_ids),
        "currentDetected": [_panel_target(target_by_id[target_id]) for target_id in current_detected_ids if target_id in target_by_id],
        "currentRouteRemaining": [
            _panel_target(target_by_id[target_id]) for target_id in current_remaining_ids if target_id in target_by_id
        ],
        "currentRoutePath": current_route.get("path", "") if current_route else "",
        "routeChecklist": [
            {
                "path": route.get("path", ""),
                "confirmedCount": sum(1 for target_id in route.get("targetIds", []) if target_id in confirmed_ids),
                "targetCount": route.get("targetCount", len(route.get("targetIds", []))),
            }
            for route in selected_routes
        ],
    }


def _panel_target(target):
    return {
        "id": target["targetId"],
        "importedName": target["importedName"],
        "file": target["file"],
        "line": target["line"],
    }
