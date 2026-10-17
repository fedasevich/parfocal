import uuid
from dataclasses import dataclass
from datetime import date

from db_support import TEST_MASTER_KEYS
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.identifiers import PatientIdentity, add_patient, ensure_keys
from parfocal_api.tables import PrivacyMode, blocks, cases, projects, slides, specimens
from parfocal_common.envelope import MasterKeyring

TEST_KEYRING = MasterKeyring.from_setting(TEST_MASTER_KEYS)


@dataclass(frozen=True)
class SeededCase:
    project_id: uuid.UUID
    case_id: uuid.UUID
    patient_id: uuid.UUID
    label: str
    specimen_ids: list[uuid.UUID]
    block_ids: list[uuid.UUID]
    slide_ids: list[uuid.UUID]
    loose_slide_id: uuid.UUID


async def seed_project(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    privacy_mode: PrivacyMode = PrivacyMode.CLINICAL,
) -> uuid.UUID:
    number = select(func.coalesce(func.max(projects.c.number), 0) + 1).where(
        projects.c.tenant_id == tenant_id
    )
    project_id = await connection.scalar(
        insert(projects)
        .values(
            tenant_id=tenant_id,
            number=number.scalar_subquery(),
            name=f"Project {uuid.uuid4().hex[:8]}",
            privacy_mode=privacy_mode,
        )
        .returning(projects.c.id)
    )
    assert isinstance(project_id, uuid.UUID)
    return project_id


async def seed_case(connection: AsyncConnection, tenant_id: uuid.UUID) -> SeededCase:
    project_id = await seed_project(connection, tenant_id)
    keys = await ensure_keys(connection, TEST_KEYRING, tenant_id)
    patient_id = await add_patient(
        connection,
        keys,
        project_id,
        PatientIdentity("Eva Testová", f"MRN{uuid.uuid4().hex[:6]}", date(1970, 1, 2)),
    )
    case_id = uuid.uuid4()
    label = f"S26-{uuid.uuid4().hex[:6].upper()}"
    await connection.execute(
        insert(cases).values(
            id=case_id,
            tenant_id=tenant_id,
            project_id=project_id,
            patient_id=patient_id,
            label=label,
            source="manual",
        )
    )
    specimen_ids: list[uuid.UUID] = []
    block_ids: list[uuid.UUID] = []
    for letter in ("A", "B"):
        specimen_id = uuid.uuid4()
        specimen_ids.append(specimen_id)
        await connection.execute(
            insert(specimens).values(
                id=specimen_id,
                tenant_id=tenant_id,
                case_id=case_id,
                letter=letter,
                type="Lymph node",
                laterality="left",
            )
        )
        block_id = uuid.uuid4()
        block_ids.append(block_id)
        await connection.execute(
            insert(blocks).values(
                id=block_id, tenant_id=tenant_id, case_id=case_id, specimen_id=specimen_id, number=1
            )
        )
    slide_ids = [uuid.uuid4(), uuid.uuid4()]
    loose_slide_id = uuid.uuid4()
    await connection.execute(
        insert(slides),
        [
            {
                "id": slide_ids[0],
                "tenant_id": tenant_id,
                "project_id": project_id,
                "case_id": case_id,
                "block_id": block_ids[0],
                "label": "A1",
                "barcode": f"{label}-A1",
            },
            {
                "id": slide_ids[1],
                "tenant_id": tenant_id,
                "project_id": project_id,
                "case_id": case_id,
                "block_id": None,
                "label": "A2",
                "barcode": None,
            },
            {
                "id": loose_slide_id,
                "tenant_id": tenant_id,
                "project_id": project_id,
                "case_id": None,
                "block_id": None,
                "label": f"tcga-{uuid.uuid4().hex[:4]}",
                "barcode": None,
            },
        ],
    )
    return SeededCase(
        project_id, case_id, patient_id, label, specimen_ids, block_ids, slide_ids, loose_slide_id
    )
