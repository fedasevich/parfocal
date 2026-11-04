import asyncio
import json
import uuid
from dataclasses import dataclass

import pytest
from db_support import OWNER_URL, ApiAs, with_database
from sqlalchemy.ext.asyncio import create_async_engine
from test_annotations import make_class
from test_blinding import make_result_set
from workspace_support import (
    give_security_contact,
    join_project,
    make_case,
    make_project,
    make_slide,
    make_workspace,
    owner,
    person,
)

from parfocal_api.principals import MemberPrincipal
from parfocal_api.sign_out import signs_out_case
from parfocal_api.tables import ProjectRole, Role, SignOutRight
from parfocal_common.db import async_database_url

pytestmark = pytest.mark.db

PROJECTS = "/api/projects"


@dataclass(frozen=True)
class Cases:
    lead: MemberPrincipal
    subject: MemberPrincipal
    project: uuid.UUID
    own: uuid.UUID
    other: uuid.UUID


def assign(
    api: ApiAs,
    database: str,
    lead: MemberPrincipal,
    project: uuid.UUID,
    slide: uuid.UUID,
    who: MemberPrincipal,
) -> None:
    make_class(database, lead.tenant_id, project)
    result_set = make_result_set(database, lead.tenant_id, project, slide)
    created = api(lead).post(
        f"{PROJECTS}/{project}/review-tasks",
        json={
            "name": "Sign-out task",
            "slide_ids": [str(slide)],
            "result_sets": [{"slide_id": str(slide), "result_set_id": result_set}],
            "reviewer_ids": [str(who.user_id)],
            "split": "everyone",
            "scope": {"kind": "all-regions"},
        },
    )
    assert created.status_code == 201, created.text


def make_cases(api: ApiAs, database: str, privacy_mode: str = "clinical") -> Cases:
    people = make_workspace(database, {"lead": Role.RESEARCHER, "subject": Role.RESEARCHER}).people
    lead, subject = people["lead"], people["subject"]
    project = make_project(database, lead.tenant_id, privacy_mode)
    join_project(database, project, lead, "owner")
    join_project(database, project, subject, "reviewer")
    own = make_case(database, lead.tenant_id, project, f"O-{uuid.uuid4().hex[:6]}")
    other = make_case(database, lead.tenant_id, project, f"A-{uuid.uuid4().hex[:6]}")
    own_slide = make_slide(database, lead.tenant_id, project, "Own slide", own)
    make_slide(database, lead.tenant_id, project, "Other slide", other)
    assign(api, database, lead, project, own_slide, subject)
    return Cases(lead, subject, project, own, other)


@pytest.fixture
def clinical(api: ApiAs, database: str) -> Cases:
    return make_cases(api, database)


def hold(database: str, cases: Cases, role: ProjectRole, stored: SignOutRight | None) -> None:
    value = f"'{stored}'" if stored else "NULL"
    owner(
        database,
        f"UPDATE project_members SET role = '{role}', sign_out = {value} "
        f"WHERE project_id = '{cases.project}' AND user_id = '{cases.subject.user_id}'",
    )


def signs_out(database: str, cases: Cases) -> tuple[bool, bool]:
    async def check() -> tuple[bool, bool]:
        engine = create_async_engine(async_database_url(with_database(OWNER_URL, database)))
        try:
            async with engine.connect() as connection:
                return (
                    await signs_out_case(connection, cases.subject, cases.own),
                    await signs_out_case(connection, cases.subject, cases.other),
                )
        finally:
            await engine.dispose()

    return asyncio.run(check())


OWN = SignOutRight.OWN_CASES
ANY = SignOutRight.ANY_CASE
NEVER = SignOutRight.NEVER

RIGHTS: list[tuple[ProjectRole, SignOutRight | None, bool, bool]] = [
    (ProjectRole.OWNER, None, True, False),
    (ProjectRole.REVIEWER, None, True, False),
    (ProjectRole.VIEWER, None, False, False),
    (ProjectRole.REVIEWER, OWN, True, False),
    (ProjectRole.REVIEWER, ANY, True, True),
    (ProjectRole.OWNER, ANY, True, True),
    (ProjectRole.REVIEWER, NEVER, False, False),
    (ProjectRole.OWNER, NEVER, False, False),
    (ProjectRole.VIEWER, ANY, False, False),
]


@pytest.mark.parametrize(("role", "stored", "own_case", "another_case"), RIGHTS, ids=str)
def test_the_right_covers_the_cases_it_names(
    database: str,
    clinical: Cases,
    role: ProjectRole,
    stored: SignOutRight | None,
    own_case: bool,
    another_case: bool,
) -> None:
    hold(database, clinical, role, stored)
    assert signs_out(database, clinical) == (own_case, another_case)


def test_a_de_identified_project_has_no_right(api: ApiAs, database: str) -> None:
    cases = make_cases(api, database, "de-identified")
    hold(database, cases, ProjectRole.REVIEWER, ANY)
    assert signs_out(database, cases) == (False, False)
    members = api(cases.lead).get(f"{PROJECTS}/{cases.project}").json()["members"]
    assert {row["sign_out"] for row in members} == {None}
    refused = api(cases.lead).put(
        f"{PROJECTS}/{cases.project}/members/{cases.subject.user_id}/sign-out",
        json={"sign_out": "any"},
    )
    assert (refused.status_code, refused.json()["code"]) == (409, "no-sign-out-right")


def rights_of(api: ApiAs, lead: MemberPrincipal, project: str) -> dict[str, str | None]:
    members = api(lead).get(f"{PROJECTS}/{project}").json()["members"]
    return {row["user_id"]: row["sign_out"] for row in members}


def test_owners_and_reviewers_sign_out_own_cases_by_default(api: ApiAs, database: str) -> None:
    workspace = make_workspace(
        database, {"lead": Role.RESEARCHER, "reader": Role.REVIEWER, "viewer": Role.REVIEWER}
    )
    give_security_contact(database, workspace.tenant_id)
    people = workspace.people
    lead = people["lead"]
    created = api(lead).post(PROJECTS, json={"name": "Clinical", "privacy_mode": "clinical"})
    assert created.status_code == 201, created.text
    project = created.json()["id"]
    for who, role in (("reader", "reviewer"), ("viewer", "viewer")):
        path = f"{PROJECTS}/{project}/members/{people[who].user_id}"
        assert api(lead).put(path, json={"role": role}).status_code == 200
    assert rights_of(api, lead, project) == {
        str(lead.user_id): "own",
        str(people["reader"].user_id): "own",
        str(people["viewer"].user_id): "never",
    }


def test_only_the_owner_changes_the_right_and_a_viewer_stays_at_never(
    api: ApiAs, database: str
) -> None:
    cases = make_cases(api, database)
    viewer = person(database, cases.lead.tenant_id, "viewer", Role.REVIEWER)
    join_project(database, cases.project, viewer, "viewer")
    lead_path = f"{PROJECTS}/{cases.project}/members/{cases.lead.user_id}/sign-out"
    refused = api(cases.subject).put(lead_path, json={"sign_out": "never"})
    assert (refused.status_code, refused.json()["code"]) == (403, "project-owners-only")
    viewer_path = f"{PROJECTS}/{cases.project}/members/{viewer.user_id}/sign-out"
    wrong = api(cases.lead).put(viewer_path, json={"sign_out": "own"})
    assert (wrong.status_code, wrong.json()["code"]) == (400, "viewers-never-sign-out")
    assert api(cases.lead).put(viewer_path, json={"sign_out": "never"}).status_code == 200
    stranger = f"{PROJECTS}/{cases.project}/members/{uuid.uuid4()}/sign-out"
    assert api(cases.lead).put(stranger, json={"sign_out": "never"}).status_code == 404


def test_the_last_member_who_signs_out_may_go_to_never_with_a_warning(
    api: ApiAs, database: str
) -> None:
    cases = make_cases(api, database)
    base = f"{PROJECTS}/{cases.project}/members"
    subject = api(cases.lead).put(
        f"{base}/{cases.subject.user_id}/sign-out", json={"sign_out": "never"}
    )
    assert (subject.status_code, subject.json()["warning"]) == (200, None)
    last = api(cases.lead).put(f"{base}/{cases.lead.user_id}/sign-out", json={"sign_out": "never"})
    assert (last.status_code, last.json()["warning"]) == (200, "no-one-signs-out")
    assert set(rights_of(api, cases.lead, str(cases.project)).values()) == {"never"}
    back = api(cases.lead).put(f"{base}/{cases.subject.user_id}/sign-out", json={"sign_out": "any"})
    assert (back.status_code, back.json()["warning"]) == (200, None)
    changes = owner(
        database,
        "SELECT details FROM audit_events WHERE action = 'project.sign-out-set' "
        f"AND tenant_id = '{cases.lead.tenant_id}' ORDER BY seq",
    )
    details = [json.loads(str(row[0])) for row in changes]
    assert [(entry["from"], entry["to"]) for entry in details] == [
        ("own", "never"),
        ("own", "never"),
        ("never", "any"),
    ]
    assert {entry["project_id"] for entry in details} == {str(cases.project)}


def test_a_member_made_viewer_starts_again_from_the_default(api: ApiAs, database: str) -> None:
    cases = make_cases(api, database)
    member = f"{PROJECTS}/{cases.project}/members/{cases.subject.user_id}"
    assert api(cases.lead).put(f"{member}/sign-out", json={"sign_out": "any"}).status_code == 200
    assert api(cases.lead).put(member, json={"role": "viewer"}).status_code == 200
    assert api(cases.lead).put(member, json={"role": "reviewer"}).status_code == 200
    assert rights_of(api, cases.lead, str(cases.project))[str(cases.subject.user_id)] == "own"
