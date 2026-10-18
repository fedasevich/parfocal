import pytest
from db_support import ApiAs
from idp_support import Browser
from workspace_support import (
    join_project,
    make_case,
    make_project,
    make_slide,
    make_tenant,
    make_workspace,
    owner,
    person,
)

from parfocal_api.tables import Role

pytestmark = pytest.mark.db


def test_every_factory_builds_what_a_route_test_needs(
    api: ApiAs, browser: Browser, database: str
) -> None:
    assert owner(database, "SELECT current_database()") == [(database,)]
    w = make_workspace(database, {"lead": Role.RESEARCHER, "doctor": Role.REVIEWER})
    admin = person(database, w.tenant_id, "admin", Role.ADMIN)
    project = make_project(database, w.tenant_id, "de-identified")
    join_project(database, project, w.people["lead"], "owner")
    case = make_case(database, w.tenant_id, project, "S26-HARNESS")
    in_case = make_slide(database, w.tenant_id, project, "A1", case)
    loose = make_slide(database, w.tenant_id, project, "loose")
    for who, expected in ((w.people["lead"], 200), (w.people["doctor"], 404), (admin, 404)):
        assert api(who).get(f"/api/cases/{case}").status_code == expected, who.role
    slides = api(w.people["lead"]).get("/api/me/slides").json()["slides"]
    assert {row["id"] for row in slides} == {str(in_case), str(loose)}
    other = make_tenant(database)
    stranger = person(database, other, "stranger", Role.RESEARCHER)
    assert api(stranger).get(f"/api/projects/{project}").status_code == 404
    browser.login()
    assert browser.session().status_code == 200
