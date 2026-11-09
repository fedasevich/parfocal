from collections.abc import Mapping
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict
from sqlalchemy import delete, literal_column, select
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_catalogue import BY_NAME, ModelMakes, ModelName, ModelVersion
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import BadRequestError
from parfocal_api.tables import TierTask, model_tiers
from parfocal_api.worker_serving import Serving, WorkerProbe, probe_of, serving_of
from parfocal_common.model_runs import ModelTier

NEEDS: Mapping[TierTask, ModelMakes] = {
    TierTask.TUMOR: ModelMakes.REGIONS,
    TierTask.OUTLINE: ModelMakes.CELLS,
    TierTask.TYPER: ModelMakes.CELLS,
}
DEFAULTS: Mapping[tuple[TierTask, ModelTier], str] = {
    (TierTask.TUMOR, ModelTier.BEST): "camelyon-tumor",
    (TierTask.OUTLINE, ModelTier.BEST): "pathosam-hovernext",
    (TierTask.OUTLINE, ModelTier.GOOD): "hovernet",
    (TierTask.TYPER, ModelTier.BEST): "pathosam-hovernext",
    (TierTask.TYPER, ModelTier.GOOD): "hovernet",
}


class TierChoice(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: ModelName
    version: ModelVersion | None = None


class TierPick(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task: TierTask
    tier: ModelTier


class TierModel(BaseModel):
    name: str
    version: str
    title: str
    description: str
    label: str


class TierMapping(BaseModel):
    task: TierTask
    tier: ModelTier
    model: TierModel | None
    set_by_lab: bool
    serving: Serving = Serving.READY


class TierModelNotFoundError(BadRequestError):
    code = "model-not-found"
    title = "No Parfocal model has this name and version"


class ModelWrongTaskError(BadRequestError):
    code = "model-wrong-task"
    title = "This model does not make what the task needs"


class TierNotMappedError(BadRequestError):
    code = "tier-not-mapped"
    title = "Your lab has not chosen a model for this tier"


router = APIRouter(prefix="/api/tenant/model-tiers", tags=["tenant"])


def tier_model(name: str, version: str) -> TierModel:
    known = BY_NAME.get(name)
    title = known.title if known is not None else name
    description = known.description if known is not None else ""
    return TierModel(
        name=name,
        version=version,
        title=title,
        description=description,
        label=f"{title} · {version}",
    )


def default_model(task: TierTask, tier: ModelTier) -> TierModel | None:
    name = DEFAULTS.get((task, tier))
    return tier_model(name, BY_NAME[name].version) if name is not None else None


def mapping_of(task: TierTask, tier: ModelTier, row: Any | None) -> TierMapping:
    if row is None:
        return TierMapping(task=task, tier=tier, model=default_model(task, tier), set_by_lab=False)
    return TierMapping(
        task=task,
        tier=tier,
        model=tier_model(row.model_name, row.model_version),
        set_by_lab=True,
    )


async def lab_rows(connection: AsyncConnection) -> dict[tuple[TierTask, ModelTier], Any]:
    rows = await connection.execute(select(model_tiers))
    return {(TierTask(row.task), ModelTier(row.tier)): row for row in rows}


async def mapped(connection: AsyncConnection, pick: TierPick) -> TierModel:
    rows = await lab_rows(connection)
    mapping = mapping_of(pick.task, pick.tier, rows.get((pick.task, pick.tier)))
    if mapping.model is None:
        raise TierNotMappedError(f"{pick.tier.value} has no model for {pick.task.value}")
    return mapping.model


def checked_choice(task: TierTask, choice: TierChoice) -> str:
    known = BY_NAME.get(choice.name)
    if known is None or (choice.version is not None and choice.version != known.version):
        raise TierModelNotFoundError(f"{choice.name!r} {choice.version or ''} is not listed")
    if NEEDS[task] not in known.makes:
        raise ModelWrongTaskError(f"{known.title} does not make {NEEDS[task].value}")
    return known.version


@router.get("", operation_id="listModelTiers")
async def list_model_tiers(
    connection: TenantConnection, probe: Annotated[WorkerProbe, Depends(probe_of)]
) -> list[TierMapping]:
    rows = await lab_rows(connection)
    mappings = [
        mapping_of(task, tier, rows.get((task, tier))) for task in TierTask for tier in ModelTier
    ]
    return [
        mapping.model_copy(
            update={"serving": serving_of(probe, mapping.model.name if mapping.model else None)}
        )
        for mapping in mappings
    ]


@router.put(
    "/{task}/{tier}",
    operation_id="setModelTier",
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def set_model_tier(
    task: TierTask,
    tier: ModelTier,
    choice: TierChoice,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> TierMapping:
    version = checked_choice(task, choice)
    tenant_id = database_scope(principal).tenant_id
    values = {"model_name": choice.name, "model_version": version}
    row = (
        await connection.execute(
            upsert(model_tiers)
            .values(
                tenant_id=tenant_id,
                task=task,
                tier=tier,
                set_by_user_id=user_of(principal),
                **values,
            )
            .on_conflict_do_update(
                index_elements=[model_tiers.c.tenant_id, model_tiers.c.task, model_tiers.c.tier],
                set_={
                    **values,
                    "set_by_user_id": user_of(principal),
                    "updated_at": literal_column("now()"),
                },
            )
            .returning(model_tiers)
        )
    ).one()
    await record(
        connection,
        actor_of(principal),
        AuditAction.MODEL_TIER_SET,
        AuditTarget.TENANT,
        tenant_id,
        tenant_id=tenant_id,
        details={"task": task.value, "tier": tier.value, "model": f"{choice.name}@{version}"},
    )
    return mapping_of(task, tier, row)


@router.delete(
    "/{task}/{tier}",
    operation_id="resetModelTier",
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def reset_model_tier(
    task: TierTask, tier: ModelTier, principal: CurrentPrincipal, connection: TenantConnection
) -> TierMapping:
    tenant_id = database_scope(principal).tenant_id
    await connection.execute(
        delete(model_tiers).where(model_tiers.c.task == task, model_tiers.c.tier == tier)
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.MODEL_TIER_RESET,
        AuditTarget.TENANT,
        tenant_id,
        tenant_id=tenant_id,
        details={"task": task.value, "tier": tier.value},
    )
    return mapping_of(task, tier, None)
