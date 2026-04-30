"""Action timeline assignment and target context helpers.

Each action represents a discrete user interaction (click, input, navigation,
idle). Console/network/pageerror events are attributed to the action whose
window covers their timestamp (with a small grace period to account for async
side effects). Sensitive values are never persisted; only `valueKind` and
`valueLength` survive the redaction step.
"""

SENSITIVE_INPUT_KINDS = {"password", "tel", "email", "search"}


def assign_events_to_actions(actions, console_events, network_events, error_events, grace_ms=1000):
    """Distribute events into the action whose window contains them.

    Returns a list of action dicts cloned from `actions` with three new keys:
    `consoleEventIds`, `networkEventIds`, `errorEventIds`. Events that fall
    outside any action window are dropped (the original event log already
    keeps every event).
    """

    enriched = [dict(action, consoleEventIds=[], networkEventIds=[], errorEventIds=[]) for action in actions]

    def _attribute(events, key):
        for event in events:
            target = _find_action_for_event(enriched, event.get("atMs"), grace_ms)
            if target is None:
                continue
            target[key].append(event["id"])

    _attribute(console_events, "consoleEventIds")
    _attribute(network_events, "networkEventIds")
    _attribute(error_events, "errorEventIds")
    return enriched


def _find_action_for_event(actions, at_ms, grace_ms):
    if at_ms is None:
        return None
    for action in actions:
        start = action.get("startedAtMs")
        end = action.get("endedAtMs")
        if start is None or end is None:
            continue
        if start <= at_ms <= end + grace_ms:
            return action
    return None


def create_target_context(*, target_id, action, screenshot, aria_snapshot):
    """Build the per-target context recorded the first time a marker fires."""

    return {
        "targetId": target_id,
        "firstSeenActionId": action.get("actionId"),
        "firstSeenAtMs": action.get("endedAtMs"),
        "firstSeenUrl": action.get("urlAfter"),
        "screenshot": screenshot,
        "ariaSnapshot": aria_snapshot,
    }


def redact_input_value(input_kind, value):
    """Strip sensitive content from input events before serialising."""

    redacted = {"valueKind": input_kind, "valueLength": len(value or "")}
    if input_kind in SENSITIVE_INPUT_KINDS:
        return redacted
    if value is not None and len(value) <= 16:
        redacted["valuePreview"] = value
    return redacted
