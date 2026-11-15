import argparse
import asyncio
import os
import secrets
import shlex
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import asyncpg

from parfocal_deploy import neon
from parfocal_deploy.environments import environment

TOOLS_PREFIX = "PARFOCAL_PG_TOOLS_PREFIX"

TABLES = """
select table_schema, table_name from information_schema.tables
where table_type = 'BASE TABLE'
  and table_schema not in ('pg_catalog', 'information_schema')
  and table_schema not like 'pg_toast%'
order by table_schema, table_name
"""
EXTENSIONS = "select extname, extversion from pg_extension order by extname"
INVALID_INDEXES = """
select count(*) from pg_index i join pg_class c on c.oid = i.indexrelid
join pg_namespace n on n.oid = c.relnamespace
where not i.indisvalid and n.nspname not in ('pg_catalog', 'information_schema')
"""
UNVALIDATED_CONSTRAINTS = """
select count(*) from pg_constraint k join pg_namespace n on n.oid = k.connamespace
where not k.convalidated and n.nspname not in ('pg_catalog', 'information_schema')
"""


@dataclass(frozen=True)
class TablePrint:
    rows: int
    digest: str


@dataclass(frozen=True)
class Fingerprint:
    tables: dict[str, TablePrint]
    extensions: dict[str, str]
    invalid_indexes: int
    unvalidated_constraints: int

    @property
    def rows(self) -> int:
        return sum(table.rows for table in self.tables.values())


@dataclass(frozen=True)
class Outcome:
    source: Fingerprint
    restored: Fingerprint
    findings: tuple[str, ...]

    @property
    def passed(self) -> bool:
        return not self.findings


def quoted(schema: str, table: str) -> str:
    return '"{}"."{}"'.format(schema.replace('"', '""'), table.replace('"', '""'))


def table_query(name: str) -> str:
    return (
        "select count(*), coalesce(md5(string_agg(md5(t::text), '' "
        f"order by md5(t::text))), '') from {name} t"
    )


async def fingerprint(connection: asyncpg.Connection) -> Fingerprint:
    await connection.execute("set row_security = off")
    tables: dict[str, TablePrint] = {}
    for schema, table in await connection.fetch(TABLES):
        name = quoted(schema, table)
        [(rows, digest)] = await connection.fetch(table_query(name))
        tables[name] = TablePrint(rows=int(rows), digest=str(digest))
    extensions = {row["extname"]: row["extversion"] for row in await connection.fetch(EXTENSIONS)}
    return Fingerprint(
        tables=tables,
        extensions=extensions,
        invalid_indexes=int(await connection.fetchval(INVALID_INDEXES) or 0),
        unvalidated_constraints=int(await connection.fetchval(UNVALIDATED_CONSTRAINTS) or 0),
    )


def compare(source: Fingerprint, restored: Fingerprint) -> tuple[str, ...]:
    found: list[str] = []
    if source.rows == 0:
        found.append("the source has no rows, so the restore proves nothing")
    for name in sorted(source.tables.keys() - restored.tables.keys()):
        found.append(f"{name} is missing from the restore")
    for name in sorted(restored.tables.keys() - source.tables.keys()):
        found.append(f"{name} is in the restore but not the source")
    for name in sorted(source.tables.keys() & restored.tables.keys()):
        want, got = source.tables[name], restored.tables[name]
        if want.rows != got.rows:
            found.append(f"{name} has {got.rows} rows, the source has {want.rows}")
        elif want.digest != got.digest:
            found.append(f"{name} has the same row count but different content")
    if source.extensions != restored.extensions:
        found.append(f"extensions differ: {source.extensions} against {restored.extensions}")
    if restored.invalid_indexes:
        found.append(f"{restored.invalid_indexes} indexes are invalid after the restore")
    if restored.unvalidated_constraints > source.unvalidated_constraints:
        found.append("constraints that were validated in the source are not after the restore")
    return tuple(found)


def tool(name: str) -> list[str]:
    return [*shlex.split(os.environ.get(TOOLS_PREFIX, "")), name]


def dump(source_url: str, archive: Path, snapshot: str | None) -> None:
    command = [*tool("pg_dump"), "--format=custom", "--no-owner", "--no-privileges"]
    if snapshot is not None:
        command.append(f"--snapshot={snapshot}")
    with archive.open("wb") as output:
        subprocess.run([*command, f"--dbname={source_url}"], stdout=output, check=True)


def restore(archive: Path, target_url: str) -> None:
    command = [*tool("pg_restore"), "--exit-on-error", "--no-owner", "--no-privileges"]
    with archive.open("rb") as archive_input:
        subprocess.run([*command, f"--dbname={target_url}"], stdin=archive_input, check=True)


def with_database(url: str, database: str) -> str:
    return urlunsplit(urlsplit(url)._replace(path=f"/{database}"))


def scratch_name() -> str:
    return f"restore_check_{secrets.token_hex(4)}"


async def dump_and_print(source_url: str, archive: Path) -> Fingerprint:
    connection = await asyncpg.connect(source_url)
    try:
        async with connection.transaction(isolation="repeatable_read", readonly=True):
            snapshot = await connection.fetchval("select pg_export_snapshot()")
            await asyncio.to_thread(dump, source_url, archive, snapshot)
            return await fingerprint(connection)
    finally:
        await connection.close()


async def create_database(admin_url: str, name: str) -> None:
    connection = await asyncpg.connect(admin_url)
    try:
        await connection.execute(f'create database "{name}"')
    finally:
        await connection.close()


async def drop_database(admin_url: str, name: str) -> None:
    connection = await asyncpg.connect(admin_url)
    try:
        await connection.execute(f'drop database if exists "{name}" with (force)')
    finally:
        await connection.close()


async def check(source_url: str, scratch_admin_url: str, archive: Path) -> Outcome:
    source = await dump_and_print(source_url, archive)
    name = scratch_name()
    await create_database(scratch_admin_url, name)
    try:
        target = with_database(scratch_admin_url, name)
        await asyncio.to_thread(restore, archive, target)
        connection = await asyncpg.connect(target)
        try:
            restored = await fingerprint(connection)
        finally:
            await connection.close()
    finally:
        await drop_database(scratch_admin_url, name)
    return Outcome(source=source, restored=restored, findings=compare(source, restored))


def production_source() -> str:
    send = neon.http_transport(os.environ["NEON_API_KEY"])
    project = os.environ["NEON_PROJECT_ID"]
    name = environment("production").neon_branch
    branch = neon.find_branch(send, project, name)
    if branch is None:
        raise SystemExit(f"no Neon branch named {name}")
    database = neon.first_database(send, project, branch)
    return neon.owner_uri(send, project, branch, database, pooled=False)


def report(outcome: Outcome) -> str:
    lines = [
        f"tables {len(outcome.source.tables)} source, {len(outcome.restored.tables)} restored",
        f"rows {outcome.source.rows} source, {outcome.restored.rows} restored",
        f"extensions {len(outcome.restored.extensions)}",
        f"invalid indexes {outcome.restored.invalid_indexes}",
    ]
    lines += [f"finding: {finding}" for finding in outcome.findings]
    lines.append("passed" if outcome.passed else "failed")
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="restore_check")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--source-url")
    source.add_argument("--source-production", action="store_true")
    parser.add_argument("--scratch-admin-url", required=True)
    parser.add_argument("--archive", type=Path, default=Path("restore-check.dump"))
    arguments = parser.parse_args(argv)
    source_url = production_source() if arguments.source_production else arguments.source_url
    outcome = asyncio.run(check(source_url, arguments.scratch_admin_url, arguments.archive))
    print(report(outcome))
    return 0 if outcome.passed else 1


if __name__ == "__main__":
    sys.exit(main())
