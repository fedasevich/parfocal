import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator
from sqlalchemy import delete, func, insert, literal_column, or_, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.display_settings import (
    DisplaySettings,
    TaskDisplaySettings,
    display_of,
    require_unlocked,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal
from parfocal_api.problems import BadRequestError, ConflictError, ForbiddenError, NotFoundError
from parfocal_api.review_tasks import check_sets, own_assignments, readable_task
from parfocal_api.tables import display_choices, display_presets, review_assignments
from parfocal_common.db import CURRENT_TENANT

TASK_DEFAULT = "Task default"

type PresetName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)
]


class PresetDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: PresetName
    task_id: uuid.UUID | None = None
    settings: DisplaySettings


class PresetChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: PresetName | None = None
    settings: DisplaySettings | None = None

    @model_validator(mode="after")
    def has_change(self) -> PresetChange:
        if self.name is None and self.settings is None:
            raise ValueError("Change the name or the settings")
        return self


class DisplayPreset(BaseModel):
    id: uuid.UUID
    name: str
    task_id: uuid.UUID | None
    settings: DisplaySettings
    created_at: datetime
    updated_at: datetime


class DisplayChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    preset_id: uuid.UUID | None = None
    settings: DisplaySettings


class MyDisplay(BaseModel):
    task: TaskDisplaySettings
    preset_id: uuid.UUID | None
    preset: str
    settings: DisplaySettings
    presets: list[DisplayPreset]


class PresetNameTakenError(ConflictError):
    code = "display-preset-name-taken"
    title = "You already have a preset with this name"


class NotYourTaskError(BadRequestError):
    code = "not-your-task"
    title = "A preset for one task needs a task you review"


class NotReviewingError(ForbiddenError):
    code = "not-reviewing"
    title = "Only a reviewer of this task has display settings on it"


router = APIRouter(prefix="/api/review-tasks/{task_id}/my-display", tags=["display"])
presets_router = APIRouter(prefix="/api/display-presets", tags=["display"])


def me_of(principal: Principal) -> uuid.UUID:
    me = user_of(principal)
    if me is None:
        raise NotFoundError("Only a person has display settings")
    return me


async def reviewed_task(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID
) -> Any:
    row, _ = await readable_task(connection, principal, task_id)
    mine = select(review_assignments.c.slide_id).where(
        review_assignments.c.task_id == task_id, own_assignments(principal)
    )
    if not await connection.scalar(select(mine.exists())):
        raise NotReviewingError
    return row


def preset_of(row: Any) -> DisplayPreset:
    return DisplayPreset(
        id=row.id,
        name=row.name,
        task_id=row.task_id,
        settings=DisplaySettings.model_validate(row.settings),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


async def own_preset(connection: AsyncConnection, me: uuid.UUID, preset_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            select(display_presets).where(
                display_presets.c.id == preset_id, display_presets.c.user_id == me
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Preset not found")
    return row


async def check_name(
    connection: AsyncConnection, me: uuid.UUID, name: str, preset_id: uuid.UUID | None = None
) -> None:
    if name.casefold() == TASK_DEFAULT.casefold():
        raise PresetNameTakenError(f"{TASK_DEFAULT} is the task's own settings")
    statement = select(display_presets.c.id).where(
        display_presets.c.user_id == me, func.lower(display_presets.c.name) == name.lower()
    )
    if preset_id is not None:
        statement = statement.where(display_presets.c.id != preset_id)
    if await connection.scalar(select(statement.exists())):
        raise PresetNameTakenError(f"You already have a preset called {name}")


async def check_for_task(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID, settings: DisplaySettings
) -> Any:
    try:
        task = await reviewed_task(connection, principal, task_id)
    except NotFoundError, ForbiddenError:
        raise NotYourTaskError from None
    require_unlocked(display_of(task.display), settings)
    await check_sets(connection, task.project_id, settings)
    return task


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    row: Any,
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.DISPLAY_PRESET,
        row.id,
        tenant_id=row.tenant_id,
        details={
            "scope": "task" if row.task_id is not None else "all",
            "task_id": None if row.task_id is None else str(row.task_id),
        },
    )


def usable_on(me: uuid.UUID, task_id: uuid.UUID) -> list[Any]:
    return [
        display_presets.c.user_id == me,
        or_(display_presets.c.task_id.is_(None), display_presets.c.task_id == task_id),
    ]


@presets_router.get("", operation_id="listDisplayPresets", **require(Permission.REVIEW))
async def list_display_presets(
    principal: CurrentPrincipal, connection: TenantConnection, task_id: uuid.UUID | None = None
) -> list[DisplayPreset]:
    me = me_of(principal)
    statement = select(display_presets).where(display_presets.c.user_id == me)
    if task_id is not None:
        statement = select(display_presets).where(*usable_on(me, task_id))
    rows = await connection.execute(statement.order_by(display_presets.c.created_at))
    return [preset_of(row) for row in rows]


@presets_router.post(
    "",
    operation_id="saveDisplayPreset",
    status_code=201,
    **require(Permission.REVIEW, write=True),
)
async def save_display_preset(
    draft: PresetDraft, principal: CurrentPrincipal, connection: TenantConnection
) -> DisplayPreset:
    me = me_of(principal)
    if draft.task_id is not None:
        await check_for_task(connection, principal, draft.task_id, draft.settings)
    tenant_id = await connection.scalar(select(literal_column(CURRENT_TENANT)))
    await check_name(connection, me, draft.name)
    row = (
        await connection.execute(
            insert(display_presets)
            .values(
                tenant_id=tenant_id,
                user_id=me,
                task_id=draft.task_id,
                name=draft.name,
                settings=draft.settings.model_dump(mode="json"),
            )
            .returning(display_presets)
        )
    ).one()
    await audit(connection, principal, AuditAction.DISPLAY_PRESET_SAVED, row)
    return preset_of(row)


@presets_router.patch(
    "/{preset_id}",
    operation_id="changeDisplayPreset",
    **require(Permission.REVIEW, write=True),
)
async def change_display_preset(
    preset_id: uuid.UUID,
    change: PresetChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> DisplayPreset:
    me = me_of(principal)
    row = await own_preset(connection, me, preset_id)
    values: dict[str, Any] = {}
    if change.name is not None and change.name != row.name:
        await check_name(connection, me, change.name, preset_id)
        values["name"] = change.name
    if change.settings is not None:
        if row.task_id is not None:
            await check_for_task(connection, principal, row.task_id, change.settings)
        values["settings"] = change.settings.model_dump(mode="json")
    if not values:
        return preset_of(row)
    changed = (
        await connection.execute(
            update(display_presets)
            .where(display_presets.c.id == preset_id)
            .values(**values)
            .returning(display_presets)
        )
    ).one()
    await audit(connection, principal, AuditAction.DISPLAY_PRESET_CHANGED, changed)
    return preset_of(changed)


@presets_router.delete(
    "/{preset_id}",
    operation_id="deleteDisplayPreset",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def delete_display_preset(
    preset_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> Response:
    row = await own_preset(connection, me_of(principal), preset_id)
    await connection.execute(delete(display_presets).where(display_presets.c.id == preset_id))
    await audit(connection, principal, AuditAction.DISPLAY_PRESET_DELETED, row)
    return Response(status_code=204)


async def my_display(connection: AsyncConnection, principal: Principal, task: Any) -> MyDisplay:
    me = me_of(principal)
    display = display_of(task.display)
    presets = [
        preset_of(row)
        for row in await connection.execute(
            select(display_presets)
            .where(*usable_on(me, task.id))
            .order_by(display_presets.c.created_at)
        )
    ]
    choice = (
        await connection.execute(
            select(display_choices).where(
                display_choices.c.task_id == task.id, display_choices.c.user_id == me
            )
        )
    ).one_or_none()
    if choice is None:
        return MyDisplay(
            task=display,
            preset_id=None,
            preset=TASK_DEFAULT,
            settings=display.defaults,
            presets=presets,
        )
    named = {preset.id: preset.name for preset in presets}
    preset_id = choice.preset_id if choice.preset_id in named else None
    return MyDisplay(
        task=display,
        preset_id=preset_id,
        preset=TASK_DEFAULT if preset_id is None else named[preset_id],
        settings=DisplaySettings.model_validate(choice.settings),
        presets=presets,
    )


@router.get("", operation_id="getMyDisplay", **require(Permission.REVIEW))
async def get_my_display(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> MyDisplay:
    task = await reviewed_task(connection, principal, task_id)
    return await my_display(connection, principal, task)


@router.put("", operation_id="chooseMyDisplay", **require(Permission.REVIEW, write=True))
async def choose_my_display(
    task_id: uuid.UUID,
    choice: DisplayChoice,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> MyDisplay:
    me = me_of(principal)
    task = await reviewed_task(connection, principal, task_id)
    require_unlocked(display_of(task.display), choice.settings)
    await check_sets(connection, task.project_id, choice.settings)
    if choice.preset_id is not None:
        preset = await own_preset(connection, me, choice.preset_id)
        if preset.task_id not in {None, task_id}:
            raise NotFoundError("Preset not found")
    values = {"preset_id": choice.preset_id, "settings": choice.settings.model_dump(mode="json")}
    await connection.execute(
        upsert(display_choices)
        .values(tenant_id=task.tenant_id, task_id=task_id, user_id=me, **values)
        .on_conflict_do_update(
            index_elements=[display_choices.c.task_id, display_choices.c.user_id], set_=values
        )
    )
    return await my_display(connection, principal, task)
