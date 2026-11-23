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
    assert (ran["title"], ran["percent"], ran["pause"]) == ("HoVer-Net v2.1", 100, None)
    assert my_jobs(api, s, "second") == []


def steps(database: str, s: Study, job_id: uuid.UUID, counts: list[tuple[str, int, int]]) -> None:
    for ordinal, (name, total, done) in enumerate(counts):
        owner(
            database,
            "INSERT INTO job_steps (tenant_id, job_id, ordinal, name, units_total) "
            f"VALUES ('{s.tenant_id}', '{job_id}', {ordinal}, '{name}', {total}) RETURNING job_id",
        )
        for unit in range(done):
            owner(
                database,
                "INSERT INTO job_units (tenant_id, job_id, ordinal, unit, worker) "
                f"VALUES ('{s.tenant_id}', '{job_id}', {ordinal}, {unit}, 'w') RETURNING job_id",
            )


def test_a_whole_slide_run_counts_its_tiles_and_names_them(api: ApiAs, database: str) -> None:
    s = study(database)
    ran = run(database, s, "owner", s.slides[0], "1 minute")
    owner(database, f"UPDATE jobs SET status = 'running' WHERE id = '{ran}'")
    steps(
        database,
        s,
        ran,
        [("tiles-read", 1, 1), ("tissue-found", 1, 1), ("model-running", 11, 4)],
    )
    [found] = my_jobs(api, s, "owner")
    assert (found["units_done"], found["units_total"], found["unit"]) == (4, 11, "tile")
    assert found["percent"] == 36


def import_job(database: str, s: Study, result_set: uuid.UUID | None) -> uuid.UUID:
    job_id = job(database, s, "result-import", "running", "1 minute")
    linked = "NULL" if result_set is None else f"'{result_set}'"
    owner(
        database,
        "INSERT INTO uploads (id, tenant_id, project_id, kind, slide_id, result_set_id, file_name, "
        "size_bytes, object_key, storage_upload_id, part_bytes, part_count, created_by_user_id, "
        "job_id, status, closed_at) VALUES (gen_random_uuid(), "
        f"'{s.tenant_id}', '{s.project}', 'result', '{s.slides[0]}', {linked}, 'cells.geojson', 1, "
        f"'k-{uuid.uuid4().hex}', 'u', 5242880, 1, '{s.user('owner')}', '{job_id}', 'completed', "
        "now()) RETURNING id",
    )
    return job_id


def test_an_import_reads_done_once_its_result_set_is_ready(api: ApiAs, database: str) -> None:
    s = study(database)
    working = import_job(database, s, None)
    ready = import_job(database, s, s.sets[s.slides[0]])
    found = {entry["id"]: entry for entry in my_jobs(api, s, "owner")}
    assert (found[str(working)]["status"], found[str(working)]["finished_at"]) == (
        "running",
        None,
    )
    assert (found[str(ready)]["status"], found[str(ready)]["percent"]) == ("done", 100)
    assert found[str(ready)]["finished_at"] is not None
    assert {entry["unit"] for entry in found.values()} == {None}


def test_my_jobs_leaves_out_runs_on_slides_i_may_not_read(api: ApiAs, database: str) -> None:
    s = study(database)
    run(database, s, "first", s.slides[0], "1 minute")
    run(database, s, "outsider", s.slides[0], "1 minute")

    assert my_jobs(api, s, "first") == []
    assert my_jobs(api, s, "outsider") == []


def test_a_failed_job_names_its_reason_and_a_running_one_does_not(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    failed = run(database, s, "owner", s.slides[0], "2 minutes")
    owner(
        database,
        f"UPDATE jobs SET status = 'failed', error_code = 'model-not-served' WHERE id = '{failed}'",
    )
    running = run(database, s, "owner", s.slides[0], "1 minute")
    owner(
        database,
        f"UPDATE jobs SET status = 'running', error_code = 'stale' WHERE id = '{running}'",
    )
    found = {entry["id"]: entry["error_code"] for entry in my_jobs(api, s, "owner")}
    assert found == {str(failed): "model-not-served", str(running): None}
