import io
import zipfile
from pathlib import Path

import pytest
from fixture_support import fixture_path

from parfocal_ingest.identify import Identified, Refusal, identify
from parfocal_ingest.integrity import check_integrity

EICAR = rb"X5O!P%@AP[4\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*"


def identified(path: Path) -> Identified:
    with path.open("rb") as handle:
        return identify(handle, path.name)


@pytest.mark.parametrize("name", ["eicar.com", "eicar.svs", "eicar.zip"])
def test_the_eicar_test_file_is_refused_as_not_a_slide(name: str, tmp_path: Path) -> None:
    path = tmp_path / name
    path.write_bytes(EICAR)
    found = identified(path)
    assert (found.format, found.refusal) == (None, Refusal.UNKNOWN)
    assert check_integrity(path, found) == Refusal.UNKNOWN
    assert found.reason == "Parfocal does not recognise this file as a whole slide image."


def test_a_truncated_tiff_fails_with_a_plain_reason(tmp_path: Path) -> None:
    whole = fixture_path("synthetic-jpeg.tiff")
    data = whole.read_bytes()
    cut = tmp_path / "cut.tiff"
    cut.write_bytes(data[: len(data) * 2 // 3])
    found = identified(cut)
    assert found.refusal is None
    refusal = check_integrity(cut, found)
    assert refusal == Refusal.TRUNCATED
    assert Identified(None, None, refusal).reason == (
        "The file is cut short, so parts of the slide are missing. Upload it again."
    )
    assert check_integrity(whole, identified(whole)) is None


@pytest.mark.parametrize(
    "name",
    [
        "CMU-1-Small-Region.svs",
        "synthetic-zlib.ome.tiff",
        "CMU-1-Saved-1_16.zip",
        "CMU-1.svs",
        "CMU-1.ndpi",
        "Leica-1.scn",
        "Philips-4.tiff",
        "Leica-4.zip",
    ],
)
def test_whole_fixtures_pass(name: str) -> None:
    path = fixture_path(name)
    assert check_integrity(path, identified(path)) is None


def test_a_damaged_zip_member_is_refused(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_STORED) as archive:
        archive.writestr("slide/Slidedat.ini", b"[GENERAL]\n" * 50)
        archive.writestr("slide/slide.mrxs", b"\xff\xd8\xff" + b"x" * 200)
    data = bytearray(buffer.getvalue())
    position = data.index(b"[GENERAL]")
    data[position] = ord("X")
    path = tmp_path / "slide.zip"
    path.write_bytes(bytes(data))
    found = identified(path)
    assert found.variant == "zip"
    assert check_integrity(path, found) == Refusal.DAMAGED_ARCHIVE
