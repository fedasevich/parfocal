import asyncio
import uuid
from collections.abc import AsyncGenerator, Iterator
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from typing import Any, cast

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from fastapi import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection
from test_showcase import RESULTS, EmptyStore

from parfocal_api.adjudications import list_my_adjudications
from parfocal_api.cases import case_detail
from parfocal_api.clinical_reports import (
    CaseReportSignOut,
    get_clinical_report,
    list_my_cosign_requests,
    sign_clinical_report,
)
from parfocal_api.disagreement_queue import (
    AdjudicationAnswer,
    decide_adjudication,
    get_my_adjudication,
)
from parfocal_api.disagreements import is_open, queue_of
from parfocal_api.my_jobs import MyJobKind, list_my_jobs
from parfocal_api.my_work import list_my_review_tasks
from parfocal_api.principals import MemberPrincipal
from parfocal_api.projects import current_role
from parfocal_api.report_links import EXPIRED, shared_report
from parfocal_api.showcase import WORKSPACES, seed
from parfocal_api.showcase_case import (
    AGENT_UPLOAD_CASE,
    BROKEN_SLIDE,
    CASE_FILES,
    COSIGN_CASE,
    DRAFT_CASE,
    SHOWCASE_CASE,
    SHOWCASE_TASK,
    THREAD_BODY,
    THREAD_REPLY,
    THREAD_TITLE,
    UPLOADED_FILE,
    seed_http,
)
from parfocal_api.showcase_reviews import QUEUE_TASK
from parfocal_api.tables import (
    CaseReportState,
    ProjectRole,
    Role,
    TaskKind,
    report_links,
    review_tasks,
)
from parfocal_api.threads import get_thread
from parfocal_api.tile_access import SlideFileNotFoundError, get_tile_access
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.jobs import JobStatus

pytestmark = pytest.mark.db

OWNER = "owner@example.test"
AGENT = "agent-case@example.test"


@pytest.fixture(scope="module")
def showcase() -> Iterator[str]:
    with migrated_database() as name:
        url = with_database(OWNER_URL, name)
        asyncio.run(
            seed(
                url,
                EmptyStore(),  # type: ignore[arg-type]
                RESULTS,  # type: ignore[arg-type]
                OWNER,
                agent_emails=[AGENT],
            )
        )
        yield url


async def member(url: str, email: str) -> MemberPrincipal:
    tenant_id, user_id = (
        await run_sql(
            url,
            "SELECT w.id, u.id FROM tenants w JOIN memberships m ON m.tenant_id = w.id "
            f"JOIN users u ON u.id = m.user_id WHERE w.slug = '{WORKSPACES[0].slug}' "
            f"AND u.email = '{email}'",
        )
    )[0]
    return MemberPrincipal(
        f"seed:{email}", uuid.UUID(str(tenant_id)), uuid.UUID(str(user_id)), Role.RESEARCHER, True
    )


async def case_ids(url: str, tenant_id: uuid.UUID) -> dict[str, tuple[uuid.UUID, uuid.UUID]]:
    rows = await run_sql(
        url,
        f"SELECT c.label, c.id, c.project_id FROM cases c WHERE c.tenant_id = '{tenant_id}' "
        f"AND c.label IN ('{SHOWCASE_CASE}', '{DRAFT_CASE}', '{COSIGN_CASE}')",
    )
    return {str(row[0]): (uuid.UUID(str(row[1])), uuid.UUID(str(row[2]))) for row in rows}


@asynccontextmanager
async def as_member(url: str, principal: MemberPrincipal) -> AsyncGenerator[AsyncConnection]:
    engine = create_engine(url)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=principal.tenant_id, user_id=principal.user_id)
        ) as connection:
            yield connection
    finally:
        await engine.dispose()


class RolledBackError(Exception):
    pass


@asynccontextmanager
async def rolled_back(url: str, principal: MemberPrincipal) -> AsyncGenerator[AsyncConnection]:
    try:
        async with as_member(url, principal) as connection:
            yield connection
            raise RolledBackError
    except RolledBackError:
        pass


async def test_the_owner_and_an_agent_open_the_case_with_its_gallery_slides(showcase: str) -> None:
    for email in (OWNER, AGENT):
        principal = await member(showcase, email)
        case_id, _ = (await case_ids(showcase, principal.tenant_id))[SHOWCASE_CASE]
        async with as_member(showcase, principal) as connection:
            detail = await case_detail(connection, cast("Any", None), principal, case_id)
        assert sorted(slide.label for slide in detail.slides) == sorted(CASE_FILES)
        assert [specimen.letter for specimen in detail.specimens] == ["A"]


async def test_every_case_slide_carries_ai_results(showcase: str) -> None:
    owner = await member(showcase, OWNER)
    case_id, _ = (await case_ids(showcase, owner.tenant_id))[SHOWCASE_CASE]
    rows = await run_sql(
        showcase,
        "SELECT s.label, count(r.id) FROM slides s JOIN result_sets r ON r.slide_id = s.id "
        f"WHERE s.case_id = '{case_id}' AND r.status = 'ready' GROUP BY s.label",
    )
    assert {str(row[0]) for row in rows} == set(CASE_FILES)


async def test_the_case_holds_a_signed_a_drafted_and_a_sent_report(showcase: str) -> None:
    owner = await member(showcase, OWNER)
    found = await case_ids(showcase, owner.tenant_id)
    async with as_member(showcase, owner) as connection:
        states = {
            label: (await get_clinical_report(project_id, case_id, owner, connection))
            for label, (case_id, project_id) in found.items()
        }
    assert states[SHOWCASE_CASE].state is CaseReportState.SIGNED
    assert len(states[SHOWCASE_CASE].versions) == 1
    assert states[DRAFT_CASE].state is CaseReportState.DRAFT
    assert states[DRAFT_CASE].blockers
    assert states[COSIGN_CASE].state is CaseReportState.SENT


async def test_the_agent_project_owner_co_signs_the_sent_report(showcase: str) -> None:
    agent = await member(showcase, AGENT)
    case_id, project_id = (await case_ids(showcase, agent.tenant_id))[COSIGN_CASE]
    async with rolled_back(showcase, agent) as connection:
        assert await current_role(connection, project_id, agent.user_id) is ProjectRole.OWNER
        requests = await list_my_cosign_requests(agent, connection)
        assert [request.case_label for request in requests] == [COSIGN_CASE] * len(WORKSPACES)
        sent = await get_clinical_report(project_id, case_id, agent, connection)
        assert sent.cosigner_user_id == agent.user_id
        signed = await sign_clinical_report(
            project_id,
            case_id,
            agent,
            connection,
            signed_in=datetime.now(UTC),
            confirmation=CaseReportSignOut(confirmed_with="password"),
        )
        assert signed.state is CaseReportState.SIGNED


async def test_a_comment_thread_with_a_reply_sits_on_a_case_slide(showcase: str) -> None:
    owner = await member(showcase, OWNER)
    case_id, _ = (await case_ids(showcase, owner.tenant_id))[SHOWCASE_CASE]
    task_id, slide_id, thread_id = (
        await run_sql(
            showcase,
            "SELECT t.task_id, t.slide_id, t.id FROM threads t JOIN slides s ON s.id = t.slide_id "
            f"WHERE s.case_id = '{case_id}' AND t.title = '{THREAD_TITLE}'",
        )
    )[0]
    async with as_member(showcase, owner) as connection:
        thread = await get_thread(
            uuid.UUID(str(task_id)),
            uuid.UUID(str(slide_id)),
            uuid.UUID(str(thread_id)),
            owner,
            connection,
        )
    assert {message.body for message in thread.messages} == {THREAD_BODY, THREAD_REPLY}
    assert len({message.author_id for message in thread.messages}) == 2


async def test_an_uploaded_slide_landed_in_the_case(showcase: str) -> None:
    owner = await member(showcase, OWNER)
    case_id, _ = (await case_ids(showcase, owner.tenant_id))[SHOWCASE_CASE]
    rows = await run_sql(
        showcase,
        "SELECT u.status, s.label FROM uploads u JOIN slides s ON s.upload_id = u.id "
        f"WHERE u.case_id = '{case_id}' AND s.case_id = '{case_id}'",
    )
    assert [(str(row[0]), str(row[1])) for row in rows] == [("completed", UPLOADED_FILE)]


async def test_a_shared_report_link_opens_the_case_review(showcase: str) -> None:
    owner = await member(showcase, OWNER)
    async with as_member(showcase, owner) as connection:
        links = (
            await connection.execute(
                select(*report_links.c, EXPIRED).where(report_links.c.tenant_id == owner.tenant_id)
            )
        ).all()
        shared = [await shared_report(connection, row) for row in links]
    assert [report.task_name for report in shared] == [SHOWCASE_TASK]


async def test_the_agent_has_a_review_and_an_annotate_task(showcase: str) -> None:
    agent = await member(showcase, AGENT)
    async with as_member(showcase, agent) as connection:
        mine = await list_my_review_tasks(agent, connection)
        kinds = await connection.scalars(
            select(review_tasks.c.kind).where(review_tasks.c.id.in_([task.id for task in mine]))
        )
        found = sorted(TaskKind(kind) for kind in kinds.all())
    assert TaskKind.REVIEW in found
    assert TaskKind.ANNOTATE in found


async def test_the_agent_reads_the_signed_case_report(showcase: str) -> None:
    agent = await member(showcase, AGENT)
    case_id, project_id = (await case_ids(showcase, agent.tenant_id))[SHOWCASE_CASE]
    async with as_member(showcase, agent) as connection:
        report = await get_clinical_report(project_id, case_id, agent, connection)
    assert report.state is CaseReportState.SIGNED


async def test_the_agent_finds_a_finished_upload_job_with_its_slide(showcase: str) -> None:
    agent = await member(showcase, AGENT)
    async with as_member(showcase, agent) as connection:
        jobs = await list_my_jobs(agent, connection)
    assert [(job.kind, job.status, job.percent) for job in jobs] == [
        (MyJobKind.UPLOAD, JobStatus.DONE, 100)
    ] * len(WORKSPACES)
    assert [slide.label for job in jobs for slide in job.slides] == [UPLOADED_FILE] * len(
        WORKSPACES
    )
    case_id, _ = (await case_ids(showcase, agent.tenant_id))[AGENT_UPLOAD_CASE]
    listed = ", ".join(f"'{slide.id}'" for job in jobs for slide in job.slides)
    rows = await run_sql(
        showcase,
        f"SELECT count(*) FROM slides WHERE id IN ({listed}) AND case_id = '{case_id}'",
    )
    assert rows[0][0] == 1


async def test_a_seeded_slide_fails_to_open_for_the_agent(showcase: str) -> None:
    agent = await member(showcase, AGENT)
    slide_id = (
        await run_sql(
            showcase,
            f"SELECT id FROM slides WHERE tenant_id = '{agent.tenant_id}' "
            f"AND label = '{BROKEN_SLIDE}'",
        )
    )[0][0]
    async with as_member(showcase, agent) as connection:
        with pytest.raises(SlideFileNotFoundError):
            await get_tile_access(
                uuid.UUID(str(slide_id)),
                seed_http(),
                Response(),
                agent,
                connection,
                cast("Any", None),
                cast("Any", None),
            )


async def test_the_signed_off_review_has_a_signed_evaluation_report(showcase: str) -> None:
    owner = await member(showcase, OWNER)
    rows = await run_sql(
        showcase,
        "SELECT t.signed_off_at IS NOT NULL, v.signed_at IS NOT NULL, v.number "
        "FROM review_tasks t JOIN evaluation_versions v ON v.task_id = t.id "
        f"WHERE t.tenant_id = '{owner.tenant_id}' AND t.name = 'Signed-off review'",
    )
    assert [tuple(row) for row in rows] == [(True, True, 1)]


async def test_an_agent_adjudicates_the_seeded_disagreement_queue(showcase: str) -> None:
    agent = await member(showcase, AGENT)
    task_id = uuid.UUID(
        str(
            (
                await run_sql(
                    showcase,
                    f"SELECT id FROM review_tasks WHERE tenant_id = '{agent.tenant_id}' "
                    f"AND name = '{QUEUE_TASK}'",
                )
            )[0][0]
        )
    )
    pending = await run_sql(
        showcase,
        "SELECT count(*) FROM review_assignments "
        f"WHERE task_id = '{task_id}' AND submitted_at IS NULL",
    )
    assert pending[0][0] == 0
    async with rolled_back(showcase, agent) as connection:
        queue = await queue_of(connection, task_id)
        assert len(queue) == 2
        assert all(is_open(item) for item in queue)
        sent = [item for item in queue if item.adjudication is not None]
        assert [item.adjudication.adjudicator_user_id for item in sent if item.adjudication] == [
            agent.user_id
        ]
        mine = await list_my_adjudications(agent, connection)
        assert (task_id, QUEUE_TASK) in [(item.task_id, item.task_name) for item in mine]
        shown = await get_my_adjudication(task_id, agent, connection, RESULTS)  # type: ignore[arg-type]
        assert [(item.slide_id, item.object) for item in shown.objects] == [
            (sent[0].slide_id, sent[0].object)
        ]
        decided = await decide_adjudication(
            task_id,
            sent[0].slide_id,
            sent[0].object,
            AdjudicationAnswer(raw="agree"),
            agent,
            connection,
            RESULTS,  # type: ignore[arg-type]
        )
        assert decided.decision == "agree"
