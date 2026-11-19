import pytest
from db_support import ApiAs
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def below_the_cells(api: ApiAs, database: str) -> Review:
    r = review(api, database)
    owner(
        database,
        f"UPDATE slide_counters SET last = 1 WHERE slide_id = '{r.slide}' AND letter = 'C'",
    )
    return r


def test_a_cell_of_the_run_above_the_hand_drawn_counter_can_be_decided(
    api: ApiAs, database: str
) -> None:
    r = below_the_cells(api, database)
    reviewer = api(r.people["first"])
    decided = reviewer.put(f"{r.base}/decisions/C4", json={"value": "agree"})
    assert decided.status_code == 200, decided.text
    assert decided.json()["object"] == "C4"
    missing = reviewer.put(f"{r.base}/decisions/C9", json={"value": "agree"})
    assert missing.status_code == 404, missing.text
    assert missing.json()["detail"] == "C9 is not in this result set"


def test_a_cell_of_the_run_above_the_hand_drawn_counter_can_be_skipped(
    api: ApiAs, database: str
) -> None:
    r = below_the_cells(api, database)
    reviewer = api(r.people["first"])
    skipped = reviewer.put(f"{r.base}/skips/C5", json={})
    assert skipped.status_code == 200, skipped.text
    assert skipped.json()["object"] == "C5"
    missing = reviewer.put(f"{r.base}/skips/C6", json={})
    assert missing.status_code == 404, missing.text


def test_a_thread_can_open_on_a_cell_of_the_run_above_the_hand_drawn_counter(
    api: ApiAs, database: str
) -> None:
    r = below_the_cells(api, database)
    reviewer = api(r.people["first"])
    opened = reviewer.post(
        f"{r.base}/threads",
        json={
            "title": "Odd nucleus",
            "body": "Is this one a cell?",
            "anchor": {"kind": "object", "object_id": "C3"},
        },
    )
    assert opened.status_code == 201, opened.text
    assert opened.json()["anchor"]["object_id"] == "C3"
    missing = reviewer.post(
        f"{r.base}/threads",
        json={
            "title": "Ghost",
            "body": "Nothing here.",
            "anchor": {"kind": "object", "object_id": "C8"},
        },
    )
    assert missing.status_code == 400, missing.text
    assert missing.json()["code"] == "bad-anchor"
