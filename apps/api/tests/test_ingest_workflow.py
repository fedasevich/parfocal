import asyncio
import os
import signal
import subprocess
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from sqlalchemy.ext.asyncio import AsyncConnection
from workflow_support import FAILING, SLOW, TILES
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.tables import Role
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.jobs import Workflow, enqueue, work

pytestmark = pytest.mark.db

TESTS = Path(__file__).resolve().parent


def run[T](database: str, work_on: Callable[[Any], Awaitable[T]]) -> T:
    async def go() -> T:
        engine = create_engine(with_database(APP_URL, database))
        try:
            return await work_on(engine)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def queue(database: str, workflow: Workflow, tenant: uuid.UUID, project: uuid.UUID) -> uuid.UUID:
    async def go(engine: Any) -> uuid.UUID:
        scope = DatabaseScope(tenant_id=tenant)
        async with scoped_transaction(engine, scope) as connection:
            return await enqueue(connection, workflow, tenant, project, {"file": "upload-1"})

    return run(database, go)


def setup(database: str) -> tuple[Any, uuid.UUID]:
    lead = make_workspace(database, {"lead": Role.RESEARCHER}).people["lead"]
    project = make_project(database, lead.tenant_id)
    join_project(database, project, lead, "owner")
    return lead, project


def start_worker(database: str, name: str) -> subprocess.Popen[bytes]:
    env = {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(TESTS), os.environ.get("PYTHONPATH", "")]),
        "APP_ENV": "test",
    }
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "parfocal_ingest",
            "--database-url",
            with_database(APP_URL, database),
            "--workflow",
            "workflow_support:SLOW",
            "--worker",
            name,
            "--idle-exit",
            "3",
            "--poll",
            "0.2",
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


def units_by(database: str, job: uuid.UUID) -> dict[str, list[int]]:
    rows = owner(
        database, f"SELECT worker, unit FROM job_units WHERE job_id = '{job}' ORDER BY unit"
    )
    found: dict[str, list[int]] = {}
    for worker, unit in rows:
        found.setdefault(str(worker), []).append(int(str(unit)))
    return found


def test_a_killed_worker_is_resumed_without_duplicate_outputs(database: str) -> None:
    lead, project = setup(database)
    job = queue(database, SLOW, lead.tenant_id, project)
    first = start_worker(database, "worker-a")
    try:
        wait_for(lambda: len(units_by(database, job).get("worker-a", [])) >= 6, 30)
    finally:
        first.send_signal(signal.SIGKILL)
        first.wait()
    second = start_worker(database, "worker-b")
    try:
        wait_for(
            lambda: owner(database, f"SELECT status FROM jobs WHERE id = '{job}'")[0][0] == "done",
            40,
        )
    finally:
        second.terminate()
        second.wait()
    units = units_by(database, job)
    written = units.get("worker-a", []) + units.get("worker-b", [])
    assert sorted(written) == list(range(TILES))
    assert units["worker-a"] == list(range(len(units["worker-a"])))
    steps = owner(
        database,
        f"SELECT name, status, runs FROM job_steps WHERE job_id = '{job}' ORDER BY ordinal",
    )
    assert steps == [("scan", "done", 1), ("derive", "done", 2), ("publish", "done", 1)]
    claims = owner(database, f"SELECT claims, claimed_by FROM jobs WHERE id = '{job}'")
    assert claims == [(2, "worker-b")]


def run_inline(database: str, workflows: list[Workflow]) -> int:
    async def go(engine: Any) -> int:
        return await work(engine, workflows, "inline", idle_exit_seconds=0.3, poll_seconds=0.1)

    return run(database, go)


def test_a_failed_step_stops_the_job_with_its_code(api: ApiAs, database: str) -> None:
    lead, project = setup(database)
    job = queue(database, FAILING, lead.tenant_id, project)
    run_inline(database, [FAILING])
    body = api(lead).get(f"/api/projects/{project}/jobs/{job}").json()
    assert (body["status"], body["error_code"]) == ("failed", "unreadable-file")
    assert [step["status"] for step in body["steps"]] == ["done", "failed", "pending"]


def test_jobs_stay_in_their_workspace_and_project(api: ApiAs, database: str) -> None:
    lead, project = setup(database)
    other_lead, other_project = setup(database)
    job = queue(database, SLOW, lead.tenant_id, project)
    assert api(other_lead).get(f"/api/projects/{project}/jobs/{job}").status_code in {403, 404}
    second_project = make_project(database, lead.tenant_id)
    join_project(database, second_project, lead, "owner")
    assert api(lead).get(f"/api/projects/{second_project}/jobs/{job}").status_code == 404

    async def visible(engine: Any) -> int:
        scope = DatabaseScope(tenant_id=other_lead.tenant_id)
        async with scoped_transaction(engine, scope) as connection:
            assert isinstance(connection, AsyncConnection)
            return len((await connection.exec_driver_sql("SELECT id FROM jobs")).all())

    assert run(database, visible) == 0
    assert other_project != project
