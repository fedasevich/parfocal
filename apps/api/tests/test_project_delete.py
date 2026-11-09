import uuid
from typing import Any

import pytest
from db_support import ApiAs
from storage_support import put_restricted_images, stand_in_images, stored_keys, with_store
from test_reviewed_layer import Review, review
from workspace_support import make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.ingest import RestrictedImage, restricted_prefix

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def name_of(database: str, project: uuid.UUID) -> str:
    return str(owner(database, f"SELECT name FROM projects WHERE id = '{project}'")[0][0])


def delete(api: ApiAs, who: MemberPrincipal, project: uuid.UUID, name: str) -> Any:
    return api(who).request("DELETE", f"/api/projects/{project}", json={"name": name})


def undelete(api: ApiAs, who: MemberPrincipal, project: uuid.UUID) -> Any:
    return api(who).post(f"/api/projects/{project}/undelete")


def listed(api: ApiAs, who: MemberPrincipal, project: uuid.UUID) -> bool:
    found = {item["id"] for item in api(who).get("/api/projects").json()}
    archived = {item["id"] for item in api(who).get("/api/projects?archived=true").json()}
    return str(project) in found | archived


def count_of(database: str, sql: str) -> int:
    return int(str(owner(database, sql)[0][0]))


def project_rows(database: str, project: uuid.UUID) -> dict[str, int]:
    tables = owner(
        database,
        "SELECT table_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND column_name = 'project_id' ORDER BY table_name",
    )
    counts = {
        str(table): count_of(
            database, f"SELECT count(*) FROM {table} WHERE project_id = '{project}'"
        )
        for (table,) in tables
    }
    counts["result_objects"] = count_of(
        database,
        "SELECT count(*) FROM result_objects o JOIN result_sets r ON r.id = o.result_set_id "
        f"WHERE r.project_id = '{project}'",
    )
    return counts


def audit_of(database: str, project: uuid.UUID) -> list[tuple[str, str]]:
    rows = owner(
        database,
        f"SELECT action, details::text FROM audit_events WHERE target_id = '{project}' "
        "AND action LIKE 'project.%deleted' ORDER BY seq",
    )
    return [(str(action), str(details)) for action, details in rows]


def stored(r: Review, tenant: uuid.UUID) -> list[str]:
    return stored_keys(restricted_prefix(tenant, r.slide))


def tenant_of(database: str, project: uuid.UUID) -> uuid.UUID:
    return uuid.UUID(
        str(owner(database, f"SELECT tenant_id FROM projects WHERE id = '{project}'")[0][0])
    )


def with_label(r: Review, tenant: uuid.UUID) -> None:
    label = {RestrictedImage.LABEL: stand_in_images(str(r.slide))[RestrictedImage.LABEL]}
    with_store(lambda store: put_restricted_images(store, tenant, r.slide, label))


def test_an_owner_deletes_a_project_and_nothing_is_erased(api: ApiAs, database: str) -> None:
    r = review(api, database)
    lead = r.people["owner"]
    tenant = tenant_of(database, r.project)
    with_label(r, tenant)
    rows_before = project_rows(database, r.project)
    keys_before = stored(r, tenant)
    assert rows_before["slides"] == 1
    assert rows_before["review_tasks"] == 1
    assert rows_before["result_objects"] == 2
    assert keys_before
    gone = delete(api, lead, r.project, name_of(database, r.project))
    assert gone.status_code == 204, gone.text
    assert project_rows(database, r.project) == rows_before
    assert stored(r, tenant) == keys_before
    deleted_at = owner(database, f"SELECT deleted_at FROM projects WHERE id = '{r.project}'")
    assert deleted_at[0][0] is not None
    assert audit_of(database, r.project) == [("project.deleted", "{}")]


def test_the_typed_name_must_match(api: ApiAs, database: str) -> None:
    r = review(api, database)
    lead = r.people["owner"]
    name = name_of(database, r.project)
    wrong = delete(api, lead, r.project, name.upper())
    assert (wrong.status_code, wrong.json()["code"]) == (400, "project-name-mismatch")
    assert delete(api, lead, r.project, "").status_code == 400
    missing = api(lead).request("DELETE", f"/api/projects/{r.project}")
    assert missing.status_code == 422
    assert listed(api, lead, r.project)
    assert audit_of(database, r.project) == []
    assert delete(api, lead, r.project, f"  {name} ").status_code == 204


def test_a_viewer_and_a_reviewer_cannot_delete_or_restore(api: ApiAs, database: str) -> None:
    r = review(api, database)
    name = name_of(database, r.project)
    for who in ("viewer", "first"):
        refused = delete(api, r.people[who], r.project, name)
        assert refused.status_code == 403, who
    assert listed(api, r.people["owner"], r.project)
    assert delete(api, r.people["owner"], r.project, name).status_code == 204
    for who in ("viewer", "first"):
        assert undelete(api, r.people[who], r.project).status_code == 403, who
    assert audit_of(database, r.project) == [("project.deleted", "{}")]


def test_another_workspace_never_reaches_the_project(api: ApiAs, database: str) -> None:
    r = review(api, database)
    name = name_of(database, r.project)
    stranger = make_workspace(database, {"lead": Role.RESEARCHER}).people["lead"]
    assert delete(api, stranger, r.project, name).status_code == 404
    assert undelete(api, stranger, r.project).status_code == 404
    assert delete(api, r.people["owner"], r.project, name).status_code == 204
    assert undelete(api, stranger, r.project).status_code == 404
    assert audit_of(database, r.project) == [("project.deleted", "{}")]


def test_every_route_hides_a_deleted_project(api: ApiAs, database: str) -> None:
    r = review(api, database)
    lead, reviewer = r.people["owner"], r.people["first"]
    name = name_of(database, r.project)
    project = f"/api/projects/{r.project}"
    assert str(r.task) in api(reviewer).get("/api/me/review-tasks").text
    assert str(r.project) in api(lead).get("/api/search", params={"q": name}).text
    assert delete(api, lead, r.project, name).status_code == 204
    for who in (lead, reviewer):
        assert not listed(api, who, r.project)
        assert api(who).get(project).status_code == 404
        assert str(r.project) not in api(who).get("/api/me/home").text
        assert str(r.task) not in api(who).get("/api/me/review-tasks").text
        assert str(r.project) not in api(who).get("/api/search", params={"q": name}).text
        assert api(who).get(f"{project}/review-tasks").status_code == 404
        assert api(who).get(f"/api/review-tasks/{r.task}").status_code == 404
    assert api(lead).patch(project, json={"colour": 3}).status_code == 404
    assert api(lead).post(f"{project}/archive").status_code == 404
    assert delete(api, lead, r.project, name).status_code == 404


def test_an_owner_restores_a_deleted_project(api: ApiAs, database: str) -> None:
    r = review(api, database)
    lead, reviewer = r.people["owner"], r.people["first"]
    name = name_of(database, r.project)
    rows_before = project_rows(database, r.project)
    assert delete(api, lead, r.project, name).status_code == 204
    back = undelete(api, lead, r.project)
    assert back.status_code == 200, back.text
    assert (back.json()["id"], back.json()["my_role"]) == (str(r.project), "owner")
    assert listed(api, lead, r.project)
    assert api(reviewer).get(f"/api/projects/{r.project}").status_code == 200
    assert str(r.task) in api(reviewer).get("/api/me/review-tasks").text
    assert undelete(api, lead, r.project).status_code == 200
    assert project_rows(database, r.project) == rows_before
    assert audit_of(database, r.project) == [
        ("project.deleted", "{}"),
        ("project.undeleted", "{}"),
    ]


def test_the_deleted_list_shows_only_owned_deleted_projects(api: ApiAs, database: str) -> None:
    r = review(api, database)
    lead, reviewer = r.people["owner"], r.people["first"]
    name = name_of(database, r.project)
    assert api(lead).get("/api/projects/deleted").json() == []
    assert delete(api, lead, r.project, name).status_code == 204
    rows = api(lead).get("/api/projects/deleted").json()
    assert [(row["id"], row["name"]) for row in rows] == [(str(r.project), name)]
    assert api(reviewer).get("/api/projects/deleted").status_code == 403
    assert undelete(api, lead, r.project).status_code == 200
    assert api(lead).get("/api/projects/deleted").json() == []
