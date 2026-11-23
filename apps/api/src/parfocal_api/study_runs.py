import base64
import binascii
import json
import zlib
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Path
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, member_of, require
from parfocal_api.problems import BadRequestError, NotFoundError
from parfocal_api.tables import study_sessions, study_trace_parts

PART_LIMIT = 2 * 1024 * 1024
ANSWERS_LIMIT = 1024 * 1024
TRACE_LIMIT = 64 * 1024 * 1024
GZIP_MAGIC = b"\x1f\x8b"

SessionKey = Annotated[str, Path(min_length=1, max_length=80, pattern=r"^[A-Za-z0-9._\-]+$")]
Participant = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]
Gzipped = Annotated[str, StringConstraints(min_length=4, max_length=PART_LIMIT * 4 // 3 + 4)]


class StudySessionUpload(BaseModel):
    participant: Participant
    round: Annotated[int, Field(ge=1, le=1000)]
    answers_gz: Gzipped


class StudyTraceUpload(BaseModel):
    events_gz: Gzipped


class StudyUploadSaved(BaseModel):
    session_key: str


class StudySessionRow(BaseModel):
    session_key: str
    participant: str
    round: int
    dry_run: bool
    answers: dict[str, Any]
    trace_parts: int
    updated_at: datetime


class StudySessions(BaseModel):
    sessions: list[StudySessionRow]


class StudyTracePart(BaseModel):
    seq: int
    events_gz: str


class StudyTrace(BaseModel):
    parts: list[StudyTracePart]


class StudyDryRun(BaseModel):
    dry_run: bool


class NotGzipError(BadRequestError):
    code = "study-upload-not-gzip"
    title = "A study upload must be gzipped JSON within its size limit"


class StudySessionNotFoundError(NotFoundError):
    code = "study-session-not-found"
    title = "This study session was never uploaded"


def gunzipped(encoded: str, limit: int) -> tuple[bytes, bytes]:
    try:
        packed = base64.b64decode(encoded, validate=True)
    except binascii.Error as error:
        raise NotGzipError from error
    if len(packed) > PART_LIMIT or not packed.startswith(GZIP_MAGIC):
        raise NotGzipError
    inflater = zlib.decompressobj(wbits=31)
    try:
        raw = inflater.decompress(packed, limit + 1)
    except zlib.error as error:
        raise NotGzipError from error
    if len(raw) > limit or not inflater.eof:
        raise NotGzipError
    return packed, raw


def parsed_json(raw: bytes) -> Any:
    try:
        return json.loads(raw)
    except ValueError as error:
        raise NotGzipError from error


me_router = APIRouter(prefix="/api/me/study-sessions", tags=["study"])
tenant_router = APIRouter(prefix="/api/tenant/study-sessions", tags=["study"])


@me_router.put("/{session_key}", operation_id="saveStudySession")
async def save_study_session(
    session_key: SessionKey,
    upload: StudySessionUpload,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> StudyUploadSaved:
    member = member_of(principal)
    _, raw = gunzipped(upload.answers_gz, ANSWERS_LIMIT)
    answers: object = parsed_json(raw)
    if not isinstance(answers, dict):
        raise NotGzipError
    values: dict[str, object] = {
        "participant": upload.participant,
        "round": upload.round,
        "answers": answers,
    }
    await connection.execute(
        insert(study_sessions)
        .values(tenant_id=member.tenant_id, session_key=session_key, **values)
        .on_conflict_do_update(
            constraint="uq_study_sessions_tenant_id_session_key",
            set_={**values, "updated_at": func.now()},
        )
    )
    return StudyUploadSaved(session_key=session_key)


@me_router.put("/{session_key}/trace/{seq}", operation_id="saveStudyTracePart")
async def save_study_trace_part(
    session_key: SessionKey,
    seq: Annotated[int, Path(ge=0, le=2**62)],
    upload: StudyTraceUpload,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> StudyUploadSaved:
    member = member_of(principal)
    packed, raw = gunzipped(upload.events_gz, TRACE_LIMIT)
    if not isinstance(parsed_json(raw), list):
        raise NotGzipError
    await connection.execute(
        insert(study_trace_parts)
        .values(
            tenant_id=member.tenant_id,
            session_key=session_key,
            seq=seq,
            body=packed,
            size=len(packed),
        )
        .on_conflict_do_nothing(constraint="uq_study_trace_parts_tenant_id_session_key_seq")
    )
    return StudyUploadSaved(session_key=session_key)


@tenant_router.get("", operation_id="listStudySessions", **require(Permission.CREATE_CASES))
async def list_study_sessions(connection: TenantConnection) -> StudySessions:
    parts = (
        select(study_trace_parts.c.session_key, func.count().label("parts"))
        .group_by(study_trace_parts.c.session_key)
        .subquery()
    )
    rows = await connection.execute(
        select(study_sessions, func.coalesce(parts.c.parts, 0).label("trace_parts"))
        .outerjoin(parts, parts.c.session_key == study_sessions.c.session_key)
        .order_by(study_sessions.c.created_at, study_sessions.c.session_key)
    )
    return StudySessions(
        sessions=[
            StudySessionRow(
                session_key=row.session_key,
                participant=row.participant,
                round=row.round,
                dry_run=row.dry_run,
                answers=row.answers,
                trace_parts=row.trace_parts,
                updated_at=row.updated_at,
            )
            for row in rows
        ]
    )


@tenant_router.get(
    "/{session_key}/trace", operation_id="getStudyTrace", **require(Permission.CREATE_CASES)
)
async def get_study_trace(session_key: SessionKey, connection: TenantConnection) -> StudyTrace:
    rows = await connection.execute(
        select(study_trace_parts.c.seq, study_trace_parts.c.body)
        .where(study_trace_parts.c.session_key == session_key)
        .order_by(study_trace_parts.c.seq)
    )
    return StudyTrace(
        parts=[
            StudyTracePart(seq=row.seq, events_gz=base64.b64encode(row.body).decode())
            for row in rows
        ]
    )


@tenant_router.put(
    "/{session_key}/dry-run",
    operation_id="markStudyDryRun",
    **require(Permission.CREATE_CASES, write=True),
)
async def mark_study_dry_run(
    session_key: SessionKey, mark: StudyDryRun, connection: TenantConnection
) -> StudyDryRun:
    changed = await connection.execute(
        update(study_sessions)
        .where(study_sessions.c.session_key == session_key)
        .values(dry_run=mark.dry_run, updated_at=func.now())
        .returning(study_sessions.c.dry_run)
    )
    if changed.first() is None:
        raise StudySessionNotFoundError
    return mark
