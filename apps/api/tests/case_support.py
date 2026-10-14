import uuid
from dataclasses import dataclass
from datetime import date

from db_support import TEST_MASTER_KEYS
from sqlalchemy import insert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.identifiers import PatientIdentity, add_patient, ensure_keys, seal_field
from parfocal_api.tables import blocks, cases, slides, specimens
from parfocal_common.envelope import MasterKeyring

TEST_KEYRING = MasterKeyring.from_setting(TEST_MASTER_KEYS)
NOTE = "Lump in the left breast, sentinel node sent"
QUESTION = "Metastasis in the sentinel node?"


@dataclass(frozen=True)
class SeededCase:
    case_id: uuid.UUID
    patient_id: uuid.UUID
    accession: str
    specimen_ids: list[uuid.UUID]
    block_ids: list[uuid.UUID]
    slide_ids: list[uuid.UUID]


async def seed_case(connection: AsyncConnection, tenant_id: uuid.UUID) -> SeededCase:
    keys = await ensure_keys(connection, TEST_KEYRING, tenant_id)
    patient_id = await add_patient(
        connection,
        keys,
        PatientIdentity("Eva Testová", f"MRN{uuid.uuid4().hex[:6]}", date(1970, 1, 2)),
    )
    case_id = uuid.uuid4()
    accession = f"S26-{uuid.uuid4().hex[:6].upper()}"
    await connection.execute(
        insert(cases).values(
            id=case_id,
            tenant_id=tenant_id,
            patient_id=patient_id,
            accession=accession,
            priority="stat",
            source="manual",
            clinical_note=seal_field(keys, "cases", case_id, "clinical_note", NOTE),
            clinical_question=seal_field(keys, "cases", case_id, "clinical_question", QUESTION),
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
    await connection.execute(
        insert(slides),
        [
            {
                "id": slide_ids[0],
                "tenant_id": tenant_id,
                "case_id": case_id,
                "block_id": block_ids[0],
                "barcode": f"{accession}-A1",
            },
            {
                "id": slide_ids[1],
                "tenant_id": tenant_id,
                "case_id": case_id,
                "block_id": None,
                "barcode": None,
            },
        ],
    )
    return SeededCase(case_id, patient_id, accession, specimen_ids, block_ids, slide_ids)
