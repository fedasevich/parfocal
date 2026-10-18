import io
import zipfile
from pathlib import Path

import pytest
from fixture_support import fixture_path

from parfocal_ingest.identify import Format, Identified, Refusal, identify

CORPUS = [
    ("CMU-1-Small-Region.svs", Format.APERIO_SVS, "jpeg"),
    ("CMU-1.svs", Format.APERIO_SVS, "jpeg"),
    ("CMU-2.svs", Format.APERIO_SVS, "jpeg"),
    ("JP2K-33003-1.svs", Format.APERIO_SVS, "jpeg2000-ycbcr"),
    ("JP2K-33003-2.svs", Format.APERIO_SVS, "jpeg2000-ycbcr"),
    ("CMU-1-JP2K-33005.svs", Format.APERIO_SVS, "jpeg2000-rgb"),
    ("CMU-1.tiff", Format.GENERIC_TIFF, "tiff"),
    ("CMU-1.ndpi", Format.HAMAMATSU_NDPI, "tiff"),
    ("OS-1.ndpi", Format.HAMAMATSU_NDPI, "tiff"),
    ("Leica-1.scn", Format.LEICA_SCN, "bigtiff"),
    ("Leica-3.scn", Format.LEICA_SCN, "bigtiff"),
    ("Ventana-1.bif", Format.VENTANA_BIF, "bigtiff"),
    ("OS-1.bif", Format.VENTANA_BIF, "bigtiff"),
    ("Huron-1-40x.tif", Format.HURON_TIFF, "bigtiff"),
    ("Huron-1-Uncompressed.tif", Format.HURON_TIFF, "bigtiff"),
    ("Argos-1.avs", Format.ARGOS_AVS, "bigtiff"),
    ("Argos-1-Stacked.avs", Format.ARGOS_AVS, "bigtiff"),
    ("Philips-4.tiff", Format.PHILIPS_TIFF, "bigtiff"),
    ("Philips-3.tiff", Format.PHILIPS_TIFF, "bigtiff"),
    ("tumor_009.tif", Format.PHILIPS_TIFF, "bigtiff"),
    ("CMU-1-Saved-1_16.zip", Format.MIRAX, "zip"),
    ("CMU-1-JP2K-33005-v2.zip", Format.DICOM, "zip"),
    ("Leica-4.zip", Format.DICOM, "zip"),
    ("synthetic-jpeg.tiff", Format.GENERIC_TIFF, "tiff"),
    ("synthetic-zlib.ome.tiff", Format.OME_TIFF, "tiff"),
]


def identified(path: Path) -> Identified:
    with path.open("rb") as handle:
        return identify(handle, path.name)


@pytest.mark.parametrize(("name", "expected", "variant"), CORPUS)
def test_every_fixture_is_identified(name: str, expected: Format, variant: str) -> None:
    result = identified(fixture_path(name))
    assert (result.format, result.variant, result.refusal) == (expected, variant, None)


def test_a_czi_fixture_is_refused_with_a_reason() -> None:
    result = identified(fixture_path("Zeiss-5-Flat.czi"))
    assert (result.format, result.refusal) == (None, Refusal.ZEISS_CZI)
    assert result.reason == "Zeiss CZI files are not supported. Export the slide as OME-TIFF."


def zipped(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in files.items():
            archive.writestr(name, data)
    return buffer.getvalue()


@pytest.mark.parametrize(
    ("name", "data", "refusal"),
    [
        ("empty.svs", b"", Refusal.EMPTY),
        ("slide.mrxs", b"\xff\xd8\xff\xe0 JFIF thumbnail", Refusal.MULTI_FILE),
        ("slide.vsi", b"II*\x00" + b"\x00" * 64, Refusal.MULTI_FILE),
        ("slide.vms", b"[Virtual Microscope Specimen]", Refusal.MULTI_FILE),
        ("slide.czi", b"ZISRAWFILE" + b"\x00" * 64, Refusal.ZEISS_CZI),
        ("slide.zvi", b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\x00" * 64, Refusal.ZEISS_ZVI),
        (
            "slide.isyntax",
            b'<?xml version="1.0"?><DataObject ObjectType="DPUfsImport">',
            Refusal.PHILIPS_ISYNTAX,
        ),
        ("photo.jpg", b"\xff\xd8\xff\xe0\x00\x10JFIF", Refusal.PLAIN_IMAGE),
        ("photo.png", b"\x89PNG\r\n\x1a\n" + b"\x00" * 16, Refusal.PLAIN_IMAGE),
        ("cut.svs", b"II*\x00\x08\x00\x00\x00\xff\xff", Refusal.DAMAGED_TIFF),
        ("notes.zip", zipped({"notes.txt": b"hello"}), Refusal.ARCHIVE_WITHOUT_SLIDE),
        ("report.pdf", b"%PDF-1.7\n", Refusal.UNKNOWN),
    ],
)
def test_unsupported_files_are_refused_with_a_named_reason(
    name: str, data: bytes, refusal: Refusal
) -> None:
    result = identify(io.BytesIO(data), name)
    assert (result.format, result.refusal) == (None, refusal)
    assert result.reason


def test_a_single_dicom_file_is_identified_by_its_preamble() -> None:
    data = b"\x00" * 128 + b"DICM" + b"\x00" * 64
    assert identify(io.BytesIO(data), "image.dcm") == Identified(Format.DICOM, "file")
