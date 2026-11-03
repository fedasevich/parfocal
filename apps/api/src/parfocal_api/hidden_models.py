import uuid

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_catalogue import BY_NAME, CATALOGUE, ModelName
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import Principal, database_scope
from parfocal_api.problems import BadRequestError
from parfocal_api.tables import hidden_models


class ModelShown(BaseModel):
    name: str
    title: str
    shown: bool
    hidden_by: uuid.UUID | None


class HiddenModelNotListedError(BadRequestError):
    code = "model-not-found"
    title = "No Parfocal model has this name"


class ModelHiddenError(BadRequestError):
    code = "model-hidden"
    title = "This model is hidden in your workspace. Someone with admin rights can show it again"


router = APIRouter(prefix="/api/tenant/hidden-models", tags=["tenant"])


async def hidden_by(connection: AsyncConnection) -> dict[str, uuid.UUID | None]:
    rows = await connection.execute(
        select(hidden_models.c.model_name, hidden_models.c.hidden_by_user_id)
    )
    return {row.model_name: row.hidden_by_user_id for row in rows}


async def hidden_names(connection: AsyncConnection) -> set[str]:
    return set(await hidden_by(connection))


async def refuse_hidden(connection: AsyncConnection, names: set[str]) -> None:
    hidden = names & await hidden_names(connection)
    if hidden:
        raise ModelHiddenError(f"{', '.join(sorted(hidden))} is hidden")


def listed(name: str, shown: bool, by: uuid.UUID | None = None) -> ModelShown:
    known = BY_NAME.get(name)
    if known is None:
        raise HiddenModelNotListedError(f"{name!r} is not a Parfocal model")
    return ModelShown(name=name, title=known.title, shown=shown, hidden_by=by)


async def audited(
    connection: AsyncConnection, principal: Principal, action: AuditAction, name: str
) -> None:
    tenant_id = database_scope(principal).tenant_id
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.TENANT,
        tenant_id,
        tenant_id=tenant_id,
        details={"model": name},
    )


@router.get("", operation_id="listModelVisibility")
async def list_model_visibility(connection: TenantConnection) -> list[ModelShown]:
    hidden = await hidden_by(connection)
    return [
        listed(model.name, model.name not in hidden, hidden.get(model.name)) for model in CATALOGUE
    ]


@router.put(
    "/{name}",
    operation_id="hideModel",
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def hide_model(
    name: ModelName, principal: CurrentPrincipal, connection: TenantConnection
) -> ModelShown:
    shown = listed(name, False, user_of(principal))
    await connection.execute(
        upsert(hidden_models)
        .values(
            tenant_id=database_scope(principal).tenant_id,
            model_name=name,
            hidden_by_user_id=user_of(principal),
        )
        .on_conflict_do_nothing(
            index_elements=[hidden_models.c.tenant_id, hidden_models.c.model_name]
        )
    )
    await audited(connection, principal, AuditAction.MODEL_HIDDEN, name)
    return shown


@router.delete(
    "/{name}",
    operation_id="showModel",
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def show_model(
    name: ModelName, principal: CurrentPrincipal, connection: TenantConnection
) -> ModelShown:
    shown = listed(name, True)
    await connection.execute(delete(hidden_models).where(hidden_models.c.model_name == name))
    await audited(connection, principal, AuditAction.MODEL_SHOWN, name)
    return shown
