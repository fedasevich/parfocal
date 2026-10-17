import itertools
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import join_project, make_workspace, owner

from parfocal_api.class_templates import TEMPLATES, TaxonomyTemplate
from parfocal_api.colours import Vision, separation
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_api.taxonomy import RESERVED, ClassDraft, too_close

PROJECTS = "/api/projects"
SENTINEL = {"tumor": "#f87171", "stroma": "#6ee7b7", "immune": "#c084fc", "other": "#fbbf24"}


def test_the_kits_closest_class_pair_matches_doc_35() -> None:
    worst = min(
        (*separation(SENTINEL[a], SENTINEL[b]), a, b)
        for a, b in itertools.combinations(SENTINEL, 2)
    )
    assert (round(worst[0], 1), worst[1], worst[2], worst[3]) == (
        15.1,
        Vision.DEUTERANOPIA,
        "tumor",
        "stroma",
    )
    assert separation("#f87171", "#f87171")[0] == 0


@pytest.mark.parametrize("template", sorted(TEMPLATES))
def test_every_template_passes_the_colour_check(template: TaxonomyTemplate) -> None:
    classes = [
        ClassDraft(key=key, name=name, colour=colour)
        for key, (name, colour) in enumerate(TEMPLATES[template], start=1)
    ]
    assert too_close(classes) is None


def test_the_check_names_the_pair_and_the_reserved_marks() -> None:
    close = [
        ClassDraft(key=1, name="Tumor", colour="#f87171"),
        ClassDraft(key=2, name="Necrosis", colour="#f47a7a"),
    ]
    assert (too_close(close) or "").startswith("Tumor and Necrosis are ")
    white = [ClassDraft(key=1, name="Fat", colour="#f8f8f8")]
    assert "unsure zones on the slide" in (too_close(white) or "")
    assert {mark for _, mark, _ in RESERVED} >= {"AI proposals"}


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


def project_for(api: ApiAs, database: str, people: dict[str, MemberPrincipal], **body: Any) -> str:
    response = api(people["owner"]).post(PROJECTS, json={"name": "Taxonomy"} | body)
    assert response.status_code == 201, response.text
    project = response.json()["id"]
    join_project(database, project, people["viewer"], "viewer")
    join_project(database, project, people["reviewer"], "reviewer")
    return project


def classes(api: ApiAs, who: MemberPrincipal, project: str) -> Any:
    return api(who).get(f"{PROJECTS}/{project}/classes")


def put_classes(api: ApiAs, who: MemberPrincipal, project: str, rows: list[dict[str, Any]]) -> Any:
    return api(who).put(f"{PROJECTS}/{project}/classes", json={"classes": rows})


def resolve(api: ApiAs, who: MemberPrincipal, project: str, *names: str) -> list[str | None]:
    response = api(who).get(
        f"{PROJECTS}/{project}/class-mappings/resolve", params=[("name", n) for n in names]
    )
    assert response.status_code == 200, response.text
    return [row["class_id"] for row in response.json()]


@pytest.mark.db
def test_templates_are_listed_and_start_a_project(api: ApiAs, database: str) -> None:
    people = team(database)
    listed = api(people["owner"]).get("/api/taxonomy-templates").json()
    assert [row["template"] for row in listed] == ["sentinel-node", "pannuke"]
    project = project_for(api, database, people, taxonomy="pannuke")
    rows = classes(api, people["reviewer"], project).json()
    assert [(row["key"], row["name"], row["colour"]) for row in rows] == [
        (1, "Neoplastic", "#f87171"),
        (2, "Inflammatory", "#c084fc"),
        (3, "Connective", "#6ee7b7"),
        (4, "Dead", "#fbbf24"),
        (5, "Epithelial", "#43999d"),
    ]
    assert classes(api, people["owner"], project_for(api, database, people)).json() == []


@pytest.mark.db
def test_an_owner_sets_custom_classes_and_keeps_their_ids(api: ApiAs, database: str) -> None:
    people = team(database)
    project = project_for(api, database, people, taxonomy="sentinel-node")
    tumor, stroma, immune, other = classes(api, people["owner"], project).json()
    changed = put_classes(
        api,
        people["owner"],
        project,
        [
            {"id": stroma["id"], "key": 1, "name": "Tumor", "colour": "#6EE7B7"},
            {"id": tumor["id"], "key": 2, "name": "Stroma", "colour": "#f87171"},
            {"id": immune["id"], "key": 3, "name": "Lymphocyte", "colour": "#c084fc"},
            {"key": 9, "name": "Necrosis", "colour": "#43999d"},
        ],
    )
    assert changed.status_code == 200, changed.text
    rows = changed.json()
    assert [(row["key"], row["name"], row["colour"]) for row in rows] == [
        (1, "Tumor", "#6ee7b7"),
        (2, "Stroma", "#f87171"),
        (3, "Lymphocyte", "#c084fc"),
        (9, "Necrosis", "#43999d"),
    ]
    assert [row["id"] for row in rows[:3]] == [stroma["id"], tumor["id"], immune["id"]]
    assert other["id"] not in {row["id"] for row in rows}
    details = owner(
        database,
        f"SELECT details FROM audit_events WHERE target_id = '{project}' "
        "AND action = 'project.taxonomy-changed'",
    )
    assert details == [('{"added":1,"classes":4,"removed":1}',)]


@pytest.mark.db
def test_colours_too_close_are_refused(api: ApiAs, database: str) -> None:
    people = team(database)
    project = project_for(api, database, people, taxonomy="sentinel-node")
    rows = [
        {"key": 1, "name": "Tumor", "colour": "#f87171"},
        {"key": 2, "name": "Necrosis", "colour": "#f47a7a"},
    ]
    refused = put_classes(api, people["owner"], project, rows)
    assert (refused.status_code, refused.json()["code"]) == (400, "colours-too-close")
    assert refused.json()["detail"].startswith("Tumor and Necrosis are ")
    near_white = put_classes(
        api, people["owner"], project, [{"key": 1, "name": "Fat", "colour": "#f8f8f8"}]
    )
    assert near_white.json()["code"] == "colours-too-close"
    assert len(classes(api, people["owner"], project).json()) == 4


@pytest.mark.db
@pytest.mark.parametrize(
    "rows",
    [
        [{"key": 0, "name": "A", "colour": "#f87171"}],
        [{"key": 10, "name": "A", "colour": "#f87171"}],
        [{"key": 1, "name": "A", "colour": "red"}],
        [{"key": 1, "name": "  ", "colour": "#f87171"}],
        [
            {"key": 1, "name": "A", "colour": "#f87171"},
            {"key": 1, "name": "B", "colour": "#6ee7b7"},
        ],
        [
            {"key": 1, "name": "Tumor", "colour": "#f87171"},
            {"key": 2, "name": "tumor", "colour": "#6ee7b7"},
        ],
        [{"key": key, "name": f"C{key}", "colour": "#f87171"} for key in range(1, 10)]
        + [{"key": 9, "name": "C10", "colour": "#f87171"}],
    ],
)
def test_invalid_taxonomies_are_refused(
    api: ApiAs, database: str, rows: list[dict[str, Any]]
) -> None:
    people = team(database)
    project = project_for(api, database, people)
    assert put_classes(api, people["owner"], project, rows).status_code == 422


@pytest.mark.db
def test_a_class_of_another_project_is_refused(api: ApiAs, database: str) -> None:
    people = team(database)
    first = project_for(api, database, people, taxonomy="sentinel-node")
    second = project_for(api, database, people)
    foreign = classes(api, people["owner"], first).json()[0]
    row = {"id": foreign["id"], "key": 1, "name": "Tumor", "colour": "#f87171"}
    refused = put_classes(api, people["owner"], second, [row])
    assert (refused.status_code, refused.json()["code"]) == (400, "unknown-class")


@pytest.mark.db
def test_a_stored_mapping_is_applied_to_the_next_import(api: ApiAs, database: str) -> None:
    people = team(database)
    project = project_for(api, database, people, taxonomy="sentinel-node")
    tumor, stroma, immune, other = (
        row["id"] for row in classes(api, people["owner"], project).json()
    )
    first = resolve(api, people["owner"], project, "Neoplastic", "tumour_cell", "Stroma", "Other")
    assert first == [None, None, stroma, other]
    remembered = api(people["owner"]).put(
        f"{PROJECTS}/{project}/class-mappings",
        json={
            "mappings": [
                {"source_name": "Neoplastic", "class_id": tumor},
                {"source_name": " tumour_cell ", "class_id": tumor},
                {"source_name": "OTHER", "class_id": immune},
            ]
        },
    )
    assert remembered.status_code == 200, remembered.text
    assert [row["source_name"] for row in remembered.json()] == [
        "neoplastic",
        "other",
        "tumour_cell",
    ]
    second = resolve(
        api, people["reviewer"], project, "neoplastic ", "TUMOUR_CELL", "Stroma", "Other", "Epi"
    )
    assert second == [tumor, tumor, stroma, immune, None]
    details = owner(
        database,
        f"SELECT details FROM audit_events WHERE target_id = '{project}' "
        "AND action = 'project.mappings-changed'",
    )
    assert details == [('{"mappings":3}',)]


@pytest.mark.db
def test_removing_a_class_forgets_its_mappings(api: ApiAs, database: str) -> None:
    people = team(database)
    project = project_for(api, database, people, taxonomy="sentinel-node")
    rows = classes(api, people["owner"], project).json()
    api(people["owner"]).put(
        f"{PROJECTS}/{project}/class-mappings",
        json={"mappings": [{"source_name": "Neoplastic", "class_id": rows[0]["id"]}]},
    )
    kept = [{k: row[k] for k in ("id", "key", "name", "colour")} for row in rows[1:]]
    assert put_classes(api, people["owner"], project, kept).status_code == 200
    assert api(people["owner"]).get(f"{PROJECTS}/{project}/class-mappings").json() == []
    unknown = api(people["owner"]).put(
        f"{PROJECTS}/{project}/class-mappings",
        json={"mappings": [{"source_name": "Neoplastic", "class_id": rows[0]["id"]}]},
    )
    assert (unknown.status_code, unknown.json()["code"]) == (400, "unknown-class")


@pytest.mark.db
def test_members_read_the_taxonomy_and_only_owners_change_it(api: ApiAs, database: str) -> None:
    people = team(database)
    project = project_for(api, database, people, taxonomy="sentinel-node")
    for label in ("viewer", "reviewer"):
        assert classes(api, people[label], project).status_code == 200
        response = put_classes(api, people[label], project, [])
        assert response.status_code == 403
    assert classes(api, people["outsider"], project).status_code == 404
    api(people["owner"]).post(f"{PROJECTS}/{project}/archive")
    archived = put_classes(api, people["owner"], project, [])
    assert (archived.status_code, archived.json()["code"]) == (409, "project-archived")
