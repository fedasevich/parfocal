import asyncio
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from db_support import APP_URL, ApiAs, with_database
from storage_support import TEST_STORAGE, put, with_store
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.db import create_engine
from parfocal_common.jobs import work
from parfocal_common.object_store import ObjectStore
from parfocal_ingest.result_import import result_import_workflow
from parfocal_ingest.workflow import Resources, ingest_workflow


@dataclass(frozen=True)
class Lab:
    tenant_id: uuid.UUID
    lead: MemberPrincipal
    colleague: MemberPrincipal
    project: uuid.UUID


def make_lab(database: str) -> Lab:
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
    def resources() -> Resources:
        return Resources(TEST_STORAGE, work_dir)

    workflows = [ingest_workflow(resources), result_import_workflow(resources)]

    async def go() -> int:
        engine = create_engine(with_database(APP_URL, database))
        try:
            return await work(
                engine,
                workflows,
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
