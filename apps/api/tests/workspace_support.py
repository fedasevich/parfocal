import json
import uuid
from collections.abc import Collection
from dataclasses import dataclass

from db_support import OWNER_URL, query, with_database

from parfocal_api.opinion_questions import DEFAULT_QUESTIONS, dumped
from parfocal_api.principals import MemberPrincipal
from parfocal_api.study_templates import built_in_rows
from parfocal_api.tables import Role


@dataclass(frozen=True)
class Workspace:
    tenant_id: uuid.UUID
    people: dict[str, MemberPrincipal]


def owner(database: str, statement: str) -> list[tuple[object, ...]]:
    return query(with_database(OWNER_URL, database), statement)


def person(
    database: str, tenant_id: uuid.UUID, label: str, role: Role, *, admin_rights: bool = False
) -> MemberPrincipal:
    subject = f"ws-{label}-{uuid.uuid4().hex[:8]}"
    user_id = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO users (subject, display_name, initials, avatar_colour) "
                f"VALUES ('{subject}', '{label}', 'PP', 1) RETURNING id",
            )[0][0]
        )
    )
    owner(
        database,
        "INSERT INTO memberships (tenant_id, user_id, role, admin_rights) "
        f"VALUES ('{tenant_id}', '{user_id}', '{role}', {admin_rights})",
    )
    return MemberPrincipal(subject, tenant_id, user_id, role, admin_rights)


def literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, int):
        return str(value)
    text = value if isinstance(value, str | uuid.UUID) else json.dumps(value)
    return "'" + str(text).replace("'", "''") + "'"


def insert_rows(database: str, table: str, rows: list[dict[str, object]]) -> None:
    columns = list(rows[0])
    values = ", ".join(
        "(" + ", ".join(literal(row[column]) for column in columns) + ")" for row in rows
    )
    owner(database, f"INSERT INTO {table} ({', '.join(columns)}) VALUES {values}")


def seed_study_templates(database: str, tenant_id: uuid.UUID) -> None:
    templates, versions = built_in_rows(tenant_id)
    insert_rows(database, "study_templates", templates)
    insert_rows(database, "study_template_versions", versions)


def make_tenant(database: str) -> uuid.UUID:
    tenant_id = new_tenant(database)
    seed_study_templates(database, tenant_id)
    return tenant_id


def new_tenant(database: str) -> uuid.UUID:
    slug = f"ws-{uuid.uuid4().hex[:10]}"
    return uuid.UUID(
        str(
            owner(
                database,
                "WITH organisation AS (INSERT INTO organisations (slug, name) "
                f"VALUES ('{slug}', '{slug}') RETURNING id) "
                "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
                f"SELECT id, '{slug}', '{slug}', 'diagnostic', 'eu', 'pilot' FROM organisation "
                "RETURNING id",
            )[0][0]
        )
    )


def make_workspace(
    database: str, roles: dict[str, Role], *, admins: Collection[str] = ()
) -> Workspace:
    tenant_id = make_tenant(database)
    return Workspace(
        tenant_id,
        {
            label: person(database, tenant_id, label, role, admin_rights=label in admins)
            for label, role in roles.items()
        },
    )


def make_project(database: str, tenant_id: uuid.UUID, privacy_mode: str = "clinical") -> uuid.UUID:
    project_id = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO projects (tenant_id, number, name, privacy_mode) "
                f"SELECT '{tenant_id}', coalesce(max(number), 0) + 1, "
                f"'Project {uuid.uuid4().hex[:8]}', '{privacy_mode}' "
                f"FROM projects WHERE tenant_id = '{tenant_id}' RETURNING id",
            )[0][0]
        )
    )
    questions = json.dumps(dumped(DEFAULT_QUESTIONS)).replace("'", "''")
    owner(
        database,
        "INSERT INTO opinion_forms (tenant_id, project_id, version, questions) "
        f"VALUES ('{tenant_id}', '{project_id}', 1, '{questions}'::jsonb)",
    )
    return project_id


def join_project(database: str, project_id: uuid.UUID, who: MemberPrincipal, role: str) -> None:
    owner(
        database,
        "INSERT INTO project_members (tenant_id, project_id, user_id, role) "
        f"VALUES ('{who.tenant_id}', '{project_id}', '{who.user_id}', '{role}')",
    )


def make_case(database: str, tenant_id: uuid.UUID, project_id: uuid.UUID, label: str) -> uuid.UUID:
    return uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO cases (tenant_id, project_id, label, source) "
                f"VALUES ('{tenant_id}', '{project_id}', '{label}', 'manual') RETURNING id",
            )[0][0]
        )
    )


def make_slide(
    database: str,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    label: str,
    case_id: uuid.UUID | None = None,
) -> uuid.UUID:
    case = f"'{case_id}'" if case_id else "NULL"
    return uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO slides (tenant_id, project_id, case_id, label) "
                f"VALUES ('{tenant_id}', '{project_id}', {case}, '{label}') RETURNING id",
            )[0][0]
        )
    )
