import asyncio
import io
import logging
import shutil
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any

from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.tables import ResultStatus, result_sets, review_order
from parfocal_common.cell_chunks import ChunkError
from parfocal_common.cell_crops import CROP_MICRONS, CROP_SIDE, crop_folder, crop_key
from parfocal_common.chunk_store import CellSummary, read_summary
from parfocal_common.jobs import StepFailedError
from parfocal_common.object_ids import Letter
from parfocal_common.object_store import ObjectStore, StorageError
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import MissingObjectError, ObjectResultStore
from parfocal_common.review_order import unpack
from parfocal_ingest.isolated_child import ScopedStorage
from parfocal_ingest.isolation import (
    JobScope,
    JobTokens,
    ParseLimits,
    output_folder,
    parse_isolated,
    read_output,
)
from parfocal_ingest.parse_jobs import READER_ERRORS
from parfocal_ingest.patch_service import PatchService, UncalibratedError

logger = logging.getLogger("parfocal.ingest.cell_crops")

PER_CLASS = 12
MAX_CROPS = 240
JPEG_QUALITY = 85
MAX_CROP_BYTES = 64 * 1024
JPEG_START = b"\xff\xd8\xff"
CUT = "cut"
PRESENT = "present"
NONE = "none"
UNREADABLE = "unreadable"
MISSING = "missing"
NOT_FOUND = 404


@dataclass(frozen=True)
class Spot:
    number: int
    x: float
    y: float
    class_index: int
    score: int


def spots_of(summary: CellSummary) -> list[Spot]:
    arrays = summary.arrays
    numbers = summary.numbers()
    return [
        Spot(
            int(numbers[index]),
            float(arrays["x"][index]),
            float(arrays["y"][index]),
            int(arrays["class"][index]),
            int(arrays["score"][index]),
        )
        for index in range(len(summary))
    ]


def chosen(
    spots: Sequence[Spot],
    wanted: Sequence[int],
    per_class: int = PER_CLASS,
    cap: int = MAX_CROPS,
) -> list[Spot]:
    by_number = {spot.number: spot for spot in spots}
    picked: dict[int, Spot] = {}
    for number in wanted:
        spot = by_number.get(number)
        if spot is not None:
            picked.setdefault(number, spot)
    classes: dict[int, list[Spot]] = {}
    for spot in by_number.values():
        classes.setdefault(spot.class_index, []).append(spot)
    for members in classes.values():
        best = sorted(members, key=lambda spot: (-spot.score, spot.number))
        for spot in best[:per_class]:
            picked.setdefault(spot.number, spot)
    return list(picked.values())[:cap]


def jpeg(pixels: Any) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(pixels).convert("RGB").save(buffer, "JPEG", quality=JPEG_QUALITY)
    return buffer.getvalue()


def cut_from(path: Path, cells: Sequence[Sequence[float]], out: Path) -> int:
    service = PatchService()
    made = 0
    try:
        for number, x, y in cells:
            pixels = service.patch(path, float(x), float(y), CROP_MICRONS, CROP_SIDE)
            if pixels is None:
                continue
            (out / f"{int(number)}.jpg").write_bytes(jpeg(pixels))
            made += 1
    finally:
        service.close()
    return made


def cut_crops(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    local = storage.fetch(arguments["key"])
    try:
        made = cut_from(local, arguments["cells"], Path(arguments["out"]))
    except (UncalibratedError, ValueError, *READER_ERRORS):
        return {"skipped": UNREADABLE}
    return {"cut": made}


async def stored_numbers(store: ObjectStore, tenant_id: uuid.UUID, slide_id: uuid.UUID) -> set[int]:
    folder = crop_folder(tenant_id, slide_id)
    found: set[int] = set()
    for key in await store.list_keys(folder):
        stem = PurePosixPath(key).stem
        if stem.isdigit():
            found.add(int(stem))
    return found


@dataclass(frozen=True)
class Isolation:
    limits: ParseLimits | None = None
    tokens: JobTokens | None = None


async def crop_slide(
    store: ObjectStore,
    tenant_id: uuid.UUID,
    slide_id: uuid.UUID,
    original_key: str,
    picked: Sequence[Spot],
    work_dir: Path,
    isolation: Isolation = Isolation(),
) -> str:
    if not picked:
        return NONE
    stored = await stored_numbers(store, tenant_id, slide_id)
    missing = [spot for spot in picked if spot.number not in stored]
    if not missing:
        return PRESENT
    folder = work_dir / f"crops-{slide_id}"
    out = await asyncio.to_thread(output_folder, folder, "crops")

    async def fetcher(wanted: str) -> Path:
        local = folder / PurePosixPath(wanted).name
        await store.download(wanted, local)
        return local

    try:
        facts = await parse_isolated(
            f"{__name__}:cut_crops",
            {
                "key": original_key,
                "cells": [[spot.number, spot.x, spot.y] for spot in missing],
                "out": str(out),
            },
            JobScope(tenant_id, slide_id, (original_key,)),
            fetcher,
            folder,
            isolation.limits,
            isolation.tokens,
        )
        if facts.get("skipped") is not None:
            return UNREADABLE
        for spot in missing:
            body = await asyncio.to_thread(read_output, out, f"{spot.number}.jpg", MAX_CROP_BYTES)
            if body is None or not body.startswith(JPEG_START):
                continue
            await store.put_object(crop_key(tenant_id, slide_id, spot.number), body, "image/jpeg")
    except StepFailedError:
        return UNREADABLE
    except StorageError as error:
        if error.status != NOT_FOUND:
            raise
        logger.warning("crop original missing", extra={"slide_id": str(slide_id)})
        return MISSING
    finally:
        await asyncio.to_thread(shutil.rmtree, folder, True)
    return CUT


async def slide_spots(
    connection: AsyncConnection, store: ObjectStore, tenant_id: uuid.UUID, slide_id: uuid.UUID
) -> list[Spot]:
    set_ids = list(
        await connection.scalars(
            select(result_sets.c.id).where(
                result_sets.c.slide_id == slide_id,
                result_sets.c.deleted_at.is_(None),
                result_sets.c.status == ResultStatus.READY,
                result_sets.c.cell_count > 0,
            )
        )
    )
    results = ObjectResultStore(store)
    spots: list[Spot] = []
    for set_id in set_ids:
        try:
            summary = await read_summary(results, result_set_prefix(tenant_id, slide_id, set_id))
        except MissingObjectError, ChunkError:
            continue
        spots += spots_of(summary)
    return spots


async def reviewed_cells(connection: AsyncConnection, slide_id: uuid.UUID) -> list[int]:
    numbers: list[int] = []
    for packed in await connection.scalars(
        select(review_order.c.objects)
        .where(review_order.c.slide_id == slide_id)
        .order_by(review_order.c.created_at)
    ):
        numbers += [number for letter, number in unpack(packed) if letter is Letter.CELL]
    return numbers


async def picked_on(
    connection: AsyncConnection, store: ObjectStore, tenant_id: uuid.UUID, slide_id: uuid.UUID
) -> list[Spot]:
    spots = await slide_spots(connection, store, tenant_id, slide_id)
    return chosen(spots, await reviewed_cells(connection, slide_id))
