from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import join_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

PROJECTS = "/api/projects"
EVERY_KIND = [
    {
        "kind": "scale",
        "key": "acceptable",
        "label": "Acceptable?",
        "min": 0,
        "max": 10,
        "min_label": "no",
        "max_label": "fully",
        "required": True,
        "quick": True,
    },
    {"kind": "choice", "key": "error", "label": "Main error", "options": ["None", "Boundaries"]},
    {"kind": "yesno", "key": "sign", "label": "Sign as is?", "quick": True},
    {"kind": "text", "key": "comment", "label": "Comment", "max_length": 500},
]


def team(database: str) -> dict[str, MemberPrincipal]:
    return make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "viewer": Role.RESEARCHER,
            "reviewer": Role.REVIEWER,
            "outsider": Role.RESEARCHER,
        },
    ).people


def project_for(api: ApiAs, database: str, people: dict[str, MemberPrincipal]) -> str:
    response = api(people["owner"]).post(PROJECTS, json={"name": "Opinions"})
    assert response.status_code == 201, response.text
    project = response.json()["id"]
    join_project(database, project, people["viewer"], "viewer")
    join_project(database, project, people["reviewer"], "reviewer")
    return project


def publish(api: ApiAs, who: MemberPrincipal, project: str, questions: list[dict[str, Any]]) -> Any:
    return api(who).put(f"{PROJECTS}/{project}/opinion-form", json={"questions": questions})


def test_a_new_project_starts_from_the_default_template(api: ApiAs, database: str) -> None:
    people = team(database)
    template = api(people["reviewer"]).get("/api/opinion-form-template").json()
    project = project_for(api, database, people)
    form = api(people["reviewer"]).get(f"{PROJECTS}/{project}/opinion-form").json()
    assert (form["version"], form["questions"]) == (1, template)
    assert [(q["key"], q["kind"], q["quick"]) for q in template] == [
        ("acceptable", "scale", True),
        ("main_error", "choice", True),
        ("sign_as_is", "yesno", True),
        ("comment", "text", False),
    ]
    assert (template[0]["min"], template[0]["max"], template[0]["max_label"]) == (
        1,
        5,
        "sign as is",
    )


def test_publishing_makes_a_new_version_and_keeps_the_old_one(api: ApiAs, database: str) -> None:
    people = team(database)
    project = project_for(api, database, people)
    first = api(people["owner"]).get(f"{PROJECTS}/{project}/opinion-form").json()
    published = publish(api, people["owner"], project, EVERY_KIND)
    assert published.status_code == 200, published.text
    body = published.json()
    assert body["version"] == 2
    assert [q["kind"] for q in body["questions"]] == ["scale", "choice", "yesno", "text"]
    assert body["questions"][0]["min"] == 0
    old = api(people["viewer"]).get(f"{PROJECTS}/{project}/opinion-form/versions/1").json()
    assert old["questions"] == first["questions"]
    again = publish(api, people["owner"], project, EVERY_KIND)
    assert again.json()["version"] == 2
    versions = api(people["reviewer"]).get(f"{PROJECTS}/{project}/opinion-form/versions").json()
    assert [row["version"] for row in versions] == [1, 2]
    missing = api(people["owner"]).get(f"{PROJECTS}/{project}/opinion-form/versions/9")
    assert missing.status_code == 404
    details = owner(
        database,
        f"SELECT details FROM audit_events WHERE target_id = '{project}' "
        "AND action = 'project.opinion-form-published'",
    )
    assert details == [('{"questions":4,"version":2}',)]


@pytest.mark.parametrize(
    "questions",
    [
        [],
        [{"kind": "scale", "key": "s", "label": "S", "min": 5, "max": 5}],
        [{"kind": "choice", "key": "c", "label": "C", "options": ["Only"]}],
        [{"kind": "choice", "key": "c", "label": "C", "options": ["Same", "same"]}],
        [{"kind": "text", "key": "t", "label": "T", "max_length": 2001}],
        [{"kind": "rating", "key": "r", "label": "R"}],
        [{"kind": "yesno", "key": "Bad Key", "label": "Y"}],
        [{"kind": "yesno", "key": "y", "label": "Y"}, {"kind": "text", "key": "y", "label": "T"}],
        [{"kind": "yesno", "key": f"q{n}", "label": "Q", "quick": True} for n in range(4)],
        [{"kind": "yesno", "key": f"q{n}", "label": "Q"} for n in range(13)],
    ],
)
def test_invalid_forms_are_refused(
    api: ApiAs, database: str, questions: list[dict[str, Any]]
) -> None:
    people = team(database)
    project = project_for(api, database, people)
    assert publish(api, people["owner"], project, questions).status_code == 422


def test_members_read_the_form_and_only_owners_publish(api: ApiAs, database: str) -> None:
    people = team(database)
    project = project_for(api, database, people)
    for label in ("viewer", "reviewer"):
        assert api(people[label]).get(f"{PROJECTS}/{project}/opinion-form").status_code == 200
        assert publish(api, people[label], project, EVERY_KIND).status_code == 403
    assert api(people["outsider"]).get(f"{PROJECTS}/{project}/opinion-form").status_code == 404
    api(people["owner"]).post(f"{PROJECTS}/{project}/archive")
    archived = publish(api, people["owner"], project, EVERY_KIND)
    assert (archived.status_code, archived.json()["code"]) == (409, "project-archived")
