from panel_state import compute_panel_state


TARGETS = [
    {
        "targetId": "src/A.tsx#Widget#L4#C10",
        "importedName": "Widget",
        "file": "src/A.tsx",
        "line": 4,
    },
    {
        "targetId": "src/B.tsx#Modal#L8#C10",
        "importedName": "Modal",
        "file": "src/B.tsx",
        "line": 8,
    },
    {
        "targetId": "src/C.tsx#Tooltip#L12#C10",
        "importedName": "Tooltip",
        "file": "src/C.tsx",
        "line": 12,
    },
]

ROUTES = [
    {
        "routeId": "p1",
        "path": "/p1",
        "url": "http://app.test/p1",
        "targetIds": ["src/A.tsx#Widget#L4#C10", "src/B.tsx#Modal#L8#C10"],
        "targetCount": 2,
    },
    {
        "routeId": "p2",
        "path": "/p2",
        "url": "http://app.test/p2",
        "targetIds": ["src/C.tsx#Tooltip#L12#C10"],
        "targetCount": 1,
    },
]


def test_current_route_remaining_is_empty_when_current_route_target_detected():
    state = compute_panel_state(
        targets=TARGETS,
        selected_routes=ROUTES,
        current_route=ROUTES[1],
        detected_target_ids={"src/C.tsx#Tooltip#L12#C10"},
        confirmed_target_ids={"src/A.tsx#Widget#L4#C10", "src/B.tsx#Modal#L8#C10"},
    )

    assert state["totalRuntimeTargets"] == 3
    assert state["confirmedTotal"] == 2
    assert state["currentDetected"] == [
        {
            "id": "src/C.tsx#Tooltip#L12#C10",
            "importedName": "Tooltip",
            "file": "src/C.tsx",
            "line": 12,
        }
    ]
    assert state["currentRouteRemaining"] == []
    assert state["currentRoutePath"] == "/p2"
    assert state["routeChecklist"] == [
        {"path": "/p1", "confirmedCount": 2, "targetCount": 2},
        {"path": "/p2", "confirmedCount": 0, "targetCount": 1},
    ]


def test_current_route_remaining_excludes_detected_and_confirmed_targets():
    state = compute_panel_state(
        targets=TARGETS,
        selected_routes=ROUTES,
        current_route=ROUTES[0],
        detected_target_ids={"src/A.tsx#Widget#L4#C10"},
        confirmed_target_ids={"src/C.tsx#Tooltip#L12#C10"},
    )

    assert state["currentDetected"] == [
        {
            "id": "src/A.tsx#Widget#L4#C10",
            "importedName": "Widget",
            "file": "src/A.tsx",
            "line": 4,
        }
    ]
    assert state["currentRouteRemaining"] == [
        {
            "id": "src/B.tsx#Modal#L8#C10",
            "importedName": "Modal",
            "file": "src/B.tsx",
            "line": 8,
        }
    ]
