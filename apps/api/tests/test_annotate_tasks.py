import json
import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_review_tasks import Study, create, insert_id, study
from workspace_support import owner

pytestmark = pytest.mark.db


def annotate(api: ApiAs, s: Study, **changes: Any) -> Any:
    body: dict[str, Any] = {
        "kind": "annotate",
        "model_name": None,
        "case_ids": [],
        "scope": None,
        "reminder_days": [],
    }
    return create(api, s, **(body | changes))


def set_classes(api: ApiAs, s: Study) -> list[dict[str, Any]]:
    template = api(s.people["owner"]).get("/api/taxonomy-templates").json()[0]
    rows = [
        {"key": item["key"], "name": item["name"], "colour": item["colour"]}
        for item in template["classes"][:3]
    ]
    response = api(s.people["owner"]).put(
        f"/api/projects/{s.project}/classes", json={"classes": rows}
    )
    assert response.status_code == 200, response.text
    return response.json()


def new_slide(database: str, s: Study, label: str) -> uuid.UUID:
    return insert_id(
        database,
        "INSERT INTO slides (tenant_id, project_id, label) "
        f"VALUES ('{s.tenant_id}', '{s.project}', '{label}') RETURNING id",
    )


def test_an_annotate_task_takes_slides_with_no_result_set_or_one(api: ApiAs, database: str) -> None:
    s = study(database)
    classes = set_classes(api, s)
    bare = new_slide(database, s, "bare")
    pinned = [{"slide_id": str(s.slides[0]), "result_set_id": str(s.other_set)}]
    made = annotate(api, s, slide_ids=[str(bare), str(s.slides[0])], result_sets=pinned)
    assert made.status_code == 201, made.text
    task = made.json()
    assert (task["kind"], task["scope"], task["scopes"]) == (
        "annotate",
        {"kind": "whole-slide", "count": None, "score": None},
        [{"kind": "whole-slide", "count": None, "score": None}],
    )
    assert task["classes"] == classes
    assert [(x["slide_id"], x["result_set_id"]) for x in task["slides"]] == [
        (str(bare), None),
        (str(s.slides[0]), str(s.other_set)),
    ]
    ordered = owner(database, f"SELECT count(*) FROM review_order WHERE task_id = '{task['id']}'")
    assert ordered[0][0] == 0
    audited = owner(
        database, f"SELECT action, details FROM audit_events WHERE target_id = '{task['id']}'"
    )
    assert [row[0] for row in audited] == ["task.created"]
    details = json.loads(str(audited[0][1]))
    assert (details["kind"], details["pinned_result_sets"], details["classes"]) == (
        "annotate",
        1,
        len(classes),
    )
    by_model = annotate(api, s, slide_ids=[str(bare), str(s.slides[1])], model_name="HoVer-NeXt")
    assert [x["result_set_id"] for x in by_model.json()["slides"]] == [
        None,
        str(s.sets[s.slides[1]]),
    ]


def test_an_annotate_task_refuses_unready_sets_and_other_scopes(api: ApiAs, database: str) -> None:
    s = study(database)
    unready = [{"slide_id": str(s.slides[1]), "result_set_id": str(s.importing_set)}]
    refused = annotate(api, s, slide_ids=[str(s.slides[1])], result_sets=unready)
    assert (refused.status_code, refused.json()["code"]) == (400, "no-result-set")
    other_slide = [{"slide_id": str(s.slides[1]), "result_set_id": str(s.other_set)}]
    assert annotate(api, s, result_sets=other_slide).json()["code"] == "no-result-set"
    assert annotate(api, s, scope={"kind": "all-regions"}).status_code == 422
    assert create(api, s, scope={"kind": "whole-slide"}).status_code == 422
    assert create(api, s, scope=None).status_code == 422
    task = annotate(api, s).json()
    change = api(s.people["owner"]).patch(
        f"/api/review-tasks/{task['id']}", json={"scope": {"kind": "all-regions"}}
    )
    assert (change.status_code, change.json()["code"]) == (400, "scope-not-for-task-kind")
    review = create(api, s).json()
    change = api(s.people["owner"]).patch(
        f"/api/review-tasks/{review['id']}", json={"scope": {"kind": "whole-slide"}}
    )
    assert change.json()["code"] == "scope-not-for-task-kind"


def test_review_only_endpoints_refuse_an_annotate_task(api: ApiAs, database: str) -> None:
    s = study(database)
    task = annotate(api, s).json()
    slide = s.slides[0]
    base = f"/api/review-tasks/{task['id']}"
    on_slide = f"{base}/slides/{slide}"
    first, boss = api(s.people["first"]), api(s.people["owner"])
    refusals = [
        first.put(f"{on_slide}/decisions/T1", json={"value": "agree"}),
        first.get(f"{on_slide}/decisions"),
        first.get(f"{on_slide}/order"),
        first.get(f"{on_slide}/layer"),
        first.put(f"{on_slide}/edits/T1", json={"deleted": True}),
        boss.get(f"{base}/disagreements"),
        boss.get(f"{base}/evaluation"),
    ]
    assert [(r.status_code, r.json()["code"]) for r in refusals] == [
        (409, "not-a-review-task")
    ] * len(refusals)
    opinion = first.get(f"{on_slide}/opinion")
    assert opinion.status_code == 200, opinion.text


def test_ready_follows_the_slide_alone(api: ApiAs, database: str) -> None:
    s = study(database)
    upload = insert_id(
        database,
        "INSERT INTO uploads (id, tenant_id, project_id, file_name, size_bytes, object_key, "
        "storage_upload_id, part_bytes, part_count, created_by_user_id) "
        f"VALUES (gen_random_uuid(), '{s.tenant_id}', '{s.project}', 'x.svs', 1, "
        f"'k-{uuid.uuid4().hex}', 'u', 5242880, 1, '{s.user('owner')}') RETURNING id",
    )
    waiting = insert_id(
        database,
        "INSERT INTO slides (tenant_id, project_id, label, upload_id, original_key) "
        f"VALUES ('{s.tenant_id}', '{s.project}', 'waiting', '{upload}', 'k') RETURNING id",
    )
    bare = new_slide(database, s, "bare")
    pinned = [{"slide_id": str(s.slides[0]), "result_set_id": str(s.other_set)}]
    task = annotate(
        api,
        s,
        slide_ids=[str(bare), str(s.slides[0]), str(waiting)],
        result_sets=pinned,
        reviewer_ids=[s.user("first")],
    ).json()
    owner(
        database,
        "UPDATE review_assignments SET released_at = now() "
        f"WHERE task_id = '{task['id']}' AND slide_id <> '{bare}' RETURNING slide_id",
    )
    states = api(s.people["owner"]).get(f"/api/review-tasks/{task['id']}/states").json()
    assert [(x["slide_id"], x["state"]) for x in states["slides"]] == [
        (str(bare), "assigned"),
        (str(s.slides[0]), "ready"),
        (str(waiting), "uploaded"),
    ]


def test_old_tasks_are_listed_as_review(api: ApiAs, database: str) -> None:
    s = study(database)
    review = create(api, s).json()
    assert (review["kind"], review["classes"]) == ("review", None)
    annotate(api, s)
    listed = api(s.people["owner"]).get(s.tasks).json()
    assert [(x["code"], x["kind"]) for x in listed] == [("RT-1", "review"), ("RT-2", "annotate")]
    stored = owner(
        database,
        "SELECT t.kind, s.kind FROM review_tasks t JOIN review_task_slides s ON s.task_id = t.id "
        f"WHERE t.id = '{review['id']}' LIMIT 1",
    )
    assert stored == [("review", "review")]


def test_removing_a_class_that_a_persons_own_annotation_uses_is_refused(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    classes = set_classes(api, s)
    owner(
        database,
        "INSERT INTO annotations "
        "(tenant_id, project_id, slide_id, kind, number, geometry, class_id) "
        f"VALUES ('{s.tenant_id}', '{s.project}', '{s.slides[0]}', 'region', 1, "
        "ST_GeomFromText('POLYGON((0 0, 9 0, 9 9, 0 9, 0 0))'), "
        f"'{classes[0]['id']}') RETURNING id",
    )
    url = f"/api/projects/{s.project}/classes"
    kept = [{key: row[key] for key in ("id", "key", "name", "colour")} for row in classes[1:]]
    refused = api(s.people["owner"]).put(url, json={"classes": kept})
    assert (refused.status_code, refused.json()["code"]) == (409, "class-in-use")
    assert len(api(s.people["owner"]).get(url).json()) == len(classes)


def test_removing_a_class_that_task_annotations_use_is_refused(api: ApiAs, database: str) -> None:
    s = study(database)
    classes = set_classes(api, s)
    task = annotate(api, s).json()
    owner(
        database,
        "INSERT INTO annotations "
        "(tenant_id, project_id, slide_id, task_id, kind, number, geometry, class_id) "
        f"VALUES ('{s.tenant_id}', '{s.project}', '{s.slides[0]}', '{task['id']}', 'region', 1, "
        "ST_GeomFromText('POLYGON((0 0, 9 0, 9 9, 0 9, 0 0))'), "
        f"'{classes[0]['id']}') RETURNING id",
    )
    url = f"/api/projects/{s.project}/classes"
    kept = [{key: row[key] for key in ("id", "key", "name", "colour")} for row in classes[1:]]
    refused = api(s.people["owner"]).put(url, json={"classes": kept})
    assert (refused.status_code, refused.json()["code"]) == (409, "class-in-use")
    unused = [{key: row[key] for key in ("id", "key", "name", "colour")} for row in classes[:2]]
    assert api(s.people["owner"]).put(url, json={"classes": unused}).status_code == 200
    snapshot = api(s.people["owner"]).get(f"/api/review-tasks/{task['id']}").json()["classes"]
    assert snapshot == classes
