import asyncio
import base64
import os
import uuid
from collections.abc import Awaitable, Callable
from datetime import date
from typing import Any

import pytest
from db_support import APP_URL, OWNER_URL, query, with_database
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

from parfocal_api.identifiers import (
    PatientIdentity,
    add_patient,
    ensure_keys,
    find_patients,
    load_keys,
    read_patient,
    rewrap_keys,
    rotate_data_key,
    shred_keys,
)
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction
from parfocal_common.envelope import (
    DataKeyUnavailableError,
    InvalidCiphertextError,
    MasterKeyring,
    UnknownMasterKeyError,
)

pytestmark = pytest.mark.db

JANA = PatientIdentity("Jana Nováková", "ab 123 456", date(1961, 4, 2))
PETR = PatientIdentity("Petr Novák", "CD-9", date(1961, 4, 2))


def master_key() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode()


KEYRING = MasterKeyring.from_setting(f"m1:{master_key()}")


def make_tenant(database: str) -> uuid.UUID:
    slug = f"phi-{uuid.uuid4().hex[:10]}"
    rows = query(
        with_database(OWNER_URL, database),
        "WITH organisation AS (INSERT INTO organisations (slug, name) "
        f"VALUES ('{slug}', '{slug}') RETURNING id) "
        "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
        f"SELECT id, '{slug}', '{slug}', 'diagnostic', 'eu', 'pilot' FROM organisation "
        "RETURNING id",
    )
    return uuid.UUID(str(rows[0][0]))


def run[T](
    database: str, scope: DatabaseScope, work: Callable[[AsyncConnection], Awaitable[T]]
) -> T:
    async def go() -> T:
        engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, scope) as connection:
                return await work(connection)
        finally:
            await engine.dispose()

    return asyncio.run(go())


def in_tenant(
    database: str, tenant_id: uuid.UUID, work: Callable[[AsyncConnection], Awaitable[Any]]
) -> Any:
    return run(database, DatabaseScope(tenant_id=tenant_id), work)


def admit(
    database: str, tenant_id: uuid.UUID, *people: PatientIdentity, keyring: MasterKeyring = KEYRING
) -> list[uuid.UUID]:
    async def work(connection: AsyncConnection) -> list[uuid.UUID]:
        keys = await ensure_keys(connection, keyring, tenant_id)
        return [await add_patient(connection, keys, person) for person in people]

    return in_tenant(database, tenant_id, work)


def read(
    database: str, tenant_id: uuid.UUID, patient_id: uuid.UUID, keyring: MasterKeyring = KEYRING
) -> PatientIdentity:
    async def work(connection: AsyncConnection) -> PatientIdentity:
        return await read_patient(
            connection, await load_keys(connection, keyring, tenant_id), patient_id
        )

    return in_tenant(database, tenant_id, work)


def find(database: str, tenant_id: uuid.UUID, **criteria: Any) -> list[uuid.UUID]:
    async def work(connection: AsyncConnection) -> list[uuid.UUID]:
        keys = await load_keys(connection, KEYRING, tenant_id)
        return await find_patients(connection, keys, **criteria)

    return in_tenant(database, tenant_id, work)


def test_identifiers_are_ciphertext_at_rest_and_read_back(database: str) -> None:
    tenant = make_tenant(database)
    (jana,) = admit(database, tenant, JANA)
    assert read(database, tenant, jana) == JANA
    raw = query(
        with_database(OWNER_URL, database),
        f"SELECT patients::text FROM patients WHERE id = '{jana}'",
    )
    stored = str(raw[0][0])
    for plain in ("Jana", "Nov", "123", "1961", "ab 123"):
        assert plain not in stored
    hexed = stored.lower()
    for plain in (b"Jana".hex(), b"123 456".hex(), b"1961-04-02".hex()):
        assert plain not in hexed


def test_search_matches_normalised_names_mrn_and_birth_date(database: str) -> None:
    tenant = make_tenant(database)
    jana, petr = admit(database, tenant, JANA, PETR)
    assert find(database, tenant, mrn="AB123456") == [jana]
    assert find(database, tenant, mrn=" ab 123 456 ") == [jana]
    assert find(database, tenant, name="NOVAKOVA") == [jana]
    assert find(database, tenant, name="jana nováková") == [jana]
    assert find(database, tenant, name="novak") == [petr]
    assert find(database, tenant, name="Jana Novák") == []
    assert find(database, tenant, birth_date=date(1961, 4, 2)) == [jana, petr]
    assert find(database, tenant, birth_date=date(1961, 4, 2), name="petr") == [petr]
    assert find(database, tenant, name="!!") == []


def test_another_workspace_finds_nothing_and_gets_other_indexes(database: str) -> None:
    mine, theirs = make_tenant(database), make_tenant(database)
    admit(database, mine, JANA)
    admit(database, theirs, PETR)
    assert find(database, theirs, mrn="AB123456") == []
    assert find(database, theirs, name="jana") == []
    (other_jana,) = admit(database, theirs, JANA)
    indexes = query(
        with_database(OWNER_URL, database),
        "SELECT count(DISTINCT mrn_index) FROM patients "
        f"WHERE tenant_id IN ('{mine}', '{theirs}') AND mrn_ciphertext IS NOT NULL",
    )
    assert indexes == [(3,)]
    assert find(database, theirs, mrn="AB123456") == [other_jana]


def test_one_mrn_per_workspace(database: str) -> None:
    tenant = make_tenant(database)
    admit(database, tenant, JANA)
    with pytest.raises(IntegrityError):
        admit(database, tenant, PatientIdentity("Someone Else", "AB 123456"))


def test_a_value_moved_to_another_patient_does_not_open(database: str) -> None:
    tenant = make_tenant(database)
    jana, petr = admit(database, tenant, JANA, PETR)
    query(
        with_database(OWNER_URL, database),
        "UPDATE patients SET name_ciphertext = "
        f"(SELECT name_ciphertext FROM patients WHERE id = '{jana}') WHERE id = '{petr}'",
    )
    with pytest.raises(InvalidCiphertextError):
        read(database, tenant, petr)


def test_shredding_the_keys_makes_the_workspace_unreadable(database: str) -> None:
    tenant = make_tenant(database)
    (jana,) = admit(database, tenant, JANA)

    async def shred(connection: AsyncConnection) -> int:
        return await shred_keys(connection, tenant)

    assert run(database, DatabaseScope(tenant_id=tenant), shred) == 0
    assert read(database, tenant, jana) == JANA
    assert run(database, DatabaseScope(platform=True), shred) == 2
    with pytest.raises(DataKeyUnavailableError):
        read(database, tenant, jana)
    with pytest.raises(DataKeyUnavailableError):
        find(database, tenant, mrn="AB123456")
    remaining = query(
        with_database(OWNER_URL, database), f"SELECT count(*) FROM patients WHERE id = '{jana}'"
    )
    assert remaining == [(1,)]


def test_a_new_data_key_writes_new_values_and_reads_old_ones(database: str) -> None:
    tenant = make_tenant(database)
    (jana,) = admit(database, tenant, JANA)

    async def rotate(connection: AsyncConnection) -> int:
        return await rotate_data_key(connection, KEYRING, tenant)

    assert in_tenant(database, tenant, rotate) == 2
    (petr,) = admit(database, tenant, PETR)
    versions = query(
        with_database(OWNER_URL, database),
        "SELECT get_byte(name_ciphertext, 2) FROM patients "
        f"WHERE id IN ('{jana}', '{petr}') ORDER BY created_at",
    )
    assert versions == [(1,), (2,)]
    assert read(database, tenant, jana) == JANA
    assert read(database, tenant, petr) == PETR
    assert find(database, tenant, mrn="CD9") == [petr]


def test_rotating_the_master_key_rewraps_without_touching_data(database: str) -> None:
    tenant = make_tenant(database)
    old = master_key()
    first = MasterKeyring.from_setting(f"old:{old}")
    (jana,) = admit(database, tenant, JANA, keyring=first)
    before = query(
        with_database(OWNER_URL, database),
        f"SELECT name_ciphertext FROM patients WHERE id = '{jana}'",
    )
    new = master_key()
    during = MasterKeyring.from_setting(f"new:{new},old:{old}")

    async def rewrap(connection: AsyncConnection) -> int:
        return await rewrap_keys(connection, during, tenant)

    assert run(database, DatabaseScope(platform=True), rewrap) == 2
    assert run(database, DatabaseScope(platform=True), rewrap) == 0
    after = MasterKeyring.from_setting(f"new:{new}")
    assert read(database, tenant, jana, keyring=after) == JANA
    with pytest.raises(UnknownMasterKeyError):
        read(database, tenant, jana, keyring=first)
    unchanged = query(
        with_database(OWNER_URL, database),
        f"SELECT name_ciphertext FROM patients WHERE id = '{jana}'",
    )
    assert unchanged == before
