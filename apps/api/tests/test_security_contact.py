import json
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.tables import Role

CONTACT = "/api/tenant/security-contact"
PEOPLE = {"admin": Role.RESEARCHER, "researcher": Role.RESEARCHER, "reviewer": Role.REVIEWER}
REASON = "The hospital asked to see patient names in this study"


def problem(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


@pytest.mark.db
def test_an_admin_sets_reads_and_clears_the_security_contact_and_each_change_is_audited(
    api: ApiAs, database: str
) -> None:
    workspace = make_workspace(database, PEOPLE, admins={"admin"})
    admin = api(workspace.people["admin"])
    assert admin.get(CONTACT).json() == {"email": None}
    saved = admin.put(CONTACT, json={"email": "  Security@Clinic.Example "})
    assert saved.status_code == 200, saved.text
    assert saved.json() == {"email": "security@clinic.example"}
    assert admin.get(CONTACT).json() == {"email": "security@clinic.example"}
    assert admin.put(CONTACT, json={"email": "security@clinic.example"}).status_code == 200
    assert admin.put(CONTACT, json={"email": None}).json() == {"email": None}
    audited = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE tenant_id = '{workspace.tenant_id}' "
        "AND action = 'tenant.security-contact-changed' ORDER BY seq",
    )
    assert [json.loads(str(row[0])) for row in audited] == [
        {"had_contact": False, "has_contact": True},
        {"had_contact": True, "has_contact": False},
    ]
    assert "clinic.example" not in str(audited)


@pytest.mark.db
def test_a_malformed_address_is_refused(api: ApiAs, database: str) -> None:
    admin = api(make_workspace(database, PEOPLE, admins={"admin"}).people["admin"])
    for email in ("security", "a@b", "two words@clinic.example", "x" * 320 + "@a.example"):
        assert admin.put(CONTACT, json={"email": email}).status_code == 422, email


@pytest.mark.db
def test_only_admins_change_the_security_contact_and_reviewers_never_see_it(
    api: ApiAs, database: str
) -> None:
    people = make_workspace(database, PEOPLE, admins={"admin"}).people
    api(people["admin"]).put(CONTACT, json={"email": "security@clinic.example"})
    assert api(people["reviewer"]).get(CONTACT).status_code == 403
    assert api(people["researcher"]).get(CONTACT).json() == {"email": "security@clinic.example"}
    for who in ("researcher", "reviewer"):
        refused = api(people[who]).put(CONTACT, json={"email": "me@clinic.example"})
        assert refused.status_code == 403
    assert api(people["admin"]).get(CONTACT).json() == {"email": "security@clinic.example"}


@pytest.mark.db
def test_another_workspace_never_sees_the_security_contact(api: ApiAs, database: str) -> None:
    first = make_workspace(database, PEOPLE, admins={"admin"}).people
    second = make_workspace(database, PEOPLE, admins={"admin"}).people
    api(first["admin"]).put(CONTACT, json={"email": "security@first.example"})
    assert api(second["admin"]).get(CONTACT).json() == {"email": None}
    api(second["admin"]).put(CONTACT, json={"email": "security@second.example"})
    assert api(first["admin"]).get(CONTACT).json() == {"email": "security@first.example"}


@pytest.mark.db
def test_a_clinical_project_needs_the_security_contact_first(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, PEOPLE, admins={"admin"})
    people = workspace.people
    clinical = {"name": "Clinical", "privacy_mode": "clinical"}
    assert problem(api(people["researcher"]).post("/api/projects", json=clinical)) == (
        409,
        "security-contact-missing",
    )
    plain = api(people["researcher"]).post("/api/projects", json={"name": "Research"})
    assert plain.status_code == 201, plain.text
    switch = {"privacy_mode": "clinical", "reason": REASON}
    project = make_project(database, workspace.tenant_id, privacy_mode="de-identified")
    join_project(database, project, workspace.people["admin"], "owner")
    path = f"/api/projects/{project}/privacy-mode"
    assert problem(api(people["admin"]).post(path, json=switch)) == (
        409,
        "security-contact-missing",
    )
    api(people["admin"]).put(CONTACT, json={"email": "security@clinic.example"})
    assert api(people["researcher"]).post("/api/projects", json=clinical).status_code == 201
    changed = api(people["admin"]).post(path, json=switch)
    assert changed.status_code == 200, changed.text
    assert changed.json()["privacy_mode"] == "clinical"
