import csv
import io
import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from submit_support import submitted as finished_submit
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = pytest.mark.db


@dataclass(frozen=True)
class Called:
    r: Review
    stroma: uuid.UUID

    @property
    def tumor(self) -> str:
        return str(self.r.tumor)


def behind_the_triggers(database: str, statements: str) -> None:
    owner(
        database,
        "DO $$ BEGIN PERFORM set_config('session_replication_role', 'replica', true); "
        f"{statements} END $$",
    )


def called(api: ApiAs, database: str) -> Called:
    r = review(api, database)
    tenant = owner(database, f"SELECT tenant_id FROM projects WHERE id = '{r.project}'")[0][0]
    stroma = owner(
        database,
        "INSERT INTO project_classes (tenant_id, project_id, key, name, colour) "
        f"VALUES ('{tenant}', '{r.project}', 2, 'Stroma', '#60a5fa') RETURNING id",
    )[0][0]
    behind_the_triggers(
        database,
        "INSERT INTO result_set_classes (tenant_id, project_id, result_set_id, position, "
        f"source_name, class_id) VALUES ('{tenant}', '{r.project}', '{r.result_set}', 0, "
        f"'tumour', '{r.tumor}'); "
        f"UPDATE result_objects SET class_index = 0 WHERE result_set_id = '{r.result_set}';",
    )
    return Called(r, uuid.UUID(str(stroma)))


def decide(api: ApiAs, c: Called, object_id: str, body: dict[str, Any], who: str = "first") -> Any:
    return api(c.r.people[who]).put(f"{c.r.base}/decisions/{object_id}", json=body)


def skip(api: ApiAs, c: Called, object_id: str, body: dict[str, Any] | None = None) -> Any:
    return api(c.r.people["first"]).put(f"{c.r.base}/skips/{object_id}", json=body or {})


def decisions(api: ApiAs, c: Called, who: str = "first", **params: str) -> dict[str, Any]:
    listed = api(c.r.people[who]).get(f"{c.r.base}/decisions", params=params).json()
    return {item["object"]: item for item in listed}


def calls(api: ApiAs, c: Called) -> dict[str, tuple[Any, Any]]:
    return {key: (item["ai_class_id"], item["ai_score"]) for key, item in decisions(api, c).items()}


def layer_classes(api: ApiAs, c: Called) -> dict[str, Any]:
    edits = api(c.r.people["first"]).get(f"{c.r.base}/layer").json()["edits"]
    return {edit["object"]: edit["class_id"] for edit in edits}


def class_rows(api: ApiAs, c: Called) -> dict[str, tuple[str, str]]:
    response = api(c.r.people["first"]).get(f"{c.r.base}/export", params={"format": "csv"})
    assert response.status_code == 200, response.text
    return {
        line["object_id"].rsplit("/", 1)[-1]: (line["model_class"], line["final_class"])
        for line in csv.DictReader(io.StringIO(response.text))
    }


def audited(database: str, c: Called) -> list[str]:
    rows = owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{c.r.task}' ORDER BY seq"
    )
    return [str(row[0]) for row in rows]


def test_keep_stores_the_reviewer_time_and_the_ai_call_of_the_set(
    api: ApiAs, database: str
) -> None:
    c = called(api, database)
    kept = decide(api, c, "T1", {"value": "agree", "ai_class_id": str(c.stroma), "ai_score": 3})
    assert kept.status_code == 200, kept.text
    body = kept.json()
    assert (body["value"], body["ai_class_id"], body["ai_score"]) == ("agree", c.tumor, 200)
    assert body["updated_at"]
    first = str(c.r.people["first"].user_id)
    as_owner = decisions(api, c, "owner", reviewer_id=first)
    assert (as_owner["T1"]["ai_class_id"], as_owner["T1"]["ai_score"]) == (c.tumor, 200)
    assert decisions(api, c, "second") == {}
    assert class_rows(api, c)["T1"] == ("Tumor", "Tumor")


def test_retype_moves_the_cell_to_the_reviewers_class_and_keeps_the_ai_call(
    api: ApiAs, database: str
) -> None:
    c = called(api, database)
    retyped = decide(
        api,
        c,
        "C2",
        {
            "value": "disagree",
            "reasons": ["wrong_class"],
            "reason_class_id": str(c.stroma),
            "ai_class_id": c.tumor,
            "ai_score": 140,
        },
    )
    assert retyped.status_code == 200, retyped.text
    assert (retyped.json()["ai_class_id"], retyped.json()["ai_score"]) == (c.tumor, 140)
    assert layer_classes(api, c) == {"C2": str(c.stroma)}


def test_not_a_cell_keeps_the_ai_call_and_refuses_a_class_the_set_never_used(
    api: ApiAs, database: str
) -> None:
    c = called(api, database)
    shown = {"value": "disagree", "reasons": ["not_a_cell"], "ai_class_id": c.tumor, "ai_score": 60}
    rejected = decide(api, c, "C1", shown)
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["reasons"] == ["not_a_cell"]
    assert calls(api, c) == {"C1": (c.tumor, 60)}
    foreign = decide(api, c, "C3", {**shown, "ai_class_id": str(c.stroma)})
    assert (foreign.status_code, foreign.json()["code"]) == (400, "not-a-set-class")
    loud = decide(api, c, "C3", {**shown, "ai_score": 256})
    assert (loud.status_code, loud.json()["code"]) == (422, "validation")
    blank = decide(api, c, "C4", {"value": "disagree", "reasons": ["not_a_cell"]})
    assert (blank.json()["ai_class_id"], blank.json()["ai_score"]) == (None, None)


def test_skip_is_stored_apart_from_decisions_and_gives_way_to_one(
    api: ApiAs, database: str
) -> None:
    c = called(api, database)
    skipped = skip(api, c, "C3", {"ai_class_id": c.tumor, "ai_score": 128})
    assert skipped.status_code == 200, skipped.text
    assert (skipped.json()["object"], skipped.json()["ai_score"]) == ("C3", 128)
    region = skip(api, c, "T2")
    assert (region.json()["ai_class_id"], region.json()["ai_score"]) == (c.tumor, 200)
    listed = api(c.r.people["first"]).get(f"{c.r.base}/skips").json()
    assert [item["object"] for item in listed] == ["C3", "T2"]
    assert decisions(api, c) == {}
    decide(api, c, "C3", {"value": "agree"})
    listed = api(c.r.people["first"]).get(f"{c.r.base}/skips").json()
    assert [item["object"] for item in listed] == ["T2"]
    decided = skip(api, c, "C3")
    assert (decided.status_code, decided.json()["code"]) == (409, "object-decided")
    assert api(c.r.people["first"]).delete(f"{c.r.base}/skips/T2").status_code == 204
    assert api(c.r.people["first"]).get(f"{c.r.base}/skips").json() == []
    assert skip(api, c, "C9").json()["code"] == "unknown-object"
    assert skip(api, c, "T1").status_code == 200
    assert api(c.r.people["viewer"]).put(f"{c.r.base}/skips/T1", json={}).status_code == 403
    assert audited(database, c)[1:] == [
        "review.object-skipped",
        "review.object-skipped",
        "review.object-decided",
        "review.skip-cleared",
        "review.object-skipped",
    ]


def test_skips_lock_at_sign_off(api: ApiAs, database: str) -> None:
    c = called(api, database)
    task = f"/api/review-tasks/{c.r.task}"
    for who in ("first", "second"):
        assert finished_submit(api(c.r.people[who]), f"{c.r.base}").status_code == 200
    assert api(c.r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    late = skip(api, c, "T1")
    assert (late.status_code, late.json()["code"]) == (409, "task-signed-off")


def test_reviewed_shapes_are_never_re_typed_by_a_model_afterwards(
    api: ApiAs, database: str
) -> None:
    c = called(api, database)
    decide(api, c, "T1", {"value": "agree"})
    wrong = {
        "value": "disagree",
        "reasons": ["wrong_class"],
        "reason_class_id": str(c.stroma),
        "ai_class_id": c.tumor,
        "ai_score": 90,
    }
    decide(api, c, "C2", wrong)
    tenant = owner(database, f"SELECT tenant_id FROM projects WHERE id = '{c.r.project}'")[0][0]
    behind_the_triggers(
        database,
        "INSERT INTO result_set_classes (tenant_id, project_id, result_set_id, position, "
        f"source_name, class_id) VALUES ('{tenant}', '{c.r.project}', '{c.r.result_set}', 1, "
        f"'stroma', '{c.stroma}'); UPDATE result_objects SET class_index = 1, score = 30 "
        f"WHERE result_set_id = '{c.r.result_set}';",
    )
    again = decide(api, c, "T1", {"value": "agree", "note": "Looked twice"})
    assert (again.json()["ai_class_id"], again.json()["ai_score"]) == (c.tumor, 200)
    decide(api, c, "C2", {**wrong, "ai_class_id": str(c.stroma), "ai_score": 10})
    decide(api, c, "T2", {"value": "agree"})
    assert calls(api, c) == {
        "C2": (c.tumor, 90),
        "T1": (c.tumor, 200),
        "T2": (str(c.stroma), 30),
    }
    assert layer_classes(api, c) == {"C2": str(c.stroma)}
    rows = class_rows(api, c)
    assert rows["T1"] == ("Tumor", "Tumor")
    assert rows["T2"] == ("Stroma", "Stroma")
    assert api(c.r.people["first"]).delete(f"{c.r.base}/decisions/T1").status_code == 204
    fresh = decide(api, c, "T1", {"value": "agree"})
    assert (fresh.json()["ai_class_id"], fresh.json()["ai_score"]) == (str(c.stroma), 30)


def test_a_reviewer_who_only_skipped_has_started(api: ApiAs, database: str) -> None:
    c = called(api, database)
    r = c.r
    assert skip(api, c, "C1", {"ai_class_id": c.tumor, "ai_score": 7}).status_code == 200
    slides = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/states").json()["slides"]
    by_user = {item["user_id"]: item["state"] for item in slides[0]["reviewers"]}
    assert by_user[str(r.people["first"].user_id)] == "in-review"
    task = f"/api/review-tasks/{r.task}"
    switched = api(r.people["owner"]).patch(task, json={"ai_hidden_first_read": True})
    assert (switched.status_code, switched.json()["code"]) == (409, "task-started")
    moved = api(r.people["owner"]).post(
        f"{task}/reassignments",
        json={
            "from_user_id": str(r.people["first"].user_id),
            "to_user_id": str(r.people["third"].user_id),
        },
    )
    assert (moved.status_code, moved.json()["code"]) == (409, "nothing-to-move")
    listed = api(r.people["first"]).get(f"{r.base}/skips").json()
    assert [item["object"] for item in listed] == ["C1"]


def test_the_ai_call_is_audited_with_each_decision_and_skip(api: ApiAs, database: str) -> None:
    c = called(api, database)
    skip(api, c, "C1", {"ai_class_id": c.tumor, "ai_score": 7})
    decide(api, c, "C2", {"value": "agree", "ai_class_id": c.tumor, "ai_score": 99})
    rows = owner(
        database,
        "SELECT details::jsonb ->> 'ai_class_id', (details::jsonb ->> 'ai_score')::int "
        f"FROM audit_events WHERE target_id = '{c.r.task}' AND action IN "
        "('review.object-skipped', 'review.object-decided') ORDER BY seq",
    )
    assert [tuple(row) for row in rows] == [(c.tumor, 7), (c.tumor, 99)]


def test_a_region_decided_before_its_class_was_mapped_keeps_that_call(
    api: ApiAs, database: str
) -> None:
    c = called(api, database)
    behind_the_triggers(
        database,
        f"UPDATE result_set_classes SET class_id = NULL WHERE result_set_id = '{c.r.result_set}';",
    )
    decide(api, c, "T1", {"value": "agree"})
    behind_the_triggers(
        database,
        f"UPDATE result_set_classes SET class_id = '{c.r.tumor}' "
        f"WHERE result_set_id = '{c.r.result_set}';",
    )
    again = decide(api, c, "T1", {"value": "agree"})
    assert (again.json()["ai_class_id"], again.json()["ai_score"]) == (None, 200)
    decide(api, c, "T2", {"value": "agree"})
    rows = class_rows(api, c)
    assert rows["T1"] == ("tumour", "tumour")
    assert rows["T2"] == ("Tumor", "Tumor")


def test_the_three_area_calls_are_stored_with_the_reviewer_and_time_and_audited(
    api: ApiAs, database: str
) -> None:
    c = called(api, database)
    first = str(c.r.people["first"].user_id)
    for value in ("agree", "disagree", "unsure"):
        response = decide(api, c, "T1", {"value": value})
        assert response.status_code == 200, response.text
        body = response.json()
        assert body["value"] == value
        assert body["updated_at"]
        assert decisions(api, c, "owner", reviewer_id=first)["T1"]["value"] == value
    assert audited(database, c).count("review.object-decided") == 3


def test_toggling_an_area_call_off_clears_it_and_is_audited(api: ApiAs, database: str) -> None:
    c = called(api, database)
    decide(api, c, "T1", {"value": "disagree"})
    cleared = api(c.r.people["first"]).delete(f"{c.r.base}/decisions/T1")
    assert cleared.status_code in (200, 204), cleared.text
    assert "T1" not in decisions(api, c)
    assert audited(database, c)[-1] == "review.object-decision-cleared"
