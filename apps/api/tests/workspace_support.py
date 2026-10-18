import json
import uuid
from dataclasses import dataclass

from db_support import OWNER_URL, query, with_database

from parfocal_api.opinion_questions import DEFAULT_QUESTIONS, dumped
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role


@dataclass(frozen=True)
class Workspace:
    tenant_id: uuid.UUID
    people: dict[str, MemberPrincipal]


def owner(database: str, statement: str) -> list[tuple[object, ...]]:
    return query(with_database(OWNER_URL, database), statement)


def person(database: str, tenant_id: uuid.UUID, label: str, role: Role) -> MemberPrincipal:
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
        "INSERT INTO memberships (tenant_id, user_id, role) "
        f"VALUES ('{tenant_id}', '{user_id}', '{role}')",
    )
    return MemberPrincipal(subject, tenant_id, user_id, role)


def make_tenant(database: str) -> uuid.UUID:
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


def make_workspace(database: str, roles: dict[str, Role]) -> Workspace:
    tenant_id = make_tenant(database)
    return Workspace(
        tenant_id,
        {label: person(database, tenant_id, label, role) for label, role in roles.items()},
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
