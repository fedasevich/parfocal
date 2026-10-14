import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, exists, func, or_, select, true
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.permissions import Grant, Permission, grant_for
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ForbiddenError
from parfocal_api.tables import cases, emergency_grants, folder_members, memberships


@dataclass(frozen=True)
class FolderAccess:
    all_folders: bool
    folder_ids: frozenset[uuid.UUID]

    def covers(self, folder_id: uuid.UUID | None) -> bool:
        return self.all_folders or folder_id is None or folder_id in self.folder_ids

    def condition(self) -> ColumnElement[bool]:
        if self.all_folders:
            return true()
        if not self.folder_ids:
            return cases.c.folder_id.is_(None)
        return or_(cases.c.folder_id.is_(None), cases.c.folder_id.in_(self.folder_ids))


EVERY_FOLDER = FolderAccess(True, frozenset())


class OutsideFoldersError(ForbiddenError):
    code = "outside-folders"
    title = "This case is in a folder you do not work in"


async def access_of(connection: AsyncConnection, principal: Principal) -> FolderAccess:
    if not isinstance(principal, MemberPrincipal):
        return EVERY_FOLDER
    all_folders = await connection.scalar(
        select(memberships.c.all_folders).where(
            memberships.c.tenant_id == principal.tenant_id,
            memberships.c.user_id == principal.user_id,
        )
    )
    folder_ids = await connection.scalars(
        select(folder_members.c.folder_id).where(
            folder_members.c.tenant_id == principal.tenant_id,
            folder_members.c.user_id == principal.user_id,
        )
    )
    return FolderAccess(bool(all_folders), frozenset(folder_ids.all()))


async def require_folder(
    connection: AsyncConnection, principal: Principal, folder_id: uuid.UUID | None
) -> None:
    if not (await access_of(connection, principal)).covers(folder_id):
        raise OutsideFoldersError


class EmergencyAccessNeededError(ForbiddenError):
    code = "emergency-access-needed"
    title = "Give a reason to open this case"


async def has_emergency_grant(
    connection: AsyncConnection, principal: MemberPrincipal, case_id: uuid.UUID
) -> bool:
    return bool(
        await connection.scalar(
            select(
                exists().where(
                    emergency_grants.c.user_id == principal.user_id,
                    emergency_grants.c.case_id == case_id,
                    emergency_grants.c.expires_at > func.now(),
                )
            )
        )
    )


async def require_case_access(
    connection: AsyncConnection,
    principal: Principal,
    case_id: uuid.UUID,
    folder_id: uuid.UUID | None,
    permission: Permission,
) -> None:
    if not isinstance(principal, MemberPrincipal):
        return
    base = grant_for(principal.role, permission)
    inside = (await access_of(connection, principal)).covers(folder_id)
    if base is not Grant.NONE and inside:
        return
    if (
        base is not Grant.NONE
        and grant_for(principal.role, Permission.OPEN_OUTSIDE_FOLDERS) is Grant.ALL
    ):
        return
    if await has_emergency_grant(connection, principal, case_id):
        return
    if base is Grant.NONE:
        raise EmergencyAccessNeededError
    raise OutsideFoldersError
