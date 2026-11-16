import json
from pathlib import Path

import numpy as np
import tifffile

from parfocal_ingest.identifying_text import identifying_text, ranges_file
from parfocal_ingest.restricted_ranges import ByteRange

NAME = b"Novakova_Jana_S26-4711"
BARCODE = b"BC-99812"
SVS_DESCRIPTION = (
    "Aperio Image Library v12.0.15\r\n512x512 [0,0 512x512] (256x256) JPEG/RGB Q=70"
    f"|AppMag = 20|StripeWidth = 2040|Filename = {NAME.decode()}|Date = 03/14/26"
    "|User = jana.novakova|MPP = 0.4990"
)
SCN_DESCRIPTION = (
    '<?xml version="1.0" encoding="utf-8"?>'
    '<scn xmlns="http://www.leica-microsystems.com/scn/2010/10/01">'
    f'<collection name="{NAME.decode()}" uuid="u" sizeX="1" sizeY="1">'
    f"<barcode>{BARCODE.decode()}</barcode>"
    '<image name="main" uuid="v"><creationDate>2026-03-14T09:00:00Z</creationDate>'
    "</image></collection></scn>"
)
PHILIPS_DESCRIPTION = (
    '<?xml version="1.0" encoding="UTF-8" ?><DataObject ObjectType="DPUfsImport">'
    f'<Attribute Name="DICOM_PATIENT_NAME" Group="0x0010" Element="0x0010">{NAME.decode()}'
    "</Attribute>"
    '<Attribute Name="DICOM_ACCESSION_NUMBER" Group="0x0008" Element="0x0050">S26-4711</Attribute>'
    f'<Attribute Name="PIM_DP_UFS_BARCODE" Group="0x301D" Element="0x1002">{BARCODE.decode()}'
    "</Attribute>"
    '<Attribute Name="DICOM_PIXEL_SPACING" Group="0x0028" Element="0x0030">"0.25" "0.25"'
    "</Attribute></DataObject>"
)


type ExtraTag = tuple[int, str, int, str, bool]


def write_tiff(
    path: Path,
    description: str,
    software: str | None = None,
    extratags: list[ExtraTag] | None = None,
) -> bytes:
    pixels = np.random.default_rng(3).integers(0, 255, (512, 512, 3), dtype=np.uint8)
    with tifffile.TiffWriter(path) as tiff:
        tiff.write(
            pixels,
            photometric="rgb",
            tile=(256, 256),
            description=description,
            metadata=None,
            software=software,
            extratags=extratags or [],
        )
        tiff.write(pixels[::2, ::2], photometric="rgb", description=description, metadata=None)
    return path.read_bytes()


def text_in(data: bytes, ranges: list[ByteRange]) -> bytes:
    return b"".join(data[start:end] for start, end in ranges)


def blanked(data: bytes, ranges: list[ByteRange]) -> bytes:
    out = bytearray(data)
    for start, end in ranges:
        out[start:end] = b" " * (end - start)
    return bytes(out)


def test_an_svs_description_closes_the_file_name_user_and_date_and_keeps_the_scale(
    tmp_path: Path,
) -> None:
    path = tmp_path / "original.svs"
    data = write_tiff(path, SVS_DESCRIPTION)
    found = identifying_text(path)
    assert found.barcode == []
    assert len(found.identifying) == 6
    hidden = blanked(data, found.identifying)
    assert NAME not in hidden
    assert b"jana.novakova" not in hidden
    assert b"03/14/26" not in hidden
    clean = tmp_path / "clean.svs"
    clean.write_bytes(hidden)
    with tifffile.TiffFile(clean) as tiff:
        assert tiff.is_svs
        description = tiff.pages.first.description
        assert "MPP = 0.4990" in description
        assert "AppMag = 20" in description
        assert np.array_equal(tiff.pages.first.asarray(), tifffile.imread(path))


def test_a_leica_scn_header_names_its_barcode_apart_from_other_identifying_text(
    tmp_path: Path,
) -> None:
    path = tmp_path / "original.scn"
    data = write_tiff(path, SCN_DESCRIPTION)
    found = identifying_text(path)
    assert {data[start:end] for start, end in found.barcode} == {BARCODE}
    names = text_in(data, found.identifying)
    assert NAME in names
    assert b"main" in names
    assert BARCODE not in names


def test_philips_patient_accession_and_barcode_attributes_close_and_the_spacing_stays(
    tmp_path: Path,
) -> None:
    path = tmp_path / "original.tiff"
    data = write_tiff(path, PHILIPS_DESCRIPTION, software="Philips DP v1.0")
    found = identifying_text(path)
    assert {data[start:end] for start, end in found.barcode} == {BARCODE}
    hidden = blanked(data, found.identifying)
    assert NAME not in hidden
    assert b"S26-4711" not in hidden
    assert b'"0.25" "0.25"' in hidden


def test_whole_name_tags_and_the_ndpi_reference_close(tmp_path: Path) -> None:
    path = tmp_path / "original.tiff"
    data = write_tiff(
        path,
        "plain",
        extratags=[
            (269, "s", 0, NAME.decode(), True),
            (315, "s", 0, "Dr Novak", True),
            (65427, "s", 0, BARCODE.decode(), True),
        ],
    )
    found = identifying_text(path)
    assert text_in(data, found.barcode) == BARCODE
    assert set(text_in(data, found.identifying).split(b"Dr Novak")) <= {NAME, b""}
    assert b"plain" in blanked(data, found.identifying + found.barcode)


def test_the_ranges_file_holds_closed_identifying_and_barcode_ranges(tmp_path: Path) -> None:
    path = tmp_path / "original.scn"
    write_tiff(path, SCN_DESCRIPTION)
    document = json.loads(ranges_file(path))
    assert set(document) == {"ranges", "identifying", "barcode"}
    assert document["barcode"]
    assert document["identifying"]


def test_a_file_that_is_not_a_tiff_has_no_identifying_text(tmp_path: Path) -> None:
    path = tmp_path / "original.dcm"
    path.write_bytes(b"DICM" * 100)
    found = identifying_text(path)
    assert (found.identifying, found.barcode) == ([], [])
