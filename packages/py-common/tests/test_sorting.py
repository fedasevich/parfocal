import pytest

from parfocal_common.sorting import (
    CaseGuess,
    CaseRule,
    CasesFrom,
    drop_root,
    name_case,
    sort_slides,
)


def test_a_folder_below_the_dropped_folder_is_a_case() -> None:
    sorted_slides = sort_slides(
        ["P07-upload/S26-04812/A1_HE.svs", "P07-upload/tumor_031.tif"],
        ["P07-upload/S26-04812/A1_HE.geojson", "P07-upload/results/tumor_031_prob.png"],
    )
    assert sorted_slides == {
        "P07-upload/S26-04812/A1_HE.svs": CaseGuess("S26-04812", CaseRule.FOLDER),
        "P07-upload/tumor_031.tif": None,
    }


def test_a_single_dropped_case_folder_is_found_by_its_case_number() -> None:
    assert sort_slides(["S26-04812/A1_HE.svs", "S26-04812/A2_HE.svs"]) == {
        "S26-04812/A1_HE.svs": CaseGuess("S26-04812", CaseRule.FOLDER),
        "S26-04812/A2_HE.svs": CaseGuess("S26-04812", CaseRule.FOLDER),
    }


def test_a_case_number_at_the_start_of_the_file_name_is_a_case() -> None:
    assert sort_slides(["S26-04812_A1_HE.svs", "tumor_031.tif", "H24-123 B2.ndpi"]) == {
        "S26-04812_A1_HE.svs": CaseGuess("S26-04812", CaseRule.FILE_NAME),
        "tumor_031.tif": None,
        "H24-123 B2.ndpi": CaseGuess("H24-123", CaseRule.FILE_NAME),
    }


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("S26-04812_A1_HE.svs", "S26-04812"),
        ("S26-04812.svs", "S26-04812"),
        ("CASE-12_x.tiff", "CASE-12"),
        ("tumor_031.tif", None),
        ("A1-HE.svs", None),
        ("P07-upload.svs", None),
        ("TCGA-A1-A0SB-01Z.svs", None),
    ],
)
def test_only_names_that_start_with_a_case_number_name_a_case(
    name: str, expected: str | None
) -> None:
    assert name_case(name) == expected


def test_the_loose_mark_and_overlong_folders_are_never_cases() -> None:
    long_folder = "x" * 101
    assert sort_slides(["~/A1.svs", f"{long_folder}/A2.svs", "other/A3.svs"]) == {
        "~/A1.svs": None,
        f"{long_folder}/A2.svs": None,
        "other/A3.svs": CaseGuess("other", CaseRule.FOLDER),
    }


def test_keeping_everything_loose_ignores_folders_and_names() -> None:
    assert sort_slides(["S26-04812/A1.svs", "S26-04813_A2.svs"], cases_from=CasesFrom.LOOSE) == {
        "S26-04812/A1.svs": None,
        "S26-04813_A2.svs": None,
    }


def test_the_drop_root_is_the_folder_every_file_shares() -> None:
    assert drop_root(["a/b/c.svs", "a/b/d/e.svs"]) == ("a", "b")
    assert drop_root(["a\\b\\c.svs", "a/x.svs"]) == ("a",)
    assert drop_root(["c.svs", "a/x.svs"]) == ()
    assert drop_root([]) == ()
