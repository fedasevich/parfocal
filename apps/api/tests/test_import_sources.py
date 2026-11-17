import json
import logging
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from db_support import TEST_MASTER_KEYS, ApiAs, api_settings
from fastapi.testclient import TestClient
from fixture_support import fixture_path
from link_support import Served, Site, serving
from storage_support import TEST_STORAGE, put, read_object
from upload_support import run_worker, single, status_of
from workspace_support import join_project, make_project, make_workspace

from parfocal_api.app import create_app
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.envelope import MasterKeyring
from parfocal_common.link_imports import source_key
from parfocal_common.object_store import presign

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

SOURCES = "/api/tenant/import-sources"
SLIDE = "CMU-1-Small-Region.svs"
HEADER_VALUE = "source-token-5b2e81c4d07f"
STORAGE_SECRET = TEST_STORAGE.secret_access_key
STORAGE_KEY_ID = TEST_STORAGE.access_key_id
STORAGE_ORIGIN = TEST_STORAGE.endpoint.split("://", 1)[1]


@dataclass(frozen=True)
class Team:
    tenant_id: uuid.UUID
    admin: MemberPrincipal
    lead: MemberPrincipal
    reviewer: MemberPrincipal
    project: uuid.UUID


@pytest.fixture
def site() -> Iterator[Site]:
    with serving() as served:
        yield served


@pytest.fixture
def other_site() -> Iterator[Site]:
    with serving() as served:
        yield served


@pytest.fixture
def linked(database: str, site: Site, other_site: Site) -> Iterator[ApiAs]:
    trusted = [site.origin, other_site.origin, STORAGE_ORIGIN]
    settings = api_settings(database).model_copy(update={"link_trusted_origins": trusted})
    app = create_app(settings)
    with TestClient(app) as client:
        yield ApiAs(app, client)


@pytest.fixture
def team(database: str) -> Team:
    workspace = make_workspace(
        database,
        {"admin": Role.RESEARCHER, "lead": Role.RESEARCHER, "reviewer": Role.REVIEWER},
        admins=("admin",),
    )
    project = make_project(database, workspace.tenant_id)
    for name in ("admin", "lead"):
        join_project(database, project, workspace.people[name], "owner")
    people = workspace.people
    return Team(workspace.tenant_id, people["admin"], people["lead"], people["reviewer"], project)


def https_source(site: Site, **change: Any) -> dict[str, Any]:
    return {
        "name": "Scanner export",
        "kind": "https",
        "address": site.url("/scans/"),
        "header_name": "X-Api-Key",
        "secret": HEADER_VALUE,
        **change,
    }


def storage_source(prefix: str, **change: Any) -> dict[str, Any]:
    return {
        "name": "Lab bucket",
        "kind": "storage",
        "address": f"{TEST_STORAGE.endpoint}/{TEST_STORAGE.bucket}/{prefix}",
        "region": TEST_STORAGE.region,
        "key_id": STORAGE_KEY_ID,
        "secret": STORAGE_SECRET,
        **change,
    }


def saved(api: ApiAs, team: Team, draft: dict[str, Any]) -> dict[str, Any]:
    response = api(team.admin).post(SOURCES, json=draft)
    assert response.status_code == 201, response.text
    return response.json()


def listing(api: ApiAs, team: Team, source_id: str) -> Any:
    return api(team.lead).get(
        f"/api/projects/{team.project}/source-files", params={"source_id": source_id}
    )


def start(api: ApiAs, team: Team, source_id: str, names: list[str]) -> Any:
    return api(team.lead).post(
        f"/api/projects/{team.project}/link-imports",
        json={"source_id": source_id, "names": names},
    )


def put_object(key: str, body: bytes) -> None:
    url = presign(TEST_STORAGE, "PUT", key, {}, 60, datetime.now(UTC))
    put(url, body).raise_for_status()


def keyring() -> MasterKeyring:
    return MasterKeyring.from_setting(TEST_MASTER_KEYS)


def sent_header(site: Site) -> list[str | None]:
    return [
        {name.lower(): value for name, value in headers.items()}.get("x-api-key")
        for _, _, headers in site.requests
    ]


def test_only_researchers_with_admin_rights_save_change_or_delete_sources(
    linked: ApiAs, team: Team, site: Site
) -> None:
    for who in (team.lead, team.reviewer):
        assert linked(who).post(SOURCES, json=https_source(site)).status_code == 403
    source = saved(linked, team, https_source(site))
    path = f"{SOURCES}/{source['id']}"
    changed = https_source(site, name="Scanner export, west wing")
    for who in (team.lead, team.reviewer):
        assert linked(who).put(path, json=changed).status_code == 403
        assert linked(who).delete(path).status_code == 403
    assert linked(team.reviewer).get(SOURCES).status_code == 403
    picked = linked(team.lead).get(SOURCES)
    assert picked.status_code == 200, picked.text
    assert [item["name"] for item in picked.json()["sources"]] == ["Scanner export"]
    assert listing(linked, team, source["id"]).status_code != 403

    kept = linked(team.admin).put(path, json={**changed, "secret": None})
    assert kept.status_code == 200, kept.text
    assert (kept.json()["name"], kept.json()["has_credential"]) == (changed["name"], True)
    assert linked(team.admin).delete(path).status_code == 204
    assert linked(team.lead).get(SOURCES).json()["sources"] == []


def test_a_source_needs_a_whole_credential_and_a_reachable_address(
    linked: ApiAs, team: Team, site: Site
) -> None:
    def refused(draft: dict[str, Any]) -> str:
        response = linked(team.admin).post(SOURCES, json=draft)
        assert response.status_code == 400, response.text
        return response.json()["code"]

    assert refused(https_source(site, header_name=None)) == "import-source-invalid"
    assert refused(storage_source("x/", key_id=None)) == "import-source-invalid"
    assert refused(storage_source("x/", region=None)) == "import-source-invalid"
    assert refused(https_source(site, address="https://10.0.0.5/scans/")) == "import-source-invalid"
    saved(linked, team, https_source(site))
    taken = linked(team.admin).post(SOURCES, json=https_source(site))
    assert (taken.status_code, taken.json()["code"]) == (409, "import-source-exists")


def test_an_https_source_sends_its_header_only_to_its_own_origin_and_imports_a_slide(
    linked: ApiAs, database: str, team: Team, site: Site, other_site: Site, tmp_path: Path
) -> None:
    data = fixture_path(SLIDE).read_bytes()
    site.index("/scans/", [SLIDE])
    site.file(f"/scans/{SLIDE}", data)
    source = saved(linked, team, https_source(site))

    found = listing(linked, team, source["id"])
    assert found.status_code == 200, found.text
    assert found.json()["address"] == site.url("/scans/")
    assert [file["name"] for file in found.json()["files"]] == [SLIDE]
    assert set(sent_header(site)) == {HEADER_VALUE}

    started = start(linked, team, source["id"], [SLIDE])
    assert started.status_code == 202, started.text
    [upload] = started.json()["started"]
    note = json.loads(read_object(source_key(team.tenant_id, uuid.UUID(upload["upload_id"]))))
    assert note == {"address": site.url(f"/scans/{SLIDE}"), "source_id": source["id"]}

    site.requests.clear()
    run_worker(database, team.tenant_id, tmp_path / "work", (site.origin,), keyring())
    assert sent_header(site) == [HEADER_VALUE]
    published = status_of(linked, team.lead, {"uploadId": upload["upload_id"]})
    assert published["status"] == "ready", published

    other_site.file("/elsewhere.svs", b"slide")
    site.routes["/hop"] = Served(302, headers={"location": other_site.url("/elsewhere.svs")})
    hop = saved(linked, team, https_source(site, name="Hop", address=site.url("/hop")))
    assert listing(linked, team, hop["id"]).status_code == 200
    assert sent_header(other_site) == [None]


def test_a_storage_source_lists_and_imports_through_signed_requests(
    linked: ApiAs, database: str, team: Team, tmp_path: Path
) -> None:
    prefix = f"sources-{uuid.uuid4().hex[:8]}/"
    data = fixture_path(SLIDE).read_bytes()
    put_object(f"{prefix}{SLIDE}", data)
    put_object(f"{prefix}deeper/ignored.svs", b"deeper")
    source = saved(linked, team, storage_source(prefix))

    found = listing(linked, team, source["id"])
    assert found.status_code == 200, found.text
    assert found.json()["kind"] == "storage"
    assert found.json()["address"] == storage_source(prefix)["address"]
    assert [(file["name"], file["size_bytes"]) for file in found.json()["files"]] == [
        (SLIDE, len(data))
    ]

    started = start(linked, team, source["id"], [SLIDE])
    assert started.status_code == 202, started.text
    [upload] = started.json()["started"]
    run_worker(database, team.tenant_id, tmp_path / "work", (STORAGE_ORIGIN,))
    published = status_of(linked, team.lead, {"uploadId": upload["upload_id"]})
    assert published["status"] == "ready", published


def test_credentials_never_appear_in_responses_logs_or_audit(
    linked: ApiAs,
    database: str,
    team: Team,
    site: Site,
    tmp_path: Path,
    caplog: pytest.LogCaptureFixture,
) -> None:
    caplog.set_level(logging.DEBUG)
    site.index("/scans/", ["a.svs"])
    site.file("/scans/a.svs", b"slide-bytes")
    prefix = f"sources-{uuid.uuid4().hex[:8]}/"
    put_object(f"{prefix}b.svs", b"slide-bytes")
    answers: list[str] = []

    def kept(response: Any) -> Any:
        answers.append(response.text)
        return response

    https = kept(linked(team.admin).post(SOURCES, json=https_source(site))).json()
    bucket = kept(linked(team.admin).post(SOURCES, json=storage_source(prefix))).json()
    kept(linked(team.admin).post(SOURCES, json=https_source(site, name="Bad", header_name=None)))
    kept(linked(team.admin).post(SOURCES, json=storage_source(prefix, name="x", region=None)))
    kept(linked(team.admin).put(f"{SOURCES}/{bucket['id']}", json=storage_source(prefix)))
    kept(linked(team.lead).get(SOURCES))
    for source in (https, bucket):
        kept(listing(linked, team, source["id"]))
    kept(start(linked, team, https["id"], ["a.svs"]))
    kept(start(linked, team, bucket["id"], ["b.svs"]))
    run_worker(
        database, team.tenant_id, tmp_path / "work", (site.origin, STORAGE_ORIGIN), keyring()
    )
    audit = single(
        database,
        "SELECT string_agg(details::text, ' ') FROM audit_events "
        f"WHERE tenant_id = '{team.tenant_id}' AND action LIKE 'import-source.%'",
    )[0]
    stored = single(
        database,
        "SELECT string_agg(encode(credential_ciphertext, 'escape'), ' ') FROM import_sources "
        f"WHERE tenant_id = '{team.tenant_id}'",
    )[0]

    for secret in (HEADER_VALUE, STORAGE_SECRET):
        assert all(secret not in answer for answer in answers)
        assert secret not in caplog.text
        assert secret not in audit
        assert secret not in stored
    assert "Scanner export" in audit
