import asyncio
import uuid
from collections import deque
from datetime import UTC, datetime, timedelta

import pytest
from case_support import seed_case
from db_support import APP_URL, OWNER_URL, ApiAs, query, with_database
from hypothesis import given
from hypothesis import strategies as st
from sqlalchemy.ext.asyncio import create_async_engine

from parfocal_api.case_states import (
    SIGNING_EVENTS,
    START,
    CaseActor,
    CaseEvent,
    CaseStatus,
    RestoreWindowClosedError,
    WrongActorError,
    WrongStateError,
    advance,
)
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import CaseState, Role
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction

S = CaseState
E = CaseEvent
A = CaseActor
NOW = datetime(2026, 10, 14, 12, tzinfo=UTC)
OPEN = [
    S.WAITING_FOR_SLIDES,
    S.WAITING_FOR_AI,
    S.READY_TO_REVIEW,
    S.IN_REVIEW,
    S.WAITING_ON_OTHERS,
    S.REPORT_DRAFTED,
    S.WITH_SUPERVISOR,
]

ALLOWED: dict[tuple[CaseState, CaseEvent, CaseActor], CaseState] = {
    (S.WAITING_FOR_SLIDES, E.SLIDES_MATCHED, A.SYSTEM): S.WAITING_FOR_AI,
    (S.WAITING_FOR_AI, E.AI_FINISHED, A.SYSTEM): S.READY_TO_REVIEW,
    (S.READY_TO_REVIEW, E.OPENED, A.ASSIGNEE): S.IN_REVIEW,
    (S.IN_REVIEW, E.SUBTASK_OPENED, A.SYSTEM): S.WAITING_ON_OTHERS,
    (S.WAITING_ON_OTHERS, E.SUBTASKS_CLOSED, A.SYSTEM): S.IN_REVIEW,
    (S.IN_REVIEW, E.DRAFT_SAVED, A.ASSIGNEE): S.REPORT_DRAFTED,
    (S.REPORT_DRAFTED, E.SIGNED_OUT, A.ASSIGNEE): S.SIGNED,
    (S.REPORT_DRAFTED, E.SENT_FOR_REVIEW, A.ASSIGNEE): S.WITH_SUPERVISOR,
    (S.WITH_SUPERVISOR, E.CO_SIGNED, A.SUPERVISOR): S.SIGNED,
    (S.WITH_SUPERVISOR, E.RETURNED, A.SUPERVISOR): S.IN_REVIEW,
    (S.SIGNED, E.AMENDMENT_STARTED, A.SIGNER): S.AMENDING,
    (S.SIGNED, E.AMENDMENT_STARTED, A.LEAD): S.AMENDING,
    (S.AMENDING, E.AMENDMENT_SIGNED, A.SIGNER): S.SIGNED,
    (S.AMENDING, E.AMENDMENT_SIGNED, A.LEAD): S.SIGNED,
    **{(state, E.CANCELLED, A.LEAD): S.CANCELLED for state in OPEN},
}


def status_in(state: CaseState) -> CaseStatus:
    if state is S.CANCELLED:
        return CaseStatus(state, S.IN_REVIEW, NOW - timedelta(days=1))
    return CaseStatus(state)


def test_every_transition_and_refusal_follows_the_table() -> None:
    mismatches: list[str] = []
    for state in CaseState:
        for event in CaseEvent:
            for actor in CaseActor:
                key = (state, event, actor)
                state_allows = any((state, event, other) in ALLOWED for other in CaseActor)
                if event is E.RESTORED:
                    expected: object = (
                        S.IN_REVIEW if (state, actor) == (S.CANCELLED, A.LEAD) else None
                    )
                    state_allows = state is S.CANCELLED
                else:
                    expected = ALLOWED.get(key)
                try:
                    outcome: object = advance(status_in(state), event, actor, NOW).state
                except WrongStateError:
                    outcome = "wrong-state"
                except WrongActorError:
                    outcome = "wrong-actor"
                wanted = expected or ("wrong-actor" if state_allows else "wrong-state")
                if outcome != wanted:
                    mismatches.append(f"{state} {event} {actor}: {outcome} != {wanted}")
    assert mismatches == []


def test_restoring_returns_to_the_state_before_cancelling_within_30_days() -> None:
    cancelled = advance(CaseStatus(S.REPORT_DRAFTED), E.CANCELLED, A.LEAD, NOW)
    assert (cancelled.state, cancelled.cancelled_from) == (S.CANCELLED, S.REPORT_DRAFTED)
    later = NOW + timedelta(days=30)
    assert advance(cancelled, E.RESTORED, A.LEAD, later) == CaseStatus(S.REPORT_DRAFTED)
    with pytest.raises(RestoreWindowClosedError):
        advance(cancelled, E.RESTORED, A.LEAD, later + timedelta(seconds=1))


def test_every_state_is_reachable_from_a_new_case() -> None:
    seen = {START}
    queue = deque([status_in(START)])
    while queue:
        status = queue.popleft()
        for event in CaseEvent:
            for actor in CaseActor:
                try:
                    following = advance(status, event, actor, NOW)
                except WrongStateError, WrongActorError:
                    continue
                if following.state not in seen:
                    seen.add(following.state)
                    queue.append(following)
    assert seen == set(CaseState)


def allowed_moves(status: CaseStatus) -> list[tuple[CaseEvent, CaseActor, CaseStatus]]:
    moves: list[tuple[CaseEvent, CaseActor, CaseStatus]] = []
    for event in CaseEvent:
        for actor in CaseActor:
            try:
                moves.append((event, actor, advance(status, event, actor, NOW)))
            except WrongStateError, WrongActorError:
                continue
    return moves


def walk(data: st.DataObject, steps: int) -> list[tuple[CaseStatus, CaseEvent, CaseStatus]]:
    status = status_in(START)
    path: list[tuple[CaseStatus, CaseEvent, CaseStatus]] = []
    for _ in range(steps):
        event, _, following = data.draw(st.sampled_from(allowed_moves(status)))
        path.append((status, event, following))
        status = following
    return path


@given(st.data(), st.integers(min_value=1, max_value=40))
def test_signed_is_only_reached_by_signing(data: st.DataObject, steps: int) -> None:
    for before, event, after in walk(data, steps):
        if after.state is S.SIGNED and before.state is not S.SIGNED:
            assert event in SIGNING_EVENTS
        if event is E.RESTORED:
            assert after.state in OPEN


@given(st.data(), st.integers(min_value=1, max_value=40))
def test_a_signed_case_is_never_cancelled(data: st.DataObject, steps: int) -> None:
    signed_once = False
    for _, _, after in walk(data, steps):
        signed_once = signed_once or after.state is S.SIGNED
        if signed_once:
            assert after.state in {S.SIGNED, S.AMENDING}


def make_tenant(database: str) -> uuid.UUID:
    slug = f"cst-{uuid.uuid4().hex[:10]}"
    rows = query(
        with_database(OWNER_URL, database),
        "WITH organisation AS (INSERT INTO organisations (slug, name) "
        f"VALUES ('{slug}', '{slug}') RETURNING id) "
        "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
        f"SELECT id, '{slug}', '{slug}', 'diagnostic', 'eu', 'pilot' FROM organisation "
        "RETURNING id",
    )
    return uuid.UUID(str(rows[0][0]))


def person(database: str, tenant: uuid.UUID, role: Role) -> MemberPrincipal:
    subject = f"cst-{role}-{uuid.uuid4().hex[:8]}"
    user_id = query(
        with_database(OWNER_URL, database),
        "INSERT INTO users (subject, display_name, initials, avatar_colour) "
        f"VALUES ('{subject}', 'Person', 'PP', 1) RETURNING id",
    )[0][0]
    return MemberPrincipal(subject, tenant, uuid.UUID(str(user_id)), role)


def new_case(database: str, tenant: uuid.UUID) -> uuid.UUID:
    async def go() -> uuid.UUID:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=tenant)) as c:
                return (await seed_case(c, tenant)).case_id
        finally:
            await engine.dispose()

    return asyncio.run(go())


def set_case(database: str, case_id: uuid.UUID, assignments: str) -> None:
    query(
        with_database(OWNER_URL, database), f"UPDATE cases SET {assignments} WHERE id = '{case_id}'"
    )


@pytest.mark.db
def test_a_lead_cancels_and_restores_a_case(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    lead = person(database, tenant, Role.LEAD)
    case_id = new_case(database, tenant)
    set_case(database, case_id, "state = 'in-review'")
    cancelled = api(lead).post(f"/api/cases/{case_id}/cancel")
    assert cancelled.json() == {"id": str(case_id), "state": "cancelled"}
    assert api(lead).post(f"/api/cases/{case_id}/cancel").json()["code"] == "case-wrong-state"
    restored = api(lead).post(f"/api/cases/{case_id}/restore")
    assert restored.json()["state"] == "in-review"
    details = query(
        with_database(OWNER_URL, database),
        f"SELECT details FROM audit_events WHERE target_id = '{case_id}' ORDER BY seq",
    )
    assert [str(row[0]) for row in details] == [
        '{"as":"lead","event":"cancelled","from":"in-review","to":"cancelled"}',
        '{"as":"lead","event":"restored","from":"cancelled","to":"in-review"}',
    ]


@pytest.mark.db
def test_signed_cases_stay_and_old_cancellations_stay_closed(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    lead = person(database, tenant, Role.LEAD)
    signed, old = new_case(database, tenant), new_case(database, tenant)
    set_case(database, signed, "state = 'signed'")
    refused = api(lead).post(f"/api/cases/{signed}/cancel")
    assert (refused.status_code, refused.json()["code"]) == (409, "case-wrong-state")
    set_case(
        database,
        old,
        "state = 'cancelled', cancelled_from = 'in-review', "
        "cancelled_at = now() - interval '31 days'",
    )
    closed = api(lead).post(f"/api/cases/{old}/restore")
    assert (closed.status_code, closed.json()["code"]) == (409, "case-restore-closed")


@pytest.mark.db
def test_only_leads_cancel(api: ApiAs, database: str) -> None:
    tenant = make_tenant(database)
    case_id = new_case(database, tenant)
    for role in (Role.CONSULTANT, Role.LAB, Role.ADMIN):
        assert (
            api(person(database, tenant, role)).post(f"/api/cases/{case_id}/cancel").status_code
            == 403
        )
    with pytest.raises(Exception, match="check constraint"):
        set_case(database, case_id, "state = 'cancelled'")
