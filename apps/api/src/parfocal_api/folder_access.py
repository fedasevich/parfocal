import uuid
from dataclasses import dataclass

from sqlalchemy import ColumnElement, or_, select, true
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ForbiddenError
from parfocal_api.tables import cases, folder_members, memberships


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
