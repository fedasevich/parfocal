import uuid

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.envelope import MasterKeyring, WrappedKey, decrypt

DATA_PURPOSE = "data"
DATA_KEYS = text(
    "SELECT version, master_id, wrapped_key FROM tenant_keys "
    "WHERE tenant_id = :tenant_id AND purpose = :purpose"
)


def field_context(table: str, tenant_id: uuid.UUID, row_id: uuid.UUID, field: str) -> bytes:
    return f"{table}.{field}:{tenant_id}:{row_id}".encode()


async def data_keys(
    connection: AsyncConnection, keyring: MasterKeyring, tenant_id: uuid.UUID
) -> dict[int, bytes]:
    rows = (
        await connection.execute(DATA_KEYS, {"tenant_id": tenant_id, "purpose": DATA_PURPOSE})
    ).all()
    owner = f"{tenant_id}:{DATA_PURPOSE}"
    return {
        row.version: keyring.unwrap(
            owner, row.version, WrappedKey(row.master_id, row.wrapped_key)
        ).key
        for row in rows
    }


async def open_sealed(
    connection: AsyncConnection,
    keyring: MasterKeyring,
    tenant_id: uuid.UUID,
    table: str,
    row_id: uuid.UUID,
    field: str,
    ciphertext: bytes,
) -> str:
    keys = await data_keys(connection, keyring, tenant_id)
    return decrypt(keys, ciphertext, field_context(table, tenant_id, row_id, field))
