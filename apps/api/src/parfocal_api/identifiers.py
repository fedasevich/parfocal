import hashlib
import hmac
import re
import unicodedata
import uuid
from dataclasses import dataclass
from datetime import date

from sqlalchemy import delete, func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import KeyPurpose, patients, tenant_keys
from parfocal_common.envelope import (
    DataKey,
    DataKeyUnavailableError,
    MasterKeyring,
    WrappedKey,
    decrypt,
    encrypt,
    new_data_key,
)

INDEX_BYTES = 16
FIRST_VERSION = 1


@dataclass(frozen=True)
class TenantKeys:
    tenant_id: uuid.UUID
    data: dict[int, bytes]
    index: bytes

    @property
    def current(self) -> DataKey:
        version = max(self.data)
        return DataKey(version, self.data[version])


@dataclass(frozen=True)
class PatientIdentity:
    name: str
    mrn: str | None = None
    birth_date: date | None = None


async def store_key(
    connection: AsyncConnection,
    keyring: MasterKeyring,
    tenant_id: uuid.UUID,
    purpose: KeyPurpose,
    key: DataKey,
) -> None:
    wrapped = keyring.wrap(f"{tenant_id}:{purpose}", key)
    await connection.execute(
        upsert(tenant_keys)
        .values(
            tenant_id=tenant_id,
            purpose=purpose,
            version=key.version,
            master_id=wrapped.master_id,
            wrapped_key=wrapped.blob,
        )
        .on_conflict_do_nothing()
    )


async def load_keys(
    connection: AsyncConnection, keyring: MasterKeyring, tenant_id: uuid.UUID
) -> TenantKeys:
    rows = (
        await connection.execute(select(tenant_keys).where(tenant_keys.c.tenant_id == tenant_id))
    ).all()
    unwrapped: dict[KeyPurpose, dict[int, bytes]] = {purpose: {} for purpose in KeyPurpose}
    for row in rows:
        purpose = KeyPurpose(row.purpose)
        key = keyring.unwrap(
            f"{tenant_id}:{purpose}", row.version, WrappedKey(row.master_id, row.wrapped_key)
        )
        unwrapped[purpose][row.version] = key.key
    if not unwrapped[KeyPurpose.DATA] or not unwrapped[KeyPurpose.INDEX]:
        raise DataKeyUnavailableError(FIRST_VERSION)
    return TenantKeys(tenant_id, unwrapped[KeyPurpose.DATA], unwrapped[KeyPurpose.INDEX][1])


async def ensure_keys(
    connection: AsyncConnection, keyring: MasterKeyring, tenant_id: uuid.UUID
) -> TenantKeys:
    for purpose in KeyPurpose:
        exists = await connection.scalar(
            select(func.count())
            .select_from(tenant_keys)
            .where(tenant_keys.c.tenant_id == tenant_id, tenant_keys.c.purpose == purpose)
        )
        if not exists:
            await store_key(connection, keyring, tenant_id, purpose, new_data_key(FIRST_VERSION))
    return await load_keys(connection, keyring, tenant_id)


async def rotate_data_key(
    connection: AsyncConnection, keyring: MasterKeyring, tenant_id: uuid.UUID
) -> int:
    keys = await ensure_keys(connection, keyring, tenant_id)
    version = keys.current.version + 1
    await store_key(connection, keyring, tenant_id, KeyPurpose.DATA, new_data_key(version))
    return version


async def rewrap_keys(
    connection: AsyncConnection, keyring: MasterKeyring, tenant_id: uuid.UUID | None = None
) -> int:
    statement = select(tenant_keys).where(tenant_keys.c.master_id != keyring.current)
    if tenant_id is not None:
        statement = statement.where(tenant_keys.c.tenant_id == tenant_id)
    rows = (await connection.execute(statement)).all()
    for row in rows:
        owner = f"{row.tenant_id}:{row.purpose}"
        wrapped = keyring.rewrap(owner, row.version, WrappedKey(row.master_id, row.wrapped_key))
        await connection.execute(
            update(tenant_keys)
            .where(
                tenant_keys.c.tenant_id == row.tenant_id,
                tenant_keys.c.purpose == row.purpose,
                tenant_keys.c.version == row.version,
            )
            .values(master_id=wrapped.master_id, wrapped_key=wrapped.blob)
        )
    return len(rows)


async def shred_keys(connection: AsyncConnection, tenant_id: uuid.UUID) -> int:
    removed = await connection.execute(
        delete(tenant_keys)
        .where(tenant_keys.c.tenant_id == tenant_id)
        .returning(tenant_keys.c.version)
    )
    return len(removed.all())


def fold(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value)
    return "".join(c for c in decomposed if not unicodedata.combining(c)).casefold()


def name_tokens(name: str) -> list[str]:
    return sorted({token for token in re.split(r"[^0-9a-z]+", fold(name)) if token})


def normal_mrn(mrn: str) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", mrn).upper()


def blind(keys: TenantKeys, field: str, value: str) -> bytes:
    message = f"{field}\0{value}".encode()
    return hmac.new(keys.index, message, hashlib.sha256).digest()[:INDEX_BYTES]


def context(keys: TenantKeys, patient_id: uuid.UUID, field: str) -> bytes:
    return f"patients.{field}:{keys.tenant_id}:{patient_id}".encode()


async def add_patient(
    connection: AsyncConnection, keys: TenantKeys, identity: PatientIdentity
) -> uuid.UUID:
    patient_id = uuid.uuid4()
    current = keys.current

    def sealed(field: str, value: str | None) -> bytes | None:
        return None if value is None else encrypt(current, value, context(keys, patient_id, field))

    birth_date = identity.birth_date.isoformat() if identity.birth_date else None
    await connection.execute(
        insert(patients).values(
            id=patient_id,
            tenant_id=keys.tenant_id,
            name_ciphertext=sealed("name", identity.name),
            name_tokens=[blind(keys, "name", token) for token in name_tokens(identity.name)],
            mrn_ciphertext=sealed("mrn", identity.mrn),
            mrn_index=blind(keys, "mrn", normal_mrn(identity.mrn)) if identity.mrn else None,
            birth_date_ciphertext=sealed("birth_date", birth_date),
            birth_date_index=blind(keys, "birth_date", birth_date) if birth_date else None,
        )
    )
    return patient_id


async def read_patient(
    connection: AsyncConnection, keys: TenantKeys, patient_id: uuid.UUID
) -> PatientIdentity:
    row = (
        await connection.execute(
            select(
                patients.c.name_ciphertext,
                patients.c.mrn_ciphertext,
                patients.c.birth_date_ciphertext,
            ).where(patients.c.id == patient_id, patients.c.tenant_id == keys.tenant_id)
        )
    ).one()

    def opened(field: str, value: bytes | None) -> str | None:
        return (
            None if value is None else decrypt(keys.data, value, context(keys, patient_id, field))
        )

    name = opened("name", row.name_ciphertext)
    assert name is not None
    birth_date = opened("birth_date", row.birth_date_ciphertext)
    return PatientIdentity(
        name=name,
        mrn=opened("mrn", row.mrn_ciphertext),
        birth_date=date.fromisoformat(birth_date) if birth_date else None,
    )


async def find_patients(
    connection: AsyncConnection,
    keys: TenantKeys,
    *,
    name: str | None = None,
    mrn: str | None = None,
    birth_date: date | None = None,
) -> list[uuid.UUID]:
    statement = select(patients.c.id).where(
        patients.c.tenant_id == keys.tenant_id, patients.c.deleted_at.is_(None)
    )
    if name is not None:
        tokens = [blind(keys, "name", token) for token in name_tokens(name)]
        if not tokens:
            return []
        statement = statement.where(patients.c.name_tokens.contains(tokens))
    if mrn is not None:
        statement = statement.where(patients.c.mrn_index == blind(keys, "mrn", normal_mrn(mrn)))
    if birth_date is not None:
        statement = statement.where(
            patients.c.birth_date_index == blind(keys, "birth_date", birth_date.isoformat())
        )
    return list((await connection.scalars(statement.order_by(patients.c.created_at))).all())
