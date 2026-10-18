import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from test_annotations import make_class, make_slide
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}
POINT = {"type": "Point", "coordinates": [40, 40]}


@dataclass(frozen=True)
class Review:
    people: dict[str, MemberPrincipal]
    project: uuid.UUID
    slide: uuid.UUID
    result_set: uuid.UUID
    tumor: uuid.UUID
    task: uuid.UUID

    @property
    def base(self) -> str:
        return f"/api/review-tasks/{self.task}/slides/{self.slide}"


def review(api: ApiAs, database: str) -> Review:
    workspace = make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "first": Role.REVIEWER,
            "second": Role.REVIEWER,
            "third": Role.REVIEWER,
            "viewer": Role.RESEARCHER,
        },
    )
    people, tenant = workspace.people, workspace.tenant_id
    project = make_project(database, tenant, "de-identified")
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["viewer"], "viewer")
    for label in ("first", "second", "third"):
        join_project(database, project, people[label], "reviewer")
    slide = make_slide(database, tenant, project)
    tumor = make_class(database, tenant, project)
    result_set = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source) "
                f"VALUES ('{tenant}', '{project}', '{slide}', 'HoVer-NeXt', 'import') RETURNING id",
            )[0][0]
        )
    )
    for number in (1, 2):
        owner(
            database,
            "INSERT INTO result_objects (tenant_id, result_set_id, kind, number, geometry, score) "
            f"VALUES ('{tenant}', '{result_set}', 'region', {number}, "
            f"ST_GeomFromText('POLYGON((0 0,{number}00 0,{number}00 50,0 50,0 0))', 0), 200)",
        )
    owner(
        database,
        "UPDATE result_sets SET status = 'ready', region_count = 2, cell_count = 5 "
        f"WHERE id = '{result_set}'",
    )
    owner(
        database,
        "INSERT INTO slide_counters (tenant_id, slide_id, letter, last) "
        f"VALUES ('{tenant}', '{slide}', 'T', 2), ('{tenant}', '{slide}', 'C', 5)",
    )
    task = api(people["owner"]).post(
        f"/api/projects/{project}/review-tasks",
        json={
            "name": "Layer task",
            "slide_ids": [str(slide)],
            "result_sets": [{"slide_id": str(slide), "result_set_id": str(result_set)}],
            "reviewer_ids": [str(people["first"].user_id), str(people["second"].user_id)],
            "split": "everyone",
            "scope": {"kind": "all-regions"},
        },
    )
    assert task.status_code == 201, task.text
    return Review(people, project, slide, result_set, tumor, uuid.UUID(task.json()["id"]))


def ai_snapshot(database: str, r: Review) -> list[tuple[object, ...]]:
    objects = owner(
        database,
        "SELECT kind, number, ST_AsText(geometry), class_index, score FROM result_objects "
        f"WHERE result_set_id = '{r.result_set}' ORDER BY kind, number",
    )
    header = owner(
        database,
        "SELECT status, name, region_count, cell_count, updated_at FROM result_sets "
        f"WHERE id = '{r.result_set}'",
    )
    return objects + header


def edit(api: ApiAs, r: Review, who: str, object_id: str, body: dict[str, Any]) -> Any:
    return api(r.people[who]).put(f"{r.base}/edits/{object_id}", json=body)


def test_each_edit_lands_in_the_layer_and_the_ai_set_never_changes(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    before = ai_snapshot(database, r)
    retyped = edit(api, r, "first", "T1", {"class_id": str(r.tumor)})
    assert retyped.status_code == 200, retyped.text
    assert retyped.json()["object"] == "T1"
    assert edit(api, r, "first", "T2", {"geometry": SQUARE}).status_code == 200
    assert edit(api, r, "first", "C3", {"deleted": True}).status_code == 200
    both = edit(api, r, "first", "T2.C4", {"class_id": str(r.tumor), "geometry": POINT})
    assert (both.status_code, both.json()["object"]) == (200, "C4")
    added_region = api(r.people["first"]).post(
        f"{r.base}/added", json={"kind": "region", "geometry": SQUARE}
    )
    assert (added_region.status_code, added_region.json()["code"]) == (201, "T3+")
    added_cell = api(r.people["first"]).post(
        f"{r.base}/added", json={"kind": "cell", "geometry": POINT}
    )
    assert added_cell.json()["code"] == "C6+"
    layer = api(r.people["first"]).get(f"{r.base}/layer").json()
    assert [(e["object"], e["deleted"]) for e in layer["edits"]] == [
        ("C3", True),
        ("C4", False),
        ("T1", False),
        ("T2", False),
    ]
    assert layer["summary"] == {
        "regions": 2,
        "cells": 5,
        "retyped": 2,
        "reshaped": 2,
        "deleted": 1,
        "added": 2,
    }
    assert [a["code"] for a in layer["added"]] == ["C6+", "T3+"]
    assert ai_snapshot(database, r) == before


def test_undo_clears_an_edit_and_both_are_audited(api: ApiAs, database: str) -> None:
    r = review(api, database)
    edit(api, r, "first", "T1", {"deleted": True})
    assert api(r.people["first"]).delete(f"{r.base}/edits/T1").status_code == 204
    assert api(r.people["first"]).delete(f"{r.base}/edits/T1").status_code == 204
    assert api(r.people["first"]).get(f"{r.base}/layer").json()["edits"] == []
    actions = owner(
        database,
        f"SELECT action FROM audit_events WHERE target_id = '{r.task}' ORDER BY seq",
    )
    assert [row[0] for row in actions] == [
        "task.created",
        "review.object-edited",
        "review.object-restored",
    ]


def test_each_reviewer_has_their_own_layer(api: ApiAs, database: str) -> None:
    r = review(api, database)
    edit(api, r, "first", "T1", {"deleted": True})
    assert api(r.people["second"]).get(f"{r.base}/layer").json()["edits"] == []
    first_id = str(r.people["first"].user_id)
    peek = api(r.people["second"]).get(f"{r.base}/layer", params={"reviewer_id": first_id})
    assert (peek.status_code, peek.json()["code"]) == (403, "other-reviewer")
    as_owner = api(r.people["owner"]).get(f"{r.base}/layer", params={"reviewer_id": first_id})
    assert [e["object"] for e in as_owner.json()["edits"]] == ["T1"]


def test_only_the_assigned_reviewer_edits_the_layer(api: ApiAs, database: str) -> None:
    r = review(api, database)
    viewer = edit(api, r, "viewer", "T1", {"deleted": True})
    assert (viewer.status_code, viewer.json()["code"]) == (403, "not-assigned")
    assert edit(api, r, "owner", "T1", {"deleted": True}).json()["code"] == "not-assigned"
    assert edit(api, r, "third", "T1", {"deleted": True}).status_code == 404


@pytest.mark.parametrize(
    ("object_id", "body", "status", "code"),
    [
        ("R1", {"deleted": True}, 400, "not-an-ai-object"),
        ("T1+", {"deleted": True}, 400, "not-an-ai-object"),
        ("T1a", {"deleted": True}, 400, "not-an-ai-object"),
        ("nonsense", {"deleted": True}, 400, "not-an-ai-object"),
        ("T9", {"deleted": True}, 404, "unknown-object"),
        ("C6", {"deleted": True}, 404, "unknown-object"),
        (
            "C1",
            {"geometry": {"type": "LineString", "coordinates": [[0, 0], [5, 5]]}},
            400,
            "invalid-shape",
        ),
        ("T1", {"class_id": str(uuid.uuid4())}, 400, "unknown-class"),
        ("T1", {}, 422, "validation"),
    ],
)
def test_bad_edits_are_refused(
    api: ApiAs, database: str, object_id: str, body: dict[str, Any], status: int, code: str
) -> None:
    r = review(api, database)
    response = edit(api, r, "first", object_id, body)
    assert (response.status_code, response.json()["code"]) == (status, code), response.text


def test_added_objects_stay_in_the_layer_and_belong_to_their_author(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    added = (
        api(r.people["first"])
        .post(f"{r.base}/added", json={"kind": "region", "geometry": SQUARE})
        .json()
    )
    slide_list = api(r.people["owner"]).get(f"/api/slides/{r.slide}/annotations").json()
    assert slide_list == []
    one = f"/api/slides/{r.slide}/annotations/{added['id']}"
    refused = api(r.people["second"]).patch(one, json={"version": 1, "geometry": SQUARE})
    assert (refused.status_code, refused.json()["code"]) == (403, "annotating-not-allowed")
    assert (
        api(r.people["first"]).patch(one, json={"version": 1, "class_id": str(r.tumor)}).status_code
        == 200
    )
    assert api(r.people["owner"]).delete(one, params={"version": 2}).status_code == 204
    assert api(r.people["first"]).get(f"{r.base}/layer").json()["added"] == []
