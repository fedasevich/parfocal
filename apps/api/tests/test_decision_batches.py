import time
from typing import Any

import pytest
from db_support import ApiAs
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = pytest.mark.db

CELLS = 1000
SECONDS = 5.0


def batch(api: ApiAs, r: Review, objects: list[str]) -> Any:
    return api(r.people["first"]).post(
        f"{r.base}/decisions/batch",
        json={"decisions": [{"object": item, "value": "agree"} for item in objects]},
    )


def decided(database: str, r: Review) -> int:
    rows = owner(
        database,
        f"SELECT count(*) FROM review_decisions WHERE task_id = '{r.task}' AND value = 'agree'",
    )
    return int(str(rows[0][0]))


def audited(database: str, r: Review, action: str) -> int:
    rows = owner(
        database,
        f"SELECT count(*) FROM audit_events WHERE target_id = '{r.task}' AND action = '{action}'",
    )
    return int(str(rows[0][0]))


def test_a_thousand_cells_agree_in_one_call_and_undo_in_one(api: ApiAs, database: str) -> None:
    r = review(api, database, cell_count=CELLS)
    cells = [f"C{number}" for number in range(1, CELLS + 1)]
    started = time.monotonic()
    saved = batch(api, r, cells)
    took = time.monotonic() - started
    assert saved.status_code == 200, saved.text
    assert took < SECONDS
    assert len(saved.json()) == CELLS
    assert decided(database, r) == CELLS
    assert audited(database, r, "review.object-decided") == CELLS
    again = batch(api, r, cells)
    assert (again.status_code, again.json()) == (200, [])
    assert decided(database, r) == CELLS
    cleared = api(r.people["first"]).post(
        f"{r.base}/decisions/batch-clear", json={"objects": cells}
    )
    assert cleared.status_code == 204, cleared.text
    assert decided(database, r) == 0
    assert audited(database, r, "review.object-decision-cleared") == CELLS


def test_the_batch_keeps_what_is_decided_and_fills_the_rest(api: ApiAs, database: str) -> None:
    r = review(api, database)
    single = api(r.people["first"]).put(
        f"{r.base}/decisions/C2", json={"value": "disagree", "reasons": ["not_a_cell"]}
    )
    assert single.status_code == 200, single.text
    saved = batch(api, r, ["C1", "C2", "C3", "T1"])
    assert [item["object"] for item in saved.json()] == ["C1", "C3", "T1"]
    mine = api(r.people["first"]).get(f"{r.base}/decisions").json()
    assert {item["object"]: item["value"] for item in mine} == {
        "C1": "agree",
        "C2": "disagree",
        "C3": "agree",
        "T1": "agree",
    }


def test_one_unknown_object_saves_nothing(api: ApiAs, database: str) -> None:
    r = review(api, database)
    refused = batch(api, r, ["C1", "C2", "C99"])
    assert refused.status_code == 404, refused.text
    assert refused.json()["code"] == "unknown-object"
    assert decided(database, r) == 0


def test_only_an_assigned_reviewer_saves_a_batch(api: ApiAs, database: str) -> None:
    r = review(api, database)
    refused = api(r.people["third"]).post(
        f"{r.base}/decisions/batch", json={"decisions": [{"object": "C1", "value": "agree"}]}
    )
    assert refused.status_code in {403, 404}, refused.text
    assert decided(database, r) == 0
