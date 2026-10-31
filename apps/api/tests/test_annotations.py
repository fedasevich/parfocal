import math
import time
import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, query, with_database
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

BULK_BUDGET_SECONDS = 5.0


@dataclass(frozen=True)
class Studio:
    people: dict[str, MemberPrincipal]
    project: uuid.UUID
    slide: uuid.UUID
    class_id: uuid.UUID

    @property
    def path(self) -> str:
        return f"/api/slides/{self.slide}/annotations"


def make_slide(database: str, tenant_id: uuid.UUID, project_id: uuid.UUID) -> uuid.UUID:
    rows = owner(
        database,
        "INSERT INTO slides (tenant_id, project_id, label) "
        f"VALUES ('{tenant_id}', '{project_id}', 'Slide {uuid.uuid4().hex[:8]}') RETURNING id",
    )
    return uuid.UUID(str(rows[0][0]))


def make_class(database: str, tenant_id: uuid.UUID, project_id: uuid.UUID) -> uuid.UUID:
    rows = owner(
        database,
        "INSERT INTO project_classes (tenant_id, project_id, key, name, colour) "
        f"VALUES ('{tenant_id}', '{project_id}', 1, 'Tumor', '#f87171') RETURNING id",
    )
    return uuid.UUID(str(rows[0][0]))


def studio(database: str) -> Studio:
    workspace = make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "viewer": Role.RESEARCHER,
            "reviewer": Role.REVIEWER,
            "outsider": Role.RESEARCHER,
            "admin": Role.RESEARCHER,
        },
        admins={"admin"},
    )
    people = workspace.people
    project = make_project(database, workspace.tenant_id, "de-identified")
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["viewer"], "viewer")
    join_project(database, project, people["reviewer"], "reviewer")
    return Studio(
        people,
        project,
        make_slide(database, workspace.tenant_id, project),
        make_class(database, workspace.tenant_id, project),
    )


def square(x: float, y: float, side: float = 100) -> dict[str, Any]:
    ring = [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]
    return {"type": "Polygon", "coordinates": [ring]}


def circle(x: float, y: float, radius: float = 6, points: int = 16) -> dict[str, Any]:
    ring = [
        [
            x + radius * math.cos(2 * math.pi * k / points),
            y + radius * math.sin(2 * math.pi * k / points),
        ]
        for k in range(points)
    ]
    return {"type": "Polygon", "coordinates": [[*ring, ring[0]]]}


def test_an_owner_draws_edits_deletes_and_restores_with_history(api: ApiAs, database: str) -> None:
    s = studio(database)
    client = api(s.people["owner"])
    created = client.post(s.path, json={"kind": "roi", "geometry": square(10, 20)})
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["code"], body["version"], body["geometry"]) == ("R1", 1, square(10, 20))
    one = f"{s.path}/{body['id']}"
    moved = client.patch(one, json={"version": 1, "geometry": square(50, 60)})
    assert moved.status_code == 200, moved.text
    classed = client.patch(one, json={"version": 2, "class_id": str(s.class_id)})
    assert classed.json()["class_id"] == str(s.class_id)
    assert client.delete(one, params={"version": 3}).status_code == 204
    assert client.get(one).json()["deleted_at"] is not None
    assert client.get(s.path).json() == []
    restored = client.post(f"{one}/restore", json={"version": 4})
    assert restored.status_code == 200, restored.text
    assert (restored.json()["version"], restored.json()["deleted_at"]) == (5, None)
    history = client.get(f"{one}/history").json()
    assert [(h["version"], h["change"]) for h in history] == [
        (1, "created"),
        (2, "edited"),
        (3, "edited"),
        (4, "deleted"),
        (5, "restored"),
    ]
    assert history[0]["geometry"] == square(10, 20)
    assert history[1]["geometry"] == square(50, 60)
    assert [h["class_id"] for h in history] == [
        None,
        None,
        str(s.class_id),
        str(s.class_id),
        str(s.class_id),
    ]
    assert {h["changed_by_user_id"] for h in history} == {str(s.people["owner"].user_id)}


def test_a_stale_version_is_refused(api: ApiAs, database: str) -> None:
    s = studio(database)
    client = api(s.people["owner"])
    created = client.post(s.path, json={"kind": "roi", "geometry": square(0, 0)}).json()
    one = f"{s.path}/{created['id']}"
    assert client.patch(one, json={"version": 1, "geometry": square(5, 5)}).status_code == 200
    stale = client.patch(one, json={"version": 1, "geometry": square(9, 9)})
    assert (stale.status_code, stale.json()["code"]) == (409, "annotation-changed")
    assert client.delete(one, params={"version": 1}).status_code == 409
    assert client.post(f"{one}/restore", json={"version": 2}).status_code == 409


def test_numbers_are_per_kind_and_never_reused(api: ApiAs, database: str) -> None:
    s = studio(database)
    client = api(s.people["owner"])
    first = client.post(s.path, json={"kind": "roi", "geometry": square(0, 0)}).json()
    second = client.post(s.path, json={"kind": "roi", "geometry": square(200, 0)}).json()
    assert client.delete(f"{s.path}/{second['id']}", params={"version": 1}).status_code == 204
    line = {"type": "LineString", "coordinates": [[0, 0], [300, 400]]}
    made = client.post(
        f"{s.path}/bulk",
        json={
            "annotations": [
                {"kind": "roi", "geometry": square(400, 0)},
                {"kind": "measurement", "geometry": line},
                {"kind": "region", "geometry": square(600, 0)},
                {"kind": "cell", "geometry": {"type": "Point", "coordinates": [700, 50]}},
            ]
        },
    )
    assert made.status_code == 201, made.text
    assert (first["code"], second["code"]) == ("R1", "R2")
    assert [ref["code"] for ref in made.json()] == ["R3", "M1", "T1+", "C1+"]


@pytest.mark.parametrize(
    ("draft", "code"),
    [
        (
            {
                "kind": "roi",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]],
                },
            },
            "invalid-shape",
        ),
        (
            {
                "kind": "roi",
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 9]]],
                },
            },
            "validation",
        ),
        ({"kind": "roi", "geometry": {"type": "Point", "coordinates": [1, 2]}}, "validation"),
        ({"kind": "roi", "geometry": square(0, 0), "class_id": str(uuid.uuid4())}, "unknown-class"),
    ],
)
def test_bad_shapes_and_classes_are_refused(
    api: ApiAs, database: str, draft: dict[str, Any], code: str
) -> None:
    s = studio(database)
    response = api(s.people["owner"]).post(s.path, json=draft)
    status = 422 if code == "validation" else 400
    assert (response.status_code, response.json()["code"]) == (status, code), response.text


def test_a_bulk_error_names_the_shape(api: ApiAs, database: str) -> None:
    s = studio(database)
    bowtie = {"type": "Polygon", "coordinates": [[[0, 0], [10, 10], [10, 0], [0, 10], [0, 0]]]}
    drafts = [{"kind": "roi", "geometry": square(0, 0)}, {"kind": "roi", "geometry": bowtie}]
    response = api(s.people["owner"]).post(f"{s.path}/bulk", json={"annotations": drafts})
    assert response.status_code == 400
    assert response.json()["detail"].startswith("Shape 2 is not valid")
    assert api(s.people["owner"]).get(s.path).json() == []


def test_only_project_owners_draw_and_only_readers_see(api: ApiAs, database: str) -> None:
    s = studio(database)
    created = api(s.people["owner"]).post(s.path, json={"kind": "roi", "geometry": square(0, 0)})
    one = f"{s.path}/{created.json()['id']}"
    viewer = api(s.people["viewer"])
    assert viewer.get(s.path).status_code == 200
    assert viewer.get(f"{one}/history").status_code == 200
    refused = viewer.post(s.path, json={"kind": "roi", "geometry": square(0, 0)})
    assert (refused.status_code, refused.json()["code"]) == (403, "annotating-not-allowed")
    for label in ("reviewer", "outsider", "admin"):
        client = api(s.people[label])
        assert client.get(s.path).status_code == 404
        assert client.get(one).status_code == 404
        assert (
            client.post(s.path, json={"kind": "roi", "geometry": square(0, 0)}).status_code == 404
        )
    archived = api(s.people["owner"]).post(f"/api/projects/{s.project}/archive")
    assert archived.status_code == 200, archived.text
    late = api(s.people["owner"]).patch(one, json={"version": 1, "geometry": square(1, 1)})
    assert (late.status_code, late.json()["code"]) == (409, "project-archived")


def test_another_workspace_sees_nothing(api: ApiAs, database: str) -> None:
    s = studio(database)
    other = studio(database)
    created = api(s.people["owner"]).post(s.path, json={"kind": "roi", "geometry": square(0, 0)})
    one = f"{s.path}/{created.json()['id']}"
    stranger = api(other.people["owner"])
    assert stranger.get(s.path).status_code == 404
    assert stranger.get(one).status_code == 404
    assert (
        stranger.get(f"/api/slides/{other.slide}/annotations/{created.json()['id']}").status_code
        == 404
    )


def test_the_viewport_filter_returns_only_shapes_it_touches(api: ApiAs, database: str) -> None:
    s = studio(database)
    client = api(s.people["owner"])
    client.post(
        f"{s.path}/bulk",
        json={
            "annotations": [
                {"kind": "roi", "geometry": square(0, 0)},
                {"kind": "roi", "geometry": square(50_000, 50_000)},
            ]
        },
    )
    found = client.get(s.path, params=[("bbox", v) for v in (40_000, 40_000, 60_000, 60_000)])
    assert found.status_code == 200, found.text
    assert [a["code"] for a in found.json()] == ["R2"]
    assert [a["code"] for a in client.get(s.path, params={"kind": "measurement"}).json()] == []


def test_history_and_shapes_cannot_be_erased_by_the_app(api: ApiAs, database: str) -> None:
    s = studio(database)
    created = api(s.people["owner"]).post(s.path, json={"kind": "roi", "geometry": square(0, 0)})
    annotation_id = created.json()["id"]
    url = with_database(APP_URL, database)
    for statement in (
        f"UPDATE annotation_versions SET version = 9 WHERE annotation_id = '{annotation_id}'",
        f"DELETE FROM annotation_versions WHERE annotation_id = '{annotation_id}'",
        f"DELETE FROM annotations WHERE id = '{annotation_id}'",
    ):
        with pytest.raises(Exception, match="permission denied"):
            query(url, statement)


def test_ten_thousand_shapes_are_accepted_in_one_request_within_budget(
    api: ApiAs, database: str
) -> None:
    s = studio(database)
    drafts = [
        {
            "kind": "cell",
            "geometry": circle(20 * (k % 100), 20 * (k // 100)),
            "class_id": str(s.class_id),
        }
        for k in range(10_000)
    ]
    client = api(s.people["owner"])
    started = time.perf_counter()
    response = client.post(f"{s.path}/bulk", json={"annotations": drafts})
    elapsed = time.perf_counter() - started
    assert response.status_code == 201, response.text[:500]
    assert [ref["number"] for ref in response.json()] == list(range(1, 10_001))
    assert elapsed < BULK_BUDGET_SECONDS, elapsed
    assert len(client.get(s.path).json()) == 10_000
