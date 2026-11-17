import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from db_support import OWNER_URL, TEST_MASTER_KEYS, ApiAs, api_settings, query, with_database
from fastapi.testclient import TestClient
from fixture_support import fixture_path
from storage_support import TEST_STORAGE, put, with_store
from upload_support import run_worker, status_of
from workspace_support import join_project, make_project, make_workspace

from parfocal_api.app import create_app
from parfocal_api.principals import MemberPrincipal
from parfocal_api.source_watches import scan_every_workspace
from parfocal_api.tables import Role
from parfocal_common.db import create_engine
from parfocal_common.envelope import MasterKeyring
from parfocal_common.object_store import ObjectStore, presign

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SOURCES = "/api/tenant/import-sources"
SLIDE = "CMU-1-Small-Region.svs"
BROKEN = "broken-scan.svs"
EARLIER = "already-there.svs"
STORAGE_ORIGIN = TEST_STORAGE.endpoint.split("://", 1)[1]


@dataclass(frozen=True)
class Team:
    tenant_id: uuid.UUID
    admin: MemberPrincipal
    lead: MemberPrincipal
    project: uuid.UUID


@pytest.fixture
def linked(database: str) -> Iterator[ApiAs]:
    settings = api_settings(database).model_copy(update={"link_trusted_origins": [STORAGE_ORIGIN]})
    app = create_app(settings)
    with TestClient(app) as client:
        yield ApiAs(app, client)


@pytest.fixture
def team(database: str) -> Team:
    workspace = make_workspace(
        database, {"admin": Role.RESEARCHER, "lead": Role.RESEARCHER}, admins=("admin",)
    )
    project = make_project(database, workspace.tenant_id)
    for name in ("admin", "lead"):
        join_project(database, project, workspace.people[name], "owner")
    return Team(workspace.tenant_id, workspace.people["admin"], workspace.people["lead"], project)


def drop(key: str, body: bytes) -> None:
    put(presign(TEST_STORAGE, "PUT", key, {}, 60, datetime.now(UTC)), body).raise_for_status()


def bucket_source(api: ApiAs, team: Team, prefix: str) -> dict[str, Any]:
    draft = {
        "name": "Scanner bucket",
        "kind": "storage",
        "address": f"{TEST_STORAGE.endpoint}/{TEST_STORAGE.bucket}/{prefix}",
        "region": TEST_STORAGE.region,
        "key_id": TEST_STORAGE.access_key_id,
        "secret": TEST_STORAGE.secret_access_key,
    }
    response = api(team.admin).post(SOURCES, json=draft)
    assert response.status_code == 201, response.text
    return response.json()


def scan(api: ApiAs, database: str) -> int:
    settings = api.app.settings
    keyring = MasterKeyring.from_setting(TEST_MASTER_KEYS)

    async def work(store: ObjectStore) -> int:
        engine = create_engine(with_database(OWNER_URL, database))
        try:
            return await scan_every_workspace(engine, keyring, settings, store)
        finally:
            await engine.dispose()

    return with_store(work)


def arrivals(database: str, team: Team) -> dict[str, tuple[Any, ...]]:
    rows = query(
        with_database(OWNER_URL, database),
        "SELECT file_name, id, created_by_user_id FROM uploads"
        f" WHERE project_id = '{team.project}'",
    )
    return {str(row[0]): (row[1], row[2]) for row in rows}


def checked(api: ApiAs, team: Team, upload_id: object) -> str:
    return str(status_of(api, team.admin, {"uploadId": str(upload_id)})["status"])


def imports(api: ApiAs, team: Team) -> dict[str, Any]:
    response = api(team.lead).get(f"/api/projects/{team.project}/imports")
    assert response.status_code == 200, response.text
    return response.json()["watched_folder"]


def test_files_dropped_in_a_watched_bucket_arrive_checked_like_an_upload(
    linked: ApiAs, database: str, team: Team, tmp_path: Path
) -> None:
    prefix = f"watched-{uuid.uuid4().hex[:8]}/"
    drop(f"{prefix}{EARLIER}", b"an older scan that stays at the source")
    source = bucket_source(linked, team, prefix)
    assert imports(linked, team)["on"] is False

    path = f"/api/projects/{team.project}/watch"
    assert linked(team.lead).put(path, json={"source_id": source["id"]}).status_code == 403
    watched = linked(team.admin).put(path, json={"source_id": source["id"]})
    assert watched.status_code == 200, watched.text
    assert (watched.json()["files_seen"], watched.json()["every_minutes"]) == (1, 60)
    assert "secret" not in watched.text
    shown = imports(linked, team)
    assert (shown["on"], shown["every"], shown["address"]) == (
        True,
        "1 hour",
        f"Scanner bucket, {STORAGE_ORIGIN}",
    )

    assert scan(linked, database) == 0
    drop(f"{prefix}{SLIDE}", fixture_path(SLIDE).read_bytes())
    drop(f"{prefix}{BROKEN}", b"these bytes are not a slide")
    assert scan(linked, database) == 2
    run_worker(database, team.tenant_id, tmp_path / "work", (STORAGE_ORIGIN,))
    arrived = arrivals(database, team)
    assert set(arrived) == {SLIDE, BROKEN}
    assert {uploader for _, uploader in arrived.values()} == {team.admin.user_id}
    assert checked(linked, team, arrived[SLIDE][0]) == "ready"
    assert checked(linked, team, arrived[BROKEN][0]) == "failed"
    [published] = query(
        with_database(OWNER_URL, database),
        f"SELECT published_at IS NOT NULL FROM slides WHERE project_id = '{team.project}'",
    )
    assert published == (True,)

    assert scan(linked, database) == 0
    assert set(arrivals(database, team)) == {SLIDE, BROKEN}

    assert linked(team.admin).delete(path).status_code == 204
    assert imports(linked, team)["on"] is False
    drop(f"{prefix}late.svs", b"arrives after the watch stopped")
    assert scan(linked, database) == 0
    gone = linked(team.admin).delete(path)
    assert (gone.status_code, gone.json()["code"]) == (404, "source-watch-not-found")


def test_a_watch_needs_a_source_that_answers(linked: ApiAs, team: Team) -> None:
    draft = {
        "name": "Unreachable bucket",
        "kind": "storage",
        "address": f"{TEST_STORAGE.endpoint}/no-such-bucket-{uuid.uuid4().hex[:6]}/",
        "region": TEST_STORAGE.region,
        "key_id": TEST_STORAGE.access_key_id,
        "secret": TEST_STORAGE.secret_access_key,
    }
    source = linked(team.admin).post(SOURCES, json=draft).json()
    refused = linked(team.admin).put(
        f"/api/projects/{team.project}/watch", json={"source_id": source["id"]}
    )
    assert (refused.status_code, refused.json()["code"]) == (400, "source-not-listed")
    missing = linked(team.admin).put(
        f"/api/projects/{team.project}/watch", json={"source_id": str(uuid.uuid4())}
    )
    assert missing.status_code == 404
