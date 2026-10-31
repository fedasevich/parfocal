import asyncio
import hashlib
import os
import signal
import subprocess
import sys
import threading
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from fixture_support import fixture_path
from storage_support import TEST_STORAGE, put, with_store
from workspace_support import (
    join_project,
    make_case,
    make_project,
    make_slide,
    make_workspace,
    owner,
)

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.db import create_engine
from parfocal_common.ingest import STEP_NAMES, restricted_prefix, slide_prefix
from parfocal_common.jobs import work
from parfocal_common.object_store import ObjectStore
from parfocal_ingest.workflow import Resources, ingest_workflow

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

TESTS = Path(__file__).resolve().parent
PUBLIC_FILES = {"levels.json", "thumbnail.jpg", "overview.jpg", "tissue.png", "tissue.json"}
DERIVE = STEP_NAMES.index("derive")


@dataclass(frozen=True)
class Lab:
    tenant_id: uuid.UUID
    lead: MemberPrincipal
    colleague: MemberPrincipal
    project: uuid.UUID


@pytest.fixture
def lab(database: str) -> Lab:
    workspace = make_workspace(database, {"lead": Role.RESEARCHER, "colleague": Role.RESEARCHER})
    project = make_project(database, workspace.tenant_id)
    for name in ("lead", "colleague"):
        join_project(database, project, workspace.people[name], "owner")
    return Lab(
        workspace.tenant_id, workspace.people["lead"], workspace.people["colleague"], project
    )


def start_upload(
    api: ApiAs, who: MemberPrincipal, project: uuid.UUID, name: str, size: int, **meta: Any
) -> dict[str, Any]:
    response = api(who).post(
        "/api/uploads/s3/multipart",
        json={
            "filename": name,
            "type": "application/octet-stream",
            "metadata": {"project_id": str(project), "size": size, **meta},
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def send_file(api: ApiAs, who: MemberPrincipal, upload: dict[str, Any], data: bytes) -> None:
    query = {"key": upload["key"]}
    base = f"/api/uploads/s3/multipart/{upload['uploadId']}"
    size = upload["part_size"]
    parts: list[dict[str, Any]] = []
    for number, start in enumerate(range(0, len(data), size), start=1):
        signed = api(who).get(f"{base}/{number}", params=query)
        assert signed.status_code == 200, signed.text
        stored = put(signed.json()["url"], data[start : start + size])
        assert stored.status_code == 200, stored.text
        parts.append({"PartNumber": number, "ETag": stored.headers["etag"].strip('"')})
    done = api(who).post(f"{base}/complete", params=query, json={"parts": parts})
    assert done.status_code == 200, done.text


def status_of(api: ApiAs, who: MemberPrincipal, upload: dict[str, Any]) -> dict[str, Any]:
    response = api(who).get(f"/api/uploads/{upload['uploadId']}/status")
    assert response.status_code == 200, response.text
    return response.json()


def run_worker(database: str, tenant_id: uuid.UUID, work_dir: Path) -> int:
    workflow = ingest_workflow(lambda: Resources(TEST_STORAGE, work_dir))

    async def go() -> int:
        engine = create_engine(with_database(APP_URL, database))
        try:
            return await work(
                engine,
                [workflow],
                "inline",
                idle_exit_seconds=0.3,
                poll_seconds=0.1,
                tenant_id=tenant_id,
            )
        finally:
            await engine.dispose()

    return asyncio.run(go())


def keys_under(prefix: str) -> set[str]:
    async def go(store: ObjectStore) -> set[str]:
        return {key.removeprefix(prefix) for key in await store.list_keys(prefix)}

    return with_store(go)


def exists(key: str) -> bool:
    async def go(store: ObjectStore) -> bool:
        return await store.head_object(key) is not None

    return with_store(go)


def single(database: str, statement: str) -> Any:
    rows = owner(database, statement)
    assert len(rows) == 1, rows
    return rows[0]


def upload_done_notifications(database: str, who: MemberPrincipal) -> list[tuple[object, ...]]:
    return owner(
        database,
        "SELECT target_type, target_id, payload->>'slide_id' FROM notifications "
        f"WHERE user_id = '{who.user_id}' AND kind = 'upload-done'",
    )


def test_an_uploaded_slide_goes_from_uploading_to_processing_to_ready(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    data = fixture_path("CMU-1-Small-Region.svs").read_bytes()
    case = make_case(database, lab.tenant_id, lab.project, "S26-100")
    upload = start_upload(
        api, lab.lead, lab.project, "CMU-1-Small-Region.svs", len(data), case_id=str(case)
    )
    seen = [status_of(api, lab.lead, upload)]
    assert (seen[0]["status"], seen[0]["slide_id"], seen[0]["job_id"]) == ("uploading", None, None)
    send_file(api, lab.lead, upload, data)
    seen.append(status_of(api, lab.lead, upload))
    assert (seen[-1]["status"], seen[-1]["step"]) == ("processing", "quarantine")

    worker = threading.Thread(target=run_worker, args=(database, lab.tenant_id, tmp_path / "work"))
    worker.start()
    while worker.is_alive():
        seen.append(status_of(api, lab.lead, upload))
        time.sleep(0.05)
    worker.join()
    final = status_of(api, lab.lead, upload)
    seen.append(final)

    order = ["uploading", "processing", "ready"]
    statuses = [entry["status"] for entry in seen]
    assert statuses == sorted(statuses, key=order.index)
    assert set(statuses) == set(order)
    steps = [entry["step"] for entry in seen if entry["status"] == "processing"]
    assert steps == sorted(steps, key=STEP_NAMES.index)
    assert (final["reason"], final["message"], final["upload_status"]) == (None, None, "completed")
    slide_id = uuid.UUID(final["slide_id"])

    row = single(
        database,
        "SELECT label, case_id, format, variant, reader, width, height, level_count, "
        "file_bytes, sha256, original_key, restricted_images, published_at IS NOT NULL "
        f"FROM slides WHERE id = '{slide_id}'",
    )
    original = f"t/{lab.tenant_id}/s/{slide_id}/original.svs"
    assert row == (
        "CMU-1-Small-Region",
        case,
        "aperio-svs",
        "jpeg",
        "openslide",
        2220,
        2967,
        1,
        len(data),
        hashlib.sha256(data).hexdigest(),
        original,
        ["label", "macro"],
        True,
    )
    case_view = api(lab.colleague).get(f"/api/cases/{case}")
    assert case_view.status_code == 200, case_view.text
    assert str(slide_id) in case_view.text

    public = slide_prefix(lab.tenant_id, slide_id)
    assert keys_under(public) == {*PUBLIC_FILES, "original.svs"}
    assert keys_under(restricted_prefix(lab.tenant_id, slide_id)) == {"label.png", "macro.jpg"}
    assert keys_under(f"t/{lab.tenant_id}/quarantine/") == set()
    assert with_store(lambda store: store.get_object(original)) == data

    job = uuid.UUID(final["job_id"])
    assert upload_done_notifications(database, lab.lead) == [("job", job, str(slide_id))]
    assert owner(database, f"SELECT kind FROM jobs WHERE tenant_id = '{lab.tenant_id}'") == [
        ("ingest",)
    ]
    assert owner(database, f"SELECT id FROM result_sets WHERE slide_id = '{slide_id}'") == []
    actions = owner(
        database,
        f"SELECT action FROM audit_events WHERE tenant_id = '{lab.tenant_id}' ORDER BY seq",
    )
    assert ("slide.published",) in actions


@pytest.mark.parametrize(
    ("name", "cut", "reason"),
    [
        ("notes.svs", None, "unknown"),
        ("cut-short.tiff", "synthetic-jpeg.tiff", "truncated"),
    ],
)
def test_a_file_that_is_not_a_usable_slide_fails_with_its_reason(
    api: ApiAs,
    database: str,
    lab: Lab,
    tmp_path: Path,
    name: str,
    cut: str | None,
    reason: str,
) -> None:
    if cut is None:
        data = b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"
    else:
        whole = fixture_path(cut).read_bytes()
        data = whole[: len(whole) * 2 // 3]
    upload = start_upload(api, lab.lead, lab.project, name, len(data))
    send_file(api, lab.lead, upload, data)
    run_worker(database, lab.tenant_id, tmp_path / "work")

    state = status_of(api, lab.lead, upload)
    assert (state["status"], state["reason"], state["slide_id"]) == ("failed", reason, None)
    assert state["message"]
    assert owner(database, f"SELECT id FROM slides WHERE project_id = '{lab.project}'") == []
    assert not exists(upload["key"])
    assert keys_under(f"t/{lab.tenant_id}/s/") == set()
    assert keys_under(f"t/{lab.tenant_id}/restricted/") == set()
    assert upload_done_notifications(database, lab.lead) == []
    assert ("upload.refused",) in owner(
        database, f"SELECT action FROM audit_events WHERE tenant_id = '{lab.tenant_id}'"
    )
    assert list((tmp_path / "work").iterdir()) == []


def start_worker(
    database: str, tenant_id: uuid.UUID, name: str, work_dir: Path
) -> subprocess.Popen[bytes]:
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(TESTS), os.environ.get("PYTHONPATH", "")]),
        "APP_ENV": "test",
        "PARFOCAL_TEST_INGEST_DIR": str(work_dir),
    }
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "parfocal_ingest",
            "--database-url",
            with_database(APP_URL, database),
            "--workflow",
            "workflow_support:SLOW_INGEST",
            "--worker",
            name,
            "--idle-exit",
            "3",
            "--poll",
            "0.2",
            "--workspace",
            str(tenant_id),
        ],
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def wait_for(check: Callable[[], bool], seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
        time.sleep(0.1)
    raise AssertionError("timed out")


def derive_units(database: str, job: str) -> list[tuple[object, ...]]:
    return owner(
        database,
        "SELECT worker, unit FROM job_units "
        f"WHERE job_id = '{job}' AND ordinal = {DERIVE} ORDER BY unit",
    )


def test_a_worker_killed_while_deriving_is_resumed_without_duplicate_outputs(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    data = fixture_path("synthetic-jpeg.tiff").read_bytes()
    upload = start_upload(api, lab.lead, lab.project, "synthetic-jpeg.tiff", len(data))
    send_file(api, lab.lead, upload, data)
    job = status_of(api, lab.lead, upload)["job_id"]
    first = start_worker(database, lab.tenant_id, "worker-a", tmp_path / "a")
    try:
        wait_for(lambda: len(derive_units(database, job)) >= 1, 60)
    finally:
        first.send_signal(signal.SIGKILL)
        first.wait()
    assert status_of(api, lab.lead, upload)["status"] == "processing"
    second = start_worker(database, lab.tenant_id, "worker-b", tmp_path / "b")
    try:
        wait_for(lambda: status_of(api, lab.lead, upload)["status"] == "ready", 60)
        wait_for(
            lambda: single(database, f"SELECT status FROM jobs WHERE id = '{job}'")[0] == "done", 30
        )
    finally:
        second.terminate()
        second.wait()

    units = derive_units(database, job)
    assert sorted(int(str(unit)) for _, unit in units) == [0, 1, 2]
    workers = {str(worker) for worker, _ in units}
    assert workers == {"worker-a", "worker-b"}
    runs = {
        str(name): int(str(count))
        for name, count in owner(
            database, f"SELECT name, runs FROM job_steps WHERE job_id = '{job}' ORDER BY ordinal"
        )
    }
    assert runs["derive"] == 2
    assert all(runs[name] == 1 for name in STEP_NAMES[:DERIVE])
    slide_id = uuid.UUID(status_of(api, lab.lead, upload)["slide_id"])
    assert owner(database, f"SELECT id FROM slides WHERE project_id = '{lab.project}'") == [
        (slide_id,)
    ]
    assert keys_under(slide_prefix(lab.tenant_id, slide_id)) == {*PUBLIC_FILES, "original.tiff"}
    assert keys_under(restricted_prefix(lab.tenant_id, slide_id)) == set()
    assert len(upload_done_notifications(database, lab.lead)) == 1
    assert not (tmp_path / "b" / job).exists()


def test_a_second_slide_with_the_same_name_gets_its_own_label(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    data = fixture_path("synthetic-jpeg.tiff").read_bytes()
    make_slide(database, lab.tenant_id, lab.project, "Biopsy")
    upload = start_upload(api, lab.lead, lab.project, "Biopsy.tiff", len(data))
    send_file(api, lab.lead, upload, data)
    run_worker(database, lab.tenant_id, tmp_path / "work")
    state = status_of(api, lab.lead, upload)
    assert state["status"] == "ready"
    assert single(database, f"SELECT label FROM slides WHERE id = '{state['slide_id']}'") == (
        "Biopsy (2)",
    )


def test_an_aborted_upload_reads_as_failed(api: ApiAs, lab: Lab) -> None:
    upload = start_upload(api, lab.lead, lab.project, "never.svs", 10)
    response = api(lab.lead).delete(
        f"/api/uploads/s3/multipart/{upload['uploadId']}", params={"key": upload["key"]}
    )
    assert response.status_code == 200, response.text
    state = status_of(api, lab.lead, upload)
    assert (state["status"], state["reason"], state["upload_status"]) == (
        "failed",
        "upload-aborted",
        "aborted",
    )


def test_only_the_uploader_reads_the_status(api: ApiAs, database: str, lab: Lab) -> None:
    upload = start_upload(api, lab.lead, lab.project, "mine.svs", 10)
    path = f"/api/uploads/{upload['uploadId']}/status"
    assert api(lab.colleague).get(path).status_code == 404
    other = make_workspace(database, {"stranger": Role.RESEARCHER}).people["stranger"]
    assert api(other).get(path).status_code == 404
    assert api(lab.lead).get(f"/api/uploads/{uuid.uuid4()}/status").status_code == 404


def test_a_stopped_check_reads_as_failed(api: ApiAs, database: str, lab: Lab) -> None:
    data = fixture_path("synthetic-jpeg.tiff").read_bytes()
    upload = start_upload(api, lab.lead, lab.project, "stopped.tiff", len(data))
    send_file(api, lab.lead, upload, data)
    job = status_of(api, lab.lead, upload)["job_id"]
    owner(database, f"UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE id = '{job}'")
    state = status_of(api, lab.lead, upload)
    assert (state["status"], state["reason"], state["slide_id"]) == (
        "failed",
        "check-stopped",
        None,
    )
