import zipfile
from pathlib import Path

import tifffile

from parfocal_ingest.identify import Format, Identified, Refusal

TIFF_FORMATS = frozenset(
    {
        Format.APERIO_SVS,
        Format.HAMAMATSU_NDPI,
        Format.LEICA_SCN,
        Format.VENTANA_BIF,
        Format.PHILIPS_TIFF,
        Format.HURON_TIFF,
        Format.ARGOS_AVS,
        Format.OME_TIFF,
        Format.GENERIC_TIFF,
    }
)


def check_tiff(path: Path) -> Refusal | None:
    size = path.stat().st_size
    try:
        with tifffile.TiffFile(path) as tiff:
            for page in tiff.pages:
                if not isinstance(page, tifffile.TiffPage):
                    continue
                for offset, count in zip(page.dataoffsets, page.databytecounts, strict=False):
                    if count and offset + count > size:
                        return Refusal.TRUNCATED
    except tifffile.TiffFileError, ValueError, OSError, IndexError:
        return Refusal.DAMAGED_TIFF
    return None


def check_zip(path: Path) -> Refusal | None:
    try:
        with zipfile.ZipFile(path) as archive:
            return Refusal.DAMAGED_ARCHIVE if archive.testzip() is not None else None
    except zipfile.BadZipFile, OSError, EOFError:
        return Refusal.DAMAGED_ARCHIVE


def check_integrity(path: Path, identified: Identified) -> Refusal | None:
    if identified.format is None:
        return identified.refusal or Refusal.UNKNOWN
    if identified.variant == "zip":
        return check_zip(path)
    if identified.format in TIFF_FORMATS:
        return check_tiff(path)
    return None
