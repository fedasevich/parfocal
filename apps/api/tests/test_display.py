import json
import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_review_tasks import study
from test_reviewed_layer import Review, review
from test_study_templates import task_draft, templates_of
from workspace_support import owner

pytestmark = pytest.mark.db

PRESETS = "/api/display-presets"
REASON = "Everyone sees the same this round"
LOCKED_CHANGE: dict[str, dict[str, Any]] = {
    "confidence": {"confidence": "hidden"},
    "heatmap": {"heatmap": 50},
    "score-cutoff": {"score_cutoff": 0.6},
    "other-sets": {"other_sets": {"reviewed_layer": False, "result_set_ids": []}},
    "order": {"order": "least-sure-first"},
}


def display_path(r: Review) -> str:
    return f"/api/review-tasks/{r.task}/my-display"


def lock(api: ApiAs, r: Review, locks: dict[str, Any], **defaults: Any) -> Any:
    return api(r.people["owner"]).patch(
        f"/api/review-tasks/{r.task}",
        json={"display": {"defaults": defaults, "locks": locks}},
    )


def choose(api: ApiAs, r: Review, who: str, settings: dict[str, Any], preset: Any = None) -> Any:
    return api(r.people[who]).put(display_path(r), json={"preset_id": preset, "settings": settings})


def save(api: ApiAs, r: Review, who: str, name: str, **body: Any) -> Any:
    settings = body.pop("settings", {})
    return api(r.people[who]).post(PRESETS, json={"name": name, "settings": settings, **body})


def decide(api: ApiAs, r: Review, who: str, object_id: str) -> Any:
    saved = api(r.people[who]).put(f"{r.base}/decisions/{object_id}", json={"answer": "agree"})
    assert saved.status_code == 200, saved.text
    return saved.json()


def refused(response: Any) -> tuple[int, str]:
    return response.status_code, response.json().get("code", "")


def actions(database: str, target: object) -> list[str]:
    return [
        str(row[0])
        for row in owner(
            database,
            f"SELECT action FROM audit_events WHERE target_id = '{target}' ORDER BY seq",
        )
    ]


def test_each_template_presets_its_own_display_defaults(api: ApiAs, database: str) -> None:
    s = study(database)
    templates = templates_of(api, s)
    researcher = api(s.people["owner"])
    shown: dict[str, Any] = {}
    for key in ("segmentation", "cell-typing", "reader-study"):
        created = researcher.post(
            s.tasks, json=task_draft(s, study_template_id=templates[key]["id"])
        )
        assert created.status_code == 201, created.text
        shown[key] = created.json()["display"]
        assert templates[key]["presets"]["display"] == shown[key]["defaults"]
    assert shown["segmentation"]["defaults"]["width"] == 1
    assert shown["segmentation"]["defaults"]["draw_as"] == "outline"
    assert (
        shown["cell-typing"]["defaults"]["draw_as"],
        shown["cell-typing"]["defaults"]["id_labels"],
    ) == ("dots", False)
    assert shown["reader-study"]["defaults"]["confidence"] == "hidden"
    assert {key: value["locks"] for key, value in shown.items()} == {key: {} for key in shown}
    plain = researcher.post(s.tasks, json=task_draft(s)).json()["display"]
    assert plain["defaults"] == {
        "draw_as": "outline",
        "width": 2,
        "opacity": 100,
        "colour_by": "class",
        "id_labels": True,
        "confidence": "number",
        "heatmap": 0,
        "score_cutoff": 0.4,
        "other_sets": {"reviewed_layer": True, "result_set_ids": []},
        "order": "ai",
        "zoom": "fit",
        "move_on": True,
        "buttons": "card",
    }
    changed = researcher.post(
        s.tasks,
        json=task_draft(
            s,
            study_template_id=templates["cell-typing"]["id"],
            display={"defaults": {"width": 3, "order": "random"}, "locks": {"order": REASON}},
        ),
    )
    assert changed.status_code == 201, changed.text
    assert changed.json()["display"]["defaults"]["width"] == 3
    assert changed.json()["display"]["locks"] == {"order": REASON}
    created = owner(
        database,
        f"SELECT details FROM audit_events WHERE target_id = '{changed.json()['id']}'",
    )
    assert json.loads(str(created[0][0]))["display_locks"] == ["order"]


@pytest.mark.parametrize("key", list(LOCKED_CHANGE))
def test_each_lockable_setting_locks_with_a_reason_and_refuses_without(
    api: ApiAs, database: str, key: str
) -> None:
    r = review(api, database)
    for reason in ("", "Why", "x" * 121, None):
        assert lock(api, r, {key: reason}).status_code == 422
    locked = lock(api, r, {key: f"  {REASON}  "})
    assert locked.status_code == 200, locked.text
    assert locked.json()["display"]["locks"] == {key: REASON}
    assert refused(choose(api, r, "first", LOCKED_CHANGE[key])) == (409, "display-setting-locked")
    assert choose(api, r, "first", {"width": 3}).status_code == 200
    unlocked = lock(api, r, {})
    assert unlocked.json()["display"]["locks"] == {}
    assert choose(api, r, "first", LOCKED_CHANGE[key]).status_code == 200
    audited = owner(
        database,
        f"SELECT details FROM audit_events WHERE target_id = '{r.task}' "
        "AND action = 'task.display-changed' ORDER BY seq",
    )
    details = [json.loads(str(row[0])) for row in audited]
    assert [(item["locked"], item["unlocked"]) for item in details] == [([key], []), ([], [key])]


def test_dry_settings_and_unknown_locks_are_refused(api: ApiAs, database: str) -> None:
    r = review(api, database)
    assert lock(api, r, {"width": REASON}).status_code == 422
    assert lock(api, r, {}, opacity=55).status_code == 422
    assert lock(api, r, {}, width=4).status_code == 422
    assert lock(api, r, {}, glow=True).status_code == 422
    foreign = {"reviewed_layer": True, "result_set_ids": [str(uuid.uuid4())]}
    assert refused(lock(api, r, {}, other_sets=foreign)) == (400, "unknown-result-set")
    mine = {"reviewed_layer": True, "result_set_ids": [str(r.result_set)]}
    assert lock(api, r, {}, other_sets=mine).status_code == 200
    assert api(r.people["first"]).patch(
        f"/api/review-tasks/{r.task}", json={"display": {}}
    ).status_code in {403, 404}


def test_a_reviewer_keeps_a_locked_value_and_changes_the_rest(api: ApiAs, database: str) -> None:
    r = review(api, database)
    assert (
        lock(api, r, {"confidence": REASON, "order": REASON}, confidence="word").status_code == 200
    )
    mine = api(r.people["first"]).get(display_path(r)).json()
    assert (mine["preset"], mine["preset_id"]) == ("Task default", None)
    assert mine["settings"]["confidence"] == "word"
    assert mine["task"]["locks"] == {"confidence": REASON, "order": REASON}
    assert refused(choose(api, r, "first", {"confidence": "number"})) == (
        409,
        "display-setting-locked",
    )
    kept = choose(api, r, "first", {"confidence": "word", "draw_as": "fill", "opacity": 60})
    assert kept.status_code == 200, kept.text
    assert kept.json()["settings"]["draw_as"] == "fill"
    task_preset = save(
        api, r, "first", "Mine here", task_id=str(r.task), settings={"order": "random"}
    )
    assert refused(task_preset) == (409, "display-setting-locked")
    everywhere = save(api, r, "first", "Everywhere", settings={"order": "random"})
    assert everywhere.status_code == 201, everywhere.text
    assert api(r.people["third"]).get(display_path(r)).status_code == 404
    assert api(r.people["viewer"]).get(display_path(r)).status_code in {403, 404}


def test_presets_save_rename_and_delete_with_unique_names(api: ApiAs, database: str) -> None:
    r = review(api, database)
    first = save(
        api, r, "first", "Fill by score", settings={"draw_as": "fill", "colour_by": "score"}
    )
    assert first.status_code == 201, first.text
    preset = first.json()
    assert (preset["name"], preset["task_id"]) == ("Fill by score", None)
    assert preset["settings"]["colour_by"] == "score"
    here = save(api, r, "first", "Dots here", task_id=str(r.task), settings={"draw_as": "dots"})
    assert here.status_code == 201, here.text
    for name in ("fill by score", " Fill by Score ", "Task default"):
        assert refused(save(api, r, "first", name)) == (409, "display-preset-name-taken")
    for name in ("", "   ", "x" * 41):
        assert save(api, r, "first", name).status_code == 422
    assert save(api, r, "first", "x" * 40).status_code == 201
    assert save(api, r, "second", "Fill by score").status_code == 201
    path = f"{PRESETS}/{preset['id']}"
    taken = api(r.people["first"]).patch(path, json={"name": "DOTS HERE"})
    assert refused(taken) == (409, "display-preset-name-taken")
    renamed = api(r.people["first"]).patch(path, json={"name": "Score fill"})
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "Score fill"
    resaved = api(r.people["first"]).patch(path, json={"settings": {"width": 1}})
    assert resaved.json()["settings"]["width"] == 1
    assert api(r.people["first"]).patch(path, json={}).status_code == 422
    listed = api(r.people["first"]).get(PRESETS).json()
    assert [item["name"] for item in listed] == ["Score fill", "Dots here", "x" * 40]
    on_task = api(r.people["first"]).get(display_path(r)).json()["presets"]
    assert [item["name"] for item in on_task] == ["Score fill", "Dots here", "x" * 40]
    stranger = api(r.people["second"])
    assert stranger.patch(path, json={"name": "Taken over"}).status_code == 404
    assert stranger.delete(path).status_code == 404
    assert "Score fill" not in stranger.get(PRESETS).text
    assert api(r.people["first"]).delete(path).status_code == 204
    assert api(r.people["first"]).delete(path).status_code == 404
    assert [item["name"] for item in api(r.people["first"]).get(PRESETS).json()] == [
        "Dots here",
        "x" * 40,
    ]
    assert actions(database, preset["id"]) == [
        "display-preset.saved",
        "display-preset.changed",
        "display-preset.changed",
        "display-preset.deleted",
    ]
    not_mine = save(api, r, "third", "Elsewhere", task_id=str(r.task))
    assert refused(not_mine) == (400, "not-your-task")


def test_every_decision_stores_the_preset_in_force(api: ApiAs, database: str) -> None:
    r = review(api, database)
    assert decide(api, r, "first", "T1")["preset"] is None
    preset = save(api, r, "first", "Dots", settings={"draw_as": "dots"}).json()
    chosen = choose(api, r, "first", {"draw_as": "dots"}, preset["id"])
    assert chosen.status_code == 200, chosen.text
    assert (chosen.json()["preset"], chosen.json()["preset_id"]) == ("Dots", preset["id"])
    assert decide(api, r, "first", "T2")["preset"] == "Dots"
    theirs = save(api, r, "second", "Theirs").json()
    assert choose(api, r, "first", {}, theirs["id"]).status_code == 404
    assert decide(api, r, "second", "T1")["preset"] is None
    listed = api(r.people["first"]).get(f"{r.base}/decisions").json()
    assert {item["object"]: item["preset"] for item in listed} == {"T1": None, "T2": "Dots"}
    api(r.people["first"]).delete(f"{PRESETS}/{preset['id']}")
    after = api(r.people["first"]).get(display_path(r)).json()
    assert (after["preset"], after["settings"]["draw_as"]) == ("Task default", "dots")
    assert api(r.people["first"]).get(f"{r.base}/decisions").json()[1]["preset"] == "Dots"


def test_the_evaluation_counts_who_used_which_preset(api: ApiAs, database: str) -> None:
    r = review(api, database)
    lock(api, r, {"heatmap": REASON}, heatmap=30)
    preset = save(api, r, "first", "Dots", settings={"draw_as": "dots", "heatmap": 30}).json()
    choose(api, r, "first", {"draw_as": "dots", "heatmap": 30}, preset["id"])
    decide(api, r, "first", "T1")
    decide(api, r, "first", "T2")
    decide(api, r, "second", "T1")
    evaluation = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/evaluation")
    assert evaluation.status_code == 200, evaluation.text
    body = evaluation.json()
    assert body["display"]["locks"] == {"heatmap": REASON}
    assert body["display"]["defaults"]["heatmap"] == 30
    used = {(item["user_id"], item["preset"]): item["objects"] for item in body["presets"]}
    assert used == {
        (str(r.people["first"].user_id), "Dots"): 2,
        (str(r.people["second"].user_id), None): 1,
    }


def test_another_workspace_sees_no_presets_or_display(api: ApiAs, database: str) -> None:
    r, other = review(api, database), review(api, database)
    preset = save(api, r, "first", "Private").json()
    outsider = api(other.people["first"])
    assert outsider.get(display_path(r)).status_code == 404
    assert outsider.patch(f"{PRESETS}/{preset['id']}", json={"name": "Mine"}).status_code == 404
    assert outsider.delete(f"{PRESETS}/{preset['id']}").status_code == 404
    assert outsider.get(PRESETS).json() == []
    assert refused(save(api, other, "first", "Theirs", task_id=str(r.task))) == (
        400,
        "not-your-task",
    )
    assert save(api, other, "first", "Private").status_code == 201
    rows = owner(
        database,
        f"SELECT tenant_id FROM display_presets WHERE id = '{preset['id']}'",
    )
    tenant = owner(database, f"SELECT tenant_id FROM projects WHERE id = '{r.project}'")
    assert rows == tenant
