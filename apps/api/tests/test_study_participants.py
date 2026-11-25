import uuid

import pytest
from db_support import OWNER_URL, ApiAs, query, with_database
from test_showcase import EmptyStore, MemoryResults
from workspace_support import make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.study_participants import InProcessStudySeeder
from parfocal_api.study_projects import STUDY_WORKSPACE
from parfocal_api.tables import Role

pytestmark = pytest.mark.db


@pytest.fixture
def people(api: ApiAs, database: str) -> dict[str, MemberPrincipal]:
    api.app.state.study_seeder = InProcessStudySeeder(
        with_database_owner(database),
        EmptyStore(),  # type: ignore[arg-type]
        MemoryResults(),
    )
    made = make_workspace(
        database,
        {"admin": Role.RESEARCHER, "researcher": Role.RESEARCHER, "reviewer": Role.REVIEWER},
        admins={"admin"},
    ).people
    for label in ("admin", "researcher"):
        owner(
            database,
            f"UPDATE users SET email = '{label}@study.invalid' WHERE id = '{made[label].user_id}'",
        )
    return made


def live_projects(database: str, name: str) -> list[tuple[object, ...]]:
    return query(
        with_database_owner(database),
        f"SELECT id FROM projects WHERE name = '{name}' AND deleted_at IS NULL",
    )


def with_database_owner(database: str) -> str:
    return with_database(OWNER_URL, database)


def test_an_admin_prepares_and_removes_a_participant_project(
    api: ApiAs, database: str, people: dict[str, MemberPrincipal]
) -> None:
    admin = people["admin"]
    prepared = api(admin).post("/api/tenant/study-participants/p-t1")
    assert prepared.status_code == 200, prepared.text
    body = prepared.json()
    assert body["code"] == "P-T1"
    assert body["workspace_name"] == STUDY_WORKSPACE.name
    [(project_id,)] = live_projects(database, "Study P-T1")
    assert str(project_id) == body["project_id"]
    seat = query(
        with_database_owner(database),
        "SELECT m.role FROM project_members m JOIN users u ON u.id = m.user_id "
        f"WHERE m.project_id = '{project_id}' AND u.id = '{admin.user_id}'",
    )
    assert [str(role) for (role,) in seat] == ["owner"]
    workspace = query(
        with_database_owner(database),
        f"SELECT slug FROM tenants WHERE id = '{uuid.UUID(body['workspace_id'])}'",
    )
    assert workspace == [(STUDY_WORKSPACE.slug,)]

    again = api(admin).post("/api/tenant/study-participants/P-T1")
    assert again.status_code == 200, again.text
    assert again.json()["project_id"] != body["project_id"]
    assert len(live_projects(database, "Study P-T1")) == 1

    removed = api(admin).delete("/api/tenant/study-participants/P-T1")
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"code": "P-T1", "removed": 1}
    assert live_projects(database, "Study P-T1") == []
    assert api(admin).delete("/api/tenant/study-participants/P-T1").json()["removed"] == 0


def test_a_moderator_new_to_the_study_workspace_joins_as_an_admin_and_removes_there(
    api: ApiAs, database: str, people: dict[str, MemberPrincipal]
) -> None:
    moderator = people["admin"]
    owner(
        database,
        f"UPDATE users SET email = 'moderator@study.invalid' WHERE id = '{moderator.user_id}'",
    )
    prepared = api(moderator).post("/api/tenant/study-participants/P-T4")
    assert prepared.status_code == 200, prepared.text
    study_id = uuid.UUID(prepared.json()["workspace_id"])
    assert study_id != moderator.tenant_id
    [(role, admin_rights)] = query(
        with_database_owner(database),
        "SELECT role, admin_rights FROM memberships "
        f"WHERE tenant_id = '{study_id}' AND user_id = '{moderator.user_id}'",
    )
    assert (str(role), admin_rights) == ("researcher", True)

    in_study = MemberPrincipal(
        moderator.subject, study_id, moderator.user_id, Role.RESEARCHER, bool(admin_rights)
    )
    removed = api(in_study).delete("/api/tenant/study-participants/P-T4")
    assert removed.status_code == 200, removed.text
    assert removed.json() == {"code": "P-T4", "removed": 1}
    assert live_projects(database, "Study P-T4") == []


def test_only_an_admin_prepares_or_removes_a_participant(
    api: ApiAs, database: str, people: dict[str, MemberPrincipal]
) -> None:
    for label in ("researcher", "reviewer"):
        prepared = api(people[label]).post("/api/tenant/study-participants/P-T2")
        assert prepared.status_code == 403, prepared.text
        removed = api(people[label]).delete("/api/tenant/study-participants/P-T2")
        assert removed.status_code == 403, removed.text
    assert live_projects(database, "Study P-T2") == []


def test_a_participant_code_is_plain_and_the_seat_needs_an_email(
    api: ApiAs, database: str, people: dict[str, MemberPrincipal]
) -> None:
    admin = people["admin"]
    assert api(admin).post("/api/tenant/study-participants/P%20T3").status_code == 422
    assert api(admin).post(f"/api/tenant/study-participants/{'A' * 33}").status_code == 422
    owner(database, f"UPDATE users SET email = NULL WHERE id = '{admin.user_id}'")
    refused = api(admin).post("/api/tenant/study-participants/P-T3")
    assert refused.status_code == 400
    assert refused.json()["code"] == "study-seat-without-email"
