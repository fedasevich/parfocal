import io
import shutil
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from PIL import Image

from parfocal_common.jobs import StepFailedError
from parfocal_common.result_imports import ImportFailure, ScoreDefault
from parfocal_ingest.import_checks import (
    Choices,
    Guess,
    KnownClasses,
    SlideFrame,
    TissueCells,
    accepted_guess,
    heatmap_guess,
    heatmap_problems,
    heatmap_values,
    problems_of,
    stored_values,
    tissue_share,
)
from parfocal_ingest.result_import import read_checked

FIXTURES = Path(__file__).parent / "fixtures"
FRAME = SlideFrame(width=4000, height=3000, level_count=4, mpp=0.25)
PROJECT = KnownClasses(frozenset({"tumor", "stroma"}))


def copied(tmp_path: Path, name: str, folder: str = "checks") -> Path:
    target = tmp_path / name
    shutil.copy(FIXTURES / folder / name, target)
    return target


def checked(
    tmp_path: Path,
    name: str,
    stored: str,
    known: KnownClasses = PROJECT,
    choices: Choices | None = None,
) -> tuple[Any, list[dict[str, Any]]]:
    parsed, tally = read_checked(copied(tmp_path, name), stored, FRAME, choices)
    return parsed, problems_of(tally, known, parsed.declared_classes)


def test_three_objects_without_a_class_are_named_by_feature(tmp_path: Path) -> None:
    _, problems = checked(tmp_path, "objects-without-class.geojson", "geojson")
    assert problems == [
        {
            "code": "objects-without-class",
            "count": 3,
            "places": ["feature 2", "feature 4", "feature 5"],
        }
    ]


def test_objects_without_a_class_take_the_chosen_class(tmp_path: Path) -> None:
    parsed, _ = checked(
        tmp_path,
        "objects-without-class.geojson",
        "geojson",
        choices=Choices(unclassified="Stroma"),
    )
    assert [item.class_name for item in parsed.shapes] == [
        "Tumor",
        "Stroma",
        "Tumor",
        "Stroma",
        "Stroma",
    ]


def test_three_new_classes_are_listed_once_and_a_remembered_mapping_hides_them(
    tmp_path: Path,
) -> None:
    _, problems = checked(tmp_path, "new-classes.csv", "csv")
    assert problems == [
        {"code": "classes-unknown", "count": 3, "names": ["Mitosis", "Necrosis", "Ki67 positive"]}
    ]
    remembered = KnownClasses(
        PROJECT.class_keys, {"mitosis": "Tumor", "necrosis": "Stroma", "ki67 positive": "Tumor"}
    )
    parsed, again = checked(
        tmp_path, "new-classes.csv", "csv", remembered, Choices(renames=remembered.renames)
    )
    assert again == []
    assert sorted(parsed.cells.class_names.names) == ["Stroma", "Tumor"]


def test_a_project_without_classes_takes_every_class_in_the_file(tmp_path: Path) -> None:
    _, problems = checked(tmp_path, "new-classes.csv", "csv", KnownClasses())
    assert problems == []


def test_rows_without_a_score_are_named_and_can_count_as_one(tmp_path: Path) -> None:
    _, problems = checked(tmp_path, "rows-without-score.csv", "csv")
    assert problems == [
        {"code": "scores-missing", "count": 3, "places": ["row 3", "row 5", "row 7"]}
    ]
    as_none, _ = checked(
        tmp_path, "rows-without-score.csv", "csv", choices=Choices(score_default=ScoreDefault.NONE)
    )
    as_one, _ = checked(
        tmp_path, "rows-without-score.csv", "csv", choices=Choices(score_default=ScoreDefault.ONE)
    )
    assert as_none.cells.scores.tolist() == [191, 0, 191, 0, 191, 0]
    assert as_one.cells.scores.tolist() == [191, 255, 191, 255, 191, 255]


def test_unreadable_rows_are_named_by_line_and_the_others_still_read(tmp_path: Path) -> None:
    parsed, problems = checked(tmp_path, "unreadable-rows.csv", "csv")
    assert problems == [{"code": "objects-unreadable", "count": 2, "places": ["row 3", "row 5"]}]
    assert len(parsed.cells) == 3


def test_a_file_wholly_outside_its_slide_is_seen_as_outside(tmp_path: Path) -> None:
    _, tally = read_checked(copied(tmp_path, "outside-slide.geojson"), "geojson", FRAME)
    assert tally.all_outside
    _, inside = read_checked(copied(tmp_path, "objects-without-class.geojson"), "geojson", FRAME)
    assert not inside.all_outside
    assert inside.outside.count == 0


def test_a_heatmap_at_level_2_scaled_by_4_is_guessed() -> None:
    path = FIXTURES / "results" / "heatmap-level2.tif"
    values = heatmap_values(path, path.name)
    frame = SlideFrame(width=128, height=128, level_count=3, mpp=0.25)
    guess = heatmap_guess(values.shape, frame)
    assert guess is not None
    assert (guess.level, guess.downsample, guess.mpp) == (2, 4.0, 1.0)
    assert heatmap_problems(values, frame)[0]["guess"] == {
        "level": 2,
        "downsample": 4.0,
        "mpp": 1.0,
        "tissue_share": None,
    }


def test_each_heatmap_guess_carries_its_share_on_tissue() -> None:
    values = np.zeros((32, 32), dtype=np.uint8)
    values[16:32, 16:32] = 200
    cells = np.zeros((4, 4), dtype=np.bool_)
    cells[2:4, 2:4] = True
    tissue = TissueCells(32, cells)
    frame = SlideFrame(width=128, height=128, level_count=3, mpp=0.25)
    [found] = heatmap_problems(values, frame, tissue)
    assert [
        (guess["level"], guess["downsample"], guess["tissue_share"]) for guess in found["guesses"]
    ] == [(2, 4.0, 1.0), (0, 1.0, 0.0), (1, 2.0, 0.0)]
    assert found["guess"] == found["guesses"][0]
    half = np.zeros((32, 32), dtype=np.float32)
    half[:, 24:32] = 0.5
    half[:, 0:8] = 0.5
    right = np.tile(np.array([False, False, True, True]), (4, 1))
    assert tissue_share(half, 4.0, TissueCells(32, right)) == 0.5
    assert tissue_share(half, 4.0, TissueCells(32, cells)) == 0.25
    assert tissue_share(np.zeros((4, 4)), 4.0, tissue) is None
    assert tissue_share(values, 4.0, None) is None


def test_an_unplaced_heatmap_ranks_the_levels_by_share_on_tissue() -> None:
    values = np.full((32, 64), 1.0, dtype=np.float32)
    cells = np.zeros((2, 2), dtype=np.bool_)
    cells[0, 0] = True
    frame = SlideFrame(width=128, height=128, level_count=2, mpp=0.25)
    [found] = heatmap_problems(values, frame, TissueCells(64, cells))
    assert [(guess["level"], guess["tissue_share"]) for guess in found["guesses"]] == [
        (0, 1.0),
        (1, 0.5),
    ]


def test_a_corrupt_png_heatmap_is_refused_with_its_named_problem(tmp_path: Path) -> None:
    buffer = io.BytesIO()
    Image.fromarray(np.random.default_rng(3).integers(0, 255, (64, 64), dtype=np.uint8)).save(
        buffer, "PNG"
    )
    path = tmp_path / "heat.png"
    path.write_bytes(buffer.getvalue()[: len(buffer.getvalue()) // 2])
    with pytest.raises(StepFailedError) as failure:
        heatmap_values(path, path.name)
    assert failure.value.code == ImportFailure.HEATMAP_UNREADABLE
    path.write_bytes(b"not a picture at all")
    with pytest.raises(StepFailedError) as garbage:
        heatmap_values(path, "heat.tif")
    assert garbage.value.code == ImportFailure.HEATMAP_UNREADABLE
    colour = io.BytesIO()
    Image.new("RGB", (8, 8)).save(colour, "PNG")
    path.write_bytes(colour.getvalue())
    with pytest.raises(StepFailedError):
        heatmap_values(path, path.name)


def test_heatmap_values_are_kept_as_bytes() -> None:
    assert stored_values(np.array([[0.0, 0.5, 2.0]])).tolist() == [[0, 128, 255]]
    assert stored_values(np.array([[0, 65535]], dtype=np.uint16)).tolist() == [[0, 255]]
    assert stored_values(np.array([[True, False]])).tolist() == [[255, 0]]
    assert accepted_guess(
        {"problems": [{"code": "heatmap-scale", "guess": {"level": 2, "downsample": 4.0}}]}
    ) == Guess(2, 4.0, None)
    with pytest.raises(StepFailedError) as unplaced:
        accepted_guess({"problems": [{"code": "heatmap-scale", "guess": None}]})
    assert unplaced.value.code == ImportFailure.HEATMAP_UNPLACED


def test_a_heatmap_scale_off_the_pyramid_keeps_only_the_scale() -> None:
    guess = heatmap_guess((32, 32), SlideFrame(width=96, height=96, level_count=3, mpp=0.5))
    assert guess is not None
    assert (guess.level, guess.downsample, guess.mpp) == (None, 3.0, 1.5)
    assert heatmap_guess((32, 32), SlideFrame(width=128, height=64)) is None
    assert heatmap_guess((32, 32), SlideFrame()) is None


def test_a_heatmap_is_not_read_as_objects(tmp_path: Path) -> None:
    path = copied(tmp_path, "heatmap-level2.tif", "results")
    with pytest.raises(StepFailedError) as failure:
        read_checked(path, "heatmap", FRAME)
    assert failure.value.code == ImportFailure.UNREADABLE
