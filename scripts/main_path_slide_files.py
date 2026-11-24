import argparse
import asyncio
import json
import shutil
from pathlib import Path, PurePosixPath

import httpx2

from parfocal_common.ingest import RESTRICTED_RANGES_NAME, fixture_original_key, folder_of
from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import load_settings
from parfocal_ingest.sample_files import DerivedFile, derived_files, opened
from parfocal_ingest.settings import IngestSettings


async def send_ranges(key: str, derived: list[DerivedFile]) -> None:
    ranges = next(item for item in derived if item.name == RESTRICTED_RANGES_NAME)
    settings = load_settings(IngestSettings)
    async with httpx2.AsyncClient(timeout=120) as http:
        store = ObjectStore(settings.storage(), http)
        await store.put_object(f"{folder_of(key)}{ranges.name}", ranges.body, ranges.content_type)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Write a slide and the files the ingest derives from it into one folder"
    )
    parser.add_argument("slide", type=Path)
    parser.add_argument("folder", type=Path)
    parser.add_argument("--send-ranges", action="store_true")
    arguments = parser.parse_args()
    slide: Path = arguments.slide
    folder: Path = arguments.folder
    folder.mkdir(parents=True, exist_ok=True)
    identified, found = opened(slide)
    key = fixture_original_key(slide.name)
    original = PurePosixPath(key).name
    shutil.copyfile(slide, folder / original)
    listed = [
        {
            "name": original,
            "content_type": "application/octet-stream",
            "content_encoding": None,
        }
    ]
    derived = derived_files(slide, slide, identified, found)
    for item in derived:
        (folder / item.name).write_bytes(item.body)
        listed.append(
            {
                "name": item.name,
                "content_type": item.content_type,
                "content_encoding": item.content_encoding,
            }
        )
    if arguments.send_ranges:
        asyncio.run(send_ranges(key, derived))
    base = json.loads((folder / "levels.json").read_text())["levels"][0]
    print(
        json.dumps(
            {
                "key": key,
                "format": str(identified.format),
                "bytes": slide.stat().st_size,
                "size": f"{base['width']}x{base['height']}",
                "files": listed,
            }
        )
    )


if __name__ == "__main__":
    main()
