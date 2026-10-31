import pytest

from parfocal_common.pairing import (
    Certainty,
    FileKind,
    Hint,
    Outcome,
    PairBy,
    Pairing,
    ResultFile,
    Rule,
    SlideCandidate,
    embedded_hint,
    kind_of,
    pair_one,
    pair_results,
)

SLIDE_UUID = "6f1c9a52-3b0e-4d7c-8a51-0f2e9b7d4c13"


def dropped(*paths: str) -> list[SlideCandidate]:
    return [SlideCandidate(key=path, name=path, path=path) for path in paths]


def existing(label: str, slide_id: str = SLIDE_UUID) -> SlideCandidate:
    return SlideCandidate(key=f"slide:{slide_id}", name=label, slide_id=slide_id)


def paired(slide: str, rule: Rule, certainty: Certainty, path: str) -> Pairing:
    return Pairing(path, Outcome.PAIRED, slide, rule, certainty)


def test_a_result_next_to_its_slide_with_the_same_name_is_sure() -> None:
    slides = dropped("S26-04812/A1_HE.svs", "S26-04812/A2_HE.svs")
    result = "S26-04812/A1_HE.geojson"
    assert pair_one(ResultFile(result), slides) == paired(
        "S26-04812/A1_HE.svs", Rule.NEXT_TO_SLIDE, Certainty.SURE, result
    )


def test_a_result_next_to_its_slide_with_a_longer_name_pairs_with_the_closest_slide() -> None:
    slides = dropped("case/A1.svs", "case/A1_HE.svs")
    result = "case/A1_HE.cells.csv"
    assert pair_one(ResultFile(result), slides) == paired(
        "case/A1_HE.svs", Rule.NEXT_TO_SLIDE, Certainty.SURE, result
    )


def test_a_result_in_a_folder_named_like_the_slide_is_sure() -> None:
    slides = dropped("S26-04812/A1_HE.svs", "S26-04812/A2_HE.svs")
    result = "S26-04812/A2_HE/cells.csv"
    assert pair_one(ResultFile(result), slides) == paired(
        "S26-04812/A2_HE.svs", Rule.FOLDER_NAMED_LIKE_SLIDE, Certainty.SURE, result
    )


def test_a_folder_named_like_the_slide_may_also_hold_the_slide() -> None:
    slides = dropped("upload/A2_HE/A2_HE.ndpi")
    result = "upload/A2_HE/regions.geojson"
    assert pair_one(ResultFile(result), slides) == paired(
        "upload/A2_HE/A2_HE.ndpi", Rule.FOLDER_NAMED_LIKE_SLIDE, Certainty.SURE, result
    )


def test_the_same_file_name_in_another_folder_is_sure() -> None:
    slides = dropped("slides/tumor_031.tif")
    result = "results/tumor_031.geojson"
    assert pair_one(ResultFile(result), slides) == paired(
        "slides/tumor_031.tif", Rule.FILE_NAME, Certainty.SURE, result
    )


def test_a_file_name_that_only_starts_with_the_slide_name_is_likely() -> None:
    slides = dropped("slides/tumor_031.tif", "slides/tumor_0310.tif")
    result = "results/tumor_031_prob.geojson"
    assert pair_one(ResultFile(result), slides) == paired(
        "slides/tumor_031.tif", Rule.FILE_NAME, Certainty.LIKELY, result
    )


def test_a_slide_already_in_the_case_pairs_by_its_label() -> None:
    result = "S26-04812-A1.geojson"
    assert pair_one(ResultFile(result), [existing("S26-04812-A1")]) == paired(
        f"slide:{SLIDE_UUID}", Rule.FILE_NAME, Certainty.SURE, result
    )


def test_an_embedded_slide_id_is_sure() -> None:
    result = ResultFile("output/run-7.json", Hint(slide_id=SLIDE_UUID.upper()))
    slides = [existing("Biopsy"), existing("Other", "0e7d3c9b-15a4-4f20-9b8e-6c1d2a3f4e5b")]
    assert pair_one(result, slides) == paired(
        f"slide:{SLIDE_UUID}", Rule.EMBEDDED_ID, Certainty.SURE, "output/run-7.json"
    )


def test_an_embedded_file_name_is_likely() -> None:
    result = ResultFile("output/run-7.json", Hint(file_name="C:\\scans\\S26-04812-A1.svs"))
    slides = dropped("S26-04812-A1.svs", "S26-04812-A2.svs")
    assert pair_one(result, slides) == paired(
        "S26-04812-A1.svs", Rule.EMBEDDED_ID, Certainty.LIKELY, "output/run-7.json"
    )


def test_a_sure_embedded_id_wins_over_a_likely_file_name() -> None:
    other = "0e7d3c9b-15a4-4f20-9b8e-6c1d2a3f4e5b"
    result = ResultFile("A1_cells.geojson", Hint(slide_id=other))
    slides = [existing("A1"), existing("Second", other)]
    assert pair_one(result, slides) == paired(
        f"slide:{other}", Rule.EMBEDDED_ID, Certainty.SURE, "A1_cells.geojson"
    )


def test_folder_shape_comes_before_the_file_name() -> None:
    slides = dropped("case/A1_HE.svs", "elsewhere/A1_HE.svs")
    result = "case/A1_HE.geojson"
    assert pair_one(ResultFile(result), slides).slide == "case/A1_HE.svs"


def test_two_slides_with_the_same_name_next_to_a_result_are_a_tie() -> None:
    slides = dropped("case/A1.svs", "case/A1.ndpi")
    assert pair_one(ResultFile("case/A1.geojson"), slides) == Pairing(
        "case/A1.geojson",
        Outcome.TIE,
        None,
        Rule.NEXT_TO_SLIDE,
        Certainty.SURE,
        ("case/A1.svs", "case/A1.ndpi"),
    )


def test_two_slides_with_the_same_name_elsewhere_are_a_tie() -> None:
    slides = dropped("one/A1.svs", "two/A1.svs")
    found = pair_one(ResultFile("results/A1.geojson"), slides)
    assert (found.outcome, found.slide, found.candidates) == (
        Outcome.TIE,
        None,
        ("one/A1.svs", "two/A1.svs"),
    )


def test_a_result_that_matches_no_slide_stays_unmatched() -> None:
    slides = dropped("case/A1.svs", "case/A10.svs")
    found = pair_one(ResultFile("results/heatmap_7.png"), slides)
    assert found == Pairing("results/heatmap_7.png", Outcome.UNMATCHED)


def test_a_name_that_continues_without_a_separator_does_not_match() -> None:
    found = pair_one(ResultFile("A10.geojson"), dropped("A1.svs"))
    assert found.outcome is Outcome.UNMATCHED


@pytest.mark.parametrize(
    ("by", "rule"),
    [(PairBy.NAME, Rule.FILE_NAME), (PairBy.EMBEDDED, Rule.EMBEDDED_ID)],
)
def test_pairing_can_use_one_rule_only(by: PairBy, rule: Rule) -> None:
    slides = [existing("A1")]
    result = ResultFile("A1.geojson", Hint(slide_id=SLIDE_UUID))
    found = pair_one(result, slides, by)
    assert (found.outcome, found.rule) == (Outcome.PAIRED, rule)


def test_pairing_by_embedded_id_ignores_the_folder_shape() -> None:
    found = pair_one(ResultFile("case/A1.geojson"), dropped("case/A1.svs"), PairBy.EMBEDDED)
    assert found.outcome is Outcome.UNMATCHED


def test_every_result_gets_a_pairing_in_order() -> None:
    slides = dropped("A1.svs", "A2.svs")
    found = pair_results([ResultFile("A2.geojson"), ResultFile("A1.csv")], slides)
    assert [item.slide for item in found] == ["A2.svs", "A1.svs"]


@pytest.mark.parametrize(
    ("path", "kind"),
    [
        ("case/A1.svs", FileKind.SLIDE),
        ("case/A1.ome.tiff", FileKind.SLIDE),
        ("case/A1.mrxs", FileKind.SLIDE),
        ("case/A1.geojson", FileKind.RESULT),
        ("case/A1.cells.CSV", FileKind.RESULT),
        ("case/heat.png", FileKind.RESULT),
        ("case/notes.txt", FileKind.OTHER),
    ],
)
def test_dropped_files_are_sorted_into_slides_and_results(path: str, kind: FileKind) -> None:
    assert kind_of(path) is kind


def test_the_slide_block_of_a_parfocal_file_gives_the_hint() -> None:
    head = (
        '{"format": "parfocal-results", "version": 1, "slide": {"file_name": "S26-1.svs", '
        f'"slide_id": "{SLIDE_UUID}", "width": 46000}}, "objects": [{{"kind": "region"'
    )
    assert embedded_hint(head, "run.json") == Hint(slide_id=SLIDE_UUID, file_name="S26-1.svs")


def test_a_json_file_without_a_slide_block_has_no_hint() -> None:
    assert embedded_hint('{"type": "FeatureCollection", "features": [', "a.geojson") is None


def test_a_table_with_a_slide_column_gives_the_hint() -> None:
    head = "x\ty\tslide_id\tclass\n10\t20\tS26-04812-A1\tTumor\n11\t21\tS26"
    assert embedded_hint(head, "cells.tsv") == Hint(slide_id="S26-04812-A1")


def test_a_table_without_a_slide_column_has_no_hint() -> None:
    assert embedded_hint("x,y,class\n1,2,Tumor\n", "cells.csv") is None
