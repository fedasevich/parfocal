import json
import os
import re
import subprocess
import sys
import time
import uuid
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, api_settings, with_database
from fastapi.testclient import TestClient
from storage_support import TEST_STORAGE, with_store
from test_result_uploads import result_set
from upload_support import Lab, send_file, start_upload, status_of
from workflow_support import SHORT_LEASE_SECONDS
from workspace_support import make_slide, owner

from parfocal_api.app import create_app
from parfocal_common.object_store import ObjectStore
from parfocal_ingest.settings import INGEST_MEMORY_MIB

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

TESTS = Path(__file__).resolve().parent
BENCH_FILE = os.environ.get("PARFOCAL_BENCH_RESULT_FILE")
BENCH_OUT = os.environ.get("PARFOCAL_BENCH_OUT")
GIB = 1024**3
BENCH_PART_BYTES = 64 * 1024 * 1024
SAMPLE_SECONDS = 0.25
GENERATED_CELLS = 120_000
MAX_RSS = re.compile(r"(\d+)\s+maximum resident set size")


def generated_cells(count: int) -> bytes:
    side = int(count**0.5) + 1
    features: list[str] = []
    for index in range(count):
        x, y = (index % side) * 30.0, (index // side) * 30.0
        ring = [[x, y], [x + 9, y + 1], [x + 10, y + 9], [x + 2, y + 10], [x, y]]
        features.append(
            '{"type":"Feature","geometry":{"type":"Polygon","coordinates":['
            + json.dumps(ring, separators=(",", ":"))
            + ']},"properties":{"objectType":"cell","classification":{"name":"type-'
            + str(index % 4)
            + '"},"score":0.75}}'
        )
    return ('{"type":"FeatureCollection","features":[' + ",".join(features) + "]}").encode()


@dataclass(frozen=True)
class WorkerRun:
    claims: int
    claimed_by: list[str]
    status: str
    lowest_lease_seconds: float
    lapsed_samples: int
    samples: int
    step_seconds: float
    worker_seconds: float
    worker_max_rss_bytes: int | None
    step_result: dict[str, Any]


def environment(work_dir: Path) -> dict[str, str]:
    return {
        **os.environ,
        "PYTHONPATH": os.pathsep.join([str(TESTS), os.environ.get("PYTHONPATH", "")]),
        "APP_ENV": "test",
        "PARFOCAL_TEST_INGEST_DIR": str(work_dir),
        "INGEST_WORK_DIR": str(work_dir),
        "STORAGE_ENDPOINT": TEST_STORAGE.endpoint,
        "STORAGE_REGION": TEST_STORAGE.region,
        "STORAGE_BUCKET": TEST_STORAGE.bucket,
        "STORAGE_ACCESS_KEY_ID": TEST_STORAGE.access_key_id,
        "STORAGE_SECRET_ACCESS_KEY": TEST_STORAGE.secret_access_key,
    }


def worker(
    database: str,
    tenant_id: uuid.UUID,
    name: str,
    work_dir: Path,
    workflow: str | None,
    timed: Path | None = None,
) -> subprocess.Popen[bytes]:
    command = [
        sys.executable,
        "-m",
        "parfocal_ingest",
        "--database-url",
        with_database(APP_URL, database),
        "--worker",
        name,
        "--idle-exit",
        "2",
        "--poll",
        "0.1",
        "--workspace",
        str(tenant_id),
        *(["--workflow", workflow] if workflow else []),
    ]
    if timed is not None:
        command = ["/usr/bin/time", "-l", *command]
    return subprocess.Popen(
        command,
        env=environment(work_dir),
        stdout=subprocess.DEVNULL,
        stderr=timed.open("wb") if timed is not None else subprocess.DEVNULL,
    )


def job_state(database: str, tenant_id: uuid.UUID) -> tuple[Any, ...] | None:
    rows = owner(
        database,
        "SELECT id, status, claims, claimed_by, "
        "extract(epoch FROM lease_until - clock_timestamp()) FROM jobs "
        f"WHERE tenant_id = '{tenant_id}' AND kind = 'result-import' "
        "ORDER BY created_at DESC LIMIT 1",
    )
    return rows[0] if rows else None


def watched(
    database: str,
    tenant_id: uuid.UUID,
    work_dir: Path,
    workflow: str | None,
    timed: Path | None,
    timeout: float,
) -> WorkerRun:
    started = time.monotonic()
    first = worker(database, tenant_id, "first", work_dir, workflow, timed)
    second: subprocess.Popen[bytes] | None = None
    names: set[str] = set()
    leases: list[float] = []
    try:
        while time.monotonic() - started < timeout:
            state = job_state(database, tenant_id)
            if state is not None and state[3] is not None:
                names.add(str(state[3]))
                if second is None:
                    second = worker(database, tenant_id, "second", work_dir, workflow)
                if state[1] == "running" and state[4] is not None:
                    leases.append(float(state[4]))
                if state[1] in ("done", "failed"):
                    break
            time.sleep(SAMPLE_SECONDS)
        first.wait(timeout=60)
        if second is not None:
            second.wait(timeout=60)
    finally:
        for process in (first, second):
            if process is not None and process.poll() is None:
                process.kill()
    elapsed = time.monotonic() - started
    final = job_state(database, tenant_id)
    assert final is not None
    step = owner(
        database,
        "SELECT extract(epoch FROM finished_at - started_at), result FROM job_steps "
        f"WHERE job_id = '{final[0]}' AND ordinal = 0",
    )
    rss = MAX_RSS.search(timed.read_text()) if timed is not None else None
    seconds: Any = step[0][0] if step else None
    result: Any = step[0][1] if step else None
    return WorkerRun(
        claims=int(final[2]),
        claimed_by=sorted(names),
        status=str(final[1]),
        lowest_lease_seconds=min(leases, default=float("nan")),
        lapsed_samples=sum(1 for value in leases if value < 0),
        samples=len(leases),
        step_seconds=float(seconds) if seconds is not None else float("nan"),
        worker_seconds=elapsed,
        worker_max_rss_bytes=int(rss.group(1)) if rss else None,
        step_result=dict(result or {}),
    )


def remove_tenant_objects(tenant_id: uuid.UUID) -> int:
    async def go(store: ObjectStore) -> int:
        keys = await store.list_keys(f"t/{tenant_id}/")
        for key in keys:
            await store.delete_object(key)
        return len(keys)

    return with_store(go)


def test_a_generated_cell_file_imports_in_a_worker_process_that_keeps_a_short_lease(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "Generated")
    data = generated_cells(GENERATED_CELLS)
    upload = start_upload(
        api,
        lab.lead,
        lab.project,
        "cells.geojson",
        len(data),
        kind="result",
        slide_id=str(slide_id),
    )
    send_file(api, lab.lead, upload, data)
    run = watched(
        database,
        lab.tenant_id,
        tmp_path / "work",
        "workflow_support:SHORT_LEASE_IMPORT",
        None,
        timeout=120,
    )
    assert (run.status, run.claims, run.claimed_by) == ("done", 1, ["first"])
    assert run.samples > 0
    assert run.lapsed_samples == 0
    assert run.lowest_lease_seconds > 0
    assert run.step_seconds > SHORT_LEASE_SECONDS
    state = status_of(api, lab.lead, upload)
    assert state["status"] == "ready", state
    detail = result_set(api, lab.lead, state["result_set_id"])
    assert detail["cell_count"] == GENERATED_CELLS
    remove_tenant_objects(lab.tenant_id)


@contextmanager
def large_upload_api(database: str) -> Generator[ApiAs]:
    settings = api_settings(database).model_copy(
        update={"upload_max_bytes": 4 * GIB, "upload_part_bytes": BENCH_PART_BYTES}
    )
    app = create_app(settings)
    with TestClient(app) as client:
        yield ApiAs(app, client)


def benchmark_import(
    api: ApiAs, database: str, lab: Lab, slide_id: uuid.UUID, data: bytes, folder: Path
) -> dict[str, Any]:
    upload = start_upload(
        api,
        lab.lead,
        lab.project,
        "cells.geojson",
        len(data),
        kind="result",
        slide_id=str(slide_id),
    )
    send_file(api, lab.lead, upload, data)
    timed = folder / "time.txt"
    run = watched(database, lab.tenant_id, folder / "work", None, timed, timeout=1800)
    state = status_of(api, lab.lead, upload)
    detail = result_set(api, lab.lead, state["result_set_id"])
    return {
        **asdict(run),
        "result_status": state["status"],
        "cells": detail["cell_count"],
        "time_output": timed.read_text(),
    }


@pytest.mark.skipif(BENCH_FILE is None, reason="set PARFOCAL_BENCH_RESULT_FILE to a GeoJSON")
def test_benchmark_a_large_result_file_through_the_real_worker(
    database: str, lab: Lab, tmp_path: Path
) -> None:
    assert BENCH_FILE is not None
    data = Path(BENCH_FILE).read_bytes()
    slide_id = make_slide(database, lab.tenant_id, lab.project, "Benchmark")
    runs: list[dict[str, Any]] = []
    with large_upload_api(database) as api:
        for name in ("first", "second"):
            (tmp_path / name).mkdir()
            runs.append(benchmark_import(api, database, lab, slide_id, data, tmp_path / name))
    del data
    removed = remove_tenant_objects(lab.tenant_id)
    if BENCH_OUT:
        Path(BENCH_OUT).write_text(json.dumps({"runs": runs, "objects_removed": removed}, indent=2))
    for run in runs:
        assert (run["status"], run["claims"], run["claimed_by"]) == ("done", 1, ["first"])
        assert run["lapsed_samples"] == 0
        assert run["result_status"] == "ready"
        assert run["worker_max_rss_bytes"] < INGEST_MEMORY_MIB * 1024 * 1024
    assert runs[1]["step_result"]["cells_inherited"] == runs[1]["cells"]
