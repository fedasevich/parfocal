import logging
import uuid
from dataclasses import dataclass
from typing import Annotated, Protocol, cast

from fastapi import APIRouter, Depends, Path, Request
from pydantic import BaseModel
from sqlalchemy import select

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, member_of, require
from parfocal_api.problems import BadRequestError, ProblemError
from parfocal_api.study_projects import (
    CODE_PATTERN,
    STUDY_WORKSPACE,
    checked_code,
    remove_participant,
    seed_participant,
)
from parfocal_api.tables import users
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_store import ResultStore

logger = logging.getLogger("parfocal.api.study_participants")

ParticipantCode = Annotated[str, Path(min_length=1, max_length=32, pattern=CODE_PATTERN.pattern)]


@dataclass(frozen=True)
class SeededParticipant:
    code: str
    tenant_id: uuid.UUID
    project_id: uuid.UUID


class StudySeeder(Protocol):
    async def seed(self, code: str, seat_email: str) -> SeededParticipant: ...

    async def remove(self, code: str) -> int: ...


class InProcessStudySeeder:
    def __init__(self, database_url: str, store: ObjectStore, results: ResultStore) -> None:
        self.database_url = database_url
        self.store = store
        self.results = results

    async def seed(self, code: str, seat_email: str) -> SeededParticipant:
        made = await seed_participant(self.database_url, self.store, self.results, code, seat_email)
        return SeededParticipant(made.code, made.tenant_id, made.project_id)

    async def remove(self, code: str) -> int:
        return await remove_participant(self.database_url, code)


class PreparedStudyParticipant(BaseModel):
    code: str
    project_id: uuid.UUID
    workspace_id: uuid.UUID
    workspace_name: str


class RemovedStudyParticipant(BaseModel):
    code: str
    removed: int


class StudySeatWithoutEmailError(BadRequestError):
    code = "study-seat-without-email"
    title = "Your account has no email, so it cannot be a study seat"


class StudySeedFailedError(ProblemError):
    status = 503
    code = "study-seed-failed"
    title = "The participant's project could not be seeded, try again"


async def seat_email_of(connection: TenantConnection, user_id: uuid.UUID) -> str | None:
    return await connection.scalar(select(users.c.email).where(users.c.id == user_id))


def study_seeder_of(request: Request) -> StudySeeder:
    seeder = getattr(request.app.state, "study_seeder", None)
    if seeder is not None:
        return cast("StudySeeder", seeder)
    app = request.app
    settings = app.settings
    database_url = settings.seed_database_url or settings.database_url
    return InProcessStudySeeder(str(database_url), app.state.storage, app.results)


type Seeder = Annotated[StudySeeder, Depends(study_seeder_of)]

router = APIRouter(prefix="/api/tenant/study-participants", tags=["study"])


@router.post(
    "/{code}",
    operation_id="prepareStudyParticipant",
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def prepare_study_participant(
    code: ParticipantCode,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    seeder: Seeder,
) -> PreparedStudyParticipant:
    member = member_of(principal)
    email = await seat_email_of(connection, member.user_id)
    if not email:
        raise StudySeatWithoutEmailError
    try:
        made = await seeder.seed(checked_code(code), email)
    except ProblemError:
        raise
    except Exception as error:
        logger.exception("study seed failed")
        raise StudySeedFailedError from error
    return PreparedStudyParticipant(
        code=made.code,
        project_id=made.project_id,
        workspace_id=made.tenant_id,
        workspace_name=STUDY_WORKSPACE.name,
    )


@router.delete(
    "/{code}",
    operation_id="removeStudyParticipant",
    **require(Permission.MANAGE_PEOPLE, write=True),
)
async def remove_study_participant(
    code: ParticipantCode, seeder: Seeder
) -> RemovedStudyParticipant:
    checked = checked_code(code)
    try:
        removed = await seeder.remove(checked)
    except Exception as error:
        logger.exception("study remove failed")
        raise StudySeedFailedError from error
    return RemovedStudyParticipant(code=checked, removed=removed)
