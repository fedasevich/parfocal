import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_my_work import submit, task
from test_review_tasks import Study, study

pytestmark = pytest.mark.db


def neighbours(api: ApiAs, s: Study, who: str, slide: uuid.UUID, **params: Any) -> Any:
    return api(s.people[who]).get(f"/api/slides/{slide}/neighbours", params=params)


def around(response: Any) -> tuple[Any, ...]:
    assert response.status_code == 200, response.text
    body = response.json()
    return (
        body["previous"] and body["previous"]["label"],
        body["current"]["label"],
        body["next"] and body["next"]["label"],
        body["position"],
        body["total"],
        body["at_end"],
    )


def test_a_task_steps_through_my_slides_and_skips_submitted_ones(api: ApiAs, database: str) -> None:
    s = study(database)
    created = task(api, s, name="Round 1", reviewer_ids=[s.user("first")])
    in_task = {"from": "task", "task_id": created["id"]}
    assert around(neighbours(api, s, "first", s.slides[0], **in_task)) == (
        None,
        "loose-0",
        "loose-1",
        1,
        4,
        False,
    )
    submit(api, s, "first", created["id"], s.slides[1])
    assert around(neighbours(api, s, "first", s.slides[0], **in_task)) == (
        None,
        "loose-0",
        "A1",
        1,
        3,
        False,
    )
    every = {**in_task, "skip_submitted": "false"}
    assert around(neighbours(api, s, "first", s.slides[1], **every))[:3] == (
        "loose-0",
        "loose-1",
        "A1",
    )
    assert around(neighbours(api, s, "first", s.slides[3], **in_task)) == (
        "A1",
        "A2",
        None,
        3,
        3,
        True,
    )
    assert around(neighbours(api, s, "owner", s.slides[1], **in_task))[:3] == (
        "loose-0",
        "loose-1",
        "A1",
    )


def test_a_split_task_shows_a_reviewer_only_their_own_slides(api: ApiAs, database: str) -> None:
    s = study(database)
    created = task(
        api, s, name="Split", split="even", reviewer_ids=[s.user("first"), s.user("second")]
    )
    in_task = {"from": "task", "task_id": created["id"]}
    mine = [
        slide
        for slide in s.slides
        if neighbours(api, s, "first", slide, **in_task).status_code == 200
    ]
    assert len(mine) == 2
    missing = neighbours(api, s, "third", s.slides[0], **in_task)
    assert missing.status_code == 404


def test_all_slides_and_a_sent_list_give_neighbours_in_their_own_order(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    newest_first = {"from": "all-slides"}
    assert around(neighbours(api, s, "owner", s.slides[1], **newest_first))[:3] == (
        "A1",
        "loose-1",
        "loose-0",
    )
    filtered = {"from": "all-slides", "q": "loose"}
    assert around(neighbours(api, s, "owner", s.slides[1], **filtered)) == (
        None,
        "loose-1",
        "loose-0",
        1,
        2,
        False,
    )
    sent = {"from": "list", "ids": [str(s.slides[3]), str(s.slides[0]), str(uuid.uuid4())]}
    assert around(neighbours(api, s, "owner", s.slides[0], **sent)) == (
        "A2",
        "loose-0",
        None,
        2,
        2,
        True,
    )
    outside = neighbours(api, s, "owner", s.slides[2], **sent)
    assert (outside.status_code, outside.json()["code"]) == (404, "not-in-list")
    no_task = neighbours(api, s, "owner", s.slides[0], **{"from": "task"})
    assert (no_task.status_code, no_task.json()["code"]) == (400, "task-needed")
    no_ids = neighbours(api, s, "owner", s.slides[0], **{"from": "list"})
    assert (no_ids.status_code, no_ids.json()["code"]) == (400, "ids-needed")
    hidden = neighbours(api, s, "outsider", s.slides[0], **sent)
    assert (hidden.status_code, hidden.json()["code"]) == (404, "not-in-list")
