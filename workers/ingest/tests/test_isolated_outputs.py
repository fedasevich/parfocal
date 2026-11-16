import shutil
from pathlib import Path

import numpy as np
import pytest

from parfocal_common.ingest import Failure, Refusal
from parfocal_common.jobs import StepFailedError
from parfocal_common.result_imports import ImportFailure
from parfocal_ingest.import_checks import SlideFrame
from parfocal_ingest.isolation import read_output
from parfocal_ingest.result_import import read_checked
from parfocal_ingest.result_wire import read_parse, write_parse

FRAME = SlideFrame(width=200_000, height=200_000)
RESULTS = Path(__file__).parent / "fixtures" / "results"


def written(tmp_path: Path, name: str) -> Path:
    source = tmp_path / name
    shutil.copyfile(RESULTS / name, source)
    out = tmp_path / "out"
    out.mkdir()
    parsed, tally = read_checked(source, None, FRAME)
    write_parse(out, parsed, tally)
    return out


def test_an_output_that_links_elsewhere_is_never_read(tmp_path: Path) -> None:
    secret = tmp_path / "environ"
    secret.write_text("DATABASE_URL=postgresql://secret")
    out = tmp_path / "out"
    out.mkdir()
    (out / "levels.json").symlink_to(secret)
    (tmp_path / "linked").symlink_to(out)
    with pytest.raises(StepFailedError) as linked_file:
        read_output(out, "levels.json")
    with pytest.raises(StepFailedError) as linked_folder:
        read_output(tmp_path / "linked", "levels.json")
    assert linked_file.value.code == linked_folder.value.code == Refusal.UNREADABLE
    with pytest.raises(ValueError, match="environ"):
        read_output(out, "../environ")


def test_an_output_over_its_limit_is_stopped(tmp_path: Path) -> None:
    (tmp_path / "big").write_bytes(b"x" * 11)
    assert read_output(tmp_path, "big", limit=11) == b"x" * 11
    with pytest.raises(StepFailedError) as stopped:
        read_output(tmp_path, "big", limit=10)
    assert stopped.value.code == Failure.PARSE_TOO_LARGE
    assert read_output(tmp_path, "missing") is None


@pytest.mark.parametrize("name", ["qupath-0.7-cells.geojson", "regions.geojson"])
def test_parsed_cells_and_shapes_cross_back_unchanged(tmp_path: Path, name: str) -> None:
    out = written(tmp_path, name)
    parsed, tally = read_checked(tmp_path / name, None, FRAME)
    facts, shapes, cells = read_parse(out)
    assert len(cells) + len(shapes) > 0
    assert len(cells) == len(parsed.cells)
    assert np.array_equal(cells.outlines.points, parsed.cells.outlines.points)
    assert np.array_equal(cells.outlines.centres, parsed.cells.outlines.centres)
    assert np.array_equal(cells.class_ids, parsed.cells.class_ids)
    assert cells.class_names == parsed.cells.class_names
    assert [item.geometry.wkt for item in shapes] == [item.geometry.wkt for item in parsed.shapes]
    assert (facts.tally.readable, facts.skipped) == (tally.readable, parsed.skipped)


def test_tampered_parse_outputs_are_refused_as_unreadable(tmp_path: Path) -> None:
    out = written(tmp_path, "qupath-0.7-cells.geojson")
    pristine = {path.name: path.read_bytes() for path in out.iterdir()}
    tampers = {
        "class_ids.npy": lambda path: np.save(path, np.array([{"x": 1}], dtype=object)),
        "offsets.npy": lambda path: np.save(path, np.array([0, 5, 2], dtype=np.int64)),
        "scores.npy": lambda path: np.save(path, np.zeros(3, dtype=np.float64)),
        "facts.msgpack": lambda path: path.write_bytes(b"\xc1"),
    }
    for name, tamper in tampers.items():
        for kept, data in pristine.items():
            (out / kept).write_bytes(data)
        tamper(out / name)
        with pytest.raises(StepFailedError) as refused:
            read_parse(out)
        assert refused.value.code == ImportFailure.UNREADABLE, name
