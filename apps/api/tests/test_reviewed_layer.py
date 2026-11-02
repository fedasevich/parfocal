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
            "decision": {"style": "agree"},
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
        "split": 0,
        "merged": 0,
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
        ("T1a", {"deleted": True}, 404, "unknown-object"),
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


LEFT = {"type": "Polygon", "coordinates": [[[0, 0], [50, 0], [50, 50], [0, 50], [0, 0]]]}
RIGHT = {"type": "Polygon", "coordinates": [[[50, 0], [100, 0], [100, 50], [50, 50], [50, 0]]]}
BOTH = {"type": "Polygon", "coordinates": [[[0, 0], [200, 0], [200, 50], [0, 50], [0, 0]]]}


def split(api: ApiAs, r: Review, object_id: str, *shapes: dict[str, Any]) -> Any:
    parts = [{"geometry": shape} for shape in shapes]
    return api(r.people["first"]).post(f"{r.base}/edits/{object_id}/split", json={"parts": parts})


def merge(api: ApiAs, r: Review, *objects: str) -> Any:
    body = {"objects": list(objects), "geometry": BOTH}
    return api(r.people["first"]).post(f"{r.base}/merges", json=body)


def current(api: ApiAs, r: Review, object_id: str) -> Any:
    return api(r.people["first"]).get(f"{r.base}/objects/{object_id}").json()["current"]


def test_a_split_makes_lettered_parts_and_keeps_the_object_in_the_history(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    before = ai_snapshot(database, r)
    edit(api, r, "first", "T1", {"class_id": str(r.tumor)})
    made = split(api, r, "T1", LEFT, RIGHT)
    assert made.status_code == 201, made.text
    assert [(p["object"], p["class_id"]) for p in made.json()] == [
        ("T1a", str(r.tumor)),
        ("T1b", str(r.tumor)),
    ]
    again = split(api, r, "T1b", LEFT, RIGHT)
    assert [p["object"] for p in again.json()] == ["T1ba", "T1bb"]
    assert current(api, r, "T1") == ["T1a", "T1ba", "T1bb"]
    refused = edit(api, r, "first", "T1", {"deleted": True})
    assert (refused.status_code, refused.json()["code"]) == (409, "retired-object")
    assert edit(api, r, "first", "T1a", {"deleted": True}).json()["geometry"] == LEFT
    layer = api(r.people["first"]).get(f"{r.base}/layer").json()
    assert [(e["object"], e["retired"]) for e in layer["edits"]] == [
        ("T1", "split"),
        ("T1a", None),
        ("T1b", "split"),
        ("T1ba", None),
        ("T1bb", None),
    ]
    assert (layer["summary"]["split"], layer["summary"]["deleted"]) == (2, 1)
    assert ai_snapshot(database, r) == before


def test_a_merge_keeps_the_lower_number_and_the_alias_still_resolves(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    kept = merge(api, r, "T2", "T1")
    assert kept.status_code == 201, kept.text
    assert (kept.json()["object"], kept.json()["geometry"]) == ("T1", BOTH)
    assert current(api, r, "T2") == ["T1"]
    refused = edit(api, r, "first", "T2", {"deleted": True})
    assert refused.json()["detail"] == "T2 was merged into T1"
    split(api, r, "T1", LEFT, RIGHT)
    assert current(api, r, "T2") == ["T1a", "T1b"]
    layer = api(r.people["first"]).get(f"{r.base}/layer").json()
    assert [(e["object"], e["merged_into"]) for e in layer["edits"]] == [
        ("T1", None),
        ("T1a", None),
        ("T1b", None),
        ("T2", "T1"),
    ]
    assert layer["summary"]["merged"] == 1
    exported = api(r.people["first"]).get(f"{r.base}/export").json()["features"]
    assert [(f["id"], f["properties"]["parfocal"]["aliases"]) for f in exported] == [
        ("T1a", []),
        ("T1b", []),
    ]
    actions = owner(
        database,
        f"SELECT action, details::jsonb->>'object' FROM audit_events WHERE target_id = '{r.task}' "
        "ORDER BY seq",
    )
    assert actions[1:] == [("review.object-merged", "T1"), ("review.object-split", "T1")]


def test_undoing_a_split_or_a_merge_brings_the_ai_objects_back(api: ApiAs, database: str) -> None:
    r = review(api, database)
    merge(api, r, "T1", "T2")
    split(api, r, "T1", LEFT, RIGHT)
    split(api, r, "T1a", LEFT, RIGHT)
    part = api(r.people["first"]).delete(f"{r.base}/edits/T1aa")
    assert (part.status_code, part.json()["code"]) == (409, "split-part")
    assert api(r.people["first"]).delete(f"{r.base}/edits/T1a").status_code == 204
    assert current(api, r, "T1") == ["T1a", "T1b"]
    assert api(r.people["first"]).delete(f"{r.base}/edits/T1").status_code == 204
    assert api(r.people["first"]).get(f"{r.base}/layer").json()["edits"] == []
    assert current(api, r, "T2") == ["T2"]


def test_a_merged_part_comes_back_when_its_keeper_is_undone(api: ApiAs, database: str) -> None:
    r = review(api, database)
    split(api, r, "T2", LEFT, RIGHT)
    merge(api, r, "T1", "T2b")
    assert current(api, r, "T2") == ["T2a", "T1"]
    exported = api(r.people["first"]).get(f"{r.base}/export").json()["features"]
    assert [(f["id"], f["properties"]["parfocal"]["aliases"]) for f in exported] == [
        ("T1", ["T2b"]),
        ("T2a", []),
    ]
    assert api(r.people["first"]).delete(f"{r.base}/edits/T1").status_code == 204
    assert current(api, r, "T2") == ["T2a", "T2b"]


@pytest.mark.parametrize(
    ("objects", "status", "code"),
    [
        (["T1", "C2"], 400, "not-a-region"),
        (["T1", "T1"], 400, "bad-request"),
        (["T1", "T9"], 404, "unknown-object"),
        (["T1", "T1a"], 404, "unknown-object"),
        (["T1"], 422, "validation"),
    ],
)
def test_bad_merges_are_refused(
    api: ApiAs, database: str, objects: list[str], status: int, code: str
) -> None:
    r = review(api, database)
    response = merge(api, r, *objects)
    assert (response.status_code, response.json()["code"]) == (status, code), response.text


def test_bad_splits_are_refused(api: ApiAs, database: str) -> None:
    r = review(api, database)
    cell = split(api, r, "C1", LEFT, RIGHT)
    assert (cell.status_code, cell.json()["code"]) == (400, "not-a-region")
    assert split(api, r, "T1", LEFT).status_code == 422
    edit(api, r, "first", "T2", {"deleted": True})
    deleted = split(api, r, "T2", LEFT, RIGHT)
    assert (deleted.status_code, deleted.json()["detail"]) == (409, "T2 is deleted")
    split(api, r, "T1", LEFT, RIGHT)
    twice = split(api, r, "T1", LEFT, RIGHT)
    assert (twice.status_code, twice.json()["detail"]) == (409, "T1 was split")
