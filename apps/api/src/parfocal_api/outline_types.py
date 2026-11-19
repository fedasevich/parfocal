import logging
import uuid
from collections.abc import Mapping
from enum import StrEnum
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response
from pydantic import BaseModel, Field, field_validator

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import ai_hidden_on
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.gpu_calls import (
    GpuAnswer,
    GpuCalls,
    GpuCallScope,
    GpuWaiting,
    gpu_calls_of,
    scope_of,
    waiting_response,
)
from parfocal_api.hidden_models import refuse_hidden
from parfocal_api.model_registry import temperatures_of
from parfocal_api.permissions import Permission, require
from parfocal_api.problems import NotFoundError, ProblemError
from parfocal_api.slide_coverage import readable_slide
from parfocal_common.ingest import folder_of
from parfocal_common.outline_types import (
    MAX_OUTLINE_SPAN,
    MAX_OUTLINES,
    MAX_POINTS,
    MIN_POINTS,
    TYPER,
    TYPER_VERSION,
    OutlineTypesCall,
    fits,
    typed_outlines_in,
)
from parfocal_common.view_maps import seconds_in

logger = logging.getLogger("parfocal.api.outline_types")

SINGLE_VIEW = 1

router = APIRouter(prefix="/api/slides/{slide_id}/outline-types", tags=["slides"])


class TyperOfflineError(ProblemError):
    status = 503
    code = "typer-offline"
    title = "No typer worker is answering. Try again in a moment"


class TyperClass(StrEnum):
    TUMOR = "tumor"
    STROMA = "stroma"
    IMMUNE = "immune"
    OTHER = "other"


class OutlineToType(BaseModel):
    points: list[float] = Field(min_length=MIN_POINTS, max_length=MAX_POINTS)

    @field_validator("points")
    @classmethod
    def small_closed_ring(cls, points: list[float]) -> list[float]:
        if not fits(points):
            raise ValueError(
                f"An outline rings one nucleus in x and y pairs, at most {MAX_OUTLINE_SPAN} px"
            )
        return points


class OutlinesToType(BaseModel):
    outlines: list[OutlineToType] = Field(min_length=1, max_length=MAX_OUTLINES)


class TypeShares(BaseModel):
    tumor: float = Field(ge=0, le=1)
    stroma: float = Field(ge=0, le=1)
    immune: float = Field(ge=0, le=1)
    other: float = Field(ge=0, le=1)


class TypedOutline(BaseModel):
    probabilities: TypeShares
    type: TyperClass
    alternatives: list[TyperClass]
    foreground: float = Field(ge=0, le=1)


class OutlineTypes(BaseModel):
    slide_id: uuid.UUID
    typer: str
    version: str
    calibrated: bool
    outlines: list[TypedOutline]


async def typed_outlines(
    calls: GpuCalls, scope: GpuCallScope, request: OutlineTypesCall, token: str | None
) -> tuple[list[Mapping[str, object]], GpuAnswer] | GpuWaiting:
    try:
        answer = await calls.answer_or_wait(scope, request.call(), token)
    except ProblemError:
        raise
    except Exception as error:
        logger.warning("outline types call failed: %s", type(error).__name__)
        raise TyperOfflineError from error
    if isinstance(answer, GpuWaiting):
        return answer
    typed = typed_outlines_in(answer.reply, len(request.outlines))
    if typed is None:
        raise TyperOfflineError
    return typed, answer


@router.post(
    "",
    operation_id="typeOutlines",
    response_model=OutlineTypes,
    responses={202: {"model": GpuWaiting}},
    **require(Permission.SEE_SLIDES, write=True),
)
async def type_outlines(
    slide_id: uuid.UUID,
    body: OutlinesToType,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    calls: Annotated[GpuCalls, Depends(gpu_calls_of)],
    call: str | None = Query(default=None, max_length=2048),
) -> OutlineTypes | Response:
    slide = await readable_slide(connection, principal, slide_id)
    if await ai_hidden_on(connection, principal, slide.project_id, slide_id):
        raise NotFoundError("Slide not found")
    await refuse_hidden(connection, {TYPER})
    temperature = temperatures_of(TYPER, TYPER_VERSION).get(SINGLE_VIEW)
    request = OutlineTypesCall(
        slide.tenant_id,
        slide_id,
        tuple(tuple(outline.points) for outline in body.outlines),
        1.0 if temperature is None else temperature,
        None if slide.original_key is None else folder_of(slide.original_key),
    )
    scope = scope_of("outline-types", principal, slide.tenant_id, slide_id)
    outcome = await typed_outlines(calls, scope, request, call)
    if isinstance(outcome, GpuWaiting):
        return waiting_response(outcome)
    typed, answer = outcome
    reported = seconds_in(answer.reply)
    gpu_seconds = answer.waited_seconds if reported is None else round(reported, 3)
    await record(
        connection,
        actor_of(principal),
        AuditAction.OUTLINES_TYPED,
        AuditTarget.SLIDE,
        slide_id,
        tenant_id=slide.tenant_id,
        details={
            "project_id": str(slide.project_id),
            "outlines": len(typed),
            "typer": f"{TYPER}@{TYPER_VERSION}",
            "calibrated": temperature is not None,
            "gpu_seconds": gpu_seconds,
            "waited_seconds": answer.waited_seconds,
        },
    )
    return OutlineTypes(
        slide_id=slide_id,
        typer=TYPER,
        version=TYPER_VERSION,
        calibrated=temperature is not None,
        outlines=[TypedOutline.model_validate(outline) for outline in typed],
    )
