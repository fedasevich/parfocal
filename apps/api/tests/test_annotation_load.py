import asyncio
import json
import os
import statistics
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx2
import pytest
from db_support import OWNER_URL, api_settings, query, with_database
from test_annotations import Studio, circle, studio

from parfocal_api.app import create_app
from parfocal_api.auth import authenticate
from parfocal_api.principals import MemberPrincipal

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


async def run_load(database: str, s: Studio, principal: MemberPrincipal) -> Timings:
    settings = api_settings(database).model_copy(
        update={
            "rate_limit_person_per_minute": NO_RATE_LIMIT,
            "rate_limit_tenant_per_minute": NO_RATE_LIMIT,
        }
    )
    app = create_app(settings)

    async def acting() -> MemberPrincipal:
        return principal

    app.dependency_overrides[authenticate] = acting
    timings = Timings()
    async with httpx2.AsyncClient(
        transport=httpx2.ASGITransport(app=app), base_url="https://testserver", timeout=120
    ) as client:
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
    await app.state.engine.dispose()
    return timings


def table_health(database: str) -> list[tuple[object, ...]]:
    names = ", ".join(f"'{table}'" for table in ANNOTATION_TABLES)
    return query(
        with_database(OWNER_URL, database),
        "SELECT s.relname, s.n_live_tup, s.n_dead_tup, s.n_ins_since_vacuum, "
        "s.autovacuum_count, s.autoanalyze_count, "
        "coalesce(array_to_string(c.reloptions, ','), '') "
        "FROM pg_stat_user_tables s JOIN pg_class c ON c.oid = s.relid "
        f"WHERE s.relname IN ({names}) ORDER BY s.relname",
    )


def test_reads_stay_under_the_p95_budget_while_bulk_inserts_run(database: str) -> None:
    s = studio(database)
    load_before = os.getloadavg()
    started = time.perf_counter()
    timings = asyncio.run(run_load(database, s, s.people["owner"]))
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
