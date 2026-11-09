import json
import uuid
from typing import Any

import pytest
from chunk_support import CellRow, chunk_bytes, put_chunk
from db_support import ApiAs
from test_reviewed_layer import Review, review
from workspace_support import owner

from parfocal_common.cell_chunks import UNCLASSIFIED
from parfocal_common.chunk_store import chunk_key
from parfocal_common.result_imports import result_set_prefix

pytestmark = pytest.mark.db

DEFAULT = ["disagree", "disagree", "unsure", "agree", "agree"]
CHUNKS: list[list[CellRow]] = [
    [(1, 0, 200, 10.0, 10.0), (2, 1, 180, 20.0, 10.0)],
    [(3, UNCLASSIFIED, 90, 2100.0, 10.0), (4, 0, 220, 2200.0, 10.0)],
]


def styled(api: ApiAs, r: Review, decision: dict[str, Any] | None) -> Any:
    body: dict[str, Any] = {
        "name": "Styled task",
        "slide_ids": [str(r.slide)],
        "result_sets": [{"slide_id": str(r.slide), "result_set_id": str(r.result_set)}],
        "reviewer_ids": [str(r.people["first"].user_id), str(r.people["second"].user_id)],
        "split": "everyone",
        "scope": {"kind": "all-regions"},
    }
    if decision is not None:
        body["decision"] = decision
    return api(r.people["owner"]).post(f"/api/projects/{r.project}/review-tasks", json=body)


def task_of(api: ApiAs, r: Review, decision: dict[str, Any] | None) -> str:
    created = styled(api, r, decision)
    assert created.status_code == 201, created.text
    return str(created.json()["id"])


def answer(
    api: ApiAs, r: Review, task: str, object_id: str, body: dict[str, Any], who: str = "first"
) -> Any:
    return api(r.people[who]).put(
        f"/api/review-tasks/{task}/slides/{r.slide}/verdicts/{object_id}", json=body
    )


def counted(api: ApiAs, r: Review, task: str, object_id: str, body: dict[str, Any]) -> Any:
    saved = answer(api, r, task, object_id, body)
    assert saved.status_code == 200, saved.text
    found = saved.json()
    return found["style"], found["answer"], found["value"]


def change(api: ApiAs, r: Review, task: str, decision: dict[str, Any]) -> Any:
    return api(r.people["owner"]).patch(f"/api/review-tasks/{task}", json={"decision": decision})


def refused(response: Any) -> tuple[int, str]:
    return response.status_code, response.json().get("code", "")


def ai_says_tumor(database: str, r: Review) -> uuid.UUID:
    tenant = owner(database, f"SELECT tenant_id FROM projects WHERE id = '{r.project}'")[0][0]
    owner(
        database,
        "DO $$ BEGIN PERFORM set_config('session_replication_role', 'replica', true); "
        "INSERT INTO result_set_classes (tenant_id, project_id, result_set_id, position, "
        f"source_name, class_id) VALUES ('{tenant}', '{r.project}', '{r.result_set}', 0, "
        f"'tumor', '{r.tumor}'); UPDATE result_objects SET class_index = 0 "
        f"WHERE result_set_id = '{r.result_set}' AND number = 1; END $$",
    )
    other = owner(
        database,
        "INSERT INTO project_classes (tenant_id, project_id, key, name, colour) "
        f"VALUES ('{tenant}', '{r.project}', 2, 'Stroma', '#60a5fa') RETURNING id",
    )
    return uuid.UUID(str(other[0][0]))


def test_certainty_is_the_default_and_counts_by_the_default_mapping(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    created = styled(api, r, None)
    assert created.json()["decision"] == {
        "style": "certainty",
        "counts_as": DEFAULT,
        "question": None,
    }
    task = str(created.json()["id"])
    answers = ["1", "2", "3", "4", "5", "unsure"]
    assert [counted(api, r, task, "T1", {"answer": key}) for key in answers] == [
        ("certainty", "1", "disagree"),
        ("certainty", "2", "disagree"),
        ("certainty", "3", "unsure"),
        ("certainty", "4", "agree"),
        ("certainty", "5", "agree"),
        ("certainty", "unsure", "unsure"),
    ]


def test_an_edited_mapping_counts_each_step_its_own_way(api: ApiAs, database: str) -> None:
    r = review(api, database)
    mapping = ["disagree", "unsure", "unsure", "unsure", "agree"]
    task = task_of(api, r, {"style": "certainty", "counts_as": mapping})
    assert [counted(api, r, task, "T1", {"answer": key})[2] for key in "12345"] == mapping


def test_agree_yes_no_and_blind_answers_count_as_their_style_says(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    stroma = ai_says_tumor(database, r)
    agree = task_of(api, r, {"style": "agree"})
    assert [counted(api, r, agree, "T1", {"answer": key})[2] for key in ("agree", "disagree")] == [
        "agree",
        "disagree",
    ]
    assert counted(api, r, agree, "T2", {"value": "unsure"}) == ("agree", "unsure", "unsure")
    yes_no = task_of(api, r, {"style": "yes-no", "question": "Is this tumor?"})
    assert [counted(api, r, yes_no, "T1", {"answer": key}) for key in ("yes", "no", "unsure")] == [
        ("yes-no", "yes", "agree"),
        ("yes-no", "no", "disagree"),
        ("yes-no", "unsure", "unsure"),
    ]
    blind = task_of(api, r, {"style": "blind"})
    picked = [
        counted(api, r, blind, "T1", {"answer": "class", "answer_class_id": str(class_id)})
        for class_id in (r.tumor, stroma)
    ]
    assert [value for _, _, value in picked] == ["agree", "disagree"]
    assert (
        counted(api, r, blind, "T2", {"answer": "class", "answer_class_id": str(r.tumor)})[2]
        == "disagree"
    )
    assert counted(api, r, blind, "T1", {"answer": "unsure"})[2] == "unsure"
    listed = api(r.people["first"]).get(f"/api/review-tasks/{blind}/slides/{r.slide}/verdicts")
    assert {item["object"]: item["answer_class_id"] for item in listed.json()} == {
        "T1": None,
        "T2": str(r.tumor),
    }


@pytest.mark.parametrize(
    ("style", "object_id", "body", "status", "code"),
    [
        ("certainty", "T1", {"answer": "agree"}, 400, "answer-not-in-style"),
        ("certainty", "T1", {"value": "agree"}, 400, "answer-not-in-style"),
        ("certainty", "T1", {"answer": "6"}, 400, "answer-not-in-style"),
        ("agree", "T1", {"answer": "4"}, 400, "answer-not-in-style"),
        ("yes-no", "T1", {"answer": "agree"}, 400, "answer-not-in-style"),
        ("blind", "T1", {"answer": "class"}, 400, "answer-not-in-style"),
        ("blind", "T1", {"answer": "yes"}, 400, "answer-not-in-style"),
        ("certainty", "T1", {"answer": "4", "answer_class_id": str(uuid.uuid4())}, 400, ""),
        ("certainty", "T1", {"answer": "4", "value": "agree"}, 422, "validation"),
        ("certainty", "T1", {"answer": "5", "reasons": ["need_ihc"]}, 400, ""),
        ("certainty", "T1", {"answer": "3", "reasons": ["need_second_look"]}, 200, ""),
    ],
)
def test_an_answer_outside_the_style_is_refused(
    api: ApiAs,
    database: str,
    style: str,
    object_id: str,
    body: dict[str, Any],
    status: int,
    code: str,
) -> None:
    r = review(api, database)
    task = task_of(api, r, {"style": style})
    response = answer(api, r, task, object_id, body)
    assert response.status_code == status, response.text
    if code:
        assert response.json()["code"] == code


def cells_in_chunks(database: str, r: Review) -> uuid.UUID:
    stroma = ai_says_tumor(database, r)
    tenant = owner(database, f"SELECT tenant_id FROM projects WHERE id = '{r.project}'")[0][0]
    owner(
        database,
        "DO $$ BEGIN PERFORM set_config('session_replication_role', 'replica', true); "
        "INSERT INTO result_set_classes (tenant_id, project_id, result_set_id, position, "
        f"source_name, class_id) VALUES ('{tenant}', '{r.project}', '{r.result_set}', 1, "
        f"'stroma', '{stroma}'); END $$",
    )
    prefix = result_set_prefix(uuid.UUID(str(tenant)), r.slide, r.result_set)
    for chunk, rows in enumerate(CHUNKS):
        key = chunk_key(prefix, chunk)
        owner(
            database,
            "DO $$ BEGIN PERFORM set_config('session_replication_role', 'replica', true); "
            "INSERT INTO result_chunks (tenant_id, result_set_id, chunk, x, y, width, height, "
            f"cell_count, vertex_count, object_key) VALUES ('{tenant}', '{r.result_set}', "
            f"{chunk}, {chunk * 2048}, 0, 2048, 2048, {len(rows)}, {4 * len(rows)}, '{key}'); "
            "END $$",
        )
        put_chunk(key, chunk_bytes(rows, None))
    return stroma


def picked(class_id: uuid.UUID) -> dict[str, str]:
    return {"answer": "class", "answer_class_id": str(class_id)}


def test_a_blind_answer_on_a_cell_counts_against_the_class_in_its_chunk(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    stroma = cells_in_chunks(database, r)
    task = task_of(api, r, {"style": "blind"})
    cases = [
        ("C1", r.tumor, "agree"),
        ("C1", stroma, "disagree"),
        ("C2", stroma, "agree"),
        ("C2", r.tumor, "disagree"),
        ("C4", r.tumor, "agree"),
        ("C3", r.tumor, "disagree"),
        ("C5", r.tumor, "disagree"),
    ]
    for object_id, class_id, value in cases:
        assert counted(api, r, task, object_id, picked(class_id)) == ("blind", "class", value)
    assert counted(api, r, task, "C1", {"answer": "unsure"})[2] == "unsure"


def test_a_queue_decision_on_a_cell_counts_against_its_chunk_class(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    stroma = cells_in_chunks(database, r)
    task = task_of(api, r, {"style": "blind"})
    for who, class_id in (("first", r.tumor), ("second", stroma)):
        assert answer(api, r, task, "C2", picked(class_id), who).status_code == 200
        submitted = api(r.people[who]).post(f"/api/review-tasks/{task}/slides/{r.slide}/submit")
        assert submitted.status_code == 200, submitted.text
    url = f"/api/review-tasks/{task}/disagreements/{r.slide}/C2"
    for class_id, value in ((stroma, "agree"), (r.tumor, "disagree")):
        decided = api(r.people["owner"]).put(url, json=picked(class_id))
        assert decided.status_code == 200, decided.text
        assert decided.json()["decision"]["value"] == value


@pytest.mark.parametrize(
    "mapping",
    [
        ["unsure", "unsure", "unsure", "agree", "agree"],
        ["disagree", "disagree", "unsure", "unsure", "unsure"],
        ["agree", "agree", "unsure", "disagree", "disagree"],
        ["disagree", "agree"],
    ],
)
def test_a_mapping_without_both_ends_is_refused(
    api: ApiAs, database: str, mapping: list[str]
) -> None:
    r = review(api, database)
    decision = {"style": "certainty", "counts_as": mapping}
    assert refused(styled(api, r, decision)) == (422, "validation")
    task = task_of(api, r, None)
    assert refused(change(api, r, task, decision)) == (422, "validation")


def test_a_mapping_change_recounts_every_answer_and_logs_who_and_when(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    task = task_of(api, r, None)
    counted(api, r, task, "T1", {"answer": "4"})
    counted(api, r, task, "T2", {"answer": "2", "reasons": ["boundary_off"]})
    counted(api, r, task, "C1", {"answer": "3", "reasons": ["need_second_look"]})
    wrong = {"answer": "2", "reasons": ["wrong_class"], "reason_class_id": str(r.tumor)}
    counted(api, r, task, "C2", wrong)
    mapping = ["disagree", "unsure", "agree", "agree", "agree"]
    changed = change(api, r, task, {"style": "certainty", "counts_as": mapping})
    assert changed.status_code == 200, changed.text
    assert changed.json()["decision"]["counts_as"] == mapping
    [entry] = changed.json()["counts_as_changes"]
    assert entry["changed_by_user_id"] == str(r.people["owner"].user_id)
    assert (entry["before"], entry["after"]) == (DEFAULT, mapping)
    assert (entry["recounted"], entry["reasons_dropped"]) == (3, 3)
    listed = api(r.people["first"]).get(f"/api/review-tasks/{task}/slides/{r.slide}/verdicts")
    assert [
        (item["object"], item["answer"], item["value"], item["reasons"]) for item in listed.json()
    ] == [
        ("C1", "3", "agree", []),
        ("C2", "2", "unsure", []),
        ("T1", "4", "agree", []),
        ("T2", "2", "unsure", []),
    ]
    assert listed.json()[1]["reason_class_id"] is None
    layer = api(r.people["first"]).get(f"/api/review-tasks/{task}/slides/{r.slide}/layer")
    assert [edit for edit in layer.json()["edits"] if edit["object"] == "C2"] == []
    audited = owner(
        database,
        "SELECT details FROM audit_events WHERE action = 'task.counts-as-changed' "
        f"AND target_id = '{task}'",
    )
    details = [json.loads(str(row[0])) for row in audited]
    assert [(item["before"], item["after"], item["recounted"]) for item in details] == [
        (DEFAULT, mapping, 3)
    ]


def test_a_mapping_change_before_any_answer_is_not_logged(api: ApiAs, database: str) -> None:
    r = review(api, database)
    task = task_of(api, r, None)
    mapping = ["disagree", "unsure", "unsure", "agree", "agree"]
    changed = change(api, r, task, {"counts_as": mapping})
    assert changed.json()["decision"]["counts_as"] == mapping
    assert changed.json()["counts_as_changes"] == []


def test_the_style_cannot_change_once_a_decision_exists(api: ApiAs, database: str) -> None:
    r = review(api, database)
    task = task_of(api, r, None)
    switched = change(api, r, task, {"style": "yes-no"})
    assert switched.json()["decision"]["style"] == "yes-no"
    counted(api, r, task, "T1", {"answer": "yes"})
    assert refused(change(api, r, task, {"style": "certainty"})) == (409, "decision-style-locked")
    assert change(api, r, task, {"style": "yes-no", "question": "Is it tumor?"}).status_code == 200


def test_the_mapping_holds_after_sign_off(api: ApiAs, database: str) -> None:
    r = review(api, database)
    task = task_of(api, r, None)
    counted(api, r, task, "T1", {"answer": "4"})
    owner(database, f"UPDATE review_tasks SET signed_off_at = now() WHERE id = '{task}'")
    mapping = ["disagree", "disagree", "disagree", "unsure", "agree"]
    assert refused(change(api, r, task, {"counts_as": mapping})) == (409, "counts-as-signed-off")
    assert change(api, r, task, {"counts_as": DEFAULT}).status_code == 200
