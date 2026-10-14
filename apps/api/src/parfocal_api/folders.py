import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import and_, delete, exists, func, insert, literal_column, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.tables import (
    AVATAR_COLOURS,
    CaseState,
    cases,
    folder_members,
    folders,
    memberships,
)
from parfocal_common.db import CURRENT_TENANT

CLOSED_STATES = (CaseState.SIGNED, CaseState.CANCELLED)

type FolderName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)
]
type Colour = Annotated[int, Field(ge=0, lt=AVATAR_COLOURS)]


class FolderDraft(BaseModel):
    name: FolderName
    colour: Colour = 0


class FolderChange(BaseModel):
    name: FolderName | None = None
    colour: Colour | None = None
    archived: bool | None = None


class FolderPeople(BaseModel):
    user_ids: Annotated[list[uuid.UUID], Field(max_length=500)]


class CaseFolder(BaseModel):
    folder_id: uuid.UUID | None


class Folder(BaseModel):
    id: uuid.UUID
    name: str
    colour: int
    archived_at: datetime | None
    open_cases: int
    people: list[uuid.UUID]


class FolderNameTakenError(ConflictError):
    code = "folder-name-taken"
    title = "A folder with this name already exists"


class NotMembersError(BadRequestError):
    code = "not-members"
    title = "Folders hold only members of this workspace"


class ArchivedFolderError(ConflictError):
    code = "folder-archived"
    title = "Cases cannot be filed in an archived folder"


IN_TENANT = folders.c.tenant_id == literal_column(CURRENT_TENANT)


async def tenant_of(connection: AsyncConnection) -> uuid.UUID:
    tenant_id = await connection.scalar(select(literal_column(CURRENT_TENANT)))
    assert isinstance(tenant_id, uuid.UUID)
    return tenant_id


async def list_of(connection: AsyncConnection, folder_id: uuid.UUID | None = None) -> list[Folder]:
    open_cases = (
        select(func.count())
        .select_from(cases)
        .where(
            cases.c.folder_id == folders.c.id,
            cases.c.state.not_in(CLOSED_STATES),
            cases.c.is_draft.is_(False),
            cases.c.deleted_at.is_(None),
        )
        .scalar_subquery()
    )
    statement = select(folders, open_cases.label("open_cases")).where(IN_TENANT)
    if folder_id is not None:
        statement = statement.where(folders.c.id == folder_id)
    rows = (await connection.execute(statement.order_by(folders.c.name))).all()
    people = (
        await connection.execute(
            select(folder_members.c.folder_id, folder_members.c.user_id).where(
                folder_members.c.tenant_id == literal_column(CURRENT_TENANT)
            )
        )
    ).all()
    return [
        Folder(
            id=row.id,
            name=row.name,
            colour=row.colour,
            archived_at=row.archived_at,
            open_cases=row.open_cases,
            people=sorted(person.user_id for person in people if person.folder_id == row.id),
        )
        for row in rows
    ]


async def one_folder(connection: AsyncConnection, folder_id: uuid.UUID) -> Folder:
    found = await list_of(connection, folder_id)
    if not found:
        raise NotFoundError("Folder not found")
    return found[0]


router = APIRouter(prefix="/api/tenant/folders", tags=["folders"])
case_router = APIRouter(prefix="/api/cases", tags=["cases"])


@router.get("", operation_id="listFolders")
async def list_folders(connection: TenantConnection) -> list[Folder]:
    return await list_of(connection)


@router.post(
    "", operation_id="createFolder", status_code=201, **require(Permission.LAB_SETUP, write=True)
)
async def create_folder(
    draft: FolderDraft, principal: CurrentPrincipal, connection: TenantConnection
) -> Folder:
    tenant_id = await tenant_of(connection)
    try:
        folder_id = await connection.scalar(
            insert(folders)
            .values(tenant_id=tenant_id, name=draft.name, colour=draft.colour)
            .returning(folders.c.id)
        )
    except IntegrityError as error:
        raise FolderNameTakenError from error
    assert isinstance(folder_id, uuid.UUID)
    await record(
        connection,
        actor_of(principal),
        AuditAction.FOLDER_CHANGED,
        AuditTarget.FOLDER,
        folder_id,
        tenant_id=tenant_id,
        details={"created": True},
    )
    return await one_folder(connection, folder_id)


@router.patch(
    "/{folder_id}", operation_id="updateFolder", **require(Permission.LAB_SETUP, write=True)
)
async def update_folder(
    folder_id: uuid.UUID,
    change: FolderChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Folder:
    await one_folder(connection, folder_id)
    values: dict[str, object] = change.model_dump(exclude_unset=True, exclude={"archived"})
    if change.archived is not None:
        values["archived_at"] = func.now() if change.archived else None
    if values:
        try:
            await connection.execute(
                update(folders).where(folders.c.id == folder_id, IN_TENANT).values(values)
            )
        except IntegrityError as error:
            raise FolderNameTakenError from error
        await record(
            connection,
            actor_of(principal),
            AuditAction.FOLDER_CHANGED,
            AuditTarget.FOLDER,
            folder_id,
            tenant_id=database_scope(principal).tenant_id,
            details={"changed": sorted(change.model_dump(exclude_unset=True))},
        )
    return await one_folder(connection, folder_id)


@router.put(
    "/{folder_id}/people",
    operation_id="setFolderPeople",
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def set_folder_people(
    folder_id: uuid.UUID,
    people: FolderPeople,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Folder:
    await one_folder(connection, folder_id)
    tenant_id = await tenant_of(connection)
    wanted = set(people.user_ids)
    known = set(
        (
            await connection.scalars(
                select(memberships.c.user_id).where(
                    memberships.c.tenant_id == tenant_id, memberships.c.user_id.in_(wanted)
                )
            )
        ).all()
    )
    if known != wanted:
        raise NotMembersError
    await connection.execute(delete(folder_members).where(folder_members.c.folder_id == folder_id))
    if wanted:
        await connection.execute(
            insert(folder_members),
            [{"tenant_id": tenant_id, "folder_id": folder_id, "user_id": user} for user in wanted],
        )
    await record(
        connection,
        actor_of(principal),
        AuditAction.FOLDER_CHANGED,
        AuditTarget.FOLDER,
        folder_id,
        tenant_id=tenant_id,
        details={"people": len(wanted)},
    )
    return await one_folder(connection, folder_id)


@case_router.put(
    "/{case_id}/folder", operation_id="fileCase", **require(Permission.EDIT_CASES, write=True)
)
async def file_case(
    case_id: uuid.UUID,
    target: CaseFolder,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseFolder:
    if target.folder_id is not None:
        folder = await one_folder(connection, target.folder_id)
        if folder.archived_at is not None:
            raise ArchivedFolderError
    previous = await connection.scalar(
        select(cases.c.folder_id)
        .where(cases.c.id == case_id, cases.c.deleted_at.is_(None))
        .with_for_update()
    )
    found = await connection.scalar(
        select(exists().where(and_(cases.c.id == case_id, cases.c.deleted_at.is_(None))))
    )
    if not found:
        raise NotFoundError("Case not found")
    await connection.execute(
        update(cases).where(cases.c.id == case_id).values(folder_id=target.folder_id)
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.CASE_FILED,
        AuditTarget.CASE,
        case_id,
        tenant_id=database_scope(principal).tenant_id,
        details={
            "from": str(previous) if previous else None,
            "to": str(target.folder_id) if target.folder_id else None,
        },
    )
    return target
