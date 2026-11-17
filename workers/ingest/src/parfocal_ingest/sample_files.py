import argparse
import asyncio
import gzip
import hashlib
from dataclasses import dataclass
from pathlib import Path

import httpx2

from parfocal_api.sample_files import SampleFile, facts_key
from parfocal_api.sample_project import SAMPLE_SLIDES
from parfocal_common.ingest import RESTRICTED_RANGES_NAME, sample_folder, sample_original_key
from parfocal_common.object_store import ObjectStore, StoredPart
from parfocal_common.settings import load_settings
from parfocal_ingest.identify import Identified, identify
from parfocal_ingest.identifying_text import ranges_file
from parfocal_ingest.overview_levels import OVERVIEW_LEVELS_NAME, overview_levels
from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.settings import IngestSettings
from parfocal_ingest.thumbnail import previews
from parfocal_ingest.tile_index import index_document, tile_index
from parfocal_ingest.workflow import TILE_INDEX_NAME, level_table

PART_BYTES = 16 * 1024 * 1024
PART_SECONDS = 15 * 60
SAMPLE_SUFFIXES = (".tif", ".tiff")


class NotASampleSlideError(ValueError):
    pass


def opened(path: Path) -> tuple[Identified, Pyramid]:
    with path.open("rb") as handle:
        identified = identify(handle, path.name)
    if identified.format is None:
        raise NotASampleSlideError(f"{path.name} is not a slide this app reads")
    found = read_pyramid(path, identified)
    if not isinstance(found, Pyramid):
        raise NotASampleSlideError(f"{path.name} has no readable pyramid")
    return identified, found


def read_part(path: Path, offset: int) -> bytes:
    with path.open("rb") as handle:
        handle.seek(offset)
        return handle.read(PART_BYTES)


async def send_original(store: ObjectStore, path: Path, key: str) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = (await asyncio.to_thread(path.stat)).st_size
    if size <= PART_BYTES:
        body = await asyncio.to_thread(read_part, path, 0)
        digest.update(body)
        await store.put_object(key, body, "image/tiff")
        return size, digest.hexdigest()
    upload_id = await store.create_multipart_upload(key)
    parts: list[StoredPart] = []
    try:
        for offset in range(0, size, PART_BYTES):
            body = await asyncio.to_thread(read_part, path, offset)
            digest.update(body)
            number = len(parts) + 1
            url = store.presign_part(key, upload_id, number, PART_SECONDS)
            answer = await store.http.put(url, content=body)
            answer.raise_for_status()
            parts.append(StoredPart(number, len(body), answer.headers["etag"].strip('"')))
        await store.complete_multipart_upload(key, upload_id, parts)
    except BaseException:
        await store.abort_multipart_upload(key, upload_id)
        raise
    return size, digest.hexdigest()


@dataclass(frozen=True)
class DerivedFile:
    name: str
    body: bytes
    content_type: str
    content_encoding: str | None = None


def derived_files(
    original: Path, readable: Path, identified: Identified, found: Pyramid
) -> list[DerivedFile]:
    assert identified.format is not None
    files = [DerivedFile("levels.json", level_table(found), "application/json")]
    tiles = tile_index(readable, identified, found)
    if tiles is not None:
        derived = overview_levels(readable, identified.format, found)
        if derived is not None:
            files.append(DerivedFile(OVERVIEW_LEVELS_NAME, derived.data, "image/tiff"))
            tiles["overviewLevels"] = derived.reference()
        files.append(
            DerivedFile(
                TILE_INDEX_NAME,
                gzip.compress(index_document(tiles), mtime=0),
                "application/json",
                "gzip",
            )
        )
    images = previews(readable, identified.format, found)
    files.append(DerivedFile("thumbnail.jpg", images.thumbnail, "image/jpeg"))
    files.append(DerivedFile("overview.jpg", images.overview, "image/jpeg"))
    files.append(DerivedFile(RESTRICTED_RANGES_NAME, ranges_file(original), "application/json"))
    return files


def facts_of(
    key: str, size: int, sha256: str, identified: Identified, found: Pyramid
) -> SampleFile:
    assert identified.format is not None
    base = found.levels[0]
    return SampleFile(
        original_key=key,
        file_bytes=size,
        sha256=sha256,
        format=identified.format.value,
        variant=identified.variant,
        reader=found.reader.value,
        width=base.width,
        height=base.height,
        level_count=len(found.levels),
        mpp_x=found.scale.mpp_x,
        mpp_y=found.scale.mpp_y,
        objective_power=found.scale.objective_power,
        notices=[notice.value for notice in found.notices],
    )


async def send_sample(store: ObjectStore, label: str, path: Path) -> SampleFile:
    identified, found = await asyncio.to_thread(opened, path)
    folder = sample_folder(label)
    for file in await asyncio.to_thread(derived_files, path, path, identified, found):
        await store.put_object(
            f"{folder}{file.name}",
            file.body,
            file.content_type,
            content_encoding=file.content_encoding,
        )
    key = sample_original_key(label, path.name)
    size, sha256 = await send_original(store, path, key)
    facts = facts_of(key, size, sha256, identified, found)
    await store.put_object(facts_key(label), facts.model_dump_json().encode(), "application/json")
    return facts


def sample_paths(folder: Path) -> dict[str, Path]:
    found: dict[str, Path] = {}
    for path in sorted(folder.iterdir()):
        label = path.stem.lower()
        if label in SAMPLE_SLIDES and path.suffix.lower() in SAMPLE_SUFFIXES:
            found[label] = path
    return found


async def send_samples(store: ObjectStore, folder: Path) -> dict[str, SampleFile]:
    sent: dict[str, SampleFile] = {}
    for label, path in sample_paths(folder).items():
        sent[label] = await send_sample(store, label, path)
    return sent


async def main() -> None:
    parser = argparse.ArgumentParser(
        prog="parfocal_ingest.sample_files",
        description="Store the CAMELYON16 sample slides once for every sample project",
    )
    parser.add_argument("folder", type=Path)
    folder: Path = parser.parse_args().folder
    settings = load_settings(IngestSettings)
    async with httpx2.AsyncClient(timeout=120) as http:
        sent = await send_samples(ObjectStore(settings.storage(), http), folder)
    for label in SAMPLE_SLIDES:
        facts = sent.get(label)
        print(label, "missing" if facts is None else f"{facts.file_bytes} {facts.sha256}")


if __name__ == "__main__":
    asyncio.run(main())
