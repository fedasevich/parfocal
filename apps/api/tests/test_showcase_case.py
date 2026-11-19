import asyncio
import uuid
from collections.abc import AsyncGenerator, Iterator
from contextlib import asynccontextmanager
from typing import Any, cast

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection
from test_showcase import RESULTS, EmptyStore

from parfocal_api.cases import case_detail
from parfocal_api.clinical_reports import get_clinical_report, list_my_cosign_requests
from parfocal_api.principals import MemberPrincipal
from parfocal_api.report_links import EXPIRED, shared_report
from parfocal_api.showcase import WORKSPACES, seed
from parfocal_api.showcase_case import (
    CASE_FILES,
    COSIGN_CASE,
    DRAFT_CASE,
    SHOWCASE_CASE,
    SHOWCASE_TASK,
    THREAD_BODY,
    THREAD_REPLY,
    THREAD_TITLE,
    UPLOADED_FILE,
)
from parfocal_api.tables import CaseReportState, Role, report_links
from parfocal_api.threads import get_thread
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction

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
        requests = await list_my_cosign_requests(owner, connection)
    assert states[SHOWCASE_CASE].state is CaseReportState.SIGNED
    assert len(states[SHOWCASE_CASE].versions) == 1
    assert states[DRAFT_CASE].state is CaseReportState.DRAFT
    assert states[DRAFT_CASE].blockers
    assert states[COSIGN_CASE].state is CaseReportState.SENT
    assert states[COSIGN_CASE].cosigner_user_id == owner.user_id
    assert [request.case_label for request in requests] == [COSIGN_CASE]


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
