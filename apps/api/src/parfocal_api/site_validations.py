import math
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, status
from pydantic import BaseModel, Field, StrictBool, StringConstraints
from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import user_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.model_catalogue import ModelName, ModelVersion
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import BadRequestError
from parfocal_api.tables import AnnouncementKind, announcements, site_validations

MAX_ITEMS = 10_000
LISTED = 50
Z_95 = 1.959963984540054

SpecimenType = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]


class ValidationItem(BaseModel):
    positive: StrictBool
    score: float = Field(ge=0, le=1)


class ValidationRun(BaseModel):
    model_name: ModelName
    model_version: ModelVersion
    specimen_type: SpecimenType
    threshold: float = Field(default=0.5, ge=0, le=1)
    items: list[ValidationItem] = Field(min_length=2, max_length=MAX_ITEMS)


class Proportion(BaseModel):
    value: float
    numerator: int
    denominator: int
    low: float
    high: float


class SiteValidation(BaseModel):
    id: uuid.UUID
    model_name: str
    model_version: str
    specimen_type: str
    threshold: float
    cases: int
    true_positives: int
    false_positives: int
    true_negatives: int
    false_negatives: int
    sensitivity: Proportion
    specificity: Proportion
    announcement_id: uuid.UUID
    created_by_user_id: uuid.UUID | None
    created_at: datetime


class NeedsBothOutcomesError(BadRequestError):
    code = "validation-needs-both-outcomes"
    title = "A validation set needs at least one positive and one negative case"


@dataclass(frozen=True)
class Confusion:
    true_positives: int
    false_positives: int
    true_negatives: int
    false_negatives: int


def confusion_of(items: list[ValidationItem], threshold: float) -> Confusion:
    called = [(item.positive, item.score >= threshold) for item in items]
    return Confusion(
        true_positives=sum(1 for truth, call in called if truth and call),
        false_positives=sum(1 for truth, call in called if not truth and call),
        true_negatives=sum(1 for truth, call in called if not truth and not call),
        false_negatives=sum(1 for truth, call in called if truth and not call),
    )


def proportion(numerator: int, denominator: int) -> Proportion:
    value = numerator / denominator
    spread = Z_95**2 / denominator
    centre = (value + spread / 2) / (1 + spread)
    margin = Z_95 * math.sqrt(value * (1 - value) / denominator + spread / denominator / 4)
    margin /= 1 + spread
    return Proportion(
        value=value,
        numerator=numerator,
        denominator=denominator,
        low=max(0.0, centre - margin),
        high=min(1.0, centre + margin),
    )


def validation_of(row: Any) -> SiteValidation:
    positives = row.true_positives + row.false_negatives
    negatives = row.true_negatives + row.false_positives
    return SiteValidation(
        id=row.id,
        model_name=row.model_name,
        model_version=row.model_version,
        specimen_type=row.specimen_type,
        threshold=row.threshold,
        cases=positives + negatives,
        true_positives=row.true_positives,
        false_positives=row.false_positives,
        true_negatives=row.true_negatives,
        false_negatives=row.false_negatives,
        sensitivity=proportion(row.true_positives, positives),
        specificity=proportion(row.true_negatives, negatives),
        announcement_id=row.announcement_id,
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
    )


def announcement_text(run: ValidationRun, confusion: Confusion) -> str:
    positives = confusion.true_positives + confusion.false_negatives
    negatives = confusion.true_negatives + confusion.false_positives
    sensitivity = confusion.true_positives / positives
    specificity = confusion.true_negatives / negatives
    return (
        f"{run.model_name} {run.model_version} was validated on {positives + negatives} local "
        f"{run.specimen_type} cases: sensitivity {sensitivity:.0%}, "
        f"specificity {specificity:.0%}"
    )


router = APIRouter(prefix="/api/site-validations", tags=["site-validations"])


async def announce(
    connection: AsyncConnection, principal: CurrentPrincipal, tenant_id: uuid.UUID | None, text: str
) -> Any:
    row = (
        await connection.execute(
            insert(announcements)
            .values(
                tenant_id=tenant_id,
                kind=AnnouncementKind.MODEL,
                text=text,
                created_by_user_id=user_of(principal),
            )
            .returning(announcements)
        )
    ).one()
    await record(
        connection,
        actor_of(principal),
        AuditAction.ANNOUNCEMENT_POSTED,
        AuditTarget.ANNOUNCEMENT,
        row.id,
        tenant_id=tenant_id,
        details={"kind": AnnouncementKind.MODEL.value},
    )
    return row


@router.post(
    "",
    operation_id="recordSiteValidation",
    status_code=status.HTTP_201_CREATED,
    **require(Permission.WORKSPACE_SETTINGS, write=True),
)
async def record_site_validation(
    run: ValidationRun, principal: CurrentPrincipal, connection: TenantConnection
) -> SiteValidation:
    confusion = confusion_of(run.items, run.threshold)
    positives = confusion.true_positives + confusion.false_negatives
    if positives == 0 or positives == len(run.items):
        raise NeedsBothOutcomesError
    tenant_id = database_scope(principal).tenant_id
    announcement = await announce(
        connection, principal, tenant_id, announcement_text(run, confusion)
    )
    row = (
        await connection.execute(
            insert(site_validations)
            .values(
                tenant_id=tenant_id,
                model_name=run.model_name,
                model_version=run.model_version,
                specimen_type=run.specimen_type,
                threshold=run.threshold,
                true_positives=confusion.true_positives,
                false_positives=confusion.false_positives,
                true_negatives=confusion.true_negatives,
                false_negatives=confusion.false_negatives,
                announcement_id=announcement.id,
                created_by_user_id=user_of(principal),
            )
            .returning(site_validations)
        )
    ).one()
    await record(
        connection,
        actor_of(principal),
        AuditAction.SITE_VALIDATION_RECORDED,
        AuditTarget.SITE_VALIDATION,
        row.id,
        tenant_id=tenant_id,
        details={
            "model": run.model_name,
            "version": run.model_version,
            "specimen_type": run.specimen_type,
            "cases": len(run.items),
        },
    )
    return validation_of(row)


@router.get("", operation_id="listSiteValidations")
async def list_site_validations(connection: TenantConnection) -> list[SiteValidation]:
    rows = await connection.execute(
        select(site_validations)
        .order_by(site_validations.c.created_at.desc(), site_validations.c.id)
        .limit(LISTED)
    )
    return [validation_of(row) for row in rows]
