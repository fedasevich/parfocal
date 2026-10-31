import asyncio
import hashlib
import os
import uuid
from dataclasses import dataclass
from typing import Any

import httpx2
import pytest
from db_support import APP_URL, ApiAs, with_database
from storage_support import MIB, TEST_MAX_BYTES, TEST_PART_BYTES, put, read_object, with_store
from workspace_support import join_project, make_case, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.stale_uploads import abort_stale_uploads
from parfocal_api.tables import Role
from parfocal_common.db import create_engine
from parfocal_common.ingest import STEP_NAMES
from parfocal_common.object_store import (
    NoSuchUploadError,
    ObjectStore,
    StorageError,
    StorageLocation,
)

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

TAIL = b"the last part of the slide"


@dataclass(frozen=True)
class Team:
    tenant_id: uuid.UUID
    lead: MemberPrincipal
    colleague: MemberPrincipal
    viewer: MemberPrincipal
    reviewer: MemberPrincipal
    project: uuid.UUID


@pytest.fixture
def team(database: str) -> Team:
    workspace = make_workspace(
        database,
        {
            "lead": Role.RESEARCHER,
            "colleague": Role.RESEARCHER,
            "viewer": Role.RESEARCHER,
            "reviewer": Role.REVIEWER,
        },
    )
    people = workspace.people
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, people["lead"], "owner")
    join_project(database, project, people["colleague"], "owner")
    join_project(database, project, people["viewer"], "viewer")
    join_project(database, project, people["reviewer"], "reviewer")
    return Team(
        workspace.tenant_id,
        people["lead"],
        people["colleague"],
        people["viewer"],
        people["reviewer"],
        project,
    )


def draft(project: uuid.UUID, size: int, name: str = "S26-1 slide.svs", **meta: Any) -> Any:
    return {
        "filename": name,
        "type": "application/octet-stream",
        "metadata": {"project_id": str(project), "size": size, "name": name, **meta},
    }


def create(api: ApiAs, who: MemberPrincipal, project: uuid.UUID, size: int, **meta: Any) -> Any:
    response = api(who).post("/api/uploads/s3/multipart", json=draft(project, size, **meta))
    assert response.status_code == 201, response.text
    return response.json()


def path(upload: Any, suffix: str = "") -> str:
    return f"/api/uploads/s3/multipart/{upload['uploadId']}{suffix}"


def query(upload: Any) -> dict[str, str]:
    return {"key": upload["key"]}


def send_part(api: ApiAs, who: MemberPrincipal, upload: Any, number: int, data: bytes) -> str:
    signed = api(who).get(path(upload, f"/{number}"), params=query(upload))
    assert signed.status_code == 200, signed.text
    stored = put(signed.json()["url"], data)
    assert stored.status_code == 200, stored.text
    return stored.headers["etag"].strip('"')


def file_of(parts: int) -> list[bytes]:
    return [os.urandom(TEST_PART_BYTES) for _ in range(parts - 1)] + [TAIL]


def size_of(parts: list[bytes]) -> int:
    return sum(len(part) for part in parts)


def listed(api: ApiAs, who: MemberPrincipal, upload: Any) -> list[dict[str, Any]]:
    response = api(who).get(path(upload), params=query(upload))
    assert response.status_code == 200, response.text
    return response.json()


def complete(api: ApiAs, who: MemberPrincipal, upload: Any, parts: list[dict[str, Any]]) -> Any:
    return api(who).post(
        path(upload, "/complete"),
        params=query(upload),
        json={"parts": [{"PartNumber": p["PartNumber"], "ETag": p["ETag"]} for p in parts]},
    )


def upload_status(database: str, upload: Any) -> str:
    return str(
        owner(database, f"SELECT status FROM uploads WHERE id = '{upload['uploadId']}'")[0][0]
    )


def storage_parts(upload_key: str, storage_upload_id: str) -> int:
    async def go(store: ObjectStore) -> int:
        return len(await store.list_parts(upload_key, storage_upload_id))

    return with_store(go)


def storage_id(database: str, upload: Any) -> str:
    return str(
        owner(database, f"SELECT storage_upload_id FROM uploads WHERE id = '{upload['uploadId']}'")[
            0
        ][0]
    )


def test_an_upload_goes_from_create_to_an_ingest_job(api: ApiAs, database: str, team: Team) -> None:
    parts = file_of(3)
    upload = create(api, team.lead, team.project, size_of(parts), last_modified=1_700_000_000_000)
    assert upload["key"] == f"t/{team.tenant_id}/quarantine/{upload['uploadId']}/S26-1_slide.svs"
    assert (upload["part_size"], upload["part_count"]) == (TEST_PART_BYTES, 3)
    etags = [send_part(api, team.lead, upload, n, data) for n, data in enumerate(parts, 1)]
    stored = listed(api, team.lead, upload)
    assert [(p["PartNumber"], p["Size"], p["ETag"]) for p in stored] == [
        (n, len(data), etag) for n, (data, etag) in enumerate(zip(parts, etags, strict=True), 1)
    ]
    assert etags == [hashlib.md5(data).hexdigest() for data in parts]
    done = complete(api, team.lead, upload, stored)
    assert done.status_code == 200, done.text
    body = done.json()
    assert body["location"] == f"/api/projects/{team.project}/jobs/{body['job_id']}"
    assert body["etag"].endswith("-3")
    assert read_object(upload["key"]) == b"".join(parts)
    assert upload_status(database, upload) == "completed"
    job = api(team.lead).get(body["location"])
    assert job.status_code == 200, job.text
    assert (job.json()["kind"], job.json()["status"]) == ("ingest", "queued")
    assert [step["name"] for step in job.json()["steps"]] == list(STEP_NAMES)
    job_input = owner(database, f"SELECT input FROM jobs WHERE id = '{body['job_id']}'")[0][0]
    assert job_input == {"upload_id": upload["uploadId"]}
    again = complete(api, team.lead, upload, stored)
    assert (again.status_code, again.json()) == (200, body)
    signed = api(team.lead).get(path(upload, "/1"), params=query(upload))
    assert (signed.status_code, signed.json()["code"]) == (409, "upload-not-open")
    actions = owner(
        database,
        f"SELECT action FROM audit_events WHERE target_id = '{upload['uploadId']}'",
    )
    assert actions == [("upload.completed",)]


def test_list_parts_reads_every_page(api: ApiAs, team: Team) -> None:
    parts = file_of(5)
    upload = create(api, team.lead, team.project, size_of(parts))
    for number, data in enumerate(parts, 1):
        send_part(api, team.lead, upload, number, data)
    assert [part["PartNumber"] for part in listed(api, team.lead, upload)] == [1, 2, 3, 4, 5]


def test_a_part_url_is_signed_for_fifteen_minutes(api: ApiAs, team: Team) -> None:
    upload = create(api, team.lead, team.project, 10)
    signed = api(team.lead).get(path(upload, "/1"), params=query(upload)).json()
    assert signed["expires"] == 900
    url = httpx2.URL(signed["url"])
    assert url.params["X-Amz-Expires"] == "900"
    assert url.params["partNumber"] == "1"
    assert url.params["X-Amz-SignedHeaders"] == "host"
    beyond = api(team.lead).get(path(upload, "/2"), params=query(upload))
    assert (beyond.status_code, beyond.json()["code"]) == (400, "part-out-of-range")


def test_size_limits_are_refused(api: ApiAs, team: Team) -> None:
    too_large = api(team.lead).post(
        "/api/uploads/s3/multipart", json=draft(team.project, TEST_MAX_BYTES + 1)
    )
    assert (too_large.status_code, too_large.json()["code"]) == (400, "upload-too-large")
    empty = api(team.lead).post("/api/uploads/s3/multipart", json=draft(team.project, 0))
    assert empty.status_code == 422
    largest = create(api, team.lead, team.project, TEST_MAX_BYTES)
    assert largest["part_count"] == TEST_MAX_BYTES // TEST_PART_BYTES + 1


def test_uneven_parts_are_refused_before_storage_completes(
    api: ApiAs, database: str, team: Team
) -> None:
    parts = file_of(3)
    upload = create(api, team.lead, team.project, size_of(parts))
    send_part(api, team.lead, upload, 1, parts[0][: 3 * MIB])
    send_part(api, team.lead, upload, 3, parts[2])
    gap = complete(api, team.lead, upload, listed(api, team.lead, upload))
    assert (gap.status_code, gap.json()["code"]) == (409, "upload-parts-invalid")
    assert gap.json()["detail"] == f"Part 1 has {3 * MIB} bytes, expected {TEST_PART_BYTES}"
    send_part(api, team.lead, upload, 1, parts[0])
    missing = complete(api, team.lead, upload, listed(api, team.lead, upload))
    assert missing.json()["detail"] == "Part 2 is missing"
    send_part(api, team.lead, upload, 2, parts[1])
    stored = listed(api, team.lead, upload)
    wrong = [{**stored[0], "ETag": "0" * 32}, *stored[1:]]
    mismatch = complete(api, team.lead, upload, wrong)
    assert mismatch.json()["detail"] == "Part 1 has another ETag"
    short = complete(api, team.lead, upload, stored[:2])
    assert short.json()["detail"] == "The parts sent are not the parts stored"
    assert upload_status(database, upload) == "open"
    done = complete(api, team.lead, upload, stored)
    assert done.status_code == 200, done.text
    assert read_object(upload["key"]) == b"".join(parts)


def test_a_reloaded_page_finds_the_open_upload(api: ApiAs, team: Team) -> None:
    upload = create(api, team.lead, team.project, 10, last_modified=1_700_000_000_000)
    lookup = {"project_id": str(team.project), "name": "S26-1 slide.svs", "size": 10}
    found = api(team.lead).get(
        "/api/uploads/open", params={**lookup, "last_modified": 1_700_000_000_000}
    )
    assert found.status_code == 200, found.text
    assert (found.json()["uploadId"], found.json()["key"]) == (upload["uploadId"], upload["key"])
    for changed in ({"last_modified": 1}, {"size": 11}, {"name": "other.svs"}):
        miss = api(team.lead).get(
            "/api/uploads/open", params={**lookup, "last_modified": 1_700_000_000_000, **changed}
        )
        assert (miss.status_code, miss.json()["code"]) == (404, "no-open-upload")
    without_time = api(team.lead).get("/api/uploads/open", params=lookup)
    assert without_time.status_code == 404
    colleague = api(team.colleague).get(
        "/api/uploads/open", params={**lookup, "last_modified": 1_700_000_000_000}
    )
    assert colleague.status_code == 404
    api(team.lead).delete(path(upload), params=query(upload))
    gone = api(team.lead).get(
        "/api/uploads/open", params={**lookup, "last_modified": 1_700_000_000_000}
    )
    assert gone.status_code == 404


def test_abort_removes_the_stored_parts_and_is_repeatable(
    api: ApiAs, database: str, team: Team
) -> None:
    upload = create(api, team.lead, team.project, 10)
    send_part(api, team.lead, upload, 1, b"0123456789")
    storage_upload_id = storage_id(database, upload)
    aborted = api(team.lead).delete(path(upload), params=query(upload))
    assert (aborted.status_code, aborted.json()["status"]) == (200, "aborted")
    with pytest.raises(NoSuchUploadError):
        storage_parts(upload["key"], storage_upload_id)
    again = api(team.lead).delete(path(upload), params=query(upload))
    assert (again.status_code, again.json()["status"]) == (200, "aborted")
    listing = api(team.lead).get(path(upload), params=query(upload))
    assert (listing.status_code, listing.json()["code"]) == (409, "upload-not-open")


def test_only_the_uploader_with_owner_rights_reaches_an_upload(
    api: ApiAs, database: str, team: Team
) -> None:
    upload = create(api, team.lead, team.project, 10)
    for who in (team.colleague,):
        response = api(who).get(path(upload, "/1"), params=query(upload))
        assert (response.status_code, response.json()["code"]) == (404, "upload-not-found")
    wrong_key = api(team.lead).get(path(upload, "/1"), params={"key": f"{upload['key']}x"})
    assert (wrong_key.status_code, wrong_key.json()["code"]) == (404, "upload-not-found")
    viewer = api(team.viewer).post("/api/uploads/s3/multipart", json=draft(team.project, 10))
    assert (viewer.status_code, viewer.json()["code"]) == (403, "uploading-not-allowed")
    reviewer = api(team.reviewer).post("/api/uploads/s3/multipart", json=draft(team.project, 10))
    assert reviewer.status_code == 403
    outside = make_project(database, team.tenant_id)
    hidden = api(team.lead).post("/api/uploads/s3/multipart", json=draft(outside, 10))
    assert hidden.status_code in {403, 404}
    assert hidden.json()["code"] != "uploading-not-allowed"
    owner(
        database,
        "UPDATE project_members SET role = 'viewer' "
        f"WHERE project_id = '{team.project}' AND user_id = '{team.lead.user_id}'",
    )
    demoted = api(team.lead).get(path(upload, "/1"), params=query(upload))
    assert (demoted.status_code, demoted.json()["code"]) == (403, "uploading-not-allowed")


def test_an_upload_can_belong_to_a_case_of_its_project(
    api: ApiAs, database: str, team: Team
) -> None:
    case = make_case(database, team.tenant_id, team.project, f"C-{uuid.uuid4().hex[:6]}")
    upload = create(api, team.lead, team.project, 10, case_id=str(case))
    stored = owner(database, f"SELECT case_id FROM uploads WHERE id = '{upload['uploadId']}'")
    assert stored == [(case,)]
    other_project = make_project(database, team.tenant_id)
    other_case = make_case(database, team.tenant_id, other_project, "Elsewhere")
    elsewhere = api(team.lead).post(
        "/api/uploads/s3/multipart", json=draft(team.project, 10, case_id=str(other_case))
    )
    assert (elsewhere.status_code, elsewhere.json()["code"]) == (404, "case-not-found")


def test_an_archived_project_takes_no_uploads(api: ApiAs, database: str, team: Team) -> None:
    upload = create(api, team.lead, team.project, 10)
    owner(database, f"UPDATE projects SET archived_at = now() WHERE id = '{team.project}'")
    created = api(team.lead).post("/api/uploads/s3/multipart", json=draft(team.project, 10))
    assert (created.status_code, created.json()["code"]) == (409, "project-archived")
    signed = api(team.lead).get(path(upload, "/1"), params=query(upload))
    assert (signed.status_code, signed.json()["code"]) == (409, "project-archived")


def test_another_workspace_can_neither_sign_list_complete_nor_abort(
    api: ApiAs, database: str, team: Team
) -> None:
    upload = create(api, team.lead, team.project, 10)
    send_part(api, team.lead, upload, 1, b"0123456789")
    other = make_workspace(database, {"lead": Role.RESEARCHER}).people["lead"]
    join_project(database, make_project(database, other.tenant_id), other, "owner")
    stranger = api(other)
    attempts = [
        stranger.get(path(upload, "/1"), params=query(upload)),
        stranger.get(path(upload), params=query(upload)),
        stranger.post(
            path(upload, "/complete"),
            params=query(upload),
            json={"parts": [{"PartNumber": 1, "ETag": hashlib.md5(b"0123456789").hexdigest()}]},
        ),
        stranger.delete(path(upload), params=query(upload)),
    ]
    for response in attempts:
        assert (response.status_code, response.json()["code"]) == (404, "upload-not-found")
        assert upload["key"] not in response.text
    foreign = stranger.post("/api/uploads/s3/multipart", json=draft(team.project, 10))
    assert foreign.status_code == 404
    found = stranger.get(
        "/api/uploads/open",
        params={"project_id": str(team.project), "name": "S26-1 slide.svs", "size": 10},
    )
    assert found.status_code == 404
    assert upload_status(database, upload) == "open"
    assert storage_parts(upload["key"], storage_id(database, upload)) == 1


def run_cleanup(database: str, storage: StorageLocation) -> list[uuid.UUID]:
    async def go() -> list[uuid.UUID]:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with httpx2.AsyncClient() as http:
                return await abort_stale_uploads(engine, ObjectStore(storage, http))
        finally:
            await engine.dispose()

    return asyncio.run(go())


def test_the_stale_upload_job_aborts_uploads_idle_for_a_day(
    api: ApiAs, database: str, team: Team, storage: StorageLocation
) -> None:
    stale = create(api, team.lead, team.project, 10)
    send_part(api, team.lead, stale, 1, b"0123456789")
    fresh = create(api, team.lead, team.project, 10)
    storage_upload_id = storage_id(database, stale)
    owner(
        database,
        "UPDATE uploads SET last_activity_at = now() - interval '25 hours' "
        f"WHERE id = '{stale['uploadId']}'",
    )
    nearly = create(api, team.lead, team.project, 10)
    owner(
        database,
        "UPDATE uploads SET last_activity_at = now() - interval '23 hours' "
        f"WHERE id = '{nearly['uploadId']}'",
    )
    expired = run_cleanup(database, storage)
    assert uuid.UUID(stale["uploadId"]) in expired
    assert uuid.UUID(fresh["uploadId"]) not in expired
    assert uuid.UUID(nearly["uploadId"]) not in expired
    assert upload_status(database, stale) == "expired"
    assert upload_status(database, fresh) == "open"
    with pytest.raises(NoSuchUploadError):
        storage_parts(stale["key"], storage_upload_id)
    assert run_cleanup(database, storage) == []
    signed = api(team.lead).get(path(stale, "/1"), params=query(stale))
    assert (signed.status_code, signed.json()["code"]) == (409, "upload-not-open")


def test_signing_and_listing_count_as_activity(api: ApiAs, database: str, team: Team) -> None:
    upload = create(api, team.lead, team.project, 10)
    owner(
        database,
        "UPDATE uploads SET last_activity_at = now() - interval '25 hours' "
        f"WHERE id = '{upload['uploadId']}'",
    )
    api(team.lead).get(path(upload, "/1"), params=query(upload))
    age = owner(
        database,
        "SELECT now() - last_activity_at < interval '1 minute' FROM uploads "
        f"WHERE id = '{upload['uploadId']}'",
    )
    assert age == [(True,)]


def test_a_completion_storage_refuses_is_a_problem_and_queues_nothing(
    api: ApiAs, database: str, team: Team, monkeypatch: pytest.MonkeyPatch
) -> None:
    upload = create(api, team.lead, team.project, 10)
    send_part(api, team.lead, upload, 1, b"0123456789")
    stored = listed(api, team.lead, upload)

    async def refuse(*_: object) -> None:
        raise StorageError(400, "InvalidPart")

    monkeypatch.setattr(api.app.state.storage, "complete_multipart_upload", refuse)
    refused = complete(api, team.lead, upload, stored)
    assert (refused.status_code, refused.json()["code"]) == (409, "upload-parts-invalid")
    assert refused.json()["detail"] == "Storage refused the parts with InvalidPart"
    jobs = owner(
        database,
        f"SELECT count(*) FROM jobs WHERE input->>'upload_id' = '{upload['uploadId']}'",
    )
    assert jobs == [(0,)]
    assert upload_status(database, upload) == "open"
