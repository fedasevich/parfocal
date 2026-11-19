import asyncio
import os
from collections.abc import Mapping, Sequence
from typing import Any

import httpx2
import pytest

from parfocal_api.showcase import FORMAT_GALLERY
from parfocal_common.object_store import ObjectStore, StorageError, StorageLocation
from parfocal_deploy import reset as reset_module
from parfocal_deploy.deploy import MIGRATE
from parfocal_deploy.environments import Environment, environment
from parfocal_deploy.reset import (
    BUCKET_LOCKED,
    KEPT_TABLES,
    RESET_SETTINGS,
    empty_tenant_objects,
    metadata,
    remove_unlocked,
    truncate_statement,
)
from parfocal_deploy.tools import Tools
from parfocal_ingest.identify import Format

RESET_STORAGE = StorageLocation(
    endpoint=os.environ.get("PARFOCAL_TEST_STORAGE_URL", "http://127.0.0.1:9000"),
    region="auto",
    bucket="parfocal-reset-test",
    access_key_id="parfocal",
    secret_access_key="parfocal-local-secret",
)
KEPT_KEYS = (
    "fixtures/CMU-1-Small-Region.svs",
    "fixtures/manifest.json",
    "fixture-slides/CMU-1-Small-Region-svs/original.svs",
    "fixture-slides/CMU-1-Small-Region-svs/levels.json",
    "samples/camelyon16/tumor/tumor_001.tif",
    "tenants/t/not-a-tenant.txt",
)
TENANT_KEYS = ("t/one/slides/two/original.svs", "t/three/results/four.geojson")
UNSEEDED_FORMATS: set[Format] = set()


async def stored_keys_after_reset() -> tuple[int, list[str]]:
    async with httpx2.AsyncClient(timeout=30) as http:
        store = ObjectStore(RESET_STORAGE, http)
        await store.create_bucket()
        for key in await store.list_keys(""):
            await store.delete_object(key)
        for key in KEPT_KEYS + TENANT_KEYS:
            await store.put_object(key, b"x", "application/octet-stream")
        removed = await empty_tenant_objects(RESET_STORAGE)
        return removed, sorted(await store.list_keys(""))


@pytest.mark.db
def test_the_reset_removes_tenant_objects_and_leaves_fixtures_untouched() -> None:
    removed, left = asyncio.run(stored_keys_after_reset())
    assert removed == len(TENANT_KEYS)
    assert left == sorted(KEPT_KEYS)


class LockedStore:
    def __init__(self, locked: set[str], refused: dict[str, str]) -> None:
        self.locked, self.refused, self.removed = locked, refused, list[str]()

    async def delete_object(self, key: str) -> None:
        if key in self.locked:
            raise StorageError(409, BUCKET_LOCKED)
        if key in self.refused:
            raise StorageError(403, self.refused[key])
        self.removed.append(key)


def test_the_reset_leaves_objects_the_bucket_lock_keeps_and_removes_the_rest() -> None:
    store = LockedStore({"t/one/new.svs"}, {})
    removed = asyncio.run(remove_unlocked(store, ["t/one/new.svs", "t/one/old.svs", "t/two/x"]))
    assert removed == 2
    assert store.removed == ["t/one/old.svs", "t/two/x"]


def test_the_reset_stops_on_any_other_refusal() -> None:
    store = LockedStore(set(), {"t/one/a": "AccessDenied"})
    with pytest.raises(StorageError, match="AccessDenied"):
        asyncio.run(remove_unlocked(store, ["t/one/a"]))


def test_the_reset_publishes_fixtures_first_and_starts_the_ingest_worker_after_the_seed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    steps: list[str] = []
    monkeypatch.setattr(reset_module.neon, "ensure_branch", lambda *_: "branch")
    monkeypatch.setattr(reset_module.neon, "first_database", lambda *_: "database")
    monkeypatch.setattr(reset_module.neon, "owner_uri", lambda *_, **__: "postgres://direct")

    async def emptied(_: StorageLocation) -> int:
        steps.append("empty objects")
        return 0

    def ran(argv: Sequence[str], _: str | None, extra: Mapping[str, str] | None) -> None:
        steps.append(argv[-1])
        assert extra is not None
        if argv[-1] != "head":
            assert extra["STORAGE_BUCKET"] == environment("production").slide_bucket
            assert extra["APP_ENV"] == "prod"

    def statement(_: str, sql: str) -> list[Any]:
        steps.append("truncate" if "TRUNCATE" in sql else sql)
        return []

    monkeypatch.setattr(reset_module, "empty_tenant_objects", emptied)
    tools = Tools(run=ran, read=lambda _: "", sql=statement, neon=None, fetch=lambda _: (200, {}))  # type: ignore[arg-type]
    settings: dict[str, str] = dict.fromkeys(RESET_SETTINGS, "x")

    def drained(target: Environment) -> None:
        steps.append(f"start ingest in {target.modal_environment}")

    reset_module.reset(environment("production"), tools, settings, drained)
    assert steps == [
        MIGRATE[-1],
        "parfocal_ingest.fixture_slides",
        "truncate",
        "empty objects",
        "parfocal_api.showcase",
        "start ingest in main",
    ]


def test_the_truncate_keeps_migrations_and_operators() -> None:
    statement = truncate_statement()
    truncated = set(statement.removeprefix("TRUNCATE ").split(" RESTART")[0].split(", "))
    assert truncated == {table.name for table in metadata.sorted_tables} - KEPT_TABLES
    assert "slides" in truncated


def test_the_gallery_covers_every_ingest_format_but_the_unseeded() -> None:
    assert set(Format) - UNSEEDED_FORMATS <= {slide.format for slide in FORMAT_GALLERY}
