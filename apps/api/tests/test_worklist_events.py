import asyncio
import uuid
from collections.abc import Sequence

import pytest
from db_support import APP_URL, ApiAs, with_database
from test_review_states import REOPEN
from test_reviewed_layer import Review, review
from workspace_support import owner

from parfocal_api.realtime import RecordedRealtime, RoomEvent
from parfocal_api.worklist_events import job_announcer
from parfocal_common.db import DatabaseScope, async_database_url, create_engine, scoped_transaction
from parfocal_common.jobs import Step, StepRun, Workflow, enqueue, work

pytestmark = pytest.mark.db


class BrokenRealtime(RecordedRealtime):
    async def publish(self, tenant_id: uuid.UUID, rooms: Sequence[str], event: RoomEvent) -> None:
        raise RuntimeError("edge down")


def recorded(api: ApiAs) -> RecordedRealtime:
    live = RecordedRealtime()
    api.app.state.realtime = live
    return live


def tenant_of(database: str, r: Review) -> uuid.UUID:
    return uuid.UUID(
        str(owner(database, f"SELECT tenant_id FROM projects WHERE id = '{r.project}'")[0][0])
    )


def rooms(r: Review, *labels: str) -> list[str]:
    return sorted(f"user:{r.people[label].user_id}" for label in labels)


def worklist(**ids: uuid.UUID) -> dict[str, object]:
    return {"kind": "worklist.changed", "ids": {name: str(value) for name, value in ids.items()}}


def test_a_new_task_reaches_its_creator_and_reviewers(api: ApiAs, database: str) -> None:
    live = recorded(api)
    r = review(api, database)
    assert live.published == [
        (tenant_of(database, r), rooms(r, "owner", "first", "second"), worklist(task=r.task))
    ]


def test_an_added_reviewer_hears_about_the_task(api: ApiAs, database: str) -> None:
    r = review(api, database)
    live = recorded(api)
    added = api(r.people["owner"]).post(
        f"/api/review-tasks/{r.task}/reviewers", json={"user_id": str(r.people["third"].user_id)}
    )
    assert added.status_code == 201, added.text
    assert live.published == [
        (
            tenant_of(database, r),
            rooms(r, "owner", "first", "second", "third"),
            worklist(task=r.task),
        )
    ]


def test_reviewer_progress_reaches_the_reviewer_and_the_creator(api: ApiAs, database: str) -> None:
    r = review(api, database)
    live = recorded(api)
    submitted = api(r.people["first"]).post(f"{r.base}/submit")
    assert submitted.status_code == 200, submitted.text
    reopened = api(r.people["first"]).post(f"{r.base}/reopen")
    assert reopened.status_code == 200, reopened.text
    progress = (
        tenant_of(database, r),
        rooms(r, "owner", "first"),
        worklist(task=r.task, slide=r.slide),
    )
    assert live.published == [progress, progress]


def test_a_status_change_reaches_everyone_on_the_task(api: ApiAs, database: str) -> None:
    r = review(api, database)
    for label in ("first", "second"):
        assert api(r.people[label]).post(f"{r.base}/submit").status_code == 200
    live = recorded(api)
    task = f"/api/review-tasks/{r.task}"
    signed = api(r.people["owner"]).post(f"{task}/sign-off")
    assert signed.status_code == 200, signed.text
    assert api(r.people["owner"]).post(f"{task}/reopen", json=REOPEN).status_code == 200
    renamed = api(r.people["owner"]).patch(task, json={"name": "Renamed task"})
    assert renamed.status_code == 200, renamed.text
    everyone = (
        tenant_of(database, r),
        rooms(r, "owner", "first", "second"),
        worklist(task=r.task),
    )
    assert live.published == [everyone, everyone, everyone]


def test_a_finished_job_reaches_the_people_on_its_task(api: ApiAs, database: str) -> None:
    r = review(api, database)
    tenant = tenant_of(database, r)
    live = RecordedRealtime()

    async def nothing(step: StepRun) -> None:
        return None

    workflow = Workflow(kind="worklist-test", steps=[Step("nothing", nothing)])

    async def go() -> uuid.UUID:
        engine = create_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as connection:
                job = await enqueue(
                    connection, workflow, tenant, r.project, {"task_id": str(r.task)}
                )
            await work(
                engine,
                [workflow],
                "test",
                idle_exit_seconds=0.2,
                poll_seconds=0.1,
                tenant_id=tenant,
                on_finished=job_announcer(engine, live),
            )
            return job
        finally:
            await engine.dispose()

    job = asyncio.run(go())
    assert live.published == [
        (tenant, rooms(r, "owner", "first", "second"), worklist(job=job, task=r.task))
    ]


def test_a_failed_publish_does_not_fail_the_request(api: ApiAs, database: str) -> None:
    r = review(api, database)
    api.app.state.realtime = BrokenRealtime()
    submitted = api(r.people["first"]).post(f"{r.base}/submit")
    assert submitted.status_code == 200, submitted.text
    stored = owner(
        database,
        "SELECT count(*) FROM review_assignments "
        f"WHERE task_id = '{r.task}' AND submitted_at IS NOT NULL",
    )
    assert stored == [(1,)]
