import os
from collections.abc import AsyncIterator
from pathlib import Path

import asyncpg
import pytest

from parfocal_deploy import restore_check
from parfocal_deploy.restore_check import (
    Fingerprint,
    TablePrint,
    check,
    compare,
    create_database,
    drop_database,
    fingerprint,
    restore,
    scratch_name,
    with_database,
)

OWNER_URL = os.environ.get(
    "PARFOCAL_TEST_OWNER_URL", "postgresql://parfocal@localhost:5432/parfocal"
)
SCHEMA = """
create table slides (id bigint primary key, name text not null, stain text);
create table decisions (
    id bigint primary key,
    slide_id bigint not null references slides (id),
    choice text not null check (choice in ('agree', 'disagree', 'unsure'))
);
create index decisions_slide on decisions (slide_id);
insert into slides select n, 'slide ' || n, 'HE' from generate_series(1, 50) n;
insert into decisions select n, 1 + n % 50, 'agree' from generate_series(1, 200) n;
"""


@pytest.fixture(autouse=True)
def tools_in_the_local_container(monkeypatch: pytest.MonkeyPatch) -> None:
    if restore_check.TOOLS_PREFIX not in os.environ:
        monkeypatch.setenv(restore_check.TOOLS_PREFIX, "docker exec -i parfocal-postgres-1")


@pytest.fixture
async def source() -> AsyncIterator[str]:
    name = scratch_name()
    await create_database(OWNER_URL, name)
    url = with_database(OWNER_URL, name)
    connection = await asyncpg.connect(url)
    try:
        await connection.execute(SCHEMA)
    finally:
        await connection.close()
    try:
        yield url
    finally:
        await drop_database(OWNER_URL, name)


def table(rows: int, digest: str = "d") -> TablePrint:
    return TablePrint(rows=rows, digest=digest)


def printed(tables: dict[str, TablePrint], invalid: int = 0) -> Fingerprint:
    return Fingerprint(
        tables=tables,
        extensions={"plpgsql": "1.0"},
        invalid_indexes=invalid,
        unvalidated_constraints=0,
    )


async def test_a_dump_restored_into_a_scratch_database_matches_its_source(
    source: str, tmp_path: Path
) -> None:
    outcome = await check(source, OWNER_URL, tmp_path / "check.dump")

    assert outcome.findings == ()
    assert outcome.passed
    assert outcome.restored.rows == 250
    assert set(outcome.restored.tables) == {'"public"."slides"', '"public"."decisions"'}


async def test_a_restore_missing_a_row_or_a_table_is_reported(source: str, tmp_path: Path) -> None:
    archive = tmp_path / "check.dump"
    expected = await restore_check.dump_and_print(source, archive)
    name = scratch_name()
    await create_database(OWNER_URL, name)
    try:
        target = with_database(OWNER_URL, name)
        restore(archive, target)
        connection = await asyncpg.connect(target)
        try:
            await connection.execute("delete from decisions where id = 7")
            await connection.execute("update slides set stain = 'IHC' where id = 3")
            damaged = await fingerprint(connection)
        finally:
            await connection.close()
    finally:
        await drop_database(OWNER_URL, name)

    findings = compare(expected, damaged)

    assert '"public"."slides" has the same row count but different content' in findings
    assert '"public"."decisions" has 199 rows, the source has 200' in findings


def test_missing_tables_row_counts_and_invalid_indexes_are_findings() -> None:
    source = printed({"a": table(3), "b": table(2)})
    restored = printed({"a": table(2), "c": table(1)}, invalid=1)

    assert compare(source, restored) == (
        "b is missing from the restore",
        "c is in the restore but not the source",
        "a has 2 rows, the source has 3",
        "1 indexes are invalid after the restore",
    )


def test_an_empty_source_never_passes() -> None:
    empty = printed({"a": table(0, "")})

    assert compare(empty, empty) == ("the source has no rows, so the restore proves nothing",)


def test_the_scratch_database_replaces_only_the_path() -> None:
    url = "postgresql://owner@ep-a.neon.tech:5432/parfocal?sslmode=require"

    assert with_database(url, "restore_check_1") == (
        "postgresql://owner@ep-a.neon.tech:5432/restore_check_1?sslmode=require"
    )


def test_the_password_goes_to_the_environment_and_never_to_the_command() -> None:
    hidden = "pw-" + "x" * 8
    url = f"postgresql://owner:{hidden}@ep-a.neon.tech/parfocal?sslmode=require"

    bare, env = restore_check.without_password(url)

    assert bare == "postgresql://owner@ep-a.neon.tech/parfocal?sslmode=require"
    assert env["PGPASSWORD"] == hidden
    assert hidden not in " ".join(restore_check.dump_command(bare, "snap"))


def test_the_driver_url_drops_channel_binding() -> None:
    url = "postgresql://owner@ep-a.neon.tech/parfocal?sslmode=require&channel_binding=require"

    assert restore_check.driver_url(url) == (
        "postgresql://owner@ep-a.neon.tech/parfocal?sslmode=require"
    )
