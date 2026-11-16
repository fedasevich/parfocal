import asyncio
import uuid
from collections.abc import Mapping
from typing import Any

import pytest
from db_support import APP_URL, with_database
from workspace_support import new_tenant, owner

from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.jobs import Step, StepRun, Workflow, claim, enqueue
from parfocal_common.residency import Placement, Region

pytestmark = pytest.mark.db


async def nothing(_: StepRun) -> Mapping[str, Any] | None:
    return None


def fresh_workflow() -> Workflow:
    return Workflow(kind=f"residency-{uuid.uuid4().hex[:12]}", steps=(Step("only", nothing),))


def tenant_in(database: str, region: Region) -> uuid.UUID:
    tenant_id = new_tenant(database)
    owner(database, f"UPDATE tenants SET region = '{region}' WHERE id = '{tenant_id}'")
    return tenant_id


def queued_job(database: str, workflow: Workflow, tenant_id: uuid.UUID) -> uuid.UUID:
    async def go() -> uuid.UUID:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant_id)) as connection:
                return await enqueue(connection, workflow, tenant_id)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def claimed_by(database: str, workflow: Workflow, placement: Placement) -> uuid.UUID | None:
    async def go() -> uuid.UUID | None:
        engine = create_engine(with_database(APP_URL, database))
        try:
            taken = await claim(
                engine, "residency-worker", {workflow.kind: workflow}, placement=placement
            )
        finally:
            await engine.dispose()
        return None if taken is None else taken[0].job_id

    return asyncio.run(go())


def state_of(database: str, job_id: uuid.UUID) -> tuple[str, int]:
    row = owner(database, f"SELECT status, claims FROM jobs WHERE id = '{job_id}'")[0]
    return str(row[0]), int(str(row[1]))


@pytest.mark.parametrize("queue_region", ["us-east", "us", None, "uk"])
def test_an_eu_job_is_never_scheduled_on_a_queue_outside_the_eu(
    database: str, queue_region: str | None
) -> None:
    workflow = fresh_workflow()
    job_id = queued_job(database, workflow, tenant_in(database, Region.EU))

    taken = claimed_by(database, workflow, Placement(region=queue_region, enforced=True))

    assert taken is None
    assert state_of(database, job_id) == ("queued", 0)


@pytest.mark.parametrize("queue_region", ["eu", "eu-west", "eu-north", "eu-south"])
def test_an_eu_job_runs_on_an_eu_queue(database: str, queue_region: str) -> None:
    workflow = fresh_workflow()
    job_id = queued_job(database, workflow, tenant_in(database, Region.EU))

    taken = claimed_by(database, workflow, Placement(region=queue_region, enforced=True))

    assert taken == job_id


def test_a_us_job_is_left_for_a_us_queue(database: str) -> None:
    workflow = fresh_workflow()
    job_id = queued_job(database, workflow, tenant_in(database, Region.US))

    assert claimed_by(database, workflow, Placement(region="eu-west", enforced=True)) is None
    assert claimed_by(database, workflow, Placement(region="us-east", enforced=True)) == job_id


def test_an_eu_queue_skips_the_older_us_job_and_takes_the_eu_one(database: str) -> None:
    workflow = fresh_workflow()
    queued_job(database, workflow, tenant_in(database, Region.US))
    eu_job = queued_job(database, workflow, tenant_in(database, Region.EU))

    assert claimed_by(database, workflow, Placement(region="eu", enforced=True)) == eu_job


def test_during_the_pilot_an_unpinned_us_queue_still_runs_eu_jobs(database: str) -> None:
    workflow = fresh_workflow()
    job_id = queued_job(database, workflow, tenant_in(database, Region.EU))

    assert claimed_by(database, workflow, Placement(region="us-east")) == job_id
