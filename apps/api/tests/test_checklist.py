from typing import Any

import pytest
from db_support import ApiAs
from test_my_work import submit, task
from test_review_tasks import Study, study
from workspace_support import owner

pytestmark = pytest.mark.db


def checklist(api: ApiAs, s: Study, who: str) -> dict[str, Any]:
    response = api(s.people[who]).get("/api/me/checklist")
    assert response.status_code == 200, response.text
    return response.json()


def done(found: dict[str, Any]) -> dict[str, bool]:
    return {step["key"]: step["done"] for step in found["steps"]}


def test_a_new_member_starts_with_only_the_workspace_step_done(api: ApiAs, database: str) -> None:
    s = study(database)
    owner(database, f"UPDATE users SET email = NULL WHERE id = '{s.user('first')}'")

    found = checklist(api, s, "first")

    assert found["hidden"] is False
    assert found["sample_project"] is None
    assert done(found) == {
        "confirm-email": False,
        "join-workspace": True,
        "open-sample": False,
        "guided-review": False,
        "comment": False,
        "opinion": False,
    }
    assert found["steps"][1]["label"].startswith("Join ")


def test_reviewing_a_sample_slide_ticks_open_and_guided_review(api: ApiAs, database: str) -> None:
    s = study(database)
    owner(database, f"UPDATE projects SET sample = true WHERE id = '{s.project}'")
    round_one = task(
        api,
        s,
        name="Round 1",
        slide_ids=[str(s.slides[1])],
        case_ids=[],
        reviewer_ids=[s.user("first")],
    )
    submit(api, s, "first", round_one["id"], s.slides[1])

    found = checklist(api, s, "first")

    assert done(found)["open-sample"] is True
    assert done(found)["guided-review"] is True
    assert found["sample_project"]["code"] == "P01"
    assert found["sample_project"]["slides"] >= 1
    assert done(checklist(api, s, "second"))["guided-review"] is False
