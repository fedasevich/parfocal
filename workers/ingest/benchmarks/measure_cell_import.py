import asyncio
import resource
import sys
import time
import uuid
from collections.abc import Awaitable, Callable
from pathlib import Path

import httpx2
import numpy as np

from parfocal_common.chunk_store import build_cells, read_summary, write_cells
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import ObjectResultStore
from parfocal_ingest.matching import match_centres, match_regions
from parfocal_ingest.result_import import (
    NumberedRegion,
    cell_values,
    class_list,
    incoming_cells,
    objects_to_import,
    read_file,
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


async def main(path: Path) -> None:
    timer = Timer()
    tenant, slide, set_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    data = timer.run("read file bytes", path.read_bytes)
    parsed = timer.run("parse GeoJSON", lambda: read_file(data, "geojson"))
    shapes, cells = timer.run("split regions and cells", lambda: objects_to_import(parsed))
    classes = timer.run("class list", lambda: class_list(parsed, [*shapes, *cells]))
    incoming = timer.run("outlines and centres", lambda: incoming_cells(cells))
    found = timer.run(
        "match regions, first import", lambda: match_regions([], [s.geometry for s in shapes])
    )
    regions = [
        NumberedRegion(number, item.geometry)
        for item, number in zip(shapes, found.numbers(1), strict=True)
    ]
    centres = incoming.outlines.centres
    nothing = np.zeros(0, dtype=np.int64)
    first = timer.run(
        "match cells, first import",
        lambda: match_centres(nothing, np.zeros((0, 2)), centres, DISTANCE),
    )
    numbers = first.numbers(1)
    values, _ = timer.run(
        "cell values with innermost region",
        lambda: cell_values(incoming, numbers, regions, classes),
    )
    built = timer.run(
        "build_cells", lambda: build_cells(tenant, slide, set_id, values, len(classes))
    )
    async with httpx2.AsyncClient(timeout=httpx2.Timeout(120.0)) as http:
        store = ObjectStore(STORAGE, http)
        results = ObjectResultStore(store)
        try:
            await timer.wait("write_cells to MinIO", write_cells(results, built))
            summary = await timer.wait(
                "read older summary from MinIO",
                read_summary(results, result_set_prefix(tenant, slide, set_id)),
            )
            known = np.asarray(summary.numbers(), dtype=np.int64)
            older = summary_centres(summary.arrays)
            again = timer.run(
                "match cells, second import",
                lambda: match_centres(known, older, centres, DISTANCE),
            )
            assert again.numbers(len(cells) + 1) == numbers
        finally:
            keys = await store.list_keys(f"t/{tenant}/")
            for key in keys:
                await store.delete_object(key)
            left = await store.list_keys(f"t/{tenant}/")
    chunk_bytes = sum(len(chunk.data) for chunk in built.chunks)
    print(f"file bytes: {len(data)}, cells: {len(cells)}, regions: {len(shapes)}")
    print(f"classes: {len(classes)}, chunks: {len(built.chunks)}, chunk bytes: {chunk_bytes}")
    print(f"summary bytes: {len(built.summary.data)}")
    print(f"vertices: {sum(entry.vertex_count for entry in built.entries)}")
    print(f"inherited on second import: {len(again.inherited)} of {len(cells)}")
    print(f"objects deleted: {len(keys)}, left: {len(left)}")
    print(timer.table())


if __name__ == "__main__":
    asyncio.run(main(Path(sys.argv[1])))
