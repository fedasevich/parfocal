import json
from typing import Any

import pytest
from db_support import ApiAs
from pydantic import SecretStr
from storage_support import with_store
from test_reviewed_layer import Review, review
from test_tile_access import SECRET, claims_of
from workspace_support import owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.sample_files import SampleFile
from parfocal_api.sample_project import (
    SAMPLE_CELL_SET,
    SAMPLE_CELLS_CHECKED,
    SAMPLE_MODEL,
    SAMPLE_RESULTS,
    sample_outline,
    sample_results,
)
from parfocal_api.showcase import FORMAT_GALLERY, VIEWER_SAMPLE, fixture_facts, viewer_sample_facts
from parfocal_api.showcase_results import (
    CELLS_MODEL,
    REGIONS_MODEL,
    SAMPLE_CELL_COUNT,
    SAMPLE_CELL_SLIDE,
    SAMPLE_RUN_SLIDE,
    folder_of,
    model_regions,
    sample_bundle,
)
from parfocal_common.ingest import SAMPLE_FACTS_NAME, fixture_folder, fixture_original_key
from parfocal_common.object_store import ObjectStore, StorageLocation

pytestmark = pytest.mark.db


def create_sample(api: ApiAs, who: MemberPrincipal, status: int = 201) -> dict[str, Any]:
    response = api(who).post("/api/projects/sample")
    assert response.status_code == status, response.text
    return response.json()


def sample_task(api: ApiAs, who: MemberPrincipal, project: str) -> dict[str, Any]:
    response = api(who).get(f"/api/projects/{project}/review-tasks")
    assert response.status_code == 200, response.text
    (task,) = response.json()
    return task


def week(api: ApiAs, who: MemberPrincipal) -> tuple[int, int]:
    response = api(who).get("/api/me/home")
    assert response.status_code == 200, response.text
    found = response.json()["week"]
    return found["objects_checked"], found["agreed"]


SAMPLE_LABELS = [slide.label for slide in sample_results().slides]
TOUR = [slide.label for slide in sample_results().slides if slide.reviewed]
WITH_RESULTS = [label for label in SAMPLE_LABELS if label != SAMPLE_RUN_SLIDE]


def points_of(wkt: str) -> tuple[tuple[float, float], ...]:
    inner = wkt.removeprefix("POLYGON((").removesuffix("))")
    return tuple((float(x), float(y)) for x, y in (point.split() for point in inner.split(",")))


def test_a_workspace_gets_one_sample_with_a_real_set_on_each_slide_and_a_task(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    person = r.people["owner"]
    sample = create_sample(api, person)
    assert (sample["name"], sample["sample"], sample["my_role"]) == (
        "Sample · sentinel nodes",
        True,
        "owner",
    )
    project = sample["id"]
    labels = owner(
        database,
        f"SELECT label FROM slides WHERE project_id = '{project}' ORDER BY label",
    )
    assert sorted(str(row[0]) for row in labels) == sorted(SAMPLE_LABELS)
    sets = api(person).get(f"/api/projects/{project}/result-sets").json()
    assert len(sets) == sample_outline().result_sets == len(WITH_RESULTS) + 1
    assert {(item["name"], item["status"]) for item in sets} == {
        (SAMPLE_MODEL, "ready"),
        (SAMPLE_CELL_SET, "ready"),
    }
    assert all(item["region_count"] > 0 for item in sets if item["name"] == SAMPLE_MODEL)
    task = sample_task(api, person, project)
    assignments = owner(
        database,
        f"SELECT user_id FROM review_assignments WHERE task_id = '{task['id']}'",
    )
    assert {row[0] for row in assignments} == {person.user_id}
    assert len(assignments) == len(TOUR)
    again = create_sample(api, person, status=200)
    assert again["id"] == project
    assert api(r.people["first"]).post("/api/projects/sample").status_code == 403


def test_the_sample_deletes_like_any_project_and_a_fresh_one_follows(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    person = r.people["owner"]
    sample = create_sample(api, person)
    project = sample["id"]
    gone = api(person).request("DELETE", f"/api/projects/{project}", json={"name": sample["name"]})
    assert gone.status_code == 204
    assert api(person).get(f"/api/projects/{project}").status_code == 404
    listed = [item["id"] for item in api(person).get("/api/projects").json()]
    assert project not in listed
    home = api(person).get("/api/me/home").json()
    assert project not in [item["id"] for item in home["projects"]]
    kept = owner(database, f"SELECT count(*) FROM slides WHERE project_id = '{project}'")
    assert kept[0][0] == len(SAMPLE_LABELS)
    fresh = create_sample(api, person)
    assert fresh["id"] != project


def test_the_sample_is_left_out_of_every_evaluation(api: ApiAs, database: str) -> None:
    r: Review = review(api, database)
    person = r.people["owner"]
    project = create_sample(api, person)["id"]
    task = sample_task(api, person, project)
    slide = owner(
        database,
        f"SELECT slide_id FROM review_task_slides WHERE task_id = '{task['id']}' "
        "ORDER BY position LIMIT 1",
    )[0][0]
    for object_id in ("T1",):
        given = api(person).put(
            f"/api/review-tasks/{task['id']}/slides/{slide}/decisions/{object_id}",
            json={"answer": "5"},
        )
        assert given.status_code == 200, given.text
    assert week(api, person) == (0, 0)
    evaluation = api(person).get(f"/api/review-tasks/{task['id']}/evaluation")
    assert evaluation.status_code == 200, evaluation.text
    assert evaluation.json()["sample"] is True
    real = api(r.people["first"]).put(f"{r.base}/decisions/T1", json={"value": "agree"})
    assert real.status_code == 200, real.text
    assert week(api, r.people["first"]) == (1, 1)
    assert api(person).get(f"/api/review-tasks/{r.task}/evaluation").json()["sample"] is False


SAMPLE_BYTES = 70_000
OPENED = "CMU-1-Small-Region.svs"


def stored_fixture(label: str) -> SampleFile:
    facts = SampleFile(
        original_key=fixture_original_key(label),
        file_bytes=SAMPLE_BYTES,
        sha256="0" * 64,
        format="aperio-svs",
        variant="jpeg",
        reader="openslide",
        width=2220,
        height=2967,
        level_count=1,
        mpp_x=0.499,
        mpp_y=0.499,
        objective_power=20.0,
        notices=[],
    )
    folder = fixture_folder(label)

    async def put(store: ObjectStore) -> None:
        await store.put_object(
            f"{folder}restricted-ranges.json",
            b'{"ranges": [], "identifying": [], "barcode": []}',
            "application/json",
        )
        await store.put_object(
            f"{folder}{SAMPLE_FACTS_NAME}", facts.model_dump_json().encode(), "application/json"
        )

    with_store(put)
    return facts


def test_a_seeded_sample_slide_points_at_the_shared_file_and_gets_a_tile_token(
    api: ApiAs, database: str, storage: StorageLocation
) -> None:
    assert storage.bucket
    bundled = {slide.label: slide.facts for slide in sample_results().slides if slide.facts}
    stored = {label: stored_fixture(label) for label in SAMPLE_LABELS if label not in bundled}
    api.app.settings = api.app.settings.model_copy(update={"tile_token_key": SecretStr(SECRET)})
    r = review(api, database)
    person = r.people["owner"]
    project = create_sample(api, person)["id"]
    rows = owner(
        database,
        "SELECT id, label, original_key, file_bytes, sha256, published_at "
        f"FROM slides WHERE project_id = '{project}'",
    )
    assert {row[1]: (row[2], row[3], row[4]) for row in rows} == {
        label: (facts.original_key, facts.file_bytes, facts.sha256)
        for label, facts in {**stored, **bundled}.items()
    }
    assert all(row[5] is not None for row in rows)
    slide = next(row[0] for row in rows if row[1] == OPENED)
    access = api(person).get(f"/api/slides/{slide}/tile-access")
    assert access.status_code == 200, access.text
    body = access.json()
    assert (body["base_path"], body["original"], body["format"]) == (
        f"/tiles/{slide}/",
        "original.svs",
        "aperio-svs",
    )
    claims = claims_of(body["token"])
    assert (claims["s"], claims["p"], claims["o"], claims["n"], claims["d"]) == (
        str(slide),
        fixture_folder(OPENED),
        "original.svs",
        SAMPLE_BYTES,
        [],
    )


def test_every_sample_region_comes_from_a_model_run(api: ApiAs, database: str) -> None:
    person = review(api, database).people["owner"]
    project = create_sample(api, person)["id"]
    made = owner(
        database,
        "SELECT s.label, r.model_version, ST_AsText(o.geometry) FROM result_objects o "
        "JOIN result_sets r ON r.id = o.result_set_id JOIN slides s ON s.id = r.slide_id "
        f"WHERE r.project_id = '{project}'",
    )
    assert {str(row[1]) for row in made} == {REGIONS_MODEL}
    found: dict[str, set[tuple[tuple[float, float], ...]]] = {}
    for label, _, wkt in made:
        found.setdefault(str(label), set()).add(points_of(str(wkt)))
    for label in WITH_RESULTS:
        real = model_regions(label)
        assert real is not None, folder_of(label)
        assert found[label] == {points_of(row.wkt) for row in real.rows}


def test_the_bundled_sample_results_match_the_model_run_files() -> None:
    labels = [VIEWER_SAMPLE, *(slide.file for slide in FORMAT_GALLERY)]
    facts = {
        key: value
        for key, value in viewer_sample_facts(fixture_facts()).items()
        if key != "published_at"
    }
    expected = sample_bundle(labels, {VIEWER_SAMPLE: SampleFile.model_validate(facts)})
    assert json.loads(SAMPLE_RESULTS.read_text()) == expected


def test_the_sample_review_is_a_short_tour_with_cells_and_a_slide_left_to_run(
    api: ApiAs, database: str
) -> None:
    person = review(api, database).people["owner"]
    outline = api(person).get("/api/sample-project")
    assert outline.status_code == 200, outline.text
    assert outline.json() == {
        "slides": len(SAMPLE_LABELS),
        "review_slides": len(TOUR),
        "cell_review_slides": 1,
        "result_sets": len(WITH_RESULTS) + 1,
        "cells": SAMPLE_CELL_COUNT,
        "run_slide": SAMPLE_RUN_SLIDE,
    }
    project = create_sample(api, person)["id"]
    task = sample_task(api, person, project)
    rows = owner(
        database,
        "SELECT s.label, s.id FROM review_task_slides t JOIN slides s ON s.id = t.slide_id "
        f"WHERE t.task_id = '{task['id']}' ORDER BY t.position",
    )
    assert [str(row[0]) for row in rows] == TOUR
    assert 1 < len(TOUR) <= 4
    in_project = owner(database, f"SELECT label FROM slides WHERE project_id = '{project}'")
    assert set(TOUR) < {str(row[0]) for row in in_project} == set(SAMPLE_LABELS)
    sets = owner(
        database,
        "SELECT s.label, r.name, r.model_version FROM result_sets r "
        f"JOIN slides s ON s.id = r.slide_id WHERE r.project_id = '{project}'",
    )
    assert SAMPLE_RUN_SLIDE not in {str(row[0]) for row in sets}
    assert (SAMPLE_CELL_SLIDE, SAMPLE_CELL_SET, CELLS_MODEL) in {
        (str(label), str(name), str(model)) for label, name, model in sets
    }
    runs = f"SELECT count(*) FROM model_runs WHERE project_id = '{project}'"
    assert owner(database, runs)[0][0] == 0
    cell_slide = next(row[1] for row in rows if row[0] == SAMPLE_CELL_SLIDE)
    counter = owner(
        database,
        f"SELECT last FROM slide_counters WHERE slide_id = '{cell_slide}' AND letter = 'C'",
    )
    assert [row[0] for row in counter] == [SAMPLE_CELL_COUNT]
    base = f"/api/review-tasks/{task['id']}/slides"
    listed = api(person).get(f"{base}/{cell_slide}/objects")
    assert listed.status_code == 200, listed.text
    objects = listed.json()["objects"]
    assert len(objects) == SAMPLE_CELLS_CHECKED
    assert {item["kind"] for item in objects} == {"cell"}
    assert len({item["class_name"] for item in objects}) > 1
    decided = api(person).put(
        f"{base}/{cell_slide}/decisions/{objects[0]['object']}", json={"answer": "5"}
    )
    assert decided.status_code == 200, decided.text
    regions = api(person).get(f"{base}/{rows[0][1]}/objects").json()["objects"]
    assert regions
    assert {item["kind"] for item in regions} == {"region"}
