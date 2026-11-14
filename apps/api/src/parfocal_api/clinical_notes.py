import uuid
from typing import Annotated

from fastapi import APIRouter, Request
from pydantic import BaseModel, ConfigDict, StringConstraints
from sqlalchemy import select, update

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.case_creation import DeIdentifiedProjectError, privacy_of, require_owner
from parfocal_api.cases import CLINICAL_NOTE_FIELD, CaseDetail, case_detail, keyring_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.identifiers import ensure_keys, seal_field
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import database_scope
from parfocal_api.problems import NotFoundError
from parfocal_api.tables import PrivacyMode, cases
from parfocal_common.structured_logging import register_sensitive

NOTE_MAX_LENGTH = 4000

NoteText = Annotated[str, StringConstraints(strip_whitespace=True, max_length=NOTE_MAX_LENGTH)]


class ClinicalNoteChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: NoteText | None


router = APIRouter(tags=["cases"])


@router.put(
    "/api/cases/{case_id}/clinical-note",
    operation_id="setCaseClinicalNote",
    **require(Permission.CREATE_CASES, write=True),
)
async def set_case_clinical_note(
    case_id: uuid.UUID,
    change: ClinicalNoteChange,
    request: Request,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> CaseDetail:
    note = change.note or None
    register_sensitive(note)
    row = (
        await connection.execute(
            select(cases.c.project_id, cases.c.clinical_note_ciphertext).where(
                cases.c.id == case_id, cases.c.deleted_at.is_(None)
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Case not found")
    mode = await privacy_of(connection, row.project_id)
    await require_owner(connection, principal, row.project_id)
    if mode is not PrivacyMode.CLINICAL:
        raise DeIdentifiedProjectError
    if note is not None or row.clinical_note_ciphertext is not None:
        tenant_id = database_scope(principal).tenant_id
        assert tenant_id is not None
        keyring = keyring_of(request)
        keys = await ensure_keys(connection, keyring, tenant_id)
        sealed = seal_field(keys, "cases", case_id, CLINICAL_NOTE_FIELD, note)
        await connection.execute(
            update(cases).where(cases.c.id == case_id).values(clinical_note_ciphertext=sealed)
        )
        await record(
            connection,
            actor_of(principal),
            AuditAction.CASE_CLINICAL_NOTE_CHANGED,
            AuditTarget.CASE,
            case_id,
            tenant_id=tenant_id,
            details={"cleared": note is None},
        )
    return await case_detail(
        connection, keyring_of(request), principal, case_id, patient_viewed=False
    )
