import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from fastapi import BackgroundTasks
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.adjudications import AdjudicationDraft, ObjectRef, send_to_adjudicator
from parfocal_api.disagreements import is_open, queue_of
from parfocal_api.principals import MemberPrincipal
from parfocal_api.seed_request import seed_request
from parfocal_api.showcase_accounts import SeededAccount, seat_accounts
from parfocal_api.showcase_reviews import DRAWN_TASK, QUEUE_TASK, review_task
from parfocal_api.tables import (
    DecisionStyle,
    ProjectRole,
    Role,
    TaskKind,
    adjudications,
    memberships,
    projects,
    review_task_slides,
    review_tasks,
    users,
)
from parfocal_common.db import DatabaseScope, scoped_transaction
from parfocal_common.result_store import ResultStore

RESEARCHER = "researcher"
REVIEWER = "reviewer"
ADJUDICATOR = "adjudicator"
VIEWER = "viewer"
ANNOTATOR = "annotator"
ROLE_SEATS = {
    RESEARCHER: (Role.RESEARCHER, ProjectRole.OWNER),
    REVIEWER: (Role.REVIEWER, ProjectRole.REVIEWER),
    ADJUDICATOR: (Role.REVIEWER, ProjectRole.REVIEWER),
    VIEWER: (Role.REVIEWER, ProjectRole.VIEWER),
    ANNOTATOR: (Role.REVIEWER, ProjectRole.REVIEWER),
}
ROLE_REVIEW = "Role account review"
ROLE_ANNOTATE = "Role account annotation"
ROLE_TASK_SLIDES = 2
ADJUDICATED_TASKS = (QUEUE_TASK, DRAWN_TASK)
GALLERY_TOUR = "Format gallery tour"


class UnknownRoleError(ValueError):
    pass


@dataclass(frozen=True)
class RoleEmail:
    role: str
    email: str


def role_emails_of(text: str) -> list[RoleEmail]:
    found: list[RoleEmail] = []
    for part in text.replace(";", ",").split(","):
        role, separator, email = part.strip().partition("=")
        if not separator:
            continue
        role, email = role.strip().lower(), email.strip().lower()
        if role not in ROLE_SEATS:
            raise UnknownRoleError(f"{role} is not a seeded role, use one of {sorted(ROLE_SEATS)}")
        if email:
            found.append(RoleEmail(role, email))
    return found


def display_name(entry: RoleEmail) -> str:
    local = entry.email.partition("@")[0].removeprefix("role-")
    return " ".join(word.capitalize() for word in local.replace("_", "-").split("-") if word)


def account_of(entry: RoleEmail) -> SeededAccount:
    name = display_name(entry) or entry.role.capitalize()
    words = name.split()
    initials = (words[0][0] + (words[-1][0] if len(words) > 1 else words[0][1:2])).upper()
    role, project_role = ROLE_SEATS[entry.role]
    return SeededAccount(name, initials, role, False, project_role)


async def seat_roles(
    engine: Any, tenant_ids: Sequence[uuid.UUID], entries: Sequence[RoleEmail]
) -> None:
    for entry in entries:
        await seat_accounts(engine, tenant_ids, [entry.email], account_of(entry))


async def role_ids(
    engine: Any, tenant_id: uuid.UUID, entries: Sequence[RoleEmail]
) -> dict[str, list[uuid.UUID]]:
    if not entries:
        return {}
    async with scoped_transaction(engine, DatabaseScope(platform=True, auth=True)) as connection:
        rows = await connection.execute(
            select(users.c.id, func.lower(users.c.email).label("email"))
            .join(memberships, memberships.c.user_id == users.c.id)
            .where(
                memberships.c.tenant_id == tenant_id,
                func.lower(users.c.email).in_([entry.email for entry in entries]),
            )
        )
        by_email = {row.email: row.id for row in rows}
    found: dict[str, list[uuid.UUID]] = {}
    for entry in entries:
        if entry.email in by_email:
            found.setdefault(entry.role, []).append(by_email[entry.email])
    return found


async def task_named(
    connection: AsyncConnection, project_id: uuid.UUID, name: str
) -> uuid.UUID | None:
    return await connection.scalar(
        select(review_tasks.c.id).where(
            review_tasks.c.project_id == project_id, review_tasks.c.name == name
        )
    )


async def tour_sets(
    connection: AsyncConnection, project_id: uuid.UUID
) -> dict[uuid.UUID, uuid.UUID | None]:
    tour = await task_named(connection, project_id, GALLERY_TOUR)
    if tour is None:
        return {}
    rows = await connection.execute(
        select(review_task_slides.c.slide_id, review_task_slides.c.result_set_id)
        .where(review_task_slides.c.task_id == tour)
        .order_by(review_task_slides.c.position)
        .limit(ROLE_TASK_SLIDES)
    )
    return {row.slide_id: row.result_set_id for row in rows}


async def role_task(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    name: str,
    people: list[uuid.UUID],
    kind: TaskKind,
) -> None:
    if not people or await task_named(connection, project_id, name) is not None:
        return
    sets = await tour_sets(connection, project_id)
    if not sets:
        return
    reviewing = kind is TaskKind.REVIEW
    await review_task(
        connection,
        creator,
        results,
        project_id,
        name,
        sets if reviewing else dict.fromkeys(sets),
        people,
        DecisionStyle.AGREE if reviewing else DecisionStyle.CERTAINTY,
        kind,
    )


async def send_open_object(
    connection: AsyncConnection, creator: MemberPrincipal, adjudicator: uuid.UUID
) -> None:
    for name in ADJUDICATED_TASKS:
        task_id = await connection.scalar(
            select(review_tasks.c.id).where(
                review_tasks.c.tenant_id == creator.tenant_id,
                review_tasks.c.name == name,
                review_tasks.c.signed_off_at.is_(None),
            )
        )
        if task_id is None:
            continue
        mine = await connection.scalar(
            select(adjudications.c.id)
            .where(
                adjudications.c.task_id == task_id,
                adjudications.c.adjudicator_user_id == adjudicator,
            )
            .limit(1)
        )
        if mine is not None:
            return
        free = [
            item
            for item in await queue_of(connection, task_id)
            if is_open(item) and not item.looking_again and item.adjudication is None
        ]
        if not free:
            continue
        await send_to_adjudicator(
            task_id,
            AdjudicationDraft(
                adjudicator_user_id=adjudicator,
                objects=[ObjectRef(slide_id=free[0].slide_id, object=free[0].object)],
            ),
            creator,
            connection,
            seed_request(),
            BackgroundTasks(),
        )
        return


async def seed_role_work(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    results: ResultStore,
    gallery: str,
    seats: dict[str, list[uuid.UUID]],
) -> None:
    if not seats:
        return
    project_id = await connection.scalar(
        select(projects.c.id).where(
            projects.c.tenant_id == creator.tenant_id, projects.c.name == gallery
        )
    )
    if project_id is not None:
        await role_task(
            connection,
            creator,
            results,
            project_id,
            ROLE_REVIEW,
            seats.get(REVIEWER, []),
            TaskKind.REVIEW,
        )
        await role_task(
            connection,
            creator,
            results,
            project_id,
            ROLE_ANNOTATE,
            seats.get(ANNOTATOR, []),
            TaskKind.ANNOTATE,
        )
    for adjudicator in seats.get(ADJUDICATOR, []):
        await send_open_object(connection, creator, adjudicator)
