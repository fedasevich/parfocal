import asyncio
import json
import multiprocessing
import os
import socket
import statistics
import time
from collections.abc import Generator
from contextlib import contextmanager
from dataclasses import dataclass, field
from multiprocessing.process import BaseProcess
from pathlib import Path
from typing import Any

import httpx2
import pytest
import uvicorn
from db_support import OWNER_URL, api_settings, query, with_database
from test_annotations import Studio, circle, studio

from parfocal_api.app import create_app
from parfocal_api.auth import authenticate
from parfocal_api.principals import MemberPrincipal
from parfocal_api.settings import ApiSettings

pytestmark = pytest.mark.db

BUDGETS = json.loads(
    (Path(__file__).resolve().parents[3] / "perf-budgets.json").read_text(encoding="utf-8")
)["budgets"]
READ_P95_BUDGET_MS = next(
    b["limit"] for b in BUDGETS if b["id"] == "api.read-p95-during-bulk-inserts-ms"
)

SEEDED_SHAPES = 10_000
WRITERS = 2
BATCHES_PER_WRITER = 4
SHAPES_PER_BATCH = 2_500
READERS = 6
GRID = 100
SPACING = 20
VIEWPORT = 400
NO_RATE_LIMIT = 1_000_000
ANNOTATION_TABLES = ("annotations", "annotation_versions")
SERVER_START_S = 60
LONG_LOAD_SECONDS = os.environ.get("PARFOCAL_LONG_LOAD_S")
LONG_BATCH = 1_000
LONG_BATCH_PAUSE_S = 4
LONG_EDIT_PAUSE_S = 0.05
LONG_READERS = 2
LONG_READ_PAUSE_S = 0.1
LONG_SAMPLE_S = 10


@dataclass
class Timings:
    reads: list[float] = field(default_factory=list)
    by_route: dict[str, list[float]] = field(default_factory=dict)
    batches: list[float] = field(default_factory=list)
    failures: list[str] = field(default_factory=list)


def drafts(s: Studio, start: int, count: int) -> list[dict[str, Any]]:
    return [
        {
            "kind": "cell",
            "geometry": circle(SPACING * (k % GRID), SPACING * (k // GRID)),
            "class_id": str(s.class_id),
        }
        for k in range(start, start + count)
    ]


def percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int(share * len(ordered)))]


def bodies(s: Studio, writer: int) -> list[bytes]:
    return [
        json.dumps(
            {
                "annotations": drafts(
                    s,
                    SEEDED_SHAPES + (writer * BATCHES_PER_WRITER + batch) * SHAPES_PER_BATCH,
                    SHAPES_PER_BATCH,
                )
            }
        ).encode()
        for batch in range(BATCHES_PER_WRITER)
    ]


async def write(
    client: httpx2.AsyncClient, s: Studio, batches: list[bytes], timings: Timings
) -> None:
    for body in batches:
        began = time.perf_counter()
        response = await client.post(
            f"{s.path}/bulk", content=body, headers={"content-type": "application/json"}
        )
        timings.batches.append((time.perf_counter() - began) * 1000)
        if response.status_code != 201:
            timings.failures.append(f"bulk {response.status_code} {response.text[:200]}")


async def read(
    client: httpx2.AsyncClient,
    s: Studio,
    reader: int,
    known: list[str],
    writing: asyncio.Event,
    timings: Timings,
) -> None:
    turn = 0
    while not writing.is_set():
        x = (reader * 7 + turn * 3) % 5 * VIEWPORT
        y = (reader * 5 + turn * 7) % 5 * VIEWPORT
        requests = (
            ("bbox", s.path, {"bbox": [x, y, x + VIEWPORT, y + VIEWPORT]}),
            ("one", f"{s.path}/{known[(reader * 31 + turn) % len(known)]}", None),
        )
        for route, path, params in requests:
            began = time.perf_counter()
            response = await client.get(path, params=params)
            elapsed = (time.perf_counter() - began) * 1000
            timings.reads.append(elapsed)
            timings.by_route.setdefault(route, []).append(elapsed)
            if response.status_code != 200:
                timings.failures.append(f"read {response.status_code} {response.text[:200]}")
        turn += 1


def serve(settings: ApiSettings, principal: MemberPrincipal, port: int) -> None:
    app = create_app(settings)

    async def acting() -> MemberPrincipal:
        return principal

    app.dependency_overrides[authenticate] = acting
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning", access_log=False)


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


async def until_up(client: httpx2.AsyncClient, server: BaseProcess) -> None:
    deadline = time.monotonic() + SERVER_START_S
    while time.monotonic() < deadline:
        assert server.is_alive(), "The API server exited before it answered"
        try:
            if (await client.get("/api/health")).status_code == 200:
                return
        except httpx2.TransportError:
            pass
        await asyncio.sleep(0.2)
    raise TimeoutError("The API server did not answer in time")


async def run_load(base_url: str, s: Studio, server: BaseProcess) -> Timings:
    timings = Timings()
    async with httpx2.AsyncClient(base_url=base_url, timeout=120) as client:
        await until_up(client, server)
        seeded = await client.post(
            f"{s.path}/bulk", json={"annotations": drafts(s, 0, SEEDED_SHAPES)}
        )
        assert seeded.status_code == 201, seeded.text[:500]
        known = [str(ref["id"]) for ref in seeded.json()[:: SEEDED_SHAPES // 100]]
        writing = asyncio.Event()
        payloads = [bodies(s, w) for w in range(WRITERS)]

        async def writers() -> None:
            await asyncio.gather(*(write(client, s, p, timings) for p in payloads))
            writing.set()

        await asyncio.gather(
            writers(),
            *(read(client, s, r, known, writing, timings) for r in range(READERS)),
        )
    return timings


@contextmanager
def own_server(database: str, s: Studio) -> Generator[tuple[str, BaseProcess]]:
    settings = api_settings(database).model_copy(
        update={
            "rate_limit_person_per_minute": NO_RATE_LIMIT,
            "rate_limit_tenant_per_minute": NO_RATE_LIMIT,
        }
    )
    port = free_port()
    server = multiprocessing.get_context("spawn").Process(
        target=serve, args=(settings, s.people["owner"], port), daemon=True
    )
    server.start()
    try:
        yield f"http://127.0.0.1:{port}", server
    finally:
        server.terminate()
        server.join(10)
        if server.is_alive():
            server.kill()


def load_in_own_server(database: str, s: Studio) -> Timings:
    with own_server(database, s) as (base_url, server):
        return asyncio.run(run_load(base_url, s, server))


def table_health(database: str) -> list[tuple[object, ...]]:
    names = ", ".join(f"'{table}'" for table in ANNOTATION_TABLES)
    return query(
        with_database(OWNER_URL, database),
        "SELECT s.relname, s.n_live_tup, s.n_dead_tup, s.n_ins_since_vacuum, "
        "s.autovacuum_count, s.autoanalyze_count, "
        "coalesce(array_to_string(c.reloptions, ','), ''), "
        "s.n_mod_since_analyze, s.last_autovacuum, s.last_autoanalyze "
        "FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid "
        f"WHERE s.relname IN ({names}) ORDER BY s.relname",
    )


async def paced_writes(
    client: httpx2.AsyncClient, s: Studio, until: float, timings: Timings
) -> None:
    start = SEEDED_SHAPES
    while time.monotonic() < until:
        began = time.perf_counter()
        response = await client.post(
            f"{s.path}/bulk", json={"annotations": drafts(s, start, LONG_BATCH)}
        )
        timings.batches.append((time.perf_counter() - began) * 1000)
        if response.status_code != 201:
            timings.failures.append(f"bulk {response.status_code} {response.text[:200]}")
        start += LONG_BATCH
        await asyncio.sleep(LONG_BATCH_PAUSE_S)


async def paced_edits(
    client: httpx2.AsyncClient, s: Studio, ids: list[str], until: float, timings: Timings
) -> None:
    versions = dict.fromkeys(ids, 1)
    turn = 0
    while time.monotonic() < until:
        target = ids[turn % len(ids)]
        response = await client.patch(
            f"{s.path}/{target}", json={"version": versions[target], "class_id": str(s.class_id)}
        )
        if response.status_code == 200:
            versions[target] = response.json()["version"]
        else:
            timings.failures.append(f"edit {response.status_code} {response.text[:200]}")
        turn += 1
        await asyncio.sleep(LONG_EDIT_PAUSE_S)


async def paced_reads(
    client: httpx2.AsyncClient, s: Studio, reader: int, until: float, timings: Timings
) -> None:
    turn = 0
    while time.monotonic() < until:
        x = (reader * 7 + turn * 3) % 5 * VIEWPORT
        y = (reader * 5 + turn * 7) % 5 * VIEWPORT
        began = time.perf_counter()
        response = await client.get(s.path, params={"bbox": [x, y, x + VIEWPORT, y + VIEWPORT]})
        timings.reads.append((time.perf_counter() - began) * 1000)
        if response.status_code != 200:
            timings.failures.append(f"read {response.status_code} {response.text[:200]}")
        turn += 1
        await asyncio.sleep(LONG_READ_PAUSE_S)


async def sample_health(database: str, until: float, samples: list[dict[str, object]]) -> None:
    started = time.monotonic()
    while time.monotonic() < until:
        rows = await asyncio.to_thread(table_health, database)
        samples.append({"t_s": round(time.monotonic() - started), "tables": rows})
        await asyncio.sleep(LONG_SAMPLE_S)


async def run_long_load(
    base_url: str, s: Studio, server: BaseProcess, database: str, seconds: float
) -> tuple[Timings, list[dict[str, object]]]:
    timings = Timings()
    samples: list[dict[str, object]] = []
    async with httpx2.AsyncClient(base_url=base_url, timeout=120) as client:
        await until_up(client, server)
        seeded = await client.post(
            f"{s.path}/bulk", json={"annotations": drafts(s, 0, SEEDED_SHAPES)}
        )
        assert seeded.status_code == 201, seeded.text[:500]
        ids = [str(ref["id"]) for ref in seeded.json()]
        until = time.monotonic() + seconds
        await asyncio.gather(
            paced_writes(client, s, until, timings),
            paced_edits(client, s, ids, until, timings),
            *(paced_reads(client, s, r, until, timings) for r in range(LONG_READERS)),
            sample_health(database, until + LONG_SAMPLE_S, samples),
        )
    return timings, samples


def test_reads_stay_under_the_p95_budget_while_bulk_inserts_run(database: str) -> None:
    s = studio(database)
    load_before = os.getloadavg()
    started = time.perf_counter()
    timings = load_in_own_server(database, s)
    wall = time.perf_counter() - started
    load_after = os.getloadavg()
    assert timings.failures == [], timings.failures[:5]
    inserted = SEEDED_SHAPES + WRITERS * BATCHES_PER_WRITER * SHAPES_PER_BATCH
    rows = query(
        with_database(OWNER_URL, database),
        f"SELECT count(*) FROM annotations WHERE slide_id = '{s.slide}'",
    )
    assert rows[0][0] == inserted
    p95 = percentile(timings.reads, 0.95)
    print(
        json.dumps(
            {
                "reads": len(timings.reads),
                "read_p50_ms": round(statistics.median(timings.reads), 1),
                "read_p95_ms": round(p95, 1),
                "read_max_ms": round(max(timings.reads), 1),
                "route_p95_ms": {
                    route: round(percentile(values, 0.95), 1)
                    for route, values in timings.by_route.items()
                },
                "batches": len(timings.batches),
                "batch_p50_ms": round(statistics.median(timings.batches), 1),
                "batch_max_ms": round(max(timings.batches), 1),
                "wall_s": round(wall, 1),
                "load_before": [round(v, 2) for v in load_before],
                "load_after": [round(v, 2) for v in load_after],
                "cpus": os.cpu_count(),
                "tables": [list(row) for row in table_health(database)],
            },
            default=str,
        )
    )
    if load_before[0] > (os.cpu_count() or 1):
        pytest.skip(f"Load average {load_before[0]:.1f} is above the core count, p95 {p95:.0f} ms")
    assert p95 < READ_P95_BUDGET_MS, p95


def test_annotation_tables_carry_the_tuned_autovacuum_settings(database: str) -> None:
    options = {str(row[0]): row[6] for row in table_health(database)}
    for table in ANNOTATION_TABLES:
        assert set(str(options[table]).split(",")) >= {
            "autovacuum_vacuum_scale_factor=0.02",
            "autovacuum_vacuum_insert_scale_factor=0.05",
            "autovacuum_analyze_scale_factor=0.01",
        }, table


@pytest.mark.skipif(LONG_LOAD_SECONDS is None, reason="Set PARFOCAL_LONG_LOAD_S to run it")
def test_autovacuum_keeps_up_during_a_long_mixed_load(database: str) -> None:
    s = studio(database)
    seconds = float(LONG_LOAD_SECONDS or 0)
    load_before = os.getloadavg()
    with own_server(database, s) as (base_url, server):
        timings, samples = asyncio.run(run_long_load(base_url, s, server, database, seconds))
    assert timings.failures == [], timings.failures[:5]
    settings = query(
        with_database(OWNER_URL, database),
        "SELECT name, setting FROM pg_settings WHERE name IN ('autovacuum_naptime', "
        "'autovacuum_vacuum_threshold', 'autovacuum_vacuum_insert_threshold', "
        "'autovacuum_analyze_threshold') ORDER BY name",
    )
    print(
        json.dumps(
            {
                "seconds": seconds,
                "reads": len(timings.reads),
                "read_p50_ms": round(statistics.median(timings.reads), 1),
                "read_p95_ms": round(percentile(timings.reads, 0.95), 1),
                "batches": len(timings.batches),
                "batch_p50_ms": round(statistics.median(timings.batches), 1),
                "load_before": [round(v, 2) for v in load_before],
                "load_after": [round(v, 2) for v in os.getloadavg()],
                "settings": [list(row) for row in settings],
                "samples": samples,
            },
            default=str,
        )
    )
    final = {str(row[0]): row for row in table_health(database)}
    assert all(int(str(final[table][4])) > 0 for table in ANNOTATION_TABLES), final
