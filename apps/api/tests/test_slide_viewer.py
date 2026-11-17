import uuid
from typing import Any

import pytest
from db_support import ApiAs
from submit_support import submitted as finished_submit
from test_model_runs import make_lab, one_run
from test_reviewed_layer import Review, review
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def tenant_of(database: str, r: Review) -> Any:
    return owner(database, f"SELECT tenant_id FROM slides WHERE id = '{r.slide}'")[0][0]


def other_set(
    database: str, r: Review, name: str, version: str | None, region: str, cells: int = 0
) -> str:
    tenant = tenant_of(database, r)
    made = owner(
        database,
        "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, model_version, source) "
        f"VALUES ('{tenant}', '{r.project}', '{r.slide}', '{name}', "
        f"{'NULL' if version is None else repr(version)}, 'import') RETURNING id",
    )[0][0]
    owner(
        database,
        "INSERT INTO result_objects (tenant_id, result_set_id, kind, number, geometry, score) "
        f"VALUES ('{tenant}', '{made}', 'region', 1, ST_GeomFromText('{region}', 0), 30)",
    )
    owner(
        database,
        f"UPDATE result_sets SET status = 'ready', region_count = 1, cell_count = {cells} "
        f"WHERE id = '{made}'",
    )
    return str(made)


def decide(api: ApiAs, r: Review, who: str, object_id: str, value: str) -> None:
    body: dict[str, Any] = {"value": value}
    if value == "disagree":
        body["reasons"] = ["artefact"]
    answer = api(r.people[who]).put(f"{r.base}/decisions/{object_id}", json=body)
    assert answer.status_code == 200, answer.text


def test_result_stats_compare_the_ai_the_reviewers_and_another_set(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    url = f"{r.base}/result-stats"
    empty = api(r.people["owner"]).get(url)
    assert empty.status_code == 200, empty.text
    assert empty.json()["object_count"] == 7
    assert empty.json()["score_bins"] == [0, 0, 0, 0, 0, 0, 0, 2, 0, 0]
    assert empty.json()["ai_vs_reviewed"] == {
        "dice": None,
        "cells_agree_percent": None,
        "objects": [],
    }
    assert empty.json()["model_vs_model"]["set_b_id"] is None
    decide(api, r, "first", "T1", "agree")
    decide(api, r, "second", "T1", "agree")
    decide(api, r, "first", "T2", "agree")
    decide(api, r, "second", "T2", "disagree")
    for who in ("first", "second"):
        assert finished_submit(api(r.people[who]), r.base).status_code == 200
    set_b = other_set(database, r, "CAMELYON", None, "POLYGON((150 0,200 0,200 50,150 50,150 0))")
    stats = api(r.people["owner"]).get(url).json()
    assert stats["ai_vs_reviewed"]["objects"] == [{"object": "T1", "agreement": "both"}]
    assert stats["ai_vs_reviewed"]["dice"] == pytest.approx(2 / 3, abs=0.001)
    assert stats["model_vs_model"]["set_a_id"] == str(r.result_set)
    assert stats["model_vs_model"]["set_b_id"] == set_b
    assert stats["model_vs_model"]["only_in_a"] == ["T1"]
    assert stats["model_vs_model"]["dice"] == pytest.approx(0.4, abs=0.001)
    reviewers = stats["reviewers"]
    assert sorted(reviewers["user_ids"]) == sorted(
        str(r.people[who].user_id) for who in ("first", "second")
    )
    assert reviewers["objects"] == [
        {"object": "T1", "agreement": "same"},
        {"object": "T2", "agreement": "split"},
    ]
    assert reviewers["kappa"] == pytest.approx(0.0)
    assert api(r.people["third"]).get(url).status_code == 404


def test_hidden_ai_leaves_the_result_stats_empty(api: ApiAs, database: str) -> None:
    r = review(api, database)
    owner(database, f"UPDATE review_tasks SET ai_hidden_first_read = true WHERE id = '{r.task}'")
    hidden = api(r.people["first"]).get(f"{r.base}/result-stats").json()
    assert hidden["object_count"] == 0
    assert hidden["model_vs_model"]["set_a_id"] is None
    assert api(r.people["owner"]).get(f"{r.base}/result-stats").json()["object_count"] == 7


def test_slide_threads_gather_the_task_and_slide_threads_with_their_comments(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    started = api(r.people["first"]).post(
        f"{r.base}/threads",
        json={
            "title": "Is this tumour?",
            "body": "Please look at the margin.",
            "anchor": {"kind": "object", "object_id": "T1"},
        },
    )
    assert started.status_code == 201, started.text
    thread = started.json()["id"]
    reply = api(r.people["owner"]).post(
        f"{r.base}/threads/{thread}/messages", json={"body": "Looks benign."}
    )
    assert reply.status_code == 201, reply.text
    on_slide = api(r.people["owner"]).post(
        f"/api/projects/{r.project}/slides/{r.slide}/threads",
        json={
            "title": "Stain check",
            "body": "The stain looks faint.",
            "anchor": {"kind": "point", "geometry": {"type": "Point", "coordinates": [5, 5]}},
        },
    )
    assert on_slide.status_code == 201, on_slide.text
    listed = api(r.people["owner"]).get(f"/api/slides/{r.slide}/threads")
    assert listed.status_code == 200, listed.text
    assert [
        (item["anchor"], item["task_id"], item["replies"], item["resolved"])
        for item in listed.json()
    ] == [("T1", str(r.task), 1, False), ("point", None, 0, False)]
    comments = api(r.people["owner"]).get(f"/api/threads/{thread}/comments")
    assert comments.status_code == 200, comments.text
    assert [
        (item["author_id"], item["author_is_researcher"], item["text"]) for item in comments.json()
    ] == [
        (str(r.people["first"].user_id), False, "Please look at the margin."),
        (str(r.people["owner"].user_id), True, "Looks benign."),
    ]
    assert api(r.people["third"]).get(f"/api/threads/{thread}/comments").status_code == 404
    assert api(r.people["owner"]).get(f"/api/threads/{uuid.uuid4()}/comments").status_code == 404


def test_a_blinded_reviewer_sees_no_other_reviewer_thread_on_the_slide(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    started = api(r.people["first"]).post(
        f"{r.base}/threads",
        json={
            "title": "Is this tumour?",
            "body": "Please look at the margin.",
            "anchor": {"kind": "object", "object_id": "T1"},
        },
    )
    assert started.status_code == 201, started.text
    thread = started.json()["id"]
    assert [
        item["id"] for item in api(r.people["first"]).get(f"/api/slides/{r.slide}/threads").json()
    ] == [thread]
    assert api(r.people["second"]).get(f"/api/slides/{r.slide}/threads").json() == []
    assert api(r.people["second"]).get(f"/api/threads/{thread}/comments").status_code == 404


def test_annotation_layers_count_the_slide_annotations_by_class(api: ApiAs, database: str) -> None:
    r = review(api, database)
    tenant = tenant_of(database, r)
    for number, kind, class_id in ((1, "region", f"'{r.tumor}'"), (2, "region", "NULL")):
        owner(
            database,
            "INSERT INTO annotations (tenant_id, project_id, slide_id, kind, number, geometry, "
            f"class_id) VALUES ('{tenant}', '{r.project}', '{r.slide}', '{kind}', {number}, "
            f"ST_GeomFromText('POLYGON((0 0, 9 0, 9 9, 0 9, 0 0))'), {class_id})",
        )
    listed = api(r.people["owner"]).get(f"/api/slides/{r.slide}/annotation-layers")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    assert [(layer["key"], layer["count"]) for layer in body["layers"]] == [
        (str(r.tumor), 1),
        ("unclassed", 1),
    ]
    assert body["new_shapes_go_to"] == str(r.tumor)
    assert api(r.people["third"]).get(f"/api/slides/{r.slide}/annotation-layers").status_code == 404


def test_a_result_set_typer_reads_its_recorded_calibration(api: ApiAs, database: str) -> None:
    r = review(api, database)
    plain = api(r.people["owner"]).get(f"/api/result-sets/{r.result_set}/typer")
    assert plain.status_code == 200, plain.text
    assert (plain.json()["name"], plain.json()["calibrated"]) == ("HoVer-NeXt", False)
    assert plain.json()["test_set_accuracy"] is None
    square = "POLYGON((0 0,9 0,9 9,0 9,0 0))"
    typed = other_set(database, r, "pathosam-hovernext", "v1.2", square, cells=3)
    calibrated = api(r.people["owner"]).get(f"/api/result-sets/{typed}/typer").json()
    assert calibrated["calibrated"] is True
    assert calibrated["test_set_accuracy"] == pytest.approx(0.8297)
    assert calibrated["band_accuracy"]["confident"] == pytest.approx(0.95)
    assert "Breast" in calibrated["validated_sites"]
    regions_only = other_set(database, r, "camelyon-tumor", "v1.0", square)
    missing = api(r.people["owner"]).get(f"/api/result-sets/{regions_only}/typer")
    assert (missing.status_code, missing.json()["code"]) == (404, "no-typer")
    assert api(r.people["third"]).get(f"/api/result-sets/{typed}/typer").status_code == 404
    assert api(r.people["owner"]).get(f"/api/result-sets/{uuid.uuid4()}/typer").status_code == 404
    owner(database, f"UPDATE review_tasks SET ai_hidden_first_read = true WHERE id = '{r.task}'")
    assert api(r.people["first"]).get(f"/api/result-sets/{typed}/typer").status_code == 403


def test_a_reviewer_whose_first_read_is_open_sees_no_ai_progress(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database, hidden=True)
    one_run(api, lab)
    url = f"/api/slides/{lab.slides[0]}/ai-progress"
    assert api(lab.people["reader"]).get(url).json()["state"] == "ready"
    assert api(lab.people["owner"]).get(url).json()["state"] == "running"


def test_ai_progress_follows_the_running_model_run(api: ApiAs, database: str) -> None:
    lab = make_lab(api, database)
    url = f"/api/slides/{lab.slides[0]}/ai-progress"
    ready = api(lab.people["owner"]).get(url)
    assert ready.status_code == 200, ready.text
    assert (ready.json()["state"], ready.json()["steps"]) == ("ready", [])
    run = one_run(api, lab)
    queued = api(lab.people["owner"]).get(url).json()
    assert queued["state"] == "running"
    assert [(step["key"], step["state"]) for step in queued["steps"]] == [
        ("tissue", "queued"),
        ("regions", "queued"),
        ("cells", "queued"),
    ]
    owner(
        database,
        "UPDATE job_steps SET status = 'done', started_at = now() - interval '4 seconds', "
        "finished_at = now(), result = '{\"fragments\": 3}' "
        f"WHERE job_id = '{run['id']}' AND name = 'tissue-found'",
    )
    owner(
        database,
        "UPDATE job_steps SET status = 'running', units_total = 4 "
        f"WHERE job_id = '{run['id']}' AND name = 'model-running'",
    )
    owner(
        database,
        "INSERT INTO job_units (tenant_id, job_id, ordinal, unit, worker, result) "
        f"SELECT tenant_id, job_id, ordinal, 0, 'worker-1', '{{}}' FROM job_steps "
        f"WHERE job_id = '{run['id']}' AND name = 'model-running'",
    )
    steps = {step["key"]: step for step in api(lab.people["owner"]).get(url).json()["steps"]}
    assert (steps["tissue"]["state"], steps["tissue"]["seconds"]) == ("done", 4)
    assert steps["tissue"]["fragments"] == 3
    assert (steps["regions"]["state"], steps["regions"]["percent"]) == ("running", 25)
    assert steps["cells"]["state"] == "queued"
    assert api(lab.people["outsider"]).get(url).status_code == 404
