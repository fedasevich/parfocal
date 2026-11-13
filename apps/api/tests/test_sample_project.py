from typing import Any

import pytest
from db_support import ApiAs
from pydantic import SecretStr
from storage_support import with_store
from test_reviewed_layer import Review, review
from test_tile_access import SECRET, claims_of
from workspace_support import owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.sample_files import SampleFile, facts_key
from parfocal_api.sample_project import SAMPLE_SLIDES
from parfocal_common.ingest import sample_folder, sample_original_key
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


def test_a_workspace_gets_one_sample_with_four_slides_two_sets_and_a_task(
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
    assert [row[0] for row in labels] == ["normal_001", "tumor_001", "tumor_002", "tumor_003"]
    sets = api(person).get(f"/api/projects/{project}/result-sets").json()
    assert len(sets) == 8
    assert {(item["name"], item["status"], item["region_count"]) for item in sets} == {
        ("CAMELYON tumor model", "ready", 3),
        ("PathoSAM + HoVer-NeXt", "ready", 3),
    }
    task = sample_task(api, person, project)
    assignments = owner(
        database,
        f"SELECT user_id FROM review_assignments WHERE task_id = '{task['id']}'",
    )
    assert {row[0] for row in assignments} == {person.user_id}
    assert len(assignments) == 4
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
    assert kept[0][0] == 4
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
    for object_id in ("T1", "T2"):
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


def stored_sample(label: str) -> SampleFile:
    facts = SampleFile(
        original_key=sample_original_key(label, f"{label}.tif"),
        file_bytes=SAMPLE_BYTES,
        sha256="0" * 64,
        format="generic-tiff",
        variant=None,
        reader="tifffile",
        width=2048,
        height=1536,
        level_count=3,
        mpp_x=0.243,
        mpp_y=0.243,
        objective_power=40.0,
        notices=[],
    )
    folder = sample_folder(label)

    async def put(store: ObjectStore) -> None:
        await store.put_object(
            f"{folder}restricted-ranges.json", b'{"ranges": []}', "application/json"
        )
        await store.put_object(
            facts_key(label), facts.model_dump_json().encode(), "application/json"
        )

    with_store(put)
    return facts


def test_a_seeded_sample_slide_points_at_the_shared_file_and_gets_a_tile_token(
    api: ApiAs, database: str, storage: StorageLocation
) -> None:
    assert storage.bucket
    stored = {label: stored_sample(label) for label in SAMPLE_SLIDES}
    api.app.settings = api.app.settings.model_copy(update={"tile_token_key": SecretStr(SECRET)})
    r = review(api, database)
    person = r.people["owner"]
    project = create_sample(api, person)["id"]
    rows = owner(
        database,
        "SELECT id, label, original_key, file_bytes, sha256, format, width, published_at "
        f"FROM slides WHERE project_id = '{project}'",
    )
    assert {row[1]: (row[2], row[3], row[4], row[5], row[6]) for row in rows} == {
        label: (facts.original_key, SAMPLE_BYTES, facts.sha256, "generic-tiff", 2048)
        for label, facts in stored.items()
    }
    assert all(row[7] is not None for row in rows)
    slide = next(row[0] for row in rows if row[1] == "tumor_001")
    access = api(person).get(f"/api/slides/{slide}/tile-access")
    assert access.status_code == 200, access.text
    body = access.json()
    assert (body["base_path"], body["original"], body["format"]) == (
        f"/tiles/{slide}/",
        "original.tif",
        "generic-tiff",
    )
    claims = claims_of(body["token"])
    assert (claims["s"], claims["p"], claims["o"], claims["n"], claims["d"]) == (
        str(slide),
        "samples/camelyon16/tumor_001/",
        "original.tif",
        SAMPLE_BYTES,
        [],
    )
