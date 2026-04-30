import pytest

from after_runtime_recorder import load_playbook, select_routes


def test_select_routes_filters_requested_route_ids():
    plan = {"routes": [{"routeId": "r1"}, {"routeId": "r2"}]}

    assert select_routes(plan, ["r2"]) == [{"routeId": "r2"}]


def test_select_routes_rejects_unknown_route_id():
    plan = {"routes": [{"routeId": "r1"}]}

    with pytest.raises(SystemExit, match="Unknown routeId"):
        select_routes(plan, ["missing"])


def test_load_playbook_defaults_to_empty_steps(tmp_path):
    assert load_playbook(tmp_path) == {"steps": []}


def test_load_playbook_reads_route_steps(tmp_path):
    playbook = tmp_path / "playbook.json"
    playbook.write_text('{"steps":[{"type":"click","texts":["Add"]}]}', encoding="utf-8")

    assert load_playbook(tmp_path)["steps"][0]["texts"] == ["Add"]


def test_load_playbook_requires_steps_array(tmp_path):
    playbook = tmp_path / "playbook.json"
    playbook.write_text('{"steps":{}}', encoding="utf-8")

    with pytest.raises(ValueError, match="steps array"):
        load_playbook(tmp_path)
