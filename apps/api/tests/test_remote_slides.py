import gzip
import json
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from db_support import OWNER_URL, TEST_MASTER_KEYS, ApiAs, api_settings, query, with_database
from fastapi.testclient import TestClient
from fixture_support import fixture_path
from link_support import Served, Site, serving
from storage_support import read_object, stored_keys, with_store
from upload_support import run_worker
from workspace_support import join_project, make_project, make_workspace

from parfocal_api.app import create_app
from parfocal_api.principals import MemberPrincipal
from parfocal_api.remote_reads import cache_prefix, sweep_remote_cache
from parfocal_api.tables import Role
from parfocal_common.db import create_engine, tenant_transaction
from parfocal_common.envelope import MasterKeyring
from parfocal_common.ingest import restricted_ranges_key
from parfocal_common.object_store import ObjectStore
from parfocal_ingest.identify import Format, Identified
from parfocal_ingest.identifying_text import ranges_file
from parfocal_ingest.pyramid import Pyramid, read_pyramid

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SOURCES = "/api/tenant/import-sources"
SLIDE = "CMU-1-Small-Region.svs"
FILE = f"/scans/{SLIDE}"
HEADER_VALUE = "source-token-9c41aa0e72"
ETAG = '"first-version"'


@dataclass(frozen=True)
class Team:
    tenant_id: uuid.UUID
    admin: MemberPrincipal
    lead: MemberPrincipal
    project: uuid.UUID


@pytest.fixture
def site() -> Iterator[Site]:
    with serving() as served:
        yield served


@pytest.fixture
def linked(database: str, site: Site) -> Iterator[ApiAs]:
    settings = api_settings(database).model_copy(update={"link_trusted_origins": [site.origin]})
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


def serve_slide(site: Site, data: bytes, etag: str = ETAG) -> None:
    site.index("/scans/", [SLIDE])
    site.routes[FILE] = Served(
        body=data, headers={"content-type": "image/tiff", "etag": etag}, ranged=True
    )


def save_source(api: ApiAs, team: Team, site: Site) -> dict[str, Any]:
    draft = {
        "name": "Scanner share",
        "kind": "https",
        "address": site.url("/scans/"),
        "header_name": "X-Api-Key",
        "secret": HEADER_VALUE,
    }
    response = api(team.admin).post(SOURCES, json=draft)
    assert response.status_code == 201, response.text
    return response.json()


def slide_row(database: str, slide_id: str) -> tuple[Any, ...]:
    [row] = query(
        with_database(OWNER_URL, database),
        "SELECT storage, upload_id, original_key, file_bytes, remote_etag, remote_failures,"
        f" format, published_at IS NOT NULL FROM slides WHERE id = '{slide_id}'",
    )
    return row


def opened_in_place(api: ApiAs, team: Team, source_id: str) -> str:
    response = api(team.lead).post(
        f"/api/projects/{team.project}/remote-slides",
        json={"source_id": source_id, "names": [SLIDE]},
    )
    assert response.status_code == 202, response.text
    [slide] = response.json()["opened"]
    assert slide["name"] == SLIDE
    return str(slide["slide_id"])


def access(api: ApiAs, team: Team, slide_id: str) -> dict[str, Any]:
    response = api(team.lead).get(f"/api/slides/{slide_id}/tile-access")
    assert response.status_code == 200, response.text
    return response.json()


def read(api: ApiAs, grant: dict[str, Any], first: int, last: int) -> Any:
    return api.client.get(
        f"{grant['base_path']}{grant['original']}",
        headers={"Authorization": f"Bearer {grant['token']}", "Range": f"bytes={first}-{last}"},
    )


def sidecar(api: ApiAs, grant: dict[str, Any], name: str) -> Any:
    return api.client.get(
        f"{grant['base_path']}{name}", headers={"Authorization": f"Bearer {grant['token']}"}
    )


def uploaded_levels(path: Path) -> list[dict[str, Any]]:
    found = read_pyramid(path, Identified(Format.APERIO_SVS))
    assert isinstance(found, Pyramid)
    return [
        {"downsample": level.downsample, "width": level.width, "height": level.height}
        for level in found.levels
    ]


def source_reads(site: Site) -> int:
    return sum(1 for method, path, _ in site.requests if method == "GET" and path == FILE)


def inspected(database: str, team: Team, site: Site, tmp_path: Path) -> None:
    keyring = MasterKeyring.from_setting(TEST_MASTER_KEYS)
    run_worker(database, team.tenant_id, tmp_path / "work", (site.origin,), keyring)


def test_a_slide_read_in_place_copies_nothing_and_opens_from_the_cache_with_the_source_down(
    linked: ApiAs, database: str, team: Team, site: Site, tmp_path: Path
) -> None:
    data = fixture_path(SLIDE).read_bytes()
    serve_slide(site, data)
    source = save_source(linked, team, site)
    slide_id = opened_in_place(linked, team, source["id"])
    assert slide_row(database, slide_id) == (
        "remote",
        None,
        None,
        len(data),
        "first-version",
        0,
        None,
        False,
    )

    inspected(database, team, site, tmp_path)
    assert slide_row(database, slide_id)[6:] == ("aperio-svs", True)
    ranges = json.loads(read_object(restricted_ranges_key(team.tenant_id, uuid.UUID(slide_id))))
    assert ranges == json.loads(ranges_file(fixture_path(SLIDE)))
    assert ranges["ranges"][0][0] > 0
    assert stored_keys(f"t/{team.tenant_id}/uploads/") == []

    grant = access(linked, team, slide_id)
    assert grant["base_path"] == f"/api/remote-tiles/{slide_id}/"
    assert (grant["storage"], grant["offline"]) == ("remote", False)
    first = read(linked, grant, 0, 4095)
    assert first.status_code == 206, first.text
    assert first.content == data[:4096]
    assert first.headers["content-range"] == f"bytes 0-4095/{len(data)}"
    reads = source_reads(site)
    assert read(linked, grant, 0, 4095).content == data[:4096]
    assert source_reads(site) == reads

    start, _ = ranges["ranges"][0]
    closed = read(linked, grant, start, start + 15)
    assert (closed.status_code, closed.json()["code"]) == (403, "range-restricted")
    assert read(linked, {**grant, "token": "forged.token"}, 0, 15).status_code == 401

    site.routes[FILE] = Served(503)
    assert read(linked, grant, 0, 4095).content == data[:4096]
    missing = read(linked, grant, 4096, 8191)
    assert (missing.status_code, missing.json()["code"]) == (503, "slide-offline")
    read(linked, grant, 4096, 8191)
    offline = access(linked, team, slide_id)
    assert offline["offline"] is True
    assert read(linked, offline, 0, 4095).content == data[:4096]
    levels = sidecar(linked, offline, "levels.json")
    assert levels.status_code == 200, levels.text
    table = levels.json()
    shown = [
        {name: level[name] for name in ("downsample", "width", "height")}
        for level in table["levels"]
    ]
    assert shown == uploaded_levels(fixture_path(SLIDE))
    assert table["scale"]["mpp_x"] == pytest.approx(0.499)
    tiles = sidecar(linked, offline, "tile-index.json")
    assert tiles.status_code == 200
    body = tiles.content
    index = json.loads(gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body)
    assert (index["formatId"], len(index["levels"])) == ("aperio-svs", len(shown))
    assert sidecar(linked, offline, "thumbnail.webp").status_code == 401
    assert sidecar(linked, {**offline, "token": "forged.token"}, "levels.json").status_code == 401

    serve_slide(site, data)
    back = read(linked, offline, 4096, 8191)
    assert back.status_code == 206, back.text
    assert back.content == data[4096:8192]
    assert slide_row(database, slide_id)[5] == 0
    assert access(linked, team, slide_id)["offline"] is False

    serve_slide(site, data, etag='"second-version"')
    changed = linked(team.lead).get(f"/api/slides/{slide_id}/tile-access")
    assert (changed.status_code, changed.json()["code"]) == (409, "remote-slide-changed")


def test_removing_the_source_keeps_the_slide_offline_with_its_cache(
    linked: ApiAs, database: str, team: Team, site: Site, tmp_path: Path
) -> None:
    data = fixture_path(SLIDE).read_bytes()
    serve_slide(site, data)
    source = save_source(linked, team, site)
    slide_id = opened_in_place(linked, team, source["id"])
    inspected(database, team, site, tmp_path)
    grant = access(linked, team, slide_id)
    assert read(linked, grant, 0, 1023).status_code == 206

    assert linked(team.admin).delete(f"{SOURCES}/{source['id']}").status_code == 204
    left = access(linked, team, slide_id)
    assert left["offline"] is True
    assert read(linked, left, 0, 1023).content == data[:1024]
    assert read(linked, left, 1024, 2047).status_code == 503


def test_the_cache_of_a_slide_unread_for_seven_days_is_swept(
    linked: ApiAs, database: str, team: Team, site: Site, tmp_path: Path
) -> None:
    serve_slide(site, fixture_path(SLIDE).read_bytes())
    source = save_source(linked, team, site)
    slide_id = opened_in_place(linked, team, source["id"])
    inspected(database, team, site, tmp_path)
    grant = access(linked, team, slide_id)
    assert read(linked, grant, 0, 1023).status_code == 206
    prefix = cache_prefix(team.tenant_id, uuid.UUID(slide_id))
    assert len(stored_keys(prefix)) == 1

    def sweep(at: datetime) -> int:
        async def work(store: ObjectStore) -> int:
            engine = create_engine(with_database(OWNER_URL, database))
            try:
                async with tenant_transaction(engine, team.tenant_id) as connection:
                    return await sweep_remote_cache(store, connection, at)
            finally:
                await engine.dispose()

        return with_store(work)

    assert sweep(datetime.now(UTC) + timedelta(days=6)) == 0
    assert sweep(datetime.now(UTC) + timedelta(days=8)) >= 1
    assert stored_keys(prefix) == []
