import json
from pathlib import Path

import numpy as np
import openslide
import pytest
import tifffile
from fixture_support import fixture_path

from parfocal_common.ingest import fixture_folder, fixture_original_key, served_fixture
from parfocal_ingest.cell_crops import cut_from
from parfocal_ingest.conversion import FIRED, Trigger, format_trigger
from parfocal_ingest.fixture_slides import write_folder
from parfocal_ingest.identify import Format
from parfocal_ingest.parse_jobs import identify_file
from parfocal_ingest.pyramid import Pyramid, read_pyramid
from parfocal_ingest.pyramid_tiff import CONVERTED_VARIANT, convert_original
from parfocal_ingest.source_levels import UnconvertibleError
from parfocal_ingest.thumbnail import background_of, flattened

MIRAX = "CMU-1-Saved-1_16.zip"
DICOM = "CMU-1-JP2K-33005-v2.zip"
WINDOW = 512


@pytest.fixture(scope="module")
def mirax(tmp_path_factory: pytest.TempPathFactory) -> tuple[Path, Path, Pyramid]:
    work = tmp_path_factory.mktemp("mirax")
    target = work / "original.tiff"
    _, source, done = convert_original(fixture_path(MIRAX), target, work / "work")
    assert done.trigger is Trigger.MIRAX_OR_DICOM
    return target, work / "work" / "source" / "unpacked", source


def test_only_mirax_and_dicom_are_converted_and_the_trigger_has_fired() -> None:
    assert Trigger.MIRAX_OR_DICOM in FIRED
    assert format_trigger(Format.MIRAX) is Trigger.MIRAX_OR_DICOM
    assert format_trigger(Format.DICOM) is Trigger.MIRAX_OR_DICOM
    assert {format_trigger(found) for found in Format} - {Trigger.MIRAX_OR_DICOM} == {None}
    assert format_trigger(Format.MIRAX, fired=()) is None


def test_a_slide_with_a_browser_reader_is_refused(tmp_path: Path) -> None:
    with pytest.raises(UnconvertibleError):
        convert_original(
            fixture_path("CMU-1-Small-Region.svs"), tmp_path / "x.tiff", tmp_path / "w"
        )


def test_zipped_fixtures_get_their_own_pyramid_folder() -> None:
    assert served_fixture(MIRAX) == f"{MIRAX}.pyramid.tiff"
    assert served_fixture("CMU-1.svs") == "CMU-1.svs"
    assert fixture_folder(MIRAX) == "fixture-slides/CMU-1-Saved-1_16-zip-pyramid-tiff/"
    assert fixture_original_key(DICOM) == (
        "fixture-slides/CMU-1-JP2K-33005-v2-zip-pyramid-tiff/original.tiff"
    )


def test_the_pyramid_tiff_keeps_every_source_level_pixel_for_pixel(
    mirax: tuple[Path, Path, Pyramid],
) -> None:
    target, unpacked, source = mirax
    identified = identify_file(target, target.name)
    assert identified.format is Format.GENERIC_TIFF
    found = read_pyramid(target, identified)
    assert isinstance(found, Pyramid)
    assert [(level.width, level.height) for level in found.levels] == [
        (level.width, level.height) for level in source.levels
    ]
    assert found.scale.mpp_x == pytest.approx(source.scale.mpp_x, rel=1e-9)
    assert found.levels[0].stored.compression == "deflate"
    slide_path = next(unpacked.rglob("*.mrxs"))
    with openslide.OpenSlide(slide_path) as slide, tifffile.TiffFile(target) as tiff:
        background = background_of(slide)
        for index, level in enumerate(source.levels):
            stored = tiff.pages[index].asarray()
            left = max(0, level.width // 2 - WINDOW // 2)
            top = max(0, level.height // 2 - WINDOW // 2)
            width, height = min(WINDOW, level.width), min(WINDOW, level.height)
            step = round(slide.level_downsamples[level.index])
            region = slide.read_region((left * step, top * step), level.index, (width, height))
            expected = np.asarray(flattened(region, background))
            assert np.array_equal(stored[top : top + height, left : left + width], expected)


def test_cell_crops_are_cut_from_the_pyramid_tiff(
    mirax: tuple[Path, Path, Pyramid], tmp_path: Path
) -> None:
    target, _, source = mirax
    middle = source.levels[0]
    cells = [[1, middle.width / 2, middle.height / 2], [2, 2500.0, 8000.0]]
    assert cut_from(target, cells, tmp_path) == 2
    assert sorted(path.name for path in tmp_path.iterdir()) == ["1.jpg", "2.jpg"]


def test_the_local_folder_holds_the_files_the_bucket_gets(tmp_path: Path) -> None:
    written = write_folder(MIRAX, fixture_path(MIRAX), tmp_path)
    assert {"original.tiff", "levels.json", "tile-index.json", "facts.json"} <= set(written)
    assert "original.zip" not in written
    facts = json.loads((tmp_path / "facts.json").read_text())
    assert facts["format"] == "mirax"
    assert facts["variant"] == CONVERTED_VARIANT
    assert facts["original_key"] == fixture_original_key(MIRAX)
    assert facts["file_bytes"] == (tmp_path / "original.tiff").stat().st_size
    assert facts["objective_power"] == 20.0
    assert json.loads((tmp_path / "restricted-ranges.json").read_text())["ranges"] == []
    index = json.loads((tmp_path / "tile-index.json").read_text())
    assert index["formatId"] == "generic-tiff"
