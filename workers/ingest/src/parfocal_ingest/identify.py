import zipfile
from dataclasses import dataclass
from enum import StrEnum
from pathlib import PurePosixPath
from typing import BinaryIO

import tifffile

HEAD_BYTES = 4096
TIFF_MAGIC = (b"II*\x00", b"MM\x00*")
BIGTIFF_MAGIC = (b"II+\x00", b"MM\x00+")
OLE_MAGIC = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"
APERIO_JPEG2000 = {33003: "jpeg2000-ycbcr", 33005: "jpeg2000-rgb"}


class Format(StrEnum):
    APERIO_SVS = "aperio-svs"
    HAMAMATSU_NDPI = "hamamatsu-ndpi"
    LEICA_SCN = "leica-scn"
    VENTANA_BIF = "ventana-bif"
    PHILIPS_TIFF = "philips-tiff"
    HURON_TIFF = "huron-tiff"
    ARGOS_AVS = "argos-avs"
    OME_TIFF = "ome-tiff"
    GENERIC_TIFF = "generic-tiff"
    MIRAX = "mirax"
    DICOM = "dicom"


class Refusal(StrEnum):
    EMPTY = "empty"
    MULTI_FILE = "multi-file"
    ZEISS_CZI = "zeiss-czi"
    ZEISS_ZVI = "zeiss-zvi"
    PHILIPS_ISYNTAX = "philips-isyntax"
    PLAIN_IMAGE = "plain-image"
    DAMAGED_TIFF = "damaged-tiff"
    ARCHIVE_WITHOUT_SLIDE = "archive-without-slide"
    UNKNOWN = "unknown"


REASONS = {
    Refusal.EMPTY: "The file is empty.",
    Refusal.MULTI_FILE: (
        "This slide is made of several files. Put the whole slide folder in one .zip and upload "
        "that."
    ),
    Refusal.ZEISS_CZI: "Zeiss CZI files are not supported. Export the slide as OME-TIFF.",
    Refusal.ZEISS_ZVI: "Zeiss ZVI files are not supported. Export the slide as OME-TIFF.",
    Refusal.PHILIPS_ISYNTAX: (
        "Philips iSyntax is a closed format. Export the slide from the Philips system as TIFF."
    ),
    Refusal.PLAIN_IMAGE: "This is an ordinary picture, not a whole slide image.",
    Refusal.DAMAGED_TIFF: "The file looks like a TIFF but cannot be read. It may be damaged.",
    Refusal.ARCHIVE_WITHOUT_SLIDE: "The .zip holds no slide that Parfocal can read.",
    Refusal.UNKNOWN: "Parfocal does not recognise this file as a whole slide image.",
}

MULTI_FILE_SUFFIXES = {".mrxs", ".vms", ".vmu", ".vsi", ".ets"}


@dataclass(frozen=True)
class Identified:
    format: Format | None
    variant: str | None = None
    refusal: Refusal | None = None

    @property
    def reason(self) -> str | None:
        return REASONS[self.refusal] if self.refusal else None


def refused(refusal: Refusal) -> Identified:
    return Identified(None, None, refusal)


def tiff_format(tiff: tifffile.TiffFile) -> Format:
    flags = tiff.flags
    page = tiff.pages.first
    description = page.description or ""
    software = str(page.tags.valueof("Software") or "")
    if "svs" in flags or description.startswith("Aperio"):
        return Format.APERIO_SVS
    if "ndpi" in flags or software.startswith("NDP"):
        return Format.HAMAMATSU_NDPI
    if "scn" in flags or "<scn" in description:
        return Format.LEICA_SCN
    if "bif" in flags or software.startswith("ScanOutputManager"):
        return Format.VENTANA_BIF
    if "philips" in flags or software.startswith("Philips"):
        return Format.PHILIPS_TIFF
    if software.startswith("MACROscan"):
        return Format.HURON_TIFF
    if "avs" in flags:
        return Format.ARGOS_AVS
    if "ome" in flags or "<OME" in description:
        return Format.OME_TIFF
    return Format.GENERIC_TIFF


def tiff_variant(tiff: tifffile.TiffFile, found: Format) -> str:
    container = "bigtiff" if tiff.is_bigtiff else "tiff"
    if found is Format.APERIO_SVS:
        compression = int(tiff.pages.first.compression)
        return APERIO_JPEG2000.get(compression, "jpeg" if compression == 7 else container)
    return container


def identify_tiff(handle: BinaryIO) -> Identified:
    handle.seek(0)
    try:
        with tifffile.TiffFile(handle) as tiff:
            found = tiff_format(tiff)
            return Identified(found, tiff_variant(tiff, found))
    except tifffile.TiffFileError, ValueError, OSError, IndexError:
        return refused(Refusal.DAMAGED_TIFF)


def identify_zip(handle: BinaryIO) -> Identified:
    handle.seek(0)
    try:
        with zipfile.ZipFile(handle) as archive:
            names = [PurePosixPath(name) for name in archive.namelist() if not name.endswith("/")]
    except zipfile.BadZipFile:
        return refused(Refusal.UNKNOWN)
    files = [name for name in names if not name.name.startswith(".")]
    if any(name.suffix.lower() == ".mrxs" for name in files) and any(
        name.name.lower() == "slidedat.ini" for name in files
    ):
        return Identified(Format.MIRAX, "zip")
    dicom = [name for name in files if name.suffix.lower() == ".dcm" or name.name == "DICOMDIR"]
    if dicom and len(dicom) == len(files):
        return Identified(Format.DICOM, "zip")
    return refused(Refusal.ARCHIVE_WITHOUT_SLIDE)


def identify_head(head: bytes, file_name: str) -> Identified | None:
    suffix = PurePosixPath(file_name).suffix.lower()
    if not head:
        return refused(Refusal.EMPTY)
    if suffix in MULTI_FILE_SUFFIXES:
        return refused(Refusal.MULTI_FILE)
    if head.startswith(b"ZISRAWFILE"):
        return refused(Refusal.ZEISS_CZI)
    if head.startswith(OLE_MAGIC):
        return refused(Refusal.ZEISS_ZVI)
    if b"DPUfsImport" in head and not head.startswith(TIFF_MAGIC + BIGTIFF_MAGIC):
        return refused(Refusal.PHILIPS_ISYNTAX)
    if len(head) >= 132 and head[128:132] == b"DICM":
        return Identified(Format.DICOM, "file")
    if head.startswith((b"\xff\xd8\xff", b"\x89PNG\r\n\x1a\n", b"GIF8", b"BM")):
        return refused(Refusal.PLAIN_IMAGE)
    return None


def identify(handle: BinaryIO, file_name: str) -> Identified:
    handle.seek(0)
    head = handle.read(HEAD_BYTES)
    early = identify_head(head, file_name)
    if early is not None:
        return early
    if head.startswith(TIFF_MAGIC + BIGTIFF_MAGIC):
        return identify_tiff(handle)
    if head.startswith(b"PK\x03\x04"):
        return identify_zip(handle)
    return refused(Refusal.UNKNOWN)
