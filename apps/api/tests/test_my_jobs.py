import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_review_tasks import Study, insert_id, study
from workspace_support import owner

pytestmark = pytest.mark.db


def my_jobs(api: ApiAs, s: Study, who: str) -> list[dict[str, Any]]:
    response = api(s.people[who]).get("/api/me/jobs")
    assert response.status_code == 200, response.text
    return response.json()


def job(database: str, s: Study, kind: str, status: str, ago: str) -> uuid.UUID:
    return insert_id(
        database,
        "INSERT INTO jobs (tenant_id, project_id, kind, status, created_at) "
        f"VALUES ('{s.tenant_id}', '{s.project}', '{kind}', '{status}', "
        f"now() - interval '{ago}') RETURNING id",
    )


def run(database: str, s: Study, who: str, slide: uuid.UUID, ago: str) -> uuid.UUID:
    job_id = job(database, s, "model-run", "done", ago)
    owner(
        database,
        "INSERT INTO model_runs (job_id, tenant_id, project_id, slide_id, batch_id, scope_kind, "
        "detector, detector_version, test_time_views, ordering, started_by_user_id) "
        f"VALUES ('{job_id}', '{s.tenant_id}', '{s.project}', '{slide}', '{uuid.uuid4()}', "
        f"'slide', 'hovernet', 'v2.1', 1, 'raster', '{s.user(who)}')",
    )
    return job_id


def test_my_jobs_lists_the_uploads_and_runs_i_started_newest_first(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    ingest = job(database, s, "ingest", "running", "1 minute")
    upload = insert_id(
        database,
        "INSERT INTO uploads (id, tenant_id, project_id, file_name, size_bytes, object_key, "
        "storage_upload_id, part_bytes, part_count, created_by_user_id, job_id, status, "
        f"closed_at) VALUES (gen_random_uuid(), '{s.tenant_id}', '{s.project}', 'x.svs', 1, "
        f"'k-{uuid.uuid4().hex}', 'u', 5242880, 1, '{s.user('owner')}', '{ingest}', 'completed', "
        "now()) "
        "RETURNING id",
    )
    owner(
        database,
        "INSERT INTO slides (tenant_id, project_id, label, upload_id, original_key) "
        f"VALUES ('{s.tenant_id}', '{s.project}', 'waiting', '{upload}', 'k') RETURNING id",
    )
    owner(
        database,
        "INSERT INTO job_steps (tenant_id, job_id, ordinal, name, units_total) "
        f"VALUES ('{s.tenant_id}', '{ingest}', 0, 'tile', 4) RETURNING job_id",
    )
    owner(
        database,
        "INSERT INTO job_units (tenant_id, job_id, ordinal, unit, worker) "
        f"VALUES ('{s.tenant_id}', '{ingest}', 0, 0, 'w') RETURNING job_id",
    )
    finished = run(database, s, "owner", s.slides[0], "1 hour")

    found = my_jobs(api, s, "owner")

    assert [(entry["id"], entry["kind"], entry["status"]) for entry in found] == [
        (str(ingest), "upload", "running"),
        (str(finished), "model-run", "done"),
    ]
    uploading, ran = found
    assert (uploading["title"], uploading["units_done"], uploading["units_total"]) == (
        "x.svs",
        1,
        4,
    )
    assert uploading["percent"] == 25
    assert [(slide["label"], slide["file"]) for slide in uploading["slides"]] == [
        ("waiting", "x.svs")
    ]
    assert uploading["project"]["code"] == "P01"
    assert uploading["started_by_user_id"] == s.user("owner")
    assert (ran["title"], ran["percent"], ran["pause"]) == ("hovernet v2.1", 100, None)
    assert my_jobs(api, s, "second") == []


def test_my_jobs_leaves_out_runs_on_slides_i_may_not_read(api: ApiAs, database: str) -> None:
    s = study(database)
    run(database, s, "first", s.slides[0], "1 minute")
    run(database, s, "outsider", s.slides[0], "1 minute")

    assert my_jobs(api, s, "first") == []
    assert my_jobs(api, s, "outsider") == []
