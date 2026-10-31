import uuid
from functools import partial
from typing import Any

import pytest
from alembic import command
from db_support import OWNER_URL, ApiAs, alembic_config, fresh_database, query, with_database
from test_review_tasks import Study, study
from test_review_tasks import draft as task_draft
from workspace_support import make_workspace, owner, person

from parfocal_api.principals import MemberPrincipal, PlatformOperator
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

TEMPLATES = "/api/study-templates"
OPERATOR = PlatformOperator("template-operator")
BUILT_IN_NAMES = {
    "sentinel-node": "Sentinel node AI evaluation",
    "detection": "Detection study",
    "segmentation": "Segmentation study",
    "cell-typing": "Cell typing study",
    "reader-study": "Reader study, first read without AI",
}
EVERY_BLOCK = [
    {"kind": "headline-numbers", "title": "Results", "metrics": ["sensitivity", "dice"]},
    {"kind": "region-metrics", "title": "Regions", "columns": ["dice"], "rows": 4},
    {"kind": "confusion-matrix", "title": "Cell types", "classes": ["Tumor"], "values": "share"},
    {"kind": "reviewer-agreement", "title": "Agreement", "parts": ["regions", "form"]},
    {"kind": "disagreement-reasons", "title": "Why", "top": 5, "style": "table"},
    {"kind": "opinion-answers", "title": "Opinions", "questions": ["acceptable"]},
    {"kind": "worst-objects", "title": "Worst", "rows": 6, "thumbnails": False},
    {"kind": "slide-table", "title": "Slides", "columns": ["time"], "sort_by": "time"},
    {"kind": "slide-figure", "title": "T2 on A1", "object_id": "T2", "layers": ["ai"]},
    {"kind": "text", "title": "Methods", "body": "Two reviewers, {slides} slides."},
    {"kind": "comparison", "title": "Against PathoSAM", "metrics": ["precision"]},
]


def template(name: str | None = None, **changes: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "name": name or f"Lab template {uuid.uuid4().hex[:8]}",
        "study_kind": "regions-and-cells",
        "blocks": EVERY_BLOCK,
        "format": {"paper": "letter", "decimals": 3, "downloads": ["pdf"]},
        "presets": {
            "objects_to_check": {"kind": "random-cells", "count": 150},
            "opinion_form": {"questions": [{"kind": "yesno", "key": "fine", "label": "Fine?"}]},
            "blinding": False,
            "first_read": True,
            "start_mode": "viewer",
            "split": "even",
        },
    }
    return body | changes


def team(database: str) -> dict[str, MemberPrincipal]:
    return make_workspace(
        database,
        {"admin": Role.RESEARCHER, "researcher": Role.RESEARCHER, "reviewer": Role.REVIEWER},
        admins={"admin"},
    ).people


def audited(database: str, target: str) -> list[tuple[object, ...]]:
    return owner(
        database,
        f"SELECT action, details FROM audit_events WHERE target_id = '{target}' ORDER BY seq",
    )


def test_a_new_workspace_gets_the_five_built_in_templates(api: ApiAs, database: str) -> None:
    slug = f"tpl-{uuid.uuid4().hex[:10]}"
    organisation = api(OPERATOR).post(
        "/api/platform/organisations", json={"slug": slug, "name": slug}
    )
    created = api(OPERATOR).post(
        "/api/platform/tenants",
        json={
            "organisation_id": organisation.json()["id"],
            "slug": slug,
            "name": slug,
            "kind": "research",
            "region": "eu",
        },
    )
    assert created.status_code == 201, created.text
    tenant = uuid.UUID(created.json()["id"])
    researcher = person(database, tenant, "researcher", Role.RESEARCHER)
    listed = api(researcher).get(TEMPLATES)
    assert listed.status_code == 200, listed.text
    templates = listed.json()
    assert {t["built_in"]: t["name"] for t in templates} == BUILT_IN_NAMES
    assert {t["version"] for t in templates} == {1}
    assert {t["task_count"] for t in templates} == {0}
    by_key = {t["built_in"]: t for t in templates}
    assert [b["kind"] for b in by_key["sentinel-node"]["blocks"]] == [
        "headline-numbers",
        "confusion-matrix",
        "disagreement-reasons",
        "opinion-answers",
        "worst-objects",
    ]
    reader = by_key["reader-study"]["presets"]
    assert (reader["blinding"], reader["first_read"], reader["start_mode"]) == (
        True,
        True,
        "viewer",
    )
    assert by_key["cell-typing"]["presets"]["objects_to_check"] == {
        "kind": "random-cells",
        "count": 200,
        "score": None,
    }
    assert by_key["segmentation"]["presets"]["split"] == "even"
    assert by_key["detection"]["format"]["paper"] == "a4"


def test_admin_rights_create_a_template_with_every_block_kind(api: ApiAs, database: str) -> None:
    people = team(database)
    created = api(people["admin"]).post(TEMPLATES, json=template("Lab study"))
    assert created.status_code == 201, created.text
    body = created.json()
    assert (body["name"], body["version"], body["built_in"], body["retired_at"]) == (
        "Lab study",
        1,
        None,
        None,
    )
    assert [b["kind"] for b in body["blocks"]] == [b["kind"] for b in EVERY_BLOCK]
    assert body["blocks"][0] | {"show_title": True, "width": "full"} == body["blocks"][0]
    assert body["format"]["paper"] == "letter"
    assert body["format"]["label_language"] == "en"
    assert body["presets"]["objects_to_check"]["count"] == 150
    assert body["presets"]["opinion_form"]["questions"][0]["key"] == "fine"
    read = api(people["researcher"]).get(f"{TEMPLATES}/{body['id']}")
    assert read.status_code == 200
    assert read.json()["blocks"] == body["blocks"]
    assert [row[0] for row in audited(database, body["id"])] == ["study-template.created"]
    taken = api(people["admin"]).post(TEMPLATES, json=template("lab STUDY"))
    assert (taken.status_code, taken.json()["code"]) == (409, "study-template-name-taken")
    built_in_name = api(people["admin"]).post(TEMPLATES, json=template("Detection study"))
    assert built_in_name.status_code == 409


def test_only_admin_rights_change_the_library(api: ApiAs, database: str) -> None:
    people = team(database)
    assert api(people["researcher"]).get(TEMPLATES).status_code == 200
    assert api(people["reviewer"]).get(TEMPLATES).status_code == 403
    assert api(people["researcher"]).post(TEMPLATES, json=template()).status_code == 403
    assert api(people["reviewer"]).post(TEMPLATES, json=template()).status_code == 403
    some = api(people["researcher"]).get(TEMPLATES).json()[0]["id"]
    assert api(people["researcher"]).put(f"{TEMPLATES}/{some}", json=template()).status_code == 403
    assert api(people["researcher"]).post(f"{TEMPLATES}/{some}/retire").status_code == 403


def test_an_edit_makes_a_new_version_and_keeps_the_old_one(api: ApiAs, database: str) -> None:
    people = team(database)
    admin = api(people["admin"])
    first = admin.post(TEMPLATES, json=template("Versioned")).json()
    path = f"{TEMPLATES}/{first['id']}"
    same = admin.put(path, json=template("Versioned"))
    assert (same.status_code, same.json()["version"]) == (200, 1)
    changed = template("Versioned, round two", blocks=EVERY_BLOCK[:2])
    edited = admin.put(path, json=changed)
    assert edited.status_code == 200, edited.text
    assert (edited.json()["version"], edited.json()["name"]) == (2, "Versioned, round two")
    assert len(edited.json()["blocks"]) == 2
    old = admin.get(f"{path}/versions/1").json()
    assert (old["version"], old["name"], len(old["blocks"])) == (1, "Versioned", len(EVERY_BLOCK))
    assert [(v["version"], v["name"]) for v in admin.get(f"{path}/versions").json()] == [
        (1, "Versioned"),
        (2, "Versioned, round two"),
    ]
    assert admin.get(path).json()["version"] == 2
    assert admin.get(f"{path}/versions/3").status_code == 404
    assert [(row[0], row[1]) for row in audited(database, first["id"])] == [
        ("study-template.created", '{"blocks":11,"version":1}'),
        ("study-template.edited", '{"blocks":2,"version":2}'),
    ]


def test_a_built_in_template_is_edited_as_a_new_version(api: ApiAs, database: str) -> None:
    people = team(database)
    detection = next(
        t for t in api(people["admin"]).get(TEMPLATES).json() if t["built_in"] == "detection"
    )
    body = {key: detection[key] for key in ("name", "study_kind", "blocks", "format", "presets")}
    body["presets"] = body["presets"] | {"split": "even"}
    edited = api(people["admin"]).put(f"{TEMPLATES}/{detection['id']}", json=body)
    assert (edited.status_code, edited.json()["version"]) == (200, 2)
    assert edited.json()["built_in"] == "detection"


def test_retire_and_restore(api: ApiAs, database: str) -> None:
    people = team(database)
    admin = api(people["admin"])
    created = admin.post(TEMPLATES, json=template("Retiring")).json()
    path = f"{TEMPLATES}/{created['id']}"
    retired = admin.post(f"{path}/retire")
    assert retired.status_code == 200
    assert retired.json()["retired_at"] is not None
    assert admin.post(f"{path}/retire").status_code == 200
    listed = {t["id"]: t for t in admin.get(TEMPLATES).json()}
    assert listed[created["id"]]["retired_at"] is not None
    refused = admin.put(path, json=template("Retiring, changed"))
    assert (refused.status_code, refused.json()["code"]) == (409, "study-template-retired")
    restored = admin.post(f"{path}/restore")
    assert (restored.status_code, restored.json()["retired_at"]) == (200, None)
    assert [row[0] for row in audited(database, created["id"])] == [
        "study-template.created",
        "study-template.retired",
        "study-template.restored",
    ]


@pytest.mark.parametrize(
    ("change", "location"),
    [
        ({"blocks": [{"kind": "pie-chart", "title": "Pie"}]}, ["body", "blocks", 0]),
        (
            {"blocks": [{"kind": "text", "title": "Methods", "colour": "red"}]},
            ["body", "blocks", 0, "text", "colour"],
        ),
        (
            {"blocks": [{"kind": "worst-objects", "title": "Worst", "rows": "6"}]},
            ["body", "blocks", 0, "worst-objects", "rows"],
        ),
        (
            {"blocks": [{"kind": "text", "title": "Methods", "show_title": "yes"}]},
            ["body", "blocks", 0, "text", "show_title"],
        ),
        (
            {"blocks": [{"kind": "headline-numbers", "title": "Results", "metrics": ["f1"]}]},
            ["body", "blocks", 0, "headline-numbers", "metrics", 0],
        ),
        (
            {"blocks": [{"kind": "region-metrics", "title": "Regions", "columns": ["dice"] * 2}]},
            ["body", "blocks", 0, "region-metrics"],
        ),
        ({"format": {"paper": "a3"}}, ["body", "format", "paper"]),
        ({"format": {"watermark": True}}, ["body", "format", "watermark"]),
        (
            {"presets": {"objects_to_check": {"kind": "all-regions"}, "blinded": True}},
            ["body", "presets", "blinded"],
        ),
        (
            {"presets": {"objects_to_check": {"kind": "all-regions"}, "first_read": "no"}},
            ["body", "presets", "first_read"],
        ),
        ({"study_kind": "histology"}, ["body", "study_kind"]),
    ],
    ids=[
        "unknown-kind",
        "unknown-setting",
        "number-as-text",
        "flag-as-text",
        "unknown-metric",
        "repeated-column",
        "unknown-paper",
        "unknown-format-setting",
        "unknown-preset",
        "preset-as-text",
        "unknown-study-kind",
    ],
)
def test_unknown_or_mistyped_blocks_and_settings_are_refused(
    api: ApiAs, database: str, change: dict[str, Any], location: list[str | int]
) -> None:
    people = team(database)
    created = api(people["admin"]).post(TEMPLATES, json=template(**change))
    assert created.status_code == 422
    assert created.headers["content-type"].startswith("application/problem+json")
    problem = created.json()
    assert (problem["status"], problem["code"]) == (422, "validation")
    assert [error["location"][: len(location)] for error in problem["errors"]] == [location]
    some = api(people["admin"]).get(TEMPLATES).json()[0]["id"]
    edited = api(people["admin"]).put(f"{TEMPLATES}/{some}", json=template(**change))
    assert edited.status_code == 422


def test_another_workspace_cannot_read_or_change_a_template(api: ApiAs, database: str) -> None:
    mine, theirs = team(database), team(database)
    created = api(mine["admin"]).post(TEMPLATES, json=template("Private study")).json()
    path = f"{TEMPLATES}/{created['id']}"
    other = api(theirs["admin"])
    assert "Private study" not in other.get(TEMPLATES).text
    assert other.get(path).status_code == 404
    assert other.get(f"{path}/versions").status_code == 404
    assert other.get(f"{path}/versions/1").status_code == 404
    assert other.put(path, json=template("Taken over")).status_code == 404
    assert other.post(f"{path}/retire").status_code == 404
    assert api(mine["admin"]).get(path).json()["retired_at"] is None


def templates_of(api: ApiAs, s: Study) -> dict[str, dict[str, Any]]:
    listed = api(s.people["admin"]).get(TEMPLATES).json()
    return {t["built_in"] or t["name"]: t for t in listed}


def test_a_task_pins_the_template_version_it_was_created_with(api: ApiAs, database: str) -> None:
    s = study(database)
    admin, researcher = partial(api, s.people["admin"]), partial(api, s.people["owner"])
    sentinel = templates_of(api, s)["sentinel-node"]
    path = f"{TEMPLATES}/{sentinel['id']}"
    first = researcher().post(s.tasks, json=task_draft(s, study_template_id=sentinel["id"]))
    assert first.status_code == 201, first.text
    assert (first.json()["study_template_id"], first.json()["study_template_version"]) == (
        sentinel["id"],
        1,
    )
    body = {key: sentinel[key] for key in ("name", "study_kind", "blocks", "format", "presets")}
    assert admin().put(path, json=body | {"blocks": body["blocks"][:2]}).json()["version"] == 2
    kept = researcher().get(f"/api/review-tasks/{first.json()['id']}").json()
    assert kept["study_template_version"] == 1
    second = researcher().post(s.tasks, json=task_draft(s, study_template_id=sentinel["id"]))
    assert second.json()["study_template_version"] == 2
    older = researcher().post(
        s.tasks,
        json=task_draft(s, study_template_id=sentinel["id"], study_template_version=1),
    )
    assert older.json()["study_template_version"] == 1
    listed = researcher().get(s.tasks).json()
    assert [t["study_template_version"] for t in listed] == [1, 2, 1]
    assert templates_of(api, s)["sentinel-node"]["task_count"] == 3
    details = owner(
        database,
        f"SELECT details FROM audit_events WHERE target_id = '{first.json()['id']}'",
    )
    assert f'"study_template_id":"{sentinel["id"]}"' in str(details[0][0])
    assert '"study_template_version":1' in str(details[0][0])


def test_a_task_without_a_template_pins_nothing(api: ApiAs, database: str) -> None:
    s = study(database)
    created = api(s.people["owner"]).post(s.tasks, json=task_draft(s))
    assert created.status_code == 201, created.text
    assert (created.json()["study_template_id"], created.json()["study_template_version"]) == (
        None,
        None,
    )


def test_a_task_refuses_unknown_foreign_and_retired_templates(api: ApiAs, database: str) -> None:
    s, other = study(database), study(database)
    researcher = partial(api, s.people["owner"])
    mine = templates_of(api, s)["detection"]["id"]
    theirs = templates_of(api, other)["detection"]["id"]
    for template_id, version in ((str(uuid.uuid4()), None), (theirs, None), (mine, 9)):
        refused = researcher().post(
            s.tasks,
            json=task_draft(s, study_template_id=template_id, study_template_version=version),
        )
        assert (refused.status_code, refused.json()["code"]) == (400, "unknown-study-template")
    lonely = researcher().post(s.tasks, json=task_draft(s, study_template_version=1))
    assert lonely.status_code == 422
    api(s.people["admin"]).post(f"{TEMPLATES}/{mine}/retire")
    retired = researcher().post(s.tasks, json=task_draft(s, study_template_id=mine))
    assert (retired.status_code, retired.json()["code"]) == (409, "study-template-retired")
    assert researcher().get(s.tasks).json() == []


def test_the_migration_seeds_the_built_ins_into_existing_workspaces() -> None:
    with fresh_database() as name:
        url = with_database(OWNER_URL, name)
        config = alembic_config(url)
        command.upgrade(config, "0044-1")
        query(url, "INSERT INTO organisations (slug, name) VALUES ('lab', 'Lab')")
        query(
            url,
            "INSERT INTO tenants (organisation_id, slug, name, kind, region, plan) "
            "SELECT id, 'lab', 'Lab', 'research', 'eu', 'pilot' FROM organisations",
        )
        command.upgrade(config, "0044")
        rows = query(
            url,
            "SELECT t.built_in, v.name, v.version FROM study_templates t "
            "JOIN study_template_versions v ON v.template_id = t.id ORDER BY t.built_in",
        )
        assert {row[0]: row[1] for row in rows} == BUILT_IN_NAMES
        assert {row[2] for row in rows} == {1}
        command.downgrade(config, "0044-1")
        assert query(url, "SELECT to_regclass('study_templates')") == [(None,)]
