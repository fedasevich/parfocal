import argparse
import asyncio
import hashlib
import os
import tempfile
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

import httpx2

from parfocal_api.showcase import FORMAT_GALLERY
from parfocal_common.ingest import (
    FIXTURES_PREFIX,
    SAMPLE_FACTS_NAME,
    fixture_folder,
    fixture_original_key,
)
from parfocal_common.jobs import StepFailedError
from parfocal_common.object_store import ObjectStore, StorageError
from parfocal_common.repository import repository_root
from parfocal_common.settings import load_settings
from parfocal_ingest.identify import Identified
from parfocal_ingest.parse_jobs import READER_ERRORS, identify_file, unpacked_in
from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.sample_files import (
    DerivedFile,
    NotASampleSlideError,
    derived_files,
    facts_of,
    send_original,
)
from parfocal_ingest.settings import IngestSettings

ALREADY_STORED = 412
COPY_PART_BYTES = 256 * 1024 * 1024
HASH_CHUNK_BYTES = 8 * 1024 * 1024
SYNTHETIC_FOLDER = repository_root(__file__) / "packages/test-fixtures/synthetic"


class FixtureConflictError(RuntimeError):
    pass


@dataclass(frozen=True)
class Prepared:
    identified: Identified
    found: Pyramid
    files: list[DerivedFile]


@dataclass(frozen=True)
class Outcome:
    name: str
    state: str
    written: tuple[str, ...] = ()


def cache_folder() -> Path:
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "parfocal" / "fixtures"


def gallery_files() -> list[str]:
    return [slide.file for slide in FORMAT_GALLERY]


def local_copy(name: str, folders: Sequence[Path]) -> Path | None:
    for folder in folders:
        candidate = folder / name
        if candidate.is_file():
            return candidate.resolve()
    return None


def prepared(local: Path, work: Path) -> Prepared:
    identified = identify_file(local, local.name)
    if identified.format is None:
        raise NotASampleSlideError(f"{local.name} is not a slide this app reads")
    readable = unpacked_in(work, local, identified)
    found = read_pyramid(readable, identified)
    if not isinstance(found, Pyramid):
        raise NotASampleSlideError(f"{local.name} has no readable pyramid")
    return Prepared(identified, found, derived_files(local, readable, identified, found))


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


async def put_new(
    store: ObjectStore,
    key: str,
    body: bytes,
    content_type: str,
    content_encoding: str | None = None,
) -> bool:
    try:
        await store.put_new_object(key, body, content_type, content_encoding=content_encoding)
    except StorageError as error:
        if error.status == ALREADY_STORED:
            return False
        raise
    return True


async def store_original(store: ObjectStore, name: str, local: Path, size: int) -> bool:
    key = fixture_original_key(name)
    stored = await store.head_object(key)
    if stored == size:
        return False
    if stored is not None:
        raise FixtureConflictError(f"{key} holds {stored} bytes, the fixture has {size}")
    source = f"{FIXTURES_PREFIX}{name}"
    if await store.head_object(source) == size:
        await store.copy_object(source, key, size, COPY_PART_BYTES)
    else:
        await send_original(store, local, key)
    return True


async def send_fixture(
    store: ObjectStore, name: str, local: Path, *, dry_run: bool = False
) -> Outcome:
    folder = fixture_folder(name)
    facts_key = f"{folder}{SAMPLE_FACTS_NAME}"
    if await store.head_object(facts_key) is not None:
        return Outcome(name, "kept")
    with tempfile.TemporaryDirectory(prefix="fixture-slide-") as work:
        ready = await asyncio.to_thread(prepared, local, Path(work))
    planned = (
        *(f"{folder}{file.name}" for file in ready.files),
        fixture_original_key(name),
        facts_key,
    )
    if dry_run:
        return Outcome(name, "planned", planned)
    written: list[str] = []
    for file in ready.files:
        key = f"{folder}{file.name}"
        if await put_new(store, key, file.body, file.content_type, file.content_encoding):
            written.append(key)
    size = (await asyncio.to_thread(local.stat)).st_size
    if await store_original(store, name, local, size):
        written.append(fixture_original_key(name))
    sha256 = await asyncio.to_thread(sha256_of, local)
    facts = facts_of(fixture_original_key(name), size, sha256, ready.identified, ready.found)
    if await put_new(store, facts_key, facts.model_dump_json().encode(), "application/json"):
        written.append(facts_key)
    return Outcome(name, "stored", tuple(written))


async def send_fixtures(
    store: ObjectStore,
    names: Sequence[str],
    folders: Sequence[Path],
    *,
    dry_run: bool = False,
) -> list[Outcome]:
    outcomes: list[Outcome] = []
    for name in names:
        local = local_copy(name, folders)
        if local is None:
            outcomes.append(Outcome(name, "missing locally"))
            continue
        try:
            outcomes.append(await send_fixture(store, name, local, dry_run=dry_run))
        except (NotASampleSlideError, StepFailedError, *READER_ERRORS) as error:
            outcomes.append(Outcome(name, f"failed: {type(error).__name__} {error}"))
    return outcomes


async def main() -> None:
    parser = argparse.ArgumentParser(
        prog="parfocal_ingest.fixture_slides",
        description=(
            "Store each seeded fixture slide once under fixture-slides/ with its derived files, "
            "never overwriting or deleting anything"
        ),
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--from", dest="folders", type=Path, action="append", default=[])
    parser.add_argument("names", nargs="*")
    arguments = parser.parse_args()
    folders = [*arguments.folders, cache_folder(), SYNTHETIC_FOLDER]
    names = arguments.names or gallery_files()
    settings = load_settings(IngestSettings)
    async with httpx2.AsyncClient(timeout=300) as http:
        outcomes = await send_fixtures(
            ObjectStore(settings.storage(), http), names, folders, dry_run=arguments.dry_run
        )
    for outcome in outcomes:
        print(outcome.name, outcome.state, len(outcome.written))
        for key in outcome.written:
            print("  ", key)


if __name__ == "__main__":
    asyncio.run(main())
