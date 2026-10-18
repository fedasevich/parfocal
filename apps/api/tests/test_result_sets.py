import asyncio
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from sqlalchemy import text
from test_annotations import make_class, make_slide
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal, ServicePrincipal
from parfocal_api.result_sets import (
    ChunkRow,
    RegionRow,
    ResultSetNotImportingError,
    add_chunks,
    add_regions,
    fail,
    finish,
)
from parfocal_api.tables import ResultObjectKind, Role
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction

pytestmark = pytest.mark.db

DRAFT = {
    "name": "HoVer-NeXt",
    "model_version": "1.2",
    "source_file": "S26-00001-A1.geojson",
    "produced_at": "2026-10-01T09:00:00Z",
    "classes": ["tumor", "Lymphocyte"],
}
SQUARE = "POLYGON((0 0,100 0,100 100,0 100,0 0))"


@dataclass(frozen=True)
class Lab:
    tenant_id: uuid.UUID
    people: dict[str, MemberPrincipal]
    project: uuid.UUID
    slide: uuid.UUID
    tumor: uuid.UUID

    @property
    def sets(self) -> str:
        return f"/api/slides/{self.slide}/result-sets"


def lab(database: str) -> Lab:
    workspace = make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "viewer": Role.RESEARCHER,
            "reviewer": Role.REVIEWER,
            "outsider": Role.RESEARCHER,
            "admin": Role.ADMIN,
        },
    )
    people = workspace.people
    project = make_project(database, workspace.tenant_id, "de-identified")
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["viewer"], "viewer")
    join_project(database, project, people["reviewer"], "reviewer")
    slide = make_slide(database, workspace.tenant_id, project)
    return Lab(
        workspace.tenant_id,
        people,
        project,
        slide,
        make_class(database, workspace.tenant_id, project),
    )


def in_tenant[T](database: str, tenant_id: uuid.UUID, work: Callable[[Any], Awaitable[T]]) -> T:
    async def go() -> T:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
                return await work(connection)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def imported(database: str, lb: Lab, set_id: uuid.UUID) -> None:
    async def work(connection: Any) -> None:
        await add_regions(
            connection,
            set_id,
            [
                RegionRow(ResultObjectKind.REGION, 1, SQUARE, 0, 230, [230, 20]),
                RegionRow(ResultObjectKind.REGION, 2, SQUARE, 1, 120),
                RegionRow(ResultObjectKind.ZONE, 1, SQUARE),
            ],
        )
        await add_chunks(
            connection,
            set_id,
            [
                ChunkRow(0, 0, 0, 2048, 2048, 900, 14_000, f"cells/{set_id}/chunk-00000.pfc"),
                ChunkRow(1, 2048, 0, 2048, 2048, 350, 5_100, f"cells/{set_id}/chunk-00001.pfc"),
            ],
        )
        await finish(connection, set_id)

    in_tenant(database, lb.tenant_id, work)


def test_an_owner_imports_a_set_that_lists_with_its_classes_and_counts(
    api: ApiAs, database: str
) -> None:
    lb = lab(database)
    client = api(lb.people["owner"])
    created = client.post(lb.sets, json=DRAFT)
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["status"], body["source"], body["cell_count"]) == ("importing", "import", 0)
    assert [(c["position"], c["source_name"], c["class_id"]) for c in body["classes"]] == [
        (0, "tumor", str(lb.tumor)),
        (1, "Lymphocyte", None),
    ]
    imported(database, lb, uuid.UUID(body["id"]))
    ready = client.get(f"/api/result-sets/{body['id']}").json()
    assert (ready["status"], ready["cell_count"], ready["region_count"], ready["zone_count"]) == (
        "ready",
        1250,
        2,
        1,
    )
    assert [c["object_count"] for c in ready["classes"]] == [1, 1]
    assert [s["id"] for s in client.get(lb.sets).json()] == [body["id"]]
    listed = client.get(f"/api/projects/{lb.project}/result-sets").json()
    assert [s["id"] for s in listed] == [body["id"]]


def test_a_finished_set_cannot_be_edited(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id = uuid.UUID(api(lb.people["owner"]).post(lb.sets, json=DRAFT).json()["id"])
    imported(database, lb, set_id)

    async def more(connection: Any) -> None:
        await add_regions(connection, set_id, [RegionRow(ResultObjectKind.REGION, 3, SQUARE)])

    with pytest.raises(ResultSetNotImportingError):
        in_tenant(database, lb.tenant_id, more)
    of_set = f"result_set_id = '{set_id}'"
    denied = "permission denied"
    refused = {
        f"UPDATE result_objects SET score = 1 WHERE {of_set}": denied,
        f"DELETE FROM result_objects WHERE {of_set}": denied,
        f"UPDATE result_chunks SET cell_count = 1 WHERE {of_set}": denied,
        f"DELETE FROM result_sets WHERE id = '{set_id}'": denied,
        f"UPDATE result_sets SET name = 'Edited' WHERE id = '{set_id}'": "only deleting",
        f"UPDATE result_sets SET status = 'importing' WHERE id = '{set_id}'": "only deleting",
        f"UPDATE result_set_classes SET source_name = 'x' WHERE {of_set}": "keeps",
        (
            "INSERT INTO result_objects (tenant_id, result_set_id, kind, number, geometry) "
            f"VALUES ('{lb.tenant_id}', '{set_id}', 'region', 9, ST_GeomFromText('{SQUARE}', 0))"
        ): "not importing",
    }
    for statement, message in refused.items():
        with pytest.raises(Exception, match=message):
            query_in(database, lb.tenant_id, statement)
    remapped = f"UPDATE result_set_classes SET class_id = NULL WHERE result_set_id = '{set_id}'"
    query_in(database, lb.tenant_id, remapped)
    response = api(lb.people["owner"]).patch(f"/api/result-sets/{set_id}", json={"name": "x"})
    assert response.status_code == 405


def query_in(database: str, tenant_id: uuid.UUID, statement: str) -> None:
    async def work(connection: Any) -> None:
        await connection.execute(text(statement))

    in_tenant(database, tenant_id, work)


def test_a_failed_import_keeps_its_code_and_stops(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id = uuid.UUID(api(lb.people["owner"]).post(lb.sets, json=DRAFT).json()["id"])

    async def failing(connection: Any) -> None:
        await fail(connection, set_id, "unreadable-file")

    in_tenant(database, lb.tenant_id, failing)
    body = api(lb.people["owner"]).get(f"/api/result-sets/{set_id}").json()
    assert (body["status"], body["error_code"]) == ("failed", "unreadable-file")

    async def finishing(connection: Any) -> None:
        await finish(connection, set_id)

    with pytest.raises(ResultSetNotImportingError):
        in_tenant(database, lb.tenant_id, finishing)


def test_deleting_hides_the_set_and_is_audited(api: ApiAs, database: str) -> None:
    lb = lab(database)
    client = api(lb.people["owner"])
    set_id = client.post(lb.sets, json=DRAFT).json()["id"]
    imported(database, lb, uuid.UUID(set_id))
    assert client.delete(f"/api/result-sets/{set_id}").status_code == 204
    assert client.get(lb.sets).json() == []
    assert client.get(f"/api/result-sets/{set_id}").status_code == 404
    actions = owner(
        database,
        f"SELECT action FROM audit_events WHERE target_id = '{set_id}' ORDER BY seq",
    )
    assert [row[0] for row in actions] == ["result-set.created", "result-set.deleted"]


def test_only_owners_and_upload_accounts_add_sets(api: ApiAs, database: str) -> None:
    lb = lab(database)
    set_id = api(lb.people["owner"]).post(lb.sets, json=DRAFT).json()["id"]
    viewer = api(lb.people["viewer"])
    assert viewer.get(lb.sets).status_code == 200
    assert viewer.get(f"/api/result-sets/{set_id}").status_code == 200
    refused = viewer.post(lb.sets, json=DRAFT)
    assert (refused.status_code, refused.json()["code"]) == (403, "uploading-not-allowed")
    assert viewer.delete(f"/api/result-sets/{set_id}").status_code == 403
    for label in ("reviewer", "outsider"):
        client = api(lb.people[label])
        assert client.get(lb.sets).status_code == 404
        assert client.get(f"/api/result-sets/{set_id}").status_code == 404
    assert api(lb.people["admin"]).post(lb.sets, json=DRAFT).status_code == 403
    service = ServicePrincipal(
        uuid.uuid4(), lb.tenant_id, frozenset({"upload-slides", "see-slides"})
    )
    made = api(service).post(lb.sets, json={**DRAFT, "name": "Pipeline"})
    assert made.status_code == 201, made.text
    assert made.json()["created_by_user_id"] is None


def test_class_names_must_be_distinct(api: ApiAs, database: str) -> None:
    lb = lab(database)
    response = api(lb.people["owner"]).post(lb.sets, json={**DRAFT, "classes": ["Tumor", "tumor"]})
    assert response.status_code == 422


def test_another_workspace_sees_no_sets(api: ApiAs, database: str) -> None:
    lb = lab(database)
    other = lab(database)
    set_id = api(lb.people["owner"]).post(lb.sets, json=DRAFT).json()["id"]
    stranger = api(other.people["owner"])
    assert stranger.get(f"/api/result-sets/{set_id}").status_code == 404
    assert stranger.get(lb.sets).status_code == 404
    assert stranger.get(f"/api/projects/{lb.project}/result-sets").status_code == 404
