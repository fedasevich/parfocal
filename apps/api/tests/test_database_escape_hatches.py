import asyncio
import uuid
from typing import Any

import pytest
from db_support import APP_URL, OWNER_URL, query, with_database
from sqlalchemy import Executable, select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import create_async_engine
from storage_support import TEST_STORAGE
from test_tenant_isolation import Seeded, seed_both

from parfocal_api.tables import api_tokens, users
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction
from parfocal_common.object_store import StorageLocation

pytestmark = pytest.mark.db

AUTH = DatabaseScope(auth=True)


@pytest.fixture(scope="module")
def seeded(database: str, storage: StorageLocation) -> tuple[Seeded, Seeded]:
    assert storage.bucket == TEST_STORAGE.bucket
    return asyncio.run(seed_both(database))


async def execute_as_app(database: str, scope: DatabaseScope, statement: Executable) -> Any:
    engine = create_async_engine(async_database_url(with_database(APP_URL, database)))
    try:
        async with scoped_transaction(engine, scope) as connection:
            result = await connection.execute(statement)
            return result.all() if result.returns_rows else result.rowcount
    finally:
        await engine.dispose()


def run_as_app(database: str, scope: DatabaseScope, statement: Executable) -> Any:
    return asyncio.run(execute_as_app(database, scope, statement))


def owner(database: str, statement: str) -> list[tuple[object, ...]]:
    return query(with_database(OWNER_URL, database), statement)


def token_of(database: str, seeded: Seeded) -> str:
    return str(
        owner(database, f"SELECT id FROM api_tokens WHERE tenant_id = '{seeded.tenant_id}'")[0][0]
    )


def test_the_auth_scope_still_marks_a_token_as_used(
    database: str, seeded: tuple[Seeded, Seeded]
) -> None:
    a, _ = seeded
    touched = run_as_app(
        database,
        AUTH,
        update(api_tokens)
        .where(api_tokens.c.tenant_id == a.tenant_id)
        .values(last_used_at=api_tokens.c.created_at),
    )
    assert touched == 1


@pytest.mark.parametrize("column", ["tenant_id", "service_account_id", "token_hash", "expires_at"])
def test_the_auth_scope_cannot_move_or_rewrite_an_api_token(
    database: str, seeded: tuple[Seeded, Seeded], column: str
) -> None:
    a, b = seeded
    moved = {
        "tenant_id": b.tenant_id,
        "service_account_id": b.ids["service_account"],
        "token_hash": uuid.uuid4().bytes,
        "expires_at": api_tokens.c.created_at,
    }
    with pytest.raises(DBAPIError, match="permission denied"):
        run_as_app(
            database,
            AUTH,
            update(api_tokens)
            .where(api_tokens.c.tenant_id == a.tenant_id)
            .values({column: moved[column]}),
        )


def test_no_scope_revives_a_revoked_api_token(database: str, seeded: tuple[Seeded, Seeded]) -> None:
    _, b = seeded
    token = token_of(database, b)
    owner(database, f"UPDATE api_tokens SET revoked_at = now() WHERE id = '{token}'")
    revive = update(api_tokens).where(api_tokens.c.tenant_id == b.tenant_id).values(revoked_at=None)
    for scope in (AUTH, DatabaseScope(tenant_id=b.tenant_id, user_id=b.ids["user"])):
        with pytest.raises(DBAPIError, match="stays revoked"):
            run_as_app(database, scope, revive)
    assert owner(database, f"SELECT revoked_at IS NULL FROM api_tokens WHERE id = '{token}'") == [
        (False,)
    ]


@pytest.mark.parametrize("column", ["email", "subject"])
def test_a_member_cannot_change_their_own_email_or_subject_in_the_database(
    database: str, seeded: tuple[Seeded, Seeded], column: str
) -> None:
    a, _ = seeded
    change = update(users).where(users.c.id == a.ids["user"]).values({column: "x@other.example"})
    for scope in (
        DatabaseScope(tenant_id=a.tenant_id, user_id=a.ids["user"]),
        DatabaseScope(user_id=a.ids["user"]),
    ):
        with pytest.raises(DBAPIError, match="auth or platform scope"):
            run_as_app(database, scope, change)


def test_a_member_still_changes_their_own_email_schedule(
    database: str, seeded: tuple[Seeded, Seeded]
) -> None:
    a, _ = seeded
    scope = DatabaseScope(tenant_id=a.tenant_id, user_id=a.ids["user"])
    changed = run_as_app(
        database,
        scope,
        update(users).where(users.c.id == a.ids["user"]).values(email_digest="hourly"),
    )
    assert changed == 1


def test_the_auth_and_platform_scopes_still_change_an_email(
    database: str, seeded: tuple[Seeded, Seeded]
) -> None:
    a, _ = seeded
    for scope in (AUTH, DatabaseScope(platform=True)):
        email = f"moved-{uuid.uuid4().hex[:8]}@example.test"
        changed = run_as_app(
            database, scope, update(users).where(users.c.id == a.ids["user"]).values(email=email)
        )
        assert changed == 1


def test_a_person_cannot_delete_their_own_row(database: str, seeded: tuple[Seeded, Seeded]) -> None:
    _, b = seeded
    scope = DatabaseScope(tenant_id=b.tenant_id, user_id=b.ids["user"])
    assert run_as_app(database, scope, users.delete().where(users.c.id == b.ids["user"])) == 0
    assert run_as_app(database, scope, select(users.c.id).where(users.c.id == b.ids["user"])) != []
