import uuid
from dataclasses import dataclass

from db_support import OWNER_URL, query, with_database

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
