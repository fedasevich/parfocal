import asyncio
import json
import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from db_support import OWNER_URL, alembic_config, fresh_database, query, with_database
from sqlalchemy import Connection
from sqlalchemy.ext.asyncio import create_async_engine

from parfocal_api import tables
from parfocal_api.legacy_names import OLD_REVIEW_TABLE
from parfocal_common.db import async_database_url, metadata
from parfocal_common.schema_sql import (
    POLICIES,
    TABLES_WITHOUT_ROW_SECURITY,
    TENANT_TABLES_WITHOUT_ISOLATION,
)

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


def test_existing_notifications_are_not_muted(empty_database: str) -> None:
    config = alembic_config(empty_database)
    command.upgrade(config, "0043-1")
    for statement in CONTEXT_SEED:
        query(empty_database, statement)
    seed_notification(empty_database, "model-run-paused", "job", "SELECT id FROM jobs", "{}")

    command.upgrade(config, "0043")
    assert query(empty_database, "SELECT kind, muted FROM notifications") == [
        ("model-run-paused", False)
    ]
    command.downgrade(config, "0043-1")
    columns = query(
        empty_database,
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_name = 'notifications' AND column_name = 'muted'",
    )
    assert columns == []


def test_every_tenant_table_is_isolated_at_head(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    assert query(empty_database, TENANT_TABLES_WITHOUT_ISOLATION) == []


def test_every_table_has_forced_row_security_at_head(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    assert query(empty_database, TABLES_WITHOUT_ROW_SECURITY) == []


REVIEWED_POLICIES = Path(__file__).parent / "fixtures" / "policies_at_head.json"
STANDARD_POLICY: tuple[object, ...] = (
    "tenant_isolation",
    "*",
    True,
    "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
    "(tenant_id = (NULLIF(current_setting('app.tenant_id'::text, true), ''::text))::uuid)",
    [],
)


def policies_of(url: str) -> dict[str, list[object]]:
    rows = query(url, POLICIES)
    standard = sorted(str(row[0]) for row in rows if row[1:] == STANDARD_POLICY)
    other = [list(row) for row in rows if row[1:] != STANDARD_POLICY]
    return {"standard": [*standard], "other": [*other]}


def reviewed_policies() -> dict[str, list[object]]:
    return json.loads(REVIEWED_POLICIES.read_text())


def test_the_policies_at_head_are_the_reviewed_ones(empty_database: str) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    found = policies_of(empty_database)
    if os.environ.get("PARFOCAL_WRITE_POLICIES"):
        REVIEWED_POLICIES.write_text(json.dumps(found, indent=2) + "\n")
    assert found == reviewed_policies()


@pytest.mark.parametrize(
    "loosened",
    [
        "ALTER POLICY tenant_isolation ON cases USING (true)",
        "CREATE POLICY readers ON cases FOR SELECT USING (true)",
        "ALTER POLICY tenant_isolation ON cases TO parfocal",
        "ALTER POLICY tenant_isolation ON cases WITH CHECK (true)",
    ],
)
def test_a_loosened_or_added_policy_differs_from_the_reviewed_ones(
    empty_database: str, loosened: str
) -> None:
    command.upgrade(alembic_config(empty_database), "head")
    query(empty_database, loosened)
    assert policies_of(empty_database) != reviewed_policies()


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


def seed_decision(url: str, kind: str, number: int, value: str, reason: str) -> None:
    query(
        url,
        f"INSERT INTO {OLD_REVIEW_TABLE} (tenant_id, project_id, task_id, slide_id, user_id, kind, "
        f"number, value, reason) SELECT p.tenant_id, p.id, gen_random_uuid(), s.id, u.id, "
        f"'{kind}', {number}, '{value}', {reason} FROM projects p, slides s, users u",
    )


def test_each_old_decision_reason_becomes_a_set_of_one(empty_database: str) -> None:
    config = alembic_config(empty_database)
    command.upgrade(config, "0049")
    for statement in CONTEXT_SEED:
        query(empty_database, statement)
    query(empty_database, f"ALTER TABLE {OLD_REVIEW_TABLE} DISABLE TRIGGER ALL")
    seed_decision(empty_database, "region", 1, "disagree", "'boundary_off'")
    seed_decision(empty_database, "region", 2, "agree", "NULL")
    seed_decision(empty_database, "cell", 1, "unsure", "NULL")
    query(empty_database, f"ALTER TABLE {OLD_REVIEW_TABLE} ENABLE TRIGGER ALL")

    command.upgrade(config, "0050")
    listed = f"SELECT kind, number, value, reasons FROM {OLD_REVIEW_TABLE} ORDER BY kind, number"
    assert query(empty_database, listed) == [
        ("cell", 1, "unsure", []),
        ("region", 1, "disagree", ["boundary_off"]),
        ("region", 2, "agree", []),
    ]
    query(
        empty_database,
        f"UPDATE {OLD_REVIEW_TABLE} SET reasons = '{{two_regions,boundary_off}}' WHERE number = 1 "
        "AND kind = 'region'",
    )
    command.downgrade(config, "0049")
    assert query(
        empty_database, f"SELECT reason FROM {OLD_REVIEW_TABLE} ORDER BY kind, number"
    ) == [
        (None,),
        ("two_regions",),
        (None,),
    ]


OLD_NAMES = """
SELECT conname FROM pg_constraint WHERE conname LIKE :pattern
UNION ALL SELECT indexname FROM pg_indexes WHERE indexname LIKE :pattern
UNION ALL SELECT tgname FROM pg_trigger WHERE tgname LIKE :pattern
UNION ALL SELECT tablename FROM pg_tables WHERE tablename LIKE :pattern
"""


def names_like(url: str, pattern: str) -> list[str]:
    sql = OLD_NAMES.replace(":pattern", f"'{pattern}'")
    return sorted(str(row[0]) for row in query(url, sql))


def test_review_decisions_rename_keeps_rows_and_renames_every_name(empty_database: str) -> None:
    config = alembic_config(empty_database)
    command.upgrade(config, "0110")
    for statement in CONTEXT_SEED:
        query(empty_database, statement)
    query(empty_database, f"ALTER TABLE {OLD_REVIEW_TABLE} DISABLE TRIGGER ALL")
    query(
        empty_database,
        f"INSERT INTO {OLD_REVIEW_TABLE} (tenant_id, project_id, task_id, slide_id, user_id, kind, "
        "number, value, style, answer) SELECT p.tenant_id, p.id, gen_random_uuid(), s.id, u.id, "
        "'region', 1, 'agree', 'agree', 'agree' FROM projects p, slides s, users u",
    )
    query(empty_database, f"ALTER TABLE {OLD_REVIEW_TABLE} ENABLE TRIGGER ALL")
    before = names_like(empty_database, f"%{OLD_REVIEW_TABLE}%")

    command.upgrade(config, "0111")
    assert names_like(empty_database, f"%{OLD_REVIEW_TABLE}%") == []
    after = names_like(empty_database, "%review_decisions%")
    assert len(after) == len(before)
    assert query(empty_database, "SELECT kind, number, value FROM review_decisions") == [
        ("region", 1, "agree")
    ]

    command.downgrade(config, "0110")
    assert names_like(empty_database, f"%{OLD_REVIEW_TABLE}%") == before
    assert names_like(empty_database, "%review_decisions%") == []


def test_old_queue_choices_read_as_agree_and_disagree(empty_database: str) -> None:
    config = alembic_config(empty_database)
    command.upgrade(config, "0079")
    for statement in CONTEXT_SEED:
        query(empty_database, statement)
    query(empty_database, "ALTER TABLE disagreement_decisions DISABLE TRIGGER ALL")
    for number, choice in ((1, "keep-ai"), (2, "go-with-reviewers")):
        query(
            empty_database,
            "INSERT INTO disagreement_decisions (tenant_id, project_id, task_id, slide_id, kind, "
            "number, decision) SELECT p.tenant_id, p.id, gen_random_uuid(), s.id, 'region', "
            f"{number}, '{choice}' FROM projects p, slides s",
        )
    query(empty_database, "ALTER TABLE disagreement_decisions ENABLE TRIGGER ALL")

    command.upgrade(config, "0080")
    listed = "SELECT number, decision, value, left_open FROM disagreement_decisions ORDER BY number"
    assert query(empty_database, listed) == [
        (1, "keep-ai", "agree", False),
        (2, "go-with-reviewers", "disagree", False),
    ]
    command.downgrade(config, "0079")
    decisions = "SELECT decision FROM disagreement_decisions ORDER BY number"
    assert query(empty_database, decisions) == [("keep-ai",), ("go-with-reviewers",)]


def test_old_tiffslide_slides_read_back_as_tifffile(empty_database: str) -> None:
    config = alembic_config(empty_database)
    command.upgrade(config, "0082")
    for statement in CONTEXT_SEED:
        query(empty_database, statement)
    query(
        empty_database,
        "INSERT INTO slides (tenant_id, project_id, case_id, label, reader) "
        "SELECT c.tenant_id, c.project_id, c.id, r.label, r.reader FROM cases c, "
        "(VALUES ('A2', 'tiffslide'), ('A3', 'openslide')) AS r(label, reader)",
    )

    command.upgrade(config, "0083")
    readers = "SELECT label, reader FROM slides ORDER BY label"
    assert query(empty_database, readers) == [
        ("A1", None),
        ("A2", "tifffile"),
        ("A3", "openslide"),
    ]
    command.downgrade(config, "0082")
    assert query(empty_database, readers) == [
        ("A1", None),
        ("A2", "tiffslide"),
        ("A3", "openslide"),
    ]
