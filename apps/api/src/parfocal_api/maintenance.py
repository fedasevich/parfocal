import time
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from enum import StrEnum
from typing import Annotated, cast

from fastapi import APIRouter, Request
from pydantic import BaseModel, StringConstraints
from sqlalchemy import func, select, update
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine
from starlette.types import ASGIApp, Receive, Scope, Send

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, PlatformConnection, engine_of
from parfocal_api.origin_check import UNSAFE_METHODS
from parfocal_api.problems import BadRequestError, problem_response
from parfocal_api.tables import maintenance
from parfocal_common.db import DatabaseScope, scoped_transaction

CHECK_SECONDS = 5.0
RETRY_AFTER_SECONDS = 60
MAINTENANCE_PATH = "/api/platform/maintenance"
OPEN_DURING_MAINTENANCE = (
    "/api/auth/sign-in",
    "/api/auth/activity",
    "/api/auth/sessions",
    MAINTENANCE_PATH,
)
MAINTENANCE_CODE = "maintenance"
MAINTENANCE_TITLE = "Parfocal is under maintenance, so changes are paused"

type MaintenanceMessage = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=300)
]


class ServiceStatus(StrEnum):
    OK = "ok"
    MAINTENANCE = "maintenance"


class Maintenance(BaseModel):
    message: str
    started_at: datetime
    expected_end_at: datetime | None


class PlatformStatus(BaseModel):
    status: ServiceStatus
    maintenance: Maintenance | None


class MaintenanceStart(BaseModel):
    message: MaintenanceMessage
    expected_end_at: datetime | None = None


class EndInThePastError(BadRequestError):
    code = "maintenance-end-in-the-past"
    title = "The expected end of maintenance must be ahead"


async def current_maintenance(connection: AsyncConnection) -> Maintenance | None:
    row = (
        await connection.execute(
            select(maintenance.c.message, maintenance.c.started_at, maintenance.c.expected_end_at)
        )
    ).first()
    if row is None or row.started_at is None:
        return None
    return Maintenance(
        message=row.message, started_at=row.started_at, expected_end_at=row.expected_end_at
    )


def status_of(current: Maintenance | None) -> PlatformStatus:
    if current is None:
        return PlatformStatus(status=ServiceStatus.OK, maintenance=None)
    return PlatformStatus(status=ServiceStatus.MAINTENANCE, maintenance=current)


@dataclass
class MaintenanceState:
    engine: AsyncEngine
    clock: Callable[[], float] = time.monotonic
    checked_at: float | None = None
    current: Maintenance | None = None

    async def read(self) -> Maintenance | None:
        now = self.clock()
        if self.checked_at is not None and now - self.checked_at < CHECK_SECONDS:
            return self.current
        try:
            async with scoped_transaction(self.engine, DatabaseScope()) as connection:
                found = await current_maintenance(connection)
        except SQLAlchemyError, OSError:
            return self.current
        self.remember(found)
        return found

    def remember(self, current: Maintenance | None) -> None:
        self.current = current
        self.checked_at = self.clock()


def stays_open(path: str) -> bool:
    return any(
        path == open_path or path.startswith(f"{open_path}/")
        for open_path in OPEN_DURING_MAINTENANCE
    )


class MaintenanceGate:
    def __init__(self, app: ASGIApp, state: MaintenanceState) -> None:
        self.app = app
        self.state = state

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if (
            scope["type"] == "http"
            and scope["method"] in UNSAFE_METHODS
            and not stays_open(scope["path"])
        ):
            current = await self.state.read()
            if current is not None:
                response = problem_response(
                    503, MAINTENANCE_CODE, MAINTENANCE_TITLE, detail=current.message
                )
                response.headers["Retry-After"] = str(RETRY_AFTER_SECONDS)
                await response(scope, receive, send)
                return
        await self.app(scope, receive, send)


def state_of(request: Request) -> MaintenanceState:
    return cast("MaintenanceState", request.app.state.maintenance)


router = APIRouter(prefix="/api/status", tags=["status"])
platform_router = APIRouter(prefix=MAINTENANCE_PATH, tags=["platform"])


@router.get("", operation_id="getPlatformStatus")
async def get_platform_status(request: Request) -> PlatformStatus:
    async with scoped_transaction(engine_of(request), DatabaseScope()) as connection:
        current = await current_maintenance(connection)
    state_of(request).remember(current)
    return status_of(current)


@platform_router.put("", operation_id="startMaintenance")
async def start_maintenance(
    start: MaintenanceStart,
    request: Request,
    principal: CurrentPrincipal,
    connection: PlatformConnection,
) -> PlatformStatus:
    if start.expected_end_at is not None and start.expected_end_at <= datetime.now(UTC):
        raise EndInThePastError
    await connection.execute(
        update(maintenance).values(
            message=start.message,
            started_at=func.coalesce(maintenance.c.started_at, func.now()),
            expected_end_at=start.expected_end_at,
        )
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.MAINTENANCE_STARTED,
        AuditTarget.MAINTENANCE,
        details={"message": start.message},
    )
    current = await current_maintenance(connection)
    state_of(request).remember(current)
    return status_of(current)


@platform_router.delete("", operation_id="endMaintenance")
async def end_maintenance(
    request: Request, principal: CurrentPrincipal, connection: PlatformConnection
) -> PlatformStatus:
    ended = await connection.scalar(
        update(maintenance)
        .where(maintenance.c.started_at.is_not(None))
        .values(message=None, started_at=None, expected_end_at=None)
        .returning(maintenance.c.id)
    )
    if ended is not None:
        await record(
            connection, actor_of(principal), AuditAction.MAINTENANCE_ENDED, AuditTarget.MAINTENANCE
        )
    state_of(request).remember(None)
    return status_of(None)
