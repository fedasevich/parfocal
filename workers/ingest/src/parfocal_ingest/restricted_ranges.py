import json
from collections.abc import Iterable, Iterator
from pathlib import Path

import tifffile

from parfocal_ingest.pyramid import main_series

type ByteRange = tuple[int, int]

WHOLE_FILE_SUFFIXES = frozenset({".dcm", ".zip"})


def merged(ranges: Iterable[ByteRange]) -> list[ByteRange]:
    result: list[ByteRange] = []
    for start, end in sorted(ranges):
        if result and start <= result[-1][1]:
            result[-1] = (result[-1][0], max(result[-1][1], end))
        else:
            result.append((start, end))
    return result


def data_ranges(series: tifffile.TiffPageSeries) -> Iterator[ByteRange]:
    for level in series.levels:
        for page in level.pages:
            if page is None:
                continue
            for offset, count in zip(page.dataoffsets, page.databytecounts, strict=True):
                if count > 0:
                    yield offset, offset + count


def outside_the_pyramid(path: Path) -> list[ByteRange] | None:
    with tifffile.TiffFile(path) as tiff:
        pyramid = main_series(tiff)
        if pyramid is None:
            return None
        return merged(
            span for series in tiff.series if series is not pyramid for span in data_ranges(series)
        )


def restricted_ranges(path: Path) -> list[ByteRange]:
    whole = [(0, path.stat().st_size)]
    if path.suffix.lower() in WHOLE_FILE_SUFFIXES:
        return whole
    try:
        found = outside_the_pyramid(path)
    except tifffile.TiffFileError, ValueError:
        return whole
    return whole if found is None else found


def ranges_document(ranges: list[ByteRange]) -> bytes:
    return json.dumps({"ranges": [list(span) for span in ranges]}).encode()
