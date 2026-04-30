from action_timeline import (
    assign_events_to_actions,
    create_target_context,
    redact_input_value,
)


def test_assigns_console_and_network_events_to_action_window():
    actions = [{"actionId": "a1", "startedAtMs": 1000, "endedAtMs": 1500}]
    console = [{"id": "c1", "atMs": 1200}, {"id": "c2", "atMs": 3000}]
    network = [{"id": "n1", "atMs": 1510}]
    assigned = assign_events_to_actions(actions, console, network, [], grace_ms=100)
    assert assigned[0]["consoleEventIds"] == ["c1"]
    assert assigned[0]["networkEventIds"] == ["n1"]


def test_assigns_error_events_to_nearest_action_window():
    actions = [
        {"actionId": "a1", "startedAtMs": 1000, "endedAtMs": 1500},
        {"actionId": "a2", "startedAtMs": 2000, "endedAtMs": 2400},
    ]
    errors = [{"id": "e1", "atMs": 2100}, {"id": "e2", "atMs": 5000}]
    assigned = assign_events_to_actions(actions, [], [], errors, grace_ms=200)
    assert assigned[0]["errorEventIds"] == []
    assert assigned[1]["errorEventIds"] == ["e1"]


def test_target_context_records_first_seen_action():
    context = create_target_context(
        target_id="src/A.tsx#ModalForm#L8#C1",
        action={"actionId": "a2", "endedAtMs": 2400, "urlAfter": "https://example.test/a"},
        screenshot="screenshots/a2.png",
        aria_snapshot="aria-snapshots/a2.yml",
    )
    assert context["firstSeenActionId"] == "a2"
    assert context["firstSeenUrl"] == "https://example.test/a"
    assert context["screenshot"] == "screenshots/a2.png"
    assert context["ariaSnapshot"] == "aria-snapshots/a2.yml"


def test_action_context_can_reference_target_artifacts_and_new_targets():
    actions = [
        {
            "actionId": "a2",
            "startedAtMs": 2000,
            "endedAtMs": 2400,
            "kind": "click",
            "selectorCandidates": ["role=button[name='选择课件']", "text=选择课件"],
            "targetSnapshot": {"tag": "BUTTON", "role": "button", "text": "选择课件"},
            "newTargetIdsAfter": ["src/A.tsx#ModalForm#L8#C1"],
            "detectedTargetIdsAfter": ["src/A.tsx#ModalForm#L8#C1"],
            "screenshot": "screenshots/a2.png",
            "ariaSnapshot": "aria-snapshots/a2.yml",
        }
    ]

    assigned = assign_events_to_actions(actions, [], [], [])

    assert assigned[0]["newTargetIdsAfter"] == ["src/A.tsx#ModalForm#L8#C1"]
    assert assigned[0]["selectorCandidates"][0] == "role=button[name='选择课件']"
    assert assigned[0]["targetSnapshot"]["text"] == "选择课件"
    assert assigned[0]["screenshot"] == "screenshots/a2.png"


def test_redact_input_value_keeps_kind_and_length_only():
    redacted = redact_input_value("password", "s3cret-token")
    assert "value" not in redacted
    assert redacted["valueKind"] == "password"
    assert redacted["valueLength"] == len("s3cret-token")
