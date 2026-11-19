import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from parfocal_api.audit import actor_of
from parfocal_api.context import CurrentPrincipal
from parfocal_api.gpu_warm import warm_gate_of
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, ServicePrincipal
from parfocal_api.problems import NotFoundError
from parfocal_api.tile_access import claims_under_any, sign_capability, viewer_of
from parfocal_api.token_keys import usable_keys
from parfocal_api.uploads import Settings
from parfocal_common.warm_gate import UnknownCallError, WarmGate

logger = logging.getLogger("parfocal.api.gpu_calls")

HOLD_SECONDS = 45.0
SLOW_WAIT_SECONDS = 60.0
CALL_TOKEN_VERSION = 1
CALL_TOKEN_SECONDS = 30 * 60

router = APIRouter(prefix="/api/gpu-calls", tags=["slides"])


class GpuCallNotFoundError(NotFoundError):
    code = "gpu-call-not-found"
    title = "This GPU call has ended or belongs to someone else"


class GpuWaiting(BaseModel):
    state: Literal["waiting"] = "waiting"
    call: str
    waited_seconds: float
    hold_seconds: float


@dataclass(frozen=True)
class GpuAnswer:
    reply: dict[str, object]
    waited_seconds: float


@dataclass(frozen=True)
class GpuCallScope:
    kind: str
    tenant_id: uuid.UUID
    slide_id: uuid.UUID
    viewer: str


@dataclass(frozen=True)
class GpuCalls:
    gate: WarmGate
    keys: list[str] | None
    clock: Callable[[], float] = time.time

    def hold(self) -> float | None:
        return None if self.keys is None else HOLD_SECONDS

    def token(self, scope: GpuCallScope, call_id: str, started: float) -> str:
        assert self.keys is not None
        claims = {
            "v": CALL_TOKEN_VERSION,
            "call": call_id,
            "kind": scope.kind,
            "tenant": str(scope.tenant_id),
            "slide": str(scope.slide_id),
            "viewer": scope.viewer,
            "started": started,
        }
        return sign_capability(self.keys[0], claims)

    def opened(self, token: str, tenant_id: uuid.UUID, viewer: str) -> dict[str, object]:
        claims = None if self.keys is None else claims_under_any(self.keys, token)
        if (
            claims is None
            or claims.get("v") != CALL_TOKEN_VERSION
            or claims.get("tenant") != str(tenant_id)
            or claims.get("viewer") != viewer
            or not isinstance(claims.get("call"), str)
            or not isinstance(claims.get("started"), int | float)
            or self.clock() - float(claims["started"]) > CALL_TOKEN_SECONDS
        ):
            raise GpuCallNotFoundError
        return claims

    async def answer_or_wait(
        self, scope: GpuCallScope, call: dict[str, object], token: str | None
    ) -> GpuAnswer | GpuWaiting:
        if token is None:
            started = self.clock()
            call_id = await run_in_threadpool(self.gate.submit, call)
        else:
            claims = self.opened(token, scope.tenant_id, scope.viewer)
            if claims.get("kind") != scope.kind or claims.get("slide") != str(scope.slide_id):
                raise GpuCallNotFoundError
            call_id, started = str(claims["call"]), float(str(claims["started"]))
        try:
            reply = await run_in_threadpool(self.gate.outcome, call_id, self.hold())
        except UnknownCallError as error:
            raise GpuCallNotFoundError from error
        waited = round(max(self.clock() - started, 0.0), 3)
        if reply is None:
            logger.info(
                "gpu call waiting",
                extra={"gpu_kind": scope.kind, "waited_seconds": waited},
            )
            return GpuWaiting(
                call=self.token(scope, call_id, started),
                waited_seconds=waited,
                hold_seconds=HOLD_SECONDS,
            )
        logger.info(
            "gpu call answered",
            extra={
                "gpu_kind": scope.kind,
                "waited_seconds": waited,
                "slow_wait": waited > SLOW_WAIT_SECONDS,
            },
        )
        return GpuAnswer(reply, waited)

    async def cancel(self, token: str, tenant_id: uuid.UUID, viewer: str) -> str | None:
        try:
            claims = self.opened(token, tenant_id, viewer)
        except GpuCallNotFoundError:
            return None
        await run_in_threadpool(self.gate.cancel, str(claims["call"]))
        waited = round(max(self.clock() - float(str(claims["started"])), 0.0), 3)
        logger.info(
            "gpu call cancelled",
            extra={"gpu_kind": claims.get("kind"), "waited_seconds": waited},
        )
        return str(claims.get("kind"))


def gpu_calls_of(gate: Annotated[WarmGate, Depends(warm_gate_of)], settings: Settings) -> GpuCalls:
    return GpuCalls(gate, usable_keys(settings.tile_token_key))


def scope_of(
    kind: str, principal: CurrentPrincipal, tenant_id: uuid.UUID, slide_id: uuid.UUID
) -> GpuCallScope:
    return GpuCallScope(kind, tenant_id, slide_id, viewer_of(actor_of(principal)))


def waiting_response(waiting: GpuWaiting) -> Response:
    return Response(
        waiting.model_dump_json(),
        status_code=202,
        media_type="application/json",
        headers={"Cache-Control": "no-store", "Retry-After": "0"},
    )


@router.delete(
    "/{call}",
    status_code=204,
    operation_id="cancelGpuCall",
    **require(Permission.SEE_SLIDES, write=True),
)
async def cancel_gpu_call(
    call: str,
    principal: CurrentPrincipal,
    calls: Annotated[GpuCalls, Depends(gpu_calls_of)],
) -> Response:
    if isinstance(principal, MemberPrincipal | ServicePrincipal):
        await calls.cancel(call, principal.tenant_id, viewer_of(actor_of(principal)))
    return Response(status_code=204)
