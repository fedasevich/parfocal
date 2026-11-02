from typing import Any

import pytest
from db_support import ApiAs
from test_reviewed_layer import Review, review
from workspace_support import owner

from parfocal_api.principals import MemberPrincipal

pytestmark = pytest.mark.db


def create_sample(api: ApiAs, who: MemberPrincipal, status: int = 201) -> dict[str, Any]:
    response = api(who).post("/api/projects/sample")
    assert response.status_code == status, response.text
    return response.json()


def sample_task(api: ApiAs, who: MemberPrincipal, project: str) -> dict[str, Any]:
    response = api(who).get(f"/api/projects/{project}/review-tasks")
    assert response.status_code == 200, response.text
    (task,) = response.json()
    return task


def week(api: ApiAs, who: MemberPrincipal) -> tuple[int, int]:
    response = api(who).get("/api/me/home")
    assert response.status_code == 200, response.text
    found = response.json()["week"]
    return found["objects_checked"], found["agreed"]


def test_a_workspace_gets_one_sample_with_four_slides_two_sets_and_a_task(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    person = r.people["owner"]
    sample = create_sample(api, person)
    assert (sample["name"], sample["sample"], sample["my_role"]) == (
        "Sample · sentinel nodes",
        True,
        "owner",
    )
    project = sample["id"]
    labels = owner(
        database,
        f"SELECT label FROM slides WHERE project_id = '{project}' ORDER BY label",
    )
    assert [row[0] for row in labels] == ["normal_001", "tumor_001", "tumor_002", "tumor_003"]
    sets = api(person).get(f"/api/projects/{project}/result-sets").json()
    assert len(sets) == 8
    assert {(item["name"], item["status"], item["region_count"]) for item in sets} == {
        ("CAMELYON tumor model", "ready", 3),
        ("PathoSAM + HoVer-NeXt", "ready", 3),
    }
    task = sample_task(api, person, project)
    assignments = owner(
        database,
        f"SELECT user_id FROM review_assignments WHERE task_id = '{task['id']}'",
    )
    assert {row[0] for row in assignments} == {person.user_id}
    assert len(assignments) == 4
    again = create_sample(api, person, status=200)
    assert again["id"] == project
    assert api(r.people["first"]).post("/api/projects/sample").status_code == 403


def test_the_sample_deletes_and_only_the_sample_does(api: ApiAs, database: str) -> None:
    r = review(api, database)
    person = r.people["owner"]
    project = create_sample(api, person)["id"]
    real = api(person).delete(f"/api/projects/{r.project}")
    assert (real.status_code, real.json()["code"]) == (409, "not-a-sample")
    assert api(person).delete(f"/api/projects/{project}").status_code == 204
    assert api(person).get(f"/api/projects/{project}").status_code == 404
    listed = [item["id"] for item in api(person).get("/api/projects").json()]
    assert project not in listed
    home = api(person).get("/api/me/home").json()
    assert project not in [item["id"] for item in home["projects"]]
    live = owner(
        database,
        f"SELECT count(*) FROM slides WHERE project_id = '{project}' AND deleted_at IS NULL",
    )
    assert live[0][0] == 0
    fresh = create_sample(api, person)
    assert fresh["id"] != project


def test_the_sample_is_left_out_of_every_evaluation(api: ApiAs, database: str) -> None:
    r: Review = review(api, database)
    person = r.people["owner"]
    project = create_sample(api, person)["id"]
    task = sample_task(api, person, project)
    slide = owner(
        database,
        f"SELECT slide_id FROM review_task_slides WHERE task_id = '{task['id']}' "
        "ORDER BY position LIMIT 1",
    )[0][0]
    for object_id in ("T1", "T2"):
        given = api(person).put(
            f"/api/review-tasks/{task['id']}/slides/{slide}/verdicts/{object_id}",
            json={"answer": "5"},
        )
        assert given.status_code == 200, given.text
    assert week(api, person) == (0, 0)
    evaluation = api(person).get(f"/api/review-tasks/{task['id']}/evaluation")
    assert evaluation.status_code == 200, evaluation.text
    assert evaluation.json()["sample"] is True
    real = api(r.people["first"]).put(f"{r.base}/verdicts/T1", json={"value": "agree"})
    assert real.status_code == 200, real.text
    assert week(api, r.people["first"]) == (1, 1)
    assert api(person).get(f"/api/review-tasks/{r.task}/evaluation").json()["sample"] is False
