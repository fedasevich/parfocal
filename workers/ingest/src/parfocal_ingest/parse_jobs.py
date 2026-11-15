import json
import shutil
from collections.abc import Callable, Mapping
from pathlib import Path
from typing import Any

import openslide
import tifffile
from PIL import UnidentifiedImageError
from wsidicom.errors import WsiDicomError

from parfocal_common.jobs import StepFailedError
from parfocal_ingest.identify import Format, Identified, Refusal, identify
from parfocal_ingest.integrity import check_integrity
from parfocal_ingest.isolated_child import ScopedStorage
from parfocal_ingest.pyramid import read_pyramid, unpack

READER_ERRORS = (
    openslide.OpenSlideError,
    tifffile.TiffFileError,
    UnidentifiedImageError,
    WsiDicomError,
)


def identify_file(path: Path, name: str) -> Identified:
    with path.open("rb") as handle:
        return identify(handle, name)


def identified_in(arguments: Mapping[str, Any]) -> Identified:
    return Identified(Format(arguments["format"]), arguments.get("variant"))


def unpacked_in(folder: Path, local: Path, identified: Identified) -> Path:
    if identified.variant != "zip" or identified.format is None:
        return local
    target = folder / "unpacked"
    marker = folder / "unpacked.json"
    if marker.exists():
        return target / json.loads(marker.read_text())["path"]
    shutil.rmtree(target, ignore_errors=True)
    target.mkdir(parents=True)
    found = unpack(local, target, identified.format)
    if isinstance(found, Refusal):
        raise StepFailedError(found)
    marker.write_text(json.dumps({"path": str(found.relative_to(target))}))
    return found


def reading(body: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        return body()
    except READER_ERRORS as error:
        raise StepFailedError(Refusal.UNREADABLE) from error


def identify_upload(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    def body() -> dict[str, Any]:
        found = identify_file(storage.fetch(arguments["key"]), arguments["name"])
        if found.format is None:
            raise StepFailedError(found.refusal or Refusal.UNKNOWN)
        return {"format": found.format.value, "variant": found.variant}

    return reading(body)


def scan_upload(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    def body() -> dict[str, Any]:
        refusal = check_integrity(storage.fetch(arguments["key"]), identified_in(arguments))
        if refusal is not None:
            raise StepFailedError(refusal)
        return {"clean": True}

    return reading(body)


def validate_upload(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    def body() -> dict[str, Any]:
        local = storage.fetch(arguments["key"])
        identified = identified_in(arguments)
        found = read_pyramid(unpacked_in(local.parent, local, identified), identified)
        if isinstance(found, Refusal):
            raise StepFailedError(found)
        base = found.levels[0]
        return {
            "reader": found.reader.value,
            "width": base.width,
            "height": base.height,
            "levels": len(found.levels),
            "mpp_x": found.scale.mpp_x,
            "mpp_y": found.scale.mpp_y,
            "objective_power": found.scale.objective_power,
            "notices": [notice.value for notice in found.notices],
        }

    return reading(body)
