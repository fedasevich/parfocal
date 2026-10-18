from pathlib import Path

from fixture_support import fixture_path

from parfocal_ingest.identify import Identified, Refusal, identify
from parfocal_ingest.pyramid import unpack


def opened(name: str, workdir: Path) -> tuple[Path, Identified] | Refusal:
    path = fixture_path(name)
    with path.open("rb") as handle:
        found = identify(handle, path.name)
    if found.variant == "zip" and found.format is not None:
        unpacked = unpack(path, workdir, found.format)
        if isinstance(unpacked, Refusal):
            return unpacked
        path = unpacked
    return path, found
