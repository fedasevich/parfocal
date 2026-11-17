import asyncio
import json
import os
from pathlib import Path

import httpx2
import pytest

from parfocal_common.ingest import fixture_folder, fixture_original_key
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ingest.fixture_slides import (
    SYNTHETIC_FOLDER,
    Outcome,
    send_fixtures,
    unfinished,
)

STORAGE = StorageLocation(
    endpoint=os.environ.get("PARFOCAL_TEST_STORAGE_URL", "http://127.0.0.1:9000"),
    region="auto",
    bucket="parfocal-fixture-slides-test",
    access_key_id="parfocal",
    secret_access_key="parfocal-local-secret",
)
OME = "synthetic-zlib.ome.tiff"
SHARED = "synthetic-jpeg.tiff"
DERIVED = {"levels.json", "thumbnail.jpg", "overview.jpg", "restricted-ranges.json", "facts.json"}


async def fresh(store: ObjectStore) -> None:
    await store.create_bucket()
    for key in await store.list_keys(""):
        await store.delete_object(key)


async def run(
    work: str, names: list[str], *, dry_run: bool = False
) -> tuple[list[Outcome], dict[str, bytes]]:
    async with httpx2.AsyncClient(timeout=60) as http:
        store = ObjectStore(STORAGE, http)
        if work == "fresh":
            await fresh(store)
            await store.put_object(
                f"fixtures/{SHARED}", (SYNTHETIC_FOLDER / SHARED).read_bytes(), "image/tiff"
            )
            await store.put_object(
                f"{fixture_folder(SHARED)}levels.json", b"kept", "application/json"
            )
        outcomes = await send_fixtures(store, names, [SYNTHETIC_FOLDER], dry_run=dry_run)
        stored = {key: await store.get_object(key) for key in await store.list_keys("")}
        return outcomes, stored


def names_in(stored: dict[str, bytes], name: str) -> set[str]:
    folder = fixture_folder(name)
    return {key.removeprefix(folder) for key in stored if key.startswith(folder)}


@pytest.mark.db
def test_a_dry_run_plans_the_files_and_writes_nothing() -> None:
    outcomes, stored = asyncio.run(run("fresh", [OME, SHARED], dry_run=True))
    assert [outcome.state for outcome in outcomes] == ["planned", "planned"]
    assert f"{fixture_folder(OME)}facts.json" in outcomes[0].written
    assert set(stored) == {f"fixtures/{SHARED}", f"{fixture_folder(SHARED)}levels.json"}


@pytest.mark.db
def test_each_fixture_gets_its_own_folder_and_nothing_is_overwritten_or_deleted() -> None:
    outcomes, stored = asyncio.run(run("fresh", [OME, SHARED, "absent.svs"]))
    assert [outcome.state for outcome in outcomes] == ["stored", "stored", "missing locally"]
    assert DERIVED | {"original.tiff"} <= names_in(stored, OME)
    assert stored[fixture_original_key(OME)] == (SYNTHETIC_FOLDER / OME).read_bytes()
    assert stored[fixture_original_key(SHARED)] == stored[f"fixtures/{SHARED}"]
    assert stored[f"{fixture_folder(SHARED)}levels.json"] == b"kept"
    assert f"{fixture_folder(SHARED)}levels.json" not in outcomes[1].written
    facts = json.loads(stored[f"{fixture_folder(OME)}facts.json"])
    assert facts["original_key"] == fixture_original_key(OME)
    assert facts["format"] == "ome-tiff"
    assert facts["level_count"] >= 1

    again, kept = asyncio.run(run("again", [OME, SHARED]))
    assert [outcome.state for outcome in again] == ["kept", "kept"]
    assert kept == stored


@pytest.mark.db
def test_a_fixture_missing_locally_is_read_from_the_shared_fixtures_folder() -> None:
    asyncio.run(run("fresh", []))

    async def without_local_files() -> list[Outcome]:
        async with httpx2.AsyncClient(timeout=60) as http:
            return await send_fixtures(ObjectStore(STORAGE, http), [SHARED, "absent.svs"], [])

    outcomes = asyncio.run(without_local_files())
    assert [outcome.state for outcome in outcomes] == ["stored", "missing locally"]
    assert f"{fixture_folder(SHARED)}facts.json" in outcomes[0].written
    assert unfinished(outcomes) == [outcomes[1]]
    again = asyncio.run(without_local_files())
    assert again[0].state == "kept"


def test_fixture_folders_fit_the_edge_folder_rule() -> None:
    assert fixture_folder("CMU-1-Saved-1_16.zip") == "fixture-slides/CMU-1-Saved-1_16-zip/"
    assert fixture_original_key("synthetic-zlib.ome.tiff") == (
        "fixture-slides/synthetic-zlib-ome-tiff/original.tiff"
    )
    assert Path(fixture_folder("Philips-4.tiff")).name == "Philips-4-tiff"
