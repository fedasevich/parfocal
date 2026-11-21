import asyncio
import hashlib
import io
import json
import uuid
import zipfile
from typing import Any

import httpx2
import pytest
from db_support import ApiAs
from storage_support import TEST_STORAGE
from test_training_exports import exported, ok, worked_slide
from workspace_support import owner as as_owner

from parfocal_api.dataset_versions import dataset_version_key
from parfocal_api.training_exports import Manifest
from parfocal_common.object_store import ObjectStore, StorageError

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def counts(api: ApiAs, person: Any, task: str, **params: Any) -> dict[str, Any]:
    return ok(api(person).get(f"/api/review-tasks/{task}/dataset", params=params))


def frozen(response: Any) -> tuple[dict[str, Any], dict[str, bytes]]:
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    return json.loads(files.pop("manifest.json")), files


def test_the_dataset_counts_follow_origin_class_slide_and_unchecked_filters(
    api: ApiAs, database: str
) -> None:
    o, task, _, class_id = worked_slide(api, database)
    owner = o.people["owner"]
    plain = counts(api, owner, task)
    assert plain["signed_off_slides"] == 1
    assert plain["objects"] == {"human": 1, "ai-confirmed": 1, "ai-edited": 1, "ai-unchecked": 0}
    assert plain["classes"] == {str(class_id): 3}
    assert (plain["unchecked_left_out"], plain["filtered_out"]) == (1, 0)
    assert plain["filters"] == {
        "origins": ["human", "ai-confirmed", "ai-edited"],
        "class_ids": None,
        "slide_ids": None,
        "include_unchecked": False,
    }
    (slide,) = plain["slides"]
    assert slide["slide_id"] == str(o.slides[1])
    assert slide["label"]

    edited = counts(api, owner, task, origin="ai-edited")
    assert edited["objects"] == {"human": 0, "ai-confirmed": 0, "ai-edited": 1, "ai-unchecked": 0}
    assert edited["filtered_out"] == 2

    wider = counts(api, owner, task, include_unchecked="true")
    assert wider["objects"]["ai-unchecked"] == 1
    assert wider["unchecked_left_out"] == 0

    other_class = counts(api, owner, task, class_id=str(uuid.uuid4()))
    assert sum(other_class["objects"].values()) == 0
    assert other_class["filtered_out"] == 3

    no_slide = counts(api, owner, task, slide_id=str(o.slides[0]))
    assert no_slide["slides"] == []
    assert sum(no_slide["objects"].values()) == 0


def test_a_frozen_version_downloads_byte_for_byte_and_matches_its_counts(
    api: ApiAs, database: str
) -> None:
    o, task, _, _ = worked_slide(api, database)
    owner = api(o.people["owner"])
    first = ok(
        owner.post(
            f"/api/review-tasks/{task}/dataset-versions",
            json={"note": " Agreed only for round 1 ", "filters": {"origins": ["ai-confirmed"]}},
        ),
        201,
    )
    assert first["number"] == 1
    assert first["note"] == "Agreed only for round 1"
    assert first["filters"]["origins"] == ["ai-confirmed"]
    assert first["created_by"]
    assert first["counts"]["objects"]["ai-confirmed"] == 1
    assert sum(first["counts"]["objects"].values()) == 1
    second = ok(owner.post(f"/api/review-tasks/{task}/dataset-versions", json={}), 201)
    assert second["number"] == 2

    listed = ok(owner.get(f"/api/review-tasks/{task}/dataset-versions"))
    assert [item["number"] for item in listed] == [2, 1]

    url = f"/api/review-tasks/{task}/dataset-versions/1"
    once = owner.get(url)
    again = owner.get(url)
    assert once.status_code == 200, once.text
    assert once.headers["content-type"] == "application/zip"
    assert once.content == again.content
    assert hashlib.sha256(once.content).hexdigest() == first["sha256"]
    assert once.headers["x-checksum-sha256"] == first["sha256"]
    assert len(once.content) == first["bytes"]
    manifest, files = frozen(once)
    Manifest.model_validate(manifest)
    assert manifest["dataset_version"] == 1
    assert manifest["filters"] == first["filters"]
    (entry,) = manifest["slides"]
    assert entry["objects"] == first["counts"]["slides"][0]["objects"]
    assert entry["classes"] == first["counts"]["slides"][0]["classes"]
    content = files[entry["file"]["path"]]
    assert hashlib.sha256(content).hexdigest() == entry["file"]["sha256"]
    origins = {f["properties"]["parfocal"]["origin"] for f in json.loads(content)["features"]}
    assert origins == {"ai-confirmed"}

    live, _ = exported(api, o, task)
    assert live["slides"][0]["objects"] == second["counts"]["slides"][0]["objects"]
    assert owner.get(f"/api/review-tasks/{task}/dataset-versions/9").status_code == 404


def test_a_version_is_written_once_and_the_table_takes_no_change(api: ApiAs, database: str) -> None:
    o, task, _, _ = worked_slide(api, database)
    version = ok(
        api(o.people["owner"]).post(f"/api/review-tasks/{task}/dataset-versions", json={}), 201
    )
    key = dataset_version_key(o.tenant, uuid.UUID(task), uuid.UUID(version["id"]))

    async def overwrite() -> None:
        async with httpx2.AsyncClient() as http:
            await ObjectStore(TEST_STORAGE, http).put_new_object(key, b"other", "application/zip")

    with pytest.raises(StorageError) as refused:
        asyncio.run(overwrite())
    assert refused.value.status == 412
    grants = as_owner(
        database,
        "SELECT privilege_type FROM information_schema.role_table_grants "
        "WHERE table_name = 'dataset_versions' AND grantee = 'parfocal_app' "
        "ORDER BY privilege_type",
    )
    assert [row[0] for row in grants] == ["INSERT", "SELECT"]


def test_patches_are_cut_from_a_frozen_version(api: ApiAs, database: str) -> None:
    o, task, _, _ = worked_slide(api, database)
    owner = api(o.people["owner"])
    version = ok(owner.post(f"/api/review-tasks/{task}/dataset-versions", json={}), 201)
    started = ok(
        owner.post(f"/api/review-tasks/{task}/patch-exports", json={"dataset_version": 1}), 202
    )
    (row,) = as_owner(database, f"SELECT input FROM jobs WHERE id = '{started['job_id']}'")
    job_input = row[0] if isinstance(row[0], dict) else json.loads(row[0])
    assert job_input["dataset_version"] == 1
    assert job_input["dataset_sha256"] == version["sha256"]
    assert job_input["dataset_key"].startswith(f"t/{o.tenant}/datasets/{task}/")
    missing = owner.post(f"/api/review-tasks/{task}/patch-exports", json={"dataset_version": 7})
    assert missing.status_code == 404


def test_a_version_with_nothing_chosen_is_refused(api: ApiAs, database: str) -> None:
    o, task, _, _ = worked_slide(api, database)
    response = api(o.people["owner"]).post(
        f"/api/review-tasks/{task}/dataset-versions",
        json={"filters": {"slide_ids": [str(o.slides[0])]}},
    )
    assert (response.status_code, response.json()["code"]) == (409, "nothing-chosen")
