import shutil
from pathlib import Path
from typing import Any

import pytest

from parfocal_common.jobs import StepFailedError
from parfocal_common.result_imports import ImportFailure, ScoreDefault
from parfocal_ingest.import_checks import (
    Choices,
    KnownClasses,
    SlideFrame,
    heatmap_guess,
    heatmap_problems,
    problems_of,
    raster_shape,
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
    shape = raster_shape(FIXTURES / "results" / "heatmap-level2.tif")
    frame = SlideFrame(width=128, height=128, level_count=3, mpp=0.25)
    guess = heatmap_guess(shape, frame)
    assert guess is not None
    assert (guess.level, guess.downsample, guess.mpp) == (2, 4.0, 1.0)
    assert heatmap_problems(shape, frame)[0]["guess"] == {"level": 2, "downsample": 4.0, "mpp": 1.0}


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
    assert failure.value.code == ImportFailure.HEATMAP_NOT_STORED
