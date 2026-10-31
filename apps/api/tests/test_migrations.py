import asyncio
from collections.abc import Iterator

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from db_support import OWNER_URL, alembic_config, fresh_database, query, with_database
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from parfocal_api import tables
from parfocal_common.db import async_database_url, metadata
from parfocal_common.schema_sql import TABLES_WITHOUT_ROW_SECURITY, TENANT_TABLES_WITHOUT_ISOLATION

pytestmark = pytest.mark.db


@pytest.fixture
def empty_database() -> Iterator[str]:
    with fresh_database() as name:
        yield with_database(OWNER_URL, name)


def installed(url: str) -> dict[str, bool]:
    extensions = query(url, "SELECT extname FROM pg_extension")
    functions = query(url, "SELECT 1 FROM pg_proc WHERE proname = 'parfocal_touch_updated_at'")
    default_acl = query(url, "SELECT defaclacl::text FROM pg_default_acl")
    table_names = query(url, "SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
    return {
        "postgis": ("postgis",) in extensions,
        "touch_function": len(functions) == 1,
        "app_role_defaults": any("parfocal_app" in str(row[0]) for row in default_acl),
        "tenancy_tables": {("organisations",), ("tenants",)} <= set(table_names),
    }


def test_migrations_upgrade_downgrade_and_upgrade_again(empty_database: str) -> None:
    config = alembic_config(empty_database)
    everything = {
        "postgis": True,
        "touch_function": True,
        "app_role_defaults": True,
        "tenancy_tables": True,
    }

    command.upgrade(config, "head")
    assert installed(empty_database) == everything

    command.downgrade(config, "base")
    assert installed(empty_database) == dict.fromkeys(everything, False)

    command.upgrade(config, "head")
    assert installed(empty_database) == everything


def seed_admins(url: str) -> None:
    query(url, "INSERT INTO organisations (slug, name) VALUES ('lab', 'Lab')")
    query(
        url,
        "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
        "SELECT id, 'lab', 'Lab', 'research', 'eu', 'pilot' FROM organisations",
    )
    for subject in ("admin", "reviewer"):
        query(
            url,
            "INSERT INTO users (subject, display_name, initials, avatar_colour) "
            f"VALUES ('{subject}', '{subject}', 'AD', 1)",
        )
        query(
            url,
            "INSERT INTO memberships (tenant_id, user_id, role) "
            f"SELECT tenants.id, users.id, '{subject}' FROM tenants, users "
            f"WHERE users.subject = '{subject}'",
        )
        query(
            url,
            "INSERT INTO invitations (tenant_id, email, role, token_hash, expires_at) "
            f"SELECT id, '{subject}@example.test', '{subject}', '{subject}'::bytea, now() "
            "FROM tenants",
        )


def seats(url: str, table: str) -> list[tuple[object, ...]]:
    return query(url, f"SELECT role, admin_rights FROM {table} ORDER BY role")


def test_admin_memberships_and_invitations_become_researchers_with_admin_rights(
    empty_database: str,
) -> None:
    config = alembic_config(empty_database)
    command.upgrade(config, "0038")
    seed_admins(empty_database)

    command.upgrade(config, "0039")
    for table in ("memberships", "invitations"):
        assert seats(empty_database, table) == [("researcher", True), ("reviewer", False)]

    command.downgrade(config, "0038")
    for table in ("memberships", "invitations"):
        roles = query(empty_database, f"SELECT role FROM {table} ORDER BY role")
        assert roles == [("admin",), ("reviewer",)]


CONTEXT_SEED = (
    "INSERT INTO organisations (slug, name) VALUES ('lab', 'Lab')",
    "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
    "SELECT id, 'lab', 'Lab', 'research', 'eu', 'pilot' FROM organisations",
    "INSERT INTO users (subject, display_name, initials, avatar_colour) "
    "VALUES ('ana', 'ana', 'AN', 1)",
    "INSERT INTO memberships (tenant_id, user_id, role) "
    "SELECT tenants.id, users.id, 'researcher' FROM tenants, users",
    "INSERT INTO projects (tenant_id, number, name, privacy_mode) "
    "SELECT id, 1, 'Nodes', 'de-identified' FROM tenants",
    "INSERT INTO cases (tenant_id, project_id, label, source) "
    "SELECT tenant_id, id, 'S26-1', 'manual' FROM projects",
    "INSERT INTO slides (tenant_id, project_id, case_id, label) "
    "SELECT tenant_id, project_id, id, 'A1' FROM cases",
    "INSERT INTO jobs (tenant_id, project_id, kind) "
    "SELECT tenant_id, id, 'model-run' FROM projects",
)


def seed_notification(url: str, kind: str, target_type: str, target: str, payload: str) -> None:
    query(
        url,
        "INSERT INTO notifications (tenant_id, user_id, kind, target_type, target_id, payload, "
        f"in_app, realtime, email_status) SELECT tenant_id, user_id, '{kind}', '{target_type}', "
        f"({target}), '{payload}'::jsonb, true, true, 'none' FROM memberships",
    )


def test_existing_notifications_get_their_project_task_and_case(empty_database: str) -> None:
    config = alembic_config(empty_database)
    command.upgrade(config, "0041-1")
    for statement in CONTEXT_SEED:
        query(empty_database, statement)
    task = "11111111-2222-3333-4444-555555555555"
    seed_notification(
        empty_database,
        "result-set-added",
        "slide",
        "SELECT id FROM slides",
        f'{{"task_id": "{task}", "object_id": "T1"}}',
    )
    seed_notification(empty_database, "model-run-paused", "job", "SELECT id FROM jobs", "{}")
    seed_notification(
        empty_database, "emergency-access", "project", "SELECT id FROM projects", "{}"
    )
    seed_notification(empty_database, "mention", "thread", "SELECT gen_random_uuid()", "{}")

    command.upgrade(config, "0041")
    rows = query(
        empty_database,
        "SELECT n.kind, n.project_id = p.id, n.task_id::text, n.case_id = c.id "
        "FROM notifications n, projects p, cases c ORDER BY n.kind",
    )
    assert rows == [
        ("emergency-access", True, None, None),
        ("mention", None, None, None),
        ("model-run-paused", True, None, None),
        ("result-set-added", True, task, True),
    ]
    command.downgrade(config, "0041-1")


def test_every_tenant_table_is_isolated_at_head(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    assert query(empty_database, TENANT_TABLES_WITHOUT_ISOLATION) == []


def test_every_table_has_forced_row_security_at_head(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    assert query(empty_database, TABLES_WITHOUT_ROW_SECURITY) == []


async def test_models_match_the_migrations(empty_database: str) -> None:
    assert tables.tenants.metadata is metadata
    await asyncio.to_thread(command.upgrade, alembic_config(empty_database), "head")
    engine = create_async_engine(async_database_url(empty_database))

    def differences(connection: Connection) -> list[object]:
        context = MigrationContext.configure(connection)
        return [
            difference
            for difference in compare_metadata(context, metadata)
            if not (difference[0] == "remove_table" and difference[1].name == "spatial_ref_sys")
        ]

    try:
        async with engine.connect() as connection:
            assert await connection.run_sync(differences) == []
    finally:
        await engine.dispose()
