import uuid
from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, Field
from sqlalchemy import literal_column, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.compare_alignments import pruned
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, member_of, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import BadRequestError, ConflictError
from parfocal_api.review_tasks import pinned_template
from parfocal_api.settings_catalogue import BY_KEY, CATALOGUE, Layer
from parfocal_api.tables import personal_settings, workspace_settings
from parfocal_common.db import CURRENT_TENANT

MAX_KEYS = len(CATALOGUE)
AUDITED_VALUES = frozenset({"two_factor_required"})

type Values = Annotated[dict[str, Any], Field(max_length=MAX_KEYS)]


class LabSettings(BaseModel):
    values: dict[str, Any]
    locked: list[str]


class MySettingLayers(BaseModel):
    lab: LabSettings
    personal: dict[str, Any]


class PersonalSettingsChange(BaseModel):
    values: Values


class WorkspaceSettingsChange(BaseModel):
    values: Values
    locked: Annotated[list[str], Field(max_length=MAX_KEYS)] = []


class UnknownSettingError(BadRequestError):
    code = "unknown-setting"
    title = "There is no such setting, or it cannot be set here"


class InvalidSettingError(BadRequestError):
    code = "invalid-setting"
    title = "A setting's value does not fit it"


class SettingLockedError(ConflictError):
    code = "setting-locked"
    title = "The workspace has locked this setting"


me_router = APIRouter(prefix="/api/me/setting-layers", tags=["me"])
tenant_router = APIRouter(prefix="/api/tenant/settings", tags=["tenant"])

IN_THIS_TENANT_LAB = workspace_settings.c.tenant_id == literal_column(CURRENT_TENANT)
IN_THIS_TENANT_PERSONAL = personal_settings.c.tenant_id == literal_column(CURRENT_TENANT)


def checked(values: Mapping[str, Any], layer: Layer) -> None:
    for key, value in values.items():
        setting = BY_KEY.get(key)
        if setting is None or layer not in setting.layers:
            raise UnknownSettingError(f"{key} is not a {layer.value} setting")
        if value is None:
            continue
        if (problem := setting.problem(value)) is not None:
            raise InvalidSettingError(f"{key} {problem}")


async def lab_of(connection: AsyncConnection) -> LabSettings:
    row = (
        await connection.execute(
            select(workspace_settings.c["values"], workspace_settings.c.locked).where(
                IN_THIS_TENANT_LAB
            )
        )
    ).one_or_none()
    if row is None:
        return LabSettings(values={}, locked=[])
    return LabSettings(
        values={key: value for key, value in row[0].items() if key in BY_KEY},
        locked=[key for key in row.locked if key in BY_KEY],
    )


async def personal_of(connection: AsyncConnection, user_id: Any) -> dict[str, Any]:
    stored = await connection.scalar(
        select(personal_settings.c["values"]).where(
            IN_THIS_TENANT_PERSONAL, personal_settings.c.user_id == user_id
        )
    )
    return dict(stored or {})


def merged(current: Mapping[str, Any], change: Mapping[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in {**current, **change}.items() if value is not None}


@me_router.get("", operation_id="getMySettingLayers")
async def get_my_settings(
    principal: CurrentPrincipal, connection: TenantConnection
) -> MySettingLayers:
    member = member_of(principal)
    return MySettingLayers(
        lab=await lab_of(connection),
        personal=await pruned(connection, await personal_of(connection, member.user_id)),
    )


@me_router.put("", operation_id="setMySettingLayers")
async def set_my_settings(
    change: PersonalSettingsChange, principal: CurrentPrincipal, connection: TenantConnection
) -> MySettingLayers:
    member = member_of(principal)
    checked(change.values, Layer.PERSONAL)
    lab = await lab_of(connection)
    for key, value in change.values.items():
        if value is not None and key in lab.locked:
            raise SettingLockedError(f"{key} is set by the workspace")
    values = await pruned(
        connection, merged(await personal_of(connection, member.user_id), change.values)
    )
    await connection.execute(
        upsert(personal_settings)
        .values(tenant_id=member.tenant_id, user_id=member.user_id, values=values)
        .on_conflict_do_update(
            index_elements=[personal_settings.c.tenant_id, personal_settings.c.user_id],
            set_={"values": values, "updated_at": literal_column("now()")},
        )
    )
    return MySettingLayers(lab=lab, personal=values)


@tenant_router.put(
    "",
    operation_id="setWorkspaceSettings",
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def set_workspace_settings(
    change: WorkspaceSettingsChange, principal: CurrentPrincipal, connection: TenantConnection
) -> LabSettings:
    checked(change.values, Layer.LAB)
    template = change.values.get("default_study_template")
    if template is not None:
        await pinned_template(connection, uuid.UUID(template), None)
    current = await lab_of(connection)
    values = merged(current.values, change.values)
    locked = sorted(set(change.locked))
    for key in locked:
        if key not in values:
            raise UnknownSettingError(f"{key} needs a workspace value before it can be locked")
    tenant_id = database_scope(principal).tenant_id
    await connection.execute(
        upsert(workspace_settings)
        .values(tenant_id=tenant_id, values=values, locked=locked)
        .on_conflict_do_update(
            index_elements=[workspace_settings.c.tenant_id],
            set_={"values": values, "locked": locked, "updated_at": literal_column("now()")},
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.WORKSPACE_SETTINGS_CHANGED,
        AuditTarget.TENANT,
        tenant_id,
        tenant_id=tenant_id,
        details={
            "keys": sorted(change.values),
            "locked": locked,
            **{key: value for key, value in change.values.items() if key in AUDITED_VALUES},
        },
    )
    return LabSettings(values=values, locked=locked)
