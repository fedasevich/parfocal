import asyncio
import resource
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx2
import numpy as np

from parfocal_common.chunk_store import read_summary
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import ObjectResultStore
from parfocal_ingest.chunk_builder import plan_chunks, write_table
from parfocal_ingest.matching import match_regions, pair_centres
from parfocal_ingest.result_import import (
    NumberedRegion,
    cell_table,
    class_list,
    objects_to_import,
    read_path,
    summary_centres,
)

STORAGE = StorageLocation(
    endpoint="http://127.0.0.1:9000",
    region="auto",
    bucket="parfocal-test",
    access_key_id="parfocal",
    secret_access_key="parfocal-local-secret",
)
DISTANCE = 16.0


def peak_mib() -> float:
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1024 * 1024)


class Timer:
    def __init__(self) -> None:
        self.rows: list[tuple[str, float, float]] = []

    def run[T](self, name: str, work: Callable[[], T]) -> T:
        started = time.perf_counter()
        value = work()
        self.rows.append((name, time.perf_counter() - started, peak_mib()))
        return value

    async def wait[T](self, name: str, work: Awaitable[T]) -> T:
        started = time.perf_counter()
        value = await work
        self.rows.append((name, time.perf_counter() - started, peak_mib()))
        return value

    def table(self) -> str:
        lines = ["| Stage | Seconds | Peak RSS MiB |", "|---|---:|---:|"]
        lines += [f"| {name} | {seconds:.2f} | {peak:,.0f} |" for name, seconds, peak in self.rows]
        lines.append(f"| total | {sum(row[1] for row in self.rows):.2f} | |")
        return "\n".join(lines)


async def main(path: Path, size: int) -> None:
    timer = Timer()
    tenant, slide, set_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    parsed = timer.run("stream the file into cell columns", lambda: read_path(path, "geojson"))
    objects_to_import(parsed)
    classes = timer.run("class list", lambda: class_list(parsed))
    found = timer.run(
        "match regions, first import",
        lambda: match_regions([], [s.geometry for s in parsed.shapes]),
    )
    regions = [
        NumberedRegion(number, item.geometry)
        for item, number in zip(parsed.shapes, found.numbers(1), strict=True)
    ]
    centres = parsed.cells.outlines.centres
    nothing = np.zeros(0, dtype=np.int64)
    first = timer.run(
        "match cells, first import",
        lambda: pair_centres(nothing, np.zeros((0, 2)), centres, DISTANCE),
    )
    numbers = first.numbers(1)
    table, _ = timer.run(
        "cell table with innermost region",
        lambda: cell_table(parsed.cells, numbers, regions, classes),
    )
    plan = timer.run("plan chunks", lambda: plan_chunks(tenant, slide, set_id, table, len(classes)))
    async with httpx2.AsyncClient(timeout=httpx2.Timeout(120.0)) as http:
        store = ObjectStore(STORAGE, http)
        results = ObjectResultStore(store)
        try:
            entries = await timer.wait(
                "build and write chunks to MinIO", write_table(results, table, plan)
            )
            summary = await timer.wait(
                "read older summary from MinIO",
                read_summary(results, result_set_prefix(tenant, slide, set_id)),
            )
            known = np.asarray(summary.numbers(), dtype=np.int64)
            older = summary_centres(summary.arrays)
            again = timer.run(
                "match cells, second import",
                lambda: pair_centres(known, older, centres, DISTANCE),
            )
            assert again.numbers(len(parsed.cells) + 1).tolist() == numbers.tolist()
        finally:
            keys = await store.list_keys(f"t/{tenant}/")
            for key in keys:
                await store.delete_object(key)
            left = await store.list_keys(f"t/{tenant}/")
    print(f"file bytes: {size}, cells: {len(parsed.cells)}")
    print(f"regions: {len(parsed.shapes)}, classes: {len(classes)}, chunks: {len(entries)}")
    print(f"vertices: {sum(entry.vertex_count for entry in entries)}")
    print(f"inherited on second import: {again.inherited} of {len(parsed.cells)}")
    print(f"objects deleted: {len(keys)}, left: {len(left)}")
    print(timer.table())


if __name__ == "__main__":
    source = Path(sys.argv[1])
    asyncio.run(main(source, source.stat().st_size))
