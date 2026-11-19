import uuid
from datetime import UTC, datetime, timedelta

import pytest
from db_support import ApiAs
from test_reviewed_layer import Review, review
from upload_support import start_upload
from workspace_support import join_project, make_project, owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def tenant_of(database: str, r: Review) -> object:
    return owner(database, f"SELECT tenant_id FROM slides WHERE id = '{r.slide}'")[0][0]


def test_the_overview_counts_the_project_from_stored_data(api: ApiAs, database: str) -> None:
    r = review(api, database)
    url = f"/api/projects/{r.project}/overview"
    answer = api(r.people["owner"]).get(url)
    assert answer.status_code == 200, answer.text
    overview = answer.json()
    assert overview["project_id"] == str(r.project)
    assert overview["slides"] == 1
    assert overview["result_sets"] == 1
    assert overview["objects"] == 7
    assert overview["no_results"] == 0
    assert overview["needs_review"] == 1
    assert overview["reviewed_percent"] == 0
    assert [item["slide_id"] for item in overview["slide_files"]] == [str(r.slide)]
    assert overview["storage"]["allowance_gb"] is None
    assert overview["import_failure"] is None
    assert api(r.people["first"]).get(url).status_code == 404


def test_the_overview_names_the_uploaded_file_only_in_a_clinical_project(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    tenant = tenant_of(database, r)
    creator = r.people["owner"].user_id
    upload = owner(
        database,
        "INSERT INTO uploads (id, tenant_id, project_id, file_name, size_bytes, object_key, "
        "storage_upload_id, part_bytes, part_count, created_by_user_id) "
        f"VALUES (gen_random_uuid(), '{tenant}', '{r.project}', 'accession-17.svs', 1, "
        f"'k-{uuid.uuid4().hex}', 'u', 5242880, 1, '{creator}') RETURNING id",
    )[0][0]
    owner(
        database,
        f"UPDATE slides SET upload_id = '{upload}', original_key = COALESCE(original_key, 'k') "
        f"WHERE id = '{r.slide}'",
    )
    label = owner(database, f"SELECT label FROM slides WHERE id = '{r.slide}'")[0][0]
    url = f"/api/projects/{r.project}/overview"

    hidden = api(r.people["owner"]).get(url).json()["slide_files"]
    assert [item["file"] for item in hidden] == [label]

    owner(database, f"UPDATE projects SET privacy_mode = 'clinical' WHERE id = '{r.project}'")
    shown = api(r.people["owner"]).get(url).json()["slide_files"]
    assert [item["file"] for item in shown] == ["accession-17.svs"]


def test_project_slides_show_ready_sets_and_only_assigned_slides_to_a_reviewer(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    url = f"/api/projects/{r.project}/slides"
    mine = api(r.people["owner"]).get(url)
    assert mine.status_code == 200, mine.text
    assert mine.json() == [
        {
            "id": str(r.slide),
            "label": mine.json()[0]["label"],
            "stain": "H&E",
            "case": None,
            "result_set_ids": [str(r.result_set)],
        }
    ]
    seen = api(r.people["first"]).get(url).json()
    assert [(item["id"], item["result_set_ids"]) for item in seen] == [
        (str(r.slide), [str(r.result_set)])
    ]
    owner(database, f"UPDATE review_tasks SET ai_hidden_first_read = true WHERE id = '{r.task}'")
    hidden = api(r.people["first"]).get(url).json()
    assert [(item["id"], item["result_set_ids"]) for item in hidden] == [(str(r.slide), [])]
    assert api(r.people["owner"]).get(url).json()[0]["result_set_ids"] == [str(r.result_set)]
    assert api(r.people["third"]).get(url).json() == []


def test_scope_options_list_rois_and_unsure_zones(api: ApiAs, database: str) -> None:
    r = review(api, database)
    tenant = tenant_of(database, r)
    owner(
        database,
        "INSERT INTO annotations (tenant_id, project_id, slide_id, kind, number, geometry) "
        f"VALUES ('{tenant}', '{r.project}', '{r.slide}', 'roi', 7, "
        "'SRID=0;POLYGON((0 0,10 0,10 10,0 10,0 0))'), "
        f"('{tenant}', '{r.project}', '{r.slide}', 'roi', 8, "
        "'SRID=0;POLYGON((20 20,30 20,30 30,20 30,20 20))')",
    )
    owner(
        database,
        f"UPDATE annotations SET class_id = '{r.tumor}' "
        f"WHERE number = 8 AND slide_id = '{r.slide}'",
    )
    tumor = owner(database, f"SELECT name FROM project_classes WHERE id = '{r.tumor}'")[0][0]
    owner(
        database,
        "DO $$ BEGIN PERFORM set_config('session_replication_role', 'replica', true); "
        "INSERT INTO result_objects (tenant_id, result_set_id, kind, number, geometry) "
        f"VALUES ('{tenant}', '{r.result_set}', 'zone', 1, "
        "ST_GeomFromText('POLYGON((0 0,100 0,100 100,0 100,0 0))', 0)); "
        f"DELETE FROM result_chunks WHERE result_set_id = '{r.result_set}'; "
        "INSERT INTO result_chunks (tenant_id, result_set_id, chunk, x, y, width, height, "
        f"cell_count, vertex_count, object_key) VALUES ('{tenant}', '{r.result_set}', "
        "0, 0, 0, 2048, 2048, 12, 48, 'scope/0'), "
        f"('{tenant}', '{r.result_set}', 1, 9000, 9000, 2048, 2048, 30, 120, 'scope/1'); "
        "END $$",
    )
    answer = api(r.people["owner"]).get(f"/api/projects/{r.project}/scope-options")
    assert answer.status_code == 200, answer.text
    assert answer.json() == {
        "rois": [{"key": "R1", "name": "ROI 7"}, {"key": "R2", "name": tumor}],
        "unsure_zones": [{"key": "Z1", "cells_per_slide": 12}],
    }
    assert api(r.people["first"]).get(f"/api/projects/{r.project}/scope-options").status_code == 403


def test_review_task_defaults_come_from_the_project(api: ApiAs, database: str) -> None:
    r = review(api, database)
    answer = api(r.people["owner"]).get(f"/api/projects/{r.project}/review-tasks/defaults")
    assert answer.status_code == 200, answer.text
    defaults = answer.json()
    today = datetime.now(UTC).date()
    assert defaults["code"] == "RT-2"
    assert defaults["names"] == [{"result_set_id": str(r.result_set), "name": "HoVer-NeXt"}]
    assert defaults["slide_ids"] == [str(r.slide)]
    assert defaults["result_set_id"] == str(r.result_set)
    assert sorted(defaults["reviewer_ids"]) == sorted(
        str(r.people[who].user_id) for who in ("first", "second", "third")
    )
    assert defaults["today"] == today.isoformat()
    assert defaults["due_on"] == (today + timedelta(days=14)).isoformat()
    assert defaults["reminder_days"] == [2, 1]
    assert defaults["study_template_id"] == ""


def test_asking_for_project_access_records_one_request(api: ApiAs, database: str) -> None:
    r = review(api, database)
    tenant = uuid.UUID(str(tenant_of(database, r)))
    closed = make_project(database, tenant, "de-identified")
    join_project(database, closed, r.people["owner"], "owner")
    url = f"/api/projects/{closed}/access-requests"
    first = api(r.people["first"]).post(url)
    assert first.status_code == 200, first.text
    assert first.json()["project_id"] == str(closed)
    assert first.json()["user_id"] == str(r.people["first"].user_id)
    assert first.json()["owner_id"] == str(r.people["owner"].user_id)
    again = api(r.people["first"]).post(url)
    assert again.json()["id"] == first.json()["id"]
    assert api(r.people["second"]).post(url).json()["id"] != first.json()["id"]
    refused = api(r.people["owner"]).post(url)
    assert refused.status_code == 409
    assert refused.json()["code"] == "already-in-project"
    assert (
        api(r.people["first"]).post(f"/api/projects/{uuid.uuid4()}/access-requests").status_code
        == 404
    )


def test_asking_for_project_access_tells_the_owner_once_and_the_owner_adds_the_person(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    tenant = uuid.UUID(str(tenant_of(database, r)))
    closed = make_project(database, tenant, "de-identified")
    join_project(database, closed, r.people["owner"], "owner")
    asker = r.people["first"]
    url = f"/api/projects/{closed}/access-requests"
    assert api(asker).post(url).status_code == 200
    assert api(asker).post(url).status_code == 200

    def asks() -> list[dict[str, object]]:
        inbox = api(r.people["owner"]).get("/api/me/notifications").json()["notifications"]
        return [item for item in inbox if item["kind"] == "project-access-asked"]

    found = asks()
    assert len(found) == 1
    assert found[0]["target_kind"] == "project"
    assert found[0]["target_id"] == str(closed)
    assert found[0]["payload"] == {"user_id": str(asker.user_id)}
    assert found[0]["link"] == f"/projects/{closed}?tab=people&add={asker.user_id}"
    inbox = api(asker).get("/api/me/notifications").json()["notifications"]
    assert [item for item in inbox if item["kind"] == "project-access-asked"] == []
    added = api(r.people["owner"]).put(
        f"/api/projects/{closed}/members/{asker.user_id}", json={"role": "reviewer"}
    )
    assert added.status_code == 200, added.text
    assert api(asker).post(url).status_code == 409


def test_imports_and_the_upload_batch_list_the_callers_uploads(api: ApiAs, database: str) -> None:
    r = review(api, database)
    me = r.people["owner"]
    start_upload(api, me, r.project, "lymph-node-01.svs", 50_000_000)
    imports = api(me).get(f"/api/projects/{r.project}/imports")
    assert imports.status_code == 200, imports.text
    assert imports.json()["watched_folder"]["on"] is False
    assert imports.json()["arrivals"][0]["file"] == "lymph-node-01.svs"
    assert imports.json()["arrivals"][0]["result"] == "open"
    assert imports.json()["last_arrival"]["what"] == "lymph-node-01.svs"
    batch = api(me).get(f"/api/projects/{r.project}/upload-batch")
    assert batch.status_code == 200, batch.text
    slides = batch.json()["slides"]
    assert [(item["name"], item["format"], item["size_gb"]) for item in slides] == [
        ("lymph-node-01.svs", "svs", 0.05)
    ]
    assert slides[0]["progress"]["text"] == "Uploading"
    assert batch.json()["results"] == []
    assert batch.json()["storage"]["needed_gb"] == 0.05
    other = api(r.people["viewer"]).get(f"/api/projects/{r.project}/upload-batch")
    assert other.status_code == 200, other.text
    assert other.json()["slides"] == []
    assert api(r.people["first"]).get(f"/api/projects/{r.project}/imports").status_code == 403
