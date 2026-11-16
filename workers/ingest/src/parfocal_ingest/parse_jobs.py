import gzip
import json
import shutil
from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import openslide
import tifffile
from PIL import UnidentifiedImageError
from wsidicom.errors import WsiDicomError

from parfocal_common.jobs import StepFailedError
from parfocal_ingest.associated import associated_images
from parfocal_ingest.identify import Format, Identified, Refusal, identify
from parfocal_ingest.identifying_text import ranges_file
from parfocal_ingest.integrity import check_integrity
from parfocal_ingest.isolated_child import ScopedStorage
from parfocal_ingest.overview_levels import OVERVIEW_LEVELS_NAME, overview_levels
from parfocal_ingest.pyramid import Pyramid, read_pyramid, unpack
from parfocal_ingest.thumbnail import previews
from parfocal_ingest.tile_index import index_document, tile_index
from parfocal_ingest.tissue import tissue_mask

READER_ERRORS = (
    openslide.OpenSlideError,
    tifffile.TiffFileError,
    UnidentifiedImageError,
    WsiDicomError,
)
LEVELS_OUTPUT = "levels.json"
TILE_INDEX_OUTPUT = "tile-index.json.gz"
THUMBNAIL_OUTPUT = "thumbnail.jpg"
OVERVIEW_OUTPUT = "overview.jpg"
TISSUE_OUTPUT = "tissue.png"
RANGES_OUTPUT = "ranges.json"


@dataclass(frozen=True)
class Opened:
    local: Path
    path: Path
    identified: Identified
    pyramid: Pyramid


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


def level_table(found: Pyramid) -> bytes:
    return json.dumps(asdict(found), separators=(",", ":")).encode()


def restricted_output(kind: str) -> str:
    return f"restricted-{kind}"


def opened_in(arguments: Mapping[str, Any], storage: ScopedStorage) -> Opened:
    local = storage.fetch(arguments["key"])
    identified = identified_in(arguments)
    path = unpacked_in(local.parent, local, identified)
    found = read_pyramid(path, identified)
    if isinstance(found, Refusal):
        raise StepFailedError(found)
    return Opened(local, path, identified, found)


def index_upload(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    def body() -> dict[str, Any]:
        opened = opened_in(arguments, storage)
        out = Path(arguments["out"])
        (out / LEVELS_OUTPUT).write_bytes(level_table(opened.pyramid))
        tiles = tile_index(opened.path, opened.identified, opened.pyramid)
        derived = None
        if tiles is not None and opened.identified.format is not None:
            derived = overview_levels(opened.path, opened.identified.format, opened.pyramid)
        if tiles is not None and derived is not None:
            (out / OVERVIEW_LEVELS_NAME).write_bytes(derived.data)
            tiles["overviewLevels"] = derived.reference()
        if tiles is not None:
            document = gzip.compress(index_document(tiles), mtime=0)
            (out / TILE_INDEX_OUTPUT).write_bytes(document)
        return {
            "levels": len(opened.pyramid.levels),
            "overview_levels": None if derived is None else list(derived.downsamples),
        }

    return reading(body)


def derive_upload(arguments: Mapping[str, Any], storage: ScopedStorage) -> dict[str, Any]:
    def body() -> dict[str, Any]:
        opened = opened_in(arguments, storage)
        found = opened.identified.format
        if found is None:
            raise StepFailedError(Refusal.UNKNOWN)
        out = Path(arguments["out"])
        facts: dict[str, Any] = {}
        if arguments.get("previews"):
            images = previews(opened.path, found, opened.pyramid)
            (out / THUMBNAIL_OUTPUT).write_bytes(images.thumbnail)
            (out / OVERVIEW_OUTPUT).write_bytes(images.overview)
        if arguments.get("tissue"):
            mask = tissue_mask(opened.path, found, opened.pyramid)
            (out / TISSUE_OUTPUT).write_bytes(mask.png())
            facts["tissue"] = {
                "cell": mask.cell,
                "threshold": mask.threshold,
                "fraction": mask.fraction,
                "box": mask.box.facts() if mask.box else None,
            }
        if arguments.get("restricted"):
            for image in associated_images(opened.path, opened.pyramid):
                (out / restricted_output(image.kind.value)).write_bytes(image.data)
        (out / RANGES_OUTPUT).write_bytes(ranges_file(opened.local))
        return facts

    return reading(body)
