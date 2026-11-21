import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import func, insert, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.auth import SEEDED_OWNER_NAME, SEEDED_SUBJECT_PREFIX
from parfocal_api.tables import ProjectRole, Role, memberships, project_members, projects, users
from parfocal_common.db import DatabaseScope, scoped_transaction

PLACEHOLDER_PREFIX = SEEDED_SUBJECT_PREFIX
SEEDED_VIEWER_NAME = "Smoke Viewer"
SEEDED_AGENT_NAME = "Agent Tester"


def placeholder_subject(email: str) -> str:
    return f"{PLACEHOLDER_PREFIX}{email.strip().lower()}"


async def add_member(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    subject: str,
    name: str,
    initials: str,
    role: Role,
    *,
    admin_rights: bool,
    email: str | None = None,
) -> uuid.UUID:
    user_id = await connection.scalar(
        upsert(users)
        .values(
            subject=subject,
            email=email,
            display_name=name,
            initials=initials,
            avatar_colour=len(name) % 12,
            last_tenant_id=tenant_id,
        )
        .on_conflict_do_update(
            index_elements=[users.c.subject],
            set_={"last_tenant_id": func.coalesce(users.c.last_tenant_id, tenant_id)},
        )
        .returning(users.c.id)
    )
    assert isinstance(user_id, uuid.UUID)
    member = await connection.scalar(
        select(memberships.c.id).where(
            memberships.c.tenant_id == tenant_id, memberships.c.user_id == user_id
        )
    )
    if member is None:
        await connection.execute(
            insert(memberships).values(
                tenant_id=tenant_id, user_id=user_id, role=role, admin_rights=admin_rights
            )
        )
    return user_id


async def add_owner(connection: AsyncConnection, tenant_id: uuid.UUID, email: str) -> uuid.UUID:
    address = email.strip().lower()
    signed_in = await connection.scalar(
        select(users.c.subject).where(func.lower(users.c.email) == address).limit(1)
    )
    subject = signed_in or placeholder_subject(address)
    return await add_member(
        connection,
        tenant_id,
        subject,
        SEEDED_OWNER_NAME,
        "WO",
        Role.RESEARCHER,
        admin_rights=True,
        email=address,
    )


@dataclass(frozen=True)
class SeededAccount:
    name: str
    initials: str
    role: Role
    admin_rights: bool
    project_role: ProjectRole


SEEDED_VIEWER = SeededAccount(SEEDED_VIEWER_NAME, "SV", Role.REVIEWER, False, ProjectRole.VIEWER)
SEEDED_AGENT = SeededAccount(SEEDED_AGENT_NAME, "AT", Role.RESEARCHER, True, ProjectRole.OWNER)


async def add_account(
    connection: AsyncConnection, tenant_id: uuid.UUID, email: str, account: SeededAccount
) -> uuid.UUID:
    address = email.strip().lower()
    signed_in = await connection.scalar(
        select(users.c.subject).where(func.lower(users.c.email) == address).limit(1)
    )
    return await add_member(
        connection,
        tenant_id,
        signed_in or placeholder_subject(address),
        account.name,
        account.initials,
        account.role,
        admin_rights=account.admin_rights,
        email=address,
    )


async def seat_on_projects(
    connection: AsyncConnection, tenant_id: uuid.UUID, user_id: uuid.UUID, role: ProjectRole
) -> None:
    project_ids = await connection.scalars(
        select(projects.c.id).where(projects.c.tenant_id == tenant_id)
    )
    for project_id in project_ids.all():
        await connection.execute(
            upsert(project_members)
            .values(tenant_id=tenant_id, project_id=project_id, user_id=user_id, role=role)
            .on_conflict_do_nothing()
        )


async def seat_accounts(
    engine: Any,
    tenant_ids: Sequence[uuid.UUID],
    emails: Sequence[str],
    account: SeededAccount,
) -> None:
    for email in emails:
        for tenant_id in tenant_ids:
            async with scoped_transaction(
                engine, DatabaseScope(platform=True, auth=True)
            ) as connection:
                user_id = await add_account(connection, tenant_id, email, account)
            async with scoped_transaction(
                engine, DatabaseScope(tenant_id=tenant_id, user_id=user_id)
            ) as connection:
                await seat_on_projects(connection, tenant_id, user_id, account.project_role)
