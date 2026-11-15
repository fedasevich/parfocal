import asyncio
import uuid
from collections.abc import Awaitable, Callable

import pytest
from db_support import APP_URL, ApiAs, with_database
from sqlalchemy import delete
from workspace_support import (
    give_security_contact,
    make_case,
    make_project,
    make_slide,
    make_workspace,
)

from parfocal_api.audit import Actor, AuditAction, AuditTarget, record
from parfocal_api.principals import MemberPrincipal
from parfocal_api.security_alerts import (
    TARGET_TABLES,
    UNCHECKED_TARGETS,
    CrossWorkspaceEvent,
    CrossWorkspaceWatch,
)
from parfocal_api.tables import ActorKind, Role, slides
from parfocal_common.alerting import OnCall
from parfocal_common.clients import MemoryEmailSender
from parfocal_common.db import async_database_url, create_engine, tenant_transaction

PAGES = "pages@example.test"


def test_every_audit_target_is_checked_or_exempt_with_a_reason() -> None:
    assert set(TARGET_TABLES).isdisjoint(UNCHECKED_TARGETS)
    assert set(TARGET_TABLES) | set(UNCHECKED_TARGETS) == set(AuditTarget)
    assert all("tenant_id" in table.c and "id" in table.c for table in TARGET_TABLES.values())
    assert all(reason for reason in UNCHECKED_TARGETS.values())


def watched[T](
    database: str, outbox: MemoryEmailSender, body: Callable[[CrossWorkspaceWatch], Awaitable[T]]
) -> T:
    async def go() -> T:
        engine = create_engine(async_database_url(with_database(APP_URL, database)))
        try:
            return await body(CrossWorkspaceWatch(engine, OnCall(outbox, PAGES, PAGES)))
        finally:
            await engine.dispose()

    return asyncio.run(go())


def forge_cross_workspace_open(
    watch: CrossWorkspaceWatch, reader: MemberPrincipal, slide_id: uuid.UUID
) -> Awaitable[None]:
    async def go() -> None:
        async with tenant_transaction(watch.engine, reader.tenant_id) as connection:
            await record(
                connection,
                Actor(ActorKind.MEMBER, reader.subject),
                AuditAction.SLIDE_OPENED,
                AuditTarget.SLIDE,
                slide_id,
                tenant_id=reader.tenant_id,
            )

    return go()


@pytest.mark.db
def test_an_audit_event_that_reaches_another_workspace_pages_on_call(
    api: ApiAs, database: str
) -> None:
    a = make_workspace(database, {"reviewer": Role.REVIEWER})
    b = make_workspace(database, {"owner": Role.RESEARCHER})
    b_project = make_project(database, b.tenant_id)
    b_case = make_case(database, b.tenant_id, b_project, "S26-9")
    b_slide = make_slide(database, b.tenant_id, b_project, "S26-9 A1", b_case)
    a_project = make_project(database, a.tenant_id)
    a_slide = make_slide(database, a.tenant_id, a_project, "S26-1 A1")
    reader = a.people["reviewer"]
    outbox = MemoryEmailSender()
    mine = {a.tenant_id, b.tenant_id}

    async def drill(watch: CrossWorkspaceWatch) -> list[list[CrossWorkspaceEvent]]:
        quiet = await watch.check()
        async with tenant_transaction(watch.engine, reader.tenant_id) as connection:
            await record(
                connection,
                Actor(ActorKind.MEMBER, reader.subject),
                AuditAction.SLIDE_OPENED,
                AuditTarget.SLIDE,
                a_slide,
                tenant_id=reader.tenant_id,
            )
        still_quiet = await watch.check()
        await forge_cross_workspace_open(watch, reader, b_slide)
        caught = await watch.check()
        again = await watch.check()
        return [quiet, still_quiet, caught, again]

    quiet, still_quiet, caught, again = watched(database, outbox, drill)

    assert [event for event in quiet + still_quiet if event.tenant_id in mine] == []
    [event] = [event for event in caught if event.tenant_id in mine]
    assert event.tenant_id == a.tenant_id
    assert event.target_type == "slide"
    assert event.target_id == b_slide
    assert [event for event in again if event.tenant_id in mine] == []
    [message] = [m for m in outbox.sent if str(a.tenant_id) in m.subject]
    assert message.to == PAGES
    assert message.subject.startswith("[page] security:cross-workspace:")
    assert "S26-9" not in message.text
    assert reader.subject not in message.text


@pytest.mark.db
def test_ordinary_workspace_activity_raises_no_security_alert(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, {"owner": Role.RESEARCHER}, admins={"owner"})
    give_security_contact(database, workspace.tenant_id)
    owner = api(workspace.people["owner"])
    project = owner.post("/api/projects", json={"name": "Watch", "privacy_mode": "clinical"})
    assert project.status_code == 201, project.text
    case = owner.post(
        "/api/cases",
        json={
            "project_id": project.json()["id"],
            "label": "S26-3",
            "patient": {"name": "Eva Testová"},
        },
    )
    assert case.status_code == 201, case.text
    opened = owner.get(f"/api/cases/{case.json()['id']}")
    assert opened.status_code == 200, opened.text
    outbox = MemoryEmailSender()

    async def check(watch: CrossWorkspaceWatch) -> list[CrossWorkspaceEvent]:
        return await watch.check()

    raised = watched(database, outbox, check)
    assert [event for event in raised if event.tenant_id == workspace.tenant_id] == []


@pytest.mark.db
def test_a_target_removed_with_its_removal_event_stays_quiet(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, {"reviewer": Role.REVIEWER})
    project = make_project(database, workspace.tenant_id)
    gone = make_slide(database, workspace.tenant_id, project, "S26-4 A1")
    reader = workspace.people["reviewer"]
    outbox = MemoryEmailSender()

    async def drill(watch: CrossWorkspaceWatch) -> list[CrossWorkspaceEvent]:
        await watch.check()
        async with tenant_transaction(watch.engine, reader.tenant_id) as connection:
            await record(
                connection,
                Actor(ActorKind.MEMBER, reader.subject),
                AuditAction.SLIDE_OPENED,
                AuditTarget.SLIDE,
                gone,
                tenant_id=reader.tenant_id,
            )
            removed = await connection.execute(delete(slides).where(slides.c.id == gone))
            assert removed.rowcount == 1
            await record(
                connection,
                Actor(ActorKind.SYSTEM),
                AuditAction.RETENTION_PURGED,
                AuditTarget.SLIDE,
                gone,
                tenant_id=reader.tenant_id,
            )
        return await watch.check()

    raised = watched(database, outbox, drill)
    assert [event for event in raised if event.tenant_id == workspace.tenant_id] == []
