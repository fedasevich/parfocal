import os
import sys
from pathlib import Path

from parfocal_ingest.conversion import Chunks, write_store

STORES = {
    "CMU-1-Small-Region.ome.zarr": ("CMU-1-Small-Region.svs", None),
    "CMU-1-Small-Region-zstd.ome.zarr": ("CMU-1-Small-Region.svs", Chunks.ZSTD),
}


def cache_dir() -> Path:
    override = os.environ.get("PARFOCAL_FIXTURES_DIR")
    if override:
        return Path(override)
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "parfocal" / "fixtures"


def main() -> None:
    cache = cache_dir()
    folder = cache / "converted"
    folder.mkdir(parents=True, exist_ok=True)
    for name, (slide, chunks) in STORES.items():
        source = cache / slide
        if not (cache / f"{slide}.sha256").exists():
            raise SystemExit(f"{slide} is not downloaded, run: pnpm fixtures small")
        store = folder / name
        done = write_store(source, store, folder / f"{name}.work", chunks=chunks)
        print(f"wrote {len(done.levels)} levels of {done.chunks} chunks to {done.store}")


if __name__ == "__main__":
    sys.exit(main())
