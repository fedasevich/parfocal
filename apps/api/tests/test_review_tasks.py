import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

MODEL = "HoVer-NeXt"
SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}


@dataclass(frozen=True)
class Study:
    tenant_id: uuid.UUID
    people: dict[str, MemberPrincipal]
    project: uuid.UUID
    case: uuid.UUID
    slides: list[uuid.UUID]
    sets: dict[uuid.UUID, uuid.UUID]
    other_set: uuid.UUID
    importing_set: uuid.UUID

    @property
    def tasks(self) -> str:
        return f"/api/projects/{self.project}/review-tasks"

    def user(self, label: str) -> str:
        return str(self.people[label].user_id)


def insert_id(database: str, statement: str) -> uuid.UUID:
    return uuid.UUID(str(owner(database, statement)[0][0]))


def add_set(
    database: str, tenant: uuid.UUID, project: uuid.UUID, slide: uuid.UUID, name: str, status: str
) -> uuid.UUID:
    return insert_id(
        database,
        "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source, status) "
        f"VALUES ('{tenant}', '{project}', '{slide}', '{name}', 'import', '{status}') RETURNING id",
    )


def study(database: str) -> Study:
    workspace = make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "first": Role.REVIEWER,
            "second": Role.REVIEWER,
            "third": Role.REVIEWER,
            "viewer": Role.RESEARCHER,
            "outsider": Role.RESEARCHER,
            "admin": Role.RESEARCHER,
        },
        admins={"admin"},
    )
    people, tenant = workspace.people, workspace.tenant_id
    project = make_project(database, tenant, "de-identified")
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["viewer"], "viewer")
    for label in ("first", "second", "third"):
        join_project(database, project, people[label], "reviewer")
    case = insert_id(
        database,
        "INSERT INTO cases (tenant_id, project_id, label, source) "
        f"VALUES ('{tenant}', '{project}', 'S26-{uuid.uuid4().hex[:6]}', 'manual') RETURNING id",
    )
    loose = [
        insert_id(
            database,
            "INSERT INTO slides (tenant_id, project_id, label) "
            f"VALUES ('{tenant}', '{project}', 'loose-{index}') RETURNING id",
        )
        for index in range(2)
    ]
    in_case = [
        insert_id(
            database,
            "INSERT INTO slides (tenant_id, project_id, case_id, label) "
            f"VALUES ('{tenant}', '{project}', '{case}', 'A{index}') RETURNING id",
        )
        for index in range(1, 3)
    ]
    all_slides = loose + in_case
    sets = {
        slide: add_set(database, tenant, project, slide, MODEL, "ready") for slide in all_slides
    }
    other = add_set(database, tenant, project, loose[0], "Other model", "ready")
    importing = add_set(database, tenant, project, loose[1], "Other model", "importing")
    return Study(tenant, people, project, case, all_slides, sets, other, importing)


def draft(s: Study, **changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": "Sentinel nodes round 1",
        "slide_ids": [str(s.slides[0]), str(s.slides[1])],
        "case_ids": [str(s.case)],
        "model_name": MODEL,
        "reviewer_ids": [s.user("first"), s.user("second"), s.user("third")],
        "split": "everyone",
        "scope": {"kind": "all-regions"},
        "due_on": "2026-11-30",
        "reminder_days": [1, 3],
    }
    return body | changes


def create(api: ApiAs, s: Study, **changes: Any) -> Any:
    return api(s.people["owner"]).post(s.tasks, json=draft(s, **changes))


def test_everyone_reviews_every_slide_of_the_named_slides_and_cases(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    response = create(api, s)
    assert response.status_code == 201, response.text
    task = response.json()
    assert (task["code"], task["split"], task["opinion_form_version"], task["blinded"]) == (
        "RT-1",
        "everyone",
        1,
        True,
    )
    assert (task["slide_count"], task["reviewer_count"], task["reminder_days"]) == (4, 3, [3, 1])
    assert [slide["slide_id"] for slide in task["slides"]] == [str(x) for x in s.slides]
    assert [slide["result_set_id"] for slide in task["slides"]] == [
        str(s.sets[x]) for x in s.slides
    ]
    reviewers = [s.user("first"), s.user("second"), s.user("third")]
    assert all(sorted(slide["reviewer_ids"]) == sorted(reviewers) for slide in task["slides"])
    audited = owner(database, f"SELECT action FROM audit_events WHERE target_id = '{task['id']}'")
    assert [row[0] for row in audited] == ["task.created"]


def test_an_even_split_deals_slides_in_turn(api: ApiAs, database: str) -> None:
    s = study(database)
    create(api, s)
    response = create(api, s, split="even")
    assert response.status_code == 201, response.text
    task = response.json()
    assert task["code"] == "RT-2"
    assert [slide["reviewer_ids"] for slide in task["slides"]] == [
        [s.user("first")],
        [s.user("second")],
        [s.user("third")],
        [s.user("first")],
    ]


def test_a_chosen_split_takes_pairs_and_needs_every_slide(api: ApiAs, database: str) -> None:
    s = study(database)
    pairs = [
        {"slide_id": str(slide), "user_id": s.user("second" if index % 2 else "first")}
        for index, slide in enumerate(s.slides)
    ]
    made = create(api, s, split="chosen", pairs=pairs)
    assert made.status_code == 201, made.text
    assert [len(slide["reviewer_ids"]) for slide in made.json()["slides"]] == [1, 1, 1, 1]
    short = create(api, s, split="chosen", pairs=pairs[:3])
    assert (short.status_code, short.json()["code"]) == (400, "bad-pairs")
    stranger = [*pairs, {"slide_id": str(s.slides[0]), "user_id": s.user("viewer")}]
    assert create(api, s, split="chosen", pairs=stranger).json()["code"] == "bad-pairs"
    assert create(api, s, split="everyone", pairs=pairs).status_code == 422


def test_result_sets_are_picked_per_slide_and_must_be_finished(api: ApiAs, database: str) -> None:
    s = study(database)
    chosen = [
        {"slide_id": str(s.slides[0]), "result_set_id": str(s.other_set)},
        {"slide_id": str(s.slides[1]), "result_set_id": str(s.sets[s.slides[1]])},
    ]
    made = create(api, s, case_ids=[], model_name=None, result_sets=chosen)
    assert made.status_code == 201, made.text
    assert [slide["result_set_id"] for slide in made.json()["slides"]] == [
        str(s.other_set),
        str(s.sets[s.slides[1]]),
    ]
    importing = [chosen[0], {"slide_id": str(s.slides[1]), "result_set_id": str(s.importing_set)}]
    refused = create(api, s, case_ids=[], model_name=None, result_sets=importing)
    assert (refused.status_code, refused.json()["code"]) == (400, "no-result-set")
    assert "loose-1" in refused.json()["detail"]
    missing = create(api, s, model_name="Other model")
    assert missing.json()["code"] == "no-result-set"
    both = create(api, s, result_sets=chosen)
    assert both.status_code == 422


def test_reviewers_slides_and_forms_must_belong_to_the_project(api: ApiAs, database: str) -> None:
    s = study(database)
    for label in ("viewer", "outsider"):
        response = create(api, s, reviewer_ids=[s.user(label)])
        assert (response.status_code, response.json()["code"]) == (400, "not-a-project-reviewer")
    other = study(database)
    assert create(api, s, slide_ids=[str(other.slides[0])]).json()["code"] == "unknown-slide"
    assert create(api, s, case_ids=[str(other.case)]).json()["code"] == "unknown-slide"
    assert create(api, s, slide_ids=[], case_ids=[]).status_code == 422
    unknown = create(api, s, opinion_form_version=9)
    assert unknown.json()["code"] == "unknown-opinion-form-version"


def test_scopes_carry_their_parameters_and_a_fixed_seed(api: ApiAs, database: str) -> None:
    s = study(database)
    assert create(api, s, scope={"kind": "random-cells"}).status_code == 422
    assert create(api, s, scope={"kind": "all-regions", "count": 5}).status_code == 422
    sampled = create(api, s, scope={"kind": "random-cells", "count": 50}).json()
    assert sampled["scope"] == {"kind": "random-cells", "count": 50, "score": None}
    seed = owner(database, f"SELECT scope_seed FROM review_tasks WHERE id = '{sampled['id']}'")
    assert seed[0][0] is not None
    client = api(s.people["owner"])
    renamed = client.patch(f"/api/review-tasks/{sampled['id']}", json={"name": "Round 1b"})
    assert renamed.status_code == 200, renamed.text
    resampled = client.patch(
        f"/api/review-tasks/{sampled['id']}", json={"scope": {"kind": "random-cells", "count": 80}}
    )
    assert resampled.json()["scope"]["count"] == 80
    after = owner(database, f"SELECT scope_seed FROM review_tasks WHERE id = '{sampled['id']}'")
    assert after == seed
    below = create(api, s, scope={"kind": "cells-below-score", "score": 0.5}).json()
    assert below["scope"] == {"kind": "cells-below-score", "count": None, "score": 0.502}


def test_owners_edit_and_everyone_else_is_refused(api: ApiAs, database: str) -> None:
    s = study(database)
    task = create(api, s).json()
    path = f"/api/review-tasks/{task['id']}"
    changed = api(s.people["owner"]).patch(
        path,
        json={
            "name": "Round 2",
            "start_mode": "viewer",
            "blinded": False,
            "due_on": None,
            "reminder_days": [],
        },
    )
    assert changed.status_code == 200, changed.text
    body = changed.json()
    assert (body["name"], body["start_mode"], body["blinded"], body["due_on"]) == (
        "Round 2",
        "viewer",
        False,
        None,
    )
    assert api(s.people["owner"]).patch(path, json={"name": None}).status_code == 400
    assert api(s.people["owner"]).patch(path, json={}).status_code == 422
    viewer = api(s.people["viewer"]).patch(path, json={"name": "x"})
    assert (viewer.status_code, viewer.json()["code"]) == (403, "project-owners-only")
    assert api(s.people["first"]).patch(path, json={"name": "x"}).status_code == 403
    assert api(s.people["first"]).post(s.tasks, json=draft(s)).status_code == 403
    actions = owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{task['id']}' ORDER BY seq"
    )
    assert [row[0] for row in actions] == ["task.created", "task.changed"]


def test_reviewers_see_only_their_tasks_and_slides(api: ApiAs, database: str) -> None:
    s = study(database)
    everyone = create(api, s, name="Everyone").json()
    even = create(
        api, s, name="Even", split="even", reviewer_ids=[s.user("first"), s.user("second")]
    ).json()
    assert [t["code"] for t in api(s.people["owner"]).get(s.tasks).json()] == ["RT-1", "RT-2"]
    assert [t["code"] for t in api(s.people["viewer"]).get(s.tasks).json()] == ["RT-1", "RT-2"]
    assert [t["code"] for t in api(s.people["first"]).get(s.tasks).json()] == ["RT-1", "RT-2"]
    assert [t["code"] for t in api(s.people["third"]).get(s.tasks).json()] == ["RT-1"]
    assert api(s.people["third"]).get(f"/api/review-tasks/{even['id']}").status_code == 404
    mine = api(s.people["first"]).get(f"/api/review-tasks/{even['id']}").json()
    assert [slide["slide_id"] for slide in mine["slides"]] == [str(s.slides[0]), str(s.slides[2])]
    assert api(s.people["outsider"]).get(s.tasks).status_code == 404
    assert api(s.people["outsider"]).get(f"/api/review-tasks/{everyone['id']}").status_code == 404


def test_an_assigned_reviewer_reads_and_draws_only_on_task_slides(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    assert api(s.people["third"]).get(f"/api/slides/{s.slides[2]}/annotations").status_code == 404
    assert api(s.people["third"]).get(f"/api/cases/{s.case}").status_code == 404
    pairs = [
        {"slide_id": str(slide), "user_id": s.user("third" if slide == s.slides[2] else "first")}
        for slide in s.slides
    ]
    assert create(api, s, split="chosen", pairs=pairs).status_code == 201
    mine, other = s.slides[2], s.slides[3]
    assert api(s.people["third"]).get(f"/api/slides/{mine}/annotations").status_code == 200
    drawn = api(s.people["third"]).post(
        f"/api/slides/{mine}/annotations", json={"kind": "roi", "geometry": SQUARE}
    )
    assert drawn.status_code == 201, drawn.text
    assert api(s.people["third"]).get(f"/api/slides/{other}/annotations").status_code == 404
    assert (
        api(s.people["third"])
        .post(f"/api/slides/{other}/annotations", json={"kind": "roi", "geometry": SQUARE})
        .status_code
        == 404
    )
    case = api(s.people["third"]).get(f"/api/cases/{s.case}")
    assert case.status_code == 200, case.text
    assert [slide["id"] for slide in case.json()["slides"]] == [str(mine)]
    assert [c["id"] for c in api(s.people["third"]).get("/api/cases").json()] == [str(s.case)]
    assert api(s.people["third"]).get(f"/api/result-sets/{s.sets[mine]}").status_code == 200
    assert api(s.people["third"]).get(f"/api/result-sets/{s.sets[other]}").status_code == 404
    listed = api(s.people["third"]).get(f"/api/projects/{s.project}/result-sets").json()
    assert [item["id"] for item in listed] == [str(s.sets[mine])]
    assert (
        api(s.people["third"])
        .post(f"/api/slides/{mine}/result-sets", json={"name": "x"})
        .status_code
        == 403
    )


def test_another_workspace_sees_no_tasks(api: ApiAs, database: str) -> None:
    s = study(database)
    task = create(api, s).json()
    other = study(database)
    stranger = api(other.people["owner"])
    assert stranger.get(s.tasks).status_code == 404
    assert stranger.get(f"/api/review-tasks/{task['id']}").status_code == 404
    assert stranger.patch(f"/api/review-tasks/{task['id']}", json={"name": "x"}).status_code == 404
