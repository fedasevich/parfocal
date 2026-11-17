import asyncio
import json
import os
import sys
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

import httpx2

from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import StorageSettings, load_settings

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = ROOT / "packages/test-fixtures/fixtures.json"
GROUP = "small"
PREFIX = "fixtures/"


def fixtures_dir(environ: Mapping[str, str]) -> Path:
    override = environ.get("PARFOCAL_FIXTURES_DIR")
    if override:
        return Path(override)
    cache = environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(cache) / "parfocal" / "fixtures"


def small_files(manifest: Mapping[str, Any]) -> list[str]:
    return [entry["file"] for entry in manifest["remote"] if GROUP in entry.get("groups", [])]


def missing_locally(names: Iterable[str], folder: Path) -> list[str]:
    return [name for name in names if not (folder / name).is_file()]


async def copy_into(store: ObjectStore, names: Iterable[str], folder: Path) -> list[str]:
    copied: list[str] = []
    for name in names:
        key = f"{PREFIX}{name}"
        if await store.head_object(key) is not None:
            continue
        await store.put_object(key, (folder / name).read_bytes(), "application/octet-stream")
        copied.append(key)
    return copied


async def main() -> int:
    names = small_files(json.loads(MANIFEST.read_text()))
    folder = fixtures_dir(os.environ)
    missing = missing_locally(names, folder)
    if missing:
        print(f"Run pnpm fixtures small first, {', '.join(missing)} not in {folder}")
        return 1
    settings = load_settings(StorageSettings)
    async with httpx2.AsyncClient(timeout=60) as http:
        store = ObjectStore(settings.storage(), http)
        await store.create_bucket()
        copied = await copy_into(store, names, folder)
    print(f"{len(copied)} small fixtures copied, {len(names) - len(copied)} already there")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
