import subprocess
import time
from pathlib import Path

import pytest
from db_support import ApiAs
from test_export_main_paths import LEVEL, TILE, ok, signed_off_task
from test_large_result_imports import remove_tenant_objects, worker
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

WAIT_SECONDS = 120
POLL_SECONDS = 0.1


def test_a_patch_export_whose_cut_fails_ends_failed_with_its_reason(
    api: ApiAs, database: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant, who, task, _ = signed_off_task(api, database, 10)
    exports = f"/api/review-tasks/{task}/patch-exports"
    job = ok(
        api(who).post(exports, json={"level": LEVEL, "tile_size": TILE, "format": "coco"}), 202
    )["job_id"]
    monkeypatch.setenv("INGEST_PARSE_SECONDS", "0.001")
    process = worker(database, tenant, "export", tmp_path / "work", None, idle_exit=30)
    try:
        started = time.monotonic()
        state = "cutting"
        while state == "cutting" and time.monotonic() - started < WAIT_SECONDS:
            time.sleep(POLL_SECONDS)
            state = ok(api(who).get(f"{exports}/{job}/status"))["state"]
    finally:
        process.terminate()
        try:
            process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            process.kill()
    assert state == "failed"
    rows = owner(database, f"SELECT status, error_code FROM jobs WHERE id = '{job}'")
    assert [(str(rows[0][0]), rows[0][1])] == [("failed", "parse-too-slow")]
    download = api(who).get(f"{exports}/{job}")
    assert download.status_code == 409
    assert download.json()["code"] == "patch-export-failed"
    remove_tenant_objects(tenant)
