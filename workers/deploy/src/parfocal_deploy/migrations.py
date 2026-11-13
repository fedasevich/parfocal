import ast
import re
from collections.abc import Collection, Iterator, Sequence
from dataclasses import dataclass
from pathlib import Path

from parfocal_deploy.tools import REPOSITORY, Tools

VERSIONS = REPOSITORY / "apps" / "api" / "migrations" / "versions"
REVISION_TABLE_EXISTS = "SELECT to_regclass('public.alembic_version') IS NOT NULL"
CURRENT_REVISION = "SELECT version_num FROM alembic_version"
DESTRUCTIVE_OPERATIONS = frozenset({"drop_table", "drop_column", "rename_table"})
DESTRUCTIVE_COLUMN_CHANGES = frozenset({"type_", "new_column_name"})
DESTRUCTIVE_SQL = re.compile(
    r"\b(DROP\s+(TABLE|COLUMN|SCHEMA|DATABASE)"
    r"|TRUNCATE"
    r"|DELETE\s+FROM"
    r"|RENAME\s+(TO|COLUMN)"
    r"|ALTER\s+COLUMN\s+\w+\s+(SET\s+DATA\s+)?TYPE)\b",
    re.IGNORECASE,
)
ROLLED_BACK_FUNCTION = "downgrade"


@dataclass(frozen=True)
class Revision:
    revision: str
    down_revision: str | None
    findings: tuple[str, ...]


class MigrationHistoryError(Exception):
    pass


class DestructiveMigrationError(Exception):
    def __init__(self, refused: Sequence[Revision]) -> None:
        lines = [f"{revision.revision}: {', '.join(revision.findings)}" for revision in refused]
        names = ",".join(revision.revision for revision in refused)
        super().__init__(
            "these migrations drop, rename or rewrite data and the previous release "
            "may stop working on the new schema:\n"
            + "\n".join(lines)
            + "\nNothing was run. With the owner's yes, start the deploy by hand with "
            f"-f allow_destructive={names}"
        )


def module_constant(tree: ast.Module, name: str) -> str | None:
    for node in tree.body:
        target = (
            node.target
            if isinstance(node, ast.AnnAssign)
            else node.targets[0]
            if isinstance(node, ast.Assign) and len(node.targets) == 1
            else None
        )
        if not isinstance(target, ast.Name) or target.id != name:
            continue
        value = node.value if isinstance(node, (ast.Assign, ast.AnnAssign)) else None
        if isinstance(value, ast.Constant) and (
            value.value is None or isinstance(value.value, str)
        ):
            return value.value
        raise MigrationHistoryError(f"{name} is not a plain string")
    raise MigrationHistoryError(f"{name} is not set")


def forward_nodes(tree: ast.Module) -> Iterator[ast.AST]:
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name == ROLLED_BACK_FUNCTION:
            continue
        yield from ast.walk(node)


def literal(node: ast.expr | None) -> str:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else "?"


def call_finding(call: ast.Call) -> str | None:
    if not isinstance(call.func, ast.Attribute):
        return None
    operation = call.func.attr
    subject = " ".join(literal(argument) for argument in call.args[:2])
    if operation in DESTRUCTIVE_OPERATIONS:
        return f"{operation} {subject}".strip()
    changed = sorted(
        keyword.arg for keyword in call.keywords if keyword.arg in DESTRUCTIVE_COLUMN_CHANGES
    )
    if operation == "alter_column" and changed:
        return f"alter_column {subject} {' '.join(changed)}".strip()
    return None


def findings(tree: ast.Module) -> tuple[str, ...]:
    found: list[str] = []
    for node in forward_nodes(tree):
        if isinstance(node, ast.Call):
            finding = call_finding(node)
            if finding is not None:
                found.append(finding)
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            found.extend(
                " ".join(match.group(0).split()).upper()
                for match in DESTRUCTIVE_SQL.finditer(node.value)
            )
    return tuple(dict.fromkeys(found))


def read_revision(source: str) -> Revision:
    tree = ast.parse(source)
    revision = module_constant(tree, "revision")
    if revision is None:
        raise MigrationHistoryError("revision is not set")
    return Revision(revision, module_constant(tree, "down_revision"), findings(tree))


def load(directory: Path) -> dict[str, Revision]:
    revisions: dict[str, Revision] = {}
    for path in sorted(directory.glob("*.py")):
        try:
            revision = read_revision(path.read_text())
        except MigrationHistoryError as error:
            raise MigrationHistoryError(f"{path.name}: {error}") from error
        if revision.revision in revisions:
            raise MigrationHistoryError(f"revision {revision.revision} appears twice")
        revisions[revision.revision] = revision
    return revisions


def head(revisions: dict[str, Revision]) -> Revision | None:
    parents = {revision.down_revision for revision in revisions.values()}
    heads = [revision for name, revision in revisions.items() if name not in parents]
    if len(heads) > 1:
        names = ", ".join(sorted(revision.revision for revision in heads))
        raise MigrationHistoryError(f"the migrations have more than one head: {names}")
    return heads[0] if heads else None


def pending(revisions: dict[str, Revision], current: str | None) -> list[Revision]:
    if current is None:
        return []
    step = head(revisions)
    waiting: list[Revision] = []
    while step is not None and step.revision != current:
        waiting.append(step)
        step = revisions.get(step.down_revision) if step.down_revision else None
    if step is None:
        raise MigrationHistoryError(
            f"the database is at revision {current}, which this code does not have. "
            "It is older than the database, so deploy it only as a rollback"
        )
    return list(reversed(waiting))


def current_revision(tools: Tools, uri: str) -> str | None:
    exists = tools.sql(uri, REVISION_TABLE_EXISTS)
    if not exists or not exists[0][0]:
        return None
    rows = tools.sql(uri, CURRENT_REVISION)
    return str(rows[0][0]) if rows else None


def check(current: str | None, allowed: Collection[str], directory: Path = VERSIONS) -> list[str]:
    waiting = pending(load(directory), current)
    refused = [
        revision for revision in waiting if revision.findings and revision.revision not in allowed
    ]
    if refused:
        raise DestructiveMigrationError(refused)
    return [revision.revision for revision in waiting]
