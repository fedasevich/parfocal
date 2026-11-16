import json
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.tumor_evaluation import (
    CellCounts,
    evaluate_slide,
    gate_metrics,
    main,
    summary,
)
from parfocal_ml.tumor_froc import BUNDLE_SPACING_UM, annotation_polygons, froc, tumor_mask
from parfocal_ml.tumor_map import CELL


def outline_xml(path: Path, boxes: list[tuple[int, int, int, int]], group: str = "Tumor") -> Path:
    annotations = []
    for index, (left, top, right, bottom) in enumerate(boxes):
        corners = [(left, top), (right, top), (right, bottom), (left, bottom)]
        coordinates = "".join(
            f'<Coordinate Order="{order}" X="{x * CELL}" Y="{y * CELL}" />'
            for order, (x, y) in enumerate(corners)
        )
        annotations.append(
            f'<Annotation Name="_{index}" PartOfGroup="{group}">'
            f"<Coordinates>{coordinates}</Coordinates></Annotation>"
        )
    path.write_text(
        f"<ASAP_Annotations><Annotations>{''.join(annotations)}</Annotations></ASAP_Annotations>"
    )
    return path


def test_a_found_deposit_and_a_stray_peak_give_one_hit_and_one_false_positive(tmp_path):
    xml = outline_xml(tmp_path / "a.xml", [(40, 40, 60, 60)])
    probability = np.zeros((200, 200), np.float32)
    probability[42:58, 42:58] = 0.99
    probability[150:155, 150:155] = 0.8
    result = evaluate_slide("a", probability, xml)
    assert result.annotated
    assert result.hits.lesions == 1
    assert result.hits.true_positives == pytest.approx((0.99,))
    assert result.hits.false_positives == pytest.approx((0.8,))
    truth = tumor_mask(annotation_polygons(xml), probability.shape, CELL)
    assert result.cells == CellCounts(16 * 16 + 25, int(truth.sum()), 16 * 16)
    assert result.deposits_missed == 0
    assert result.stray_areas == 0
    assert len(result.size_errors_mm) == 1
    assert result.size_errors_mm[0] < 0


def test_a_slide_without_outlines_counts_only_false_alarms():
    probability = np.zeros((100, 100), np.float32)
    probability[10:20, 10:20] = 0.99
    result = evaluate_slide("normal", probability, None)
    assert not result.annotated
    assert result.hits.lesions == 0
    assert len(result.hits.false_positives) == 1
    assert result.cells.dice == pytest.approx(0.0)
    assert result.cells.sensitivity is None
    assert result.stray_areas == 1
    assert result.as_json()["froc"] is None


def test_an_empty_map_scores_nothing_and_misses_every_deposit(tmp_path):
    xml = outline_xml(tmp_path / "b.xml", [(40, 40, 60, 60)])
    result = evaluate_slide("b", np.zeros((200, 200), np.float32), xml)
    assert result.detections == 0
    assert result.hits.true_positives == (0.0,)
    assert result.deposits_missed == 1
    assert result.as_json()["froc"] == 0.0


def test_the_pooled_froc_is_the_froc_of_every_annotated_slide_together(tmp_path):
    first = outline_xml(tmp_path / "a.xml", [(40, 40, 60, 60)])
    second = outline_xml(tmp_path / "b.xml", [(40, 40, 60, 60), (140, 140, 160, 160)])
    found = np.zeros((200, 200), np.float32)
    found[42:58, 42:58] = 0.9
    slides = [
        evaluate_slide("a", found, first),
        evaluate_slide("b", found, second),
        evaluate_slide("n", found, None),
    ]
    report = summary(slides)
    assert report["annotated_slides"] == 2
    assert report["normal_slides"] == 1
    assert report["lesions_counted"] == 3
    assert report["froc"] == pytest.approx(froc([slides[0].hits, slides[1].hits]).score)
    assert report["froc"] == pytest.approx(2 / 3)
    assert report["false_positives_on_normal"] == 1
    assert report["dice"] == pytest.approx(
        2
        * (slides[0].cells.both + slides[1].cells.both)
        / (
            slides[0].cells.called
            + slides[1].cells.called
            + slides[0].cells.truth
            + slides[1].cells.truth
        )
    )
    assert gate_metrics(report) == {"froc": report["froc"], "dice": report["dice"]}


def test_a_run_with_no_counted_lesion_has_no_froc_and_no_gate_metric():
    report = summary([evaluate_slide("n", np.zeros((50, 50), np.float32), None)])
    assert report["froc"] is None
    assert report["dice"] is None
    assert gate_metrics(report) == {}


def test_cell_counts_without_any_cell_have_no_dice():
    assert CellCounts(0, 0, 0).dice is None


def test_the_command_reads_cached_maps_and_their_outlines(tmp_path, capsys):
    maps = tmp_path / "maps"
    fixtures = tmp_path / "fixtures"
    fixtures.mkdir()
    for name in ("test_a", "test_n"):
        (maps / name).mkdir(parents=True)
        values = np.zeros((200, 200), np.uint8)
        values[42:58, 42:58] = 255
        values[150:155, 150:155] = 128
        np.save(maps / name / "stored.npy", values)
    outline_xml(fixtures / "test_a.xml", [(40, 40, 60, 60)])
    out = tmp_path / "report.json"
    main([str(maps), str(fixtures), "--out", str(out)])
    report = json.loads(out.read_text())
    assert [s["slide"] for s in report["slides"]] == ["test_a", "test_n"]
    assert report["summary"]["froc"] == pytest.approx(1.0)
    assert report["summary"]["false_positives_on_annotated"] == 1
    assert report["summary"]["false_positives_on_normal"] == 2
    assert json.loads(capsys.readouterr().out) == report


def test_many_outlines_of_one_deposit_count_as_one_deposit(tmp_path):
    xml = outline_xml(tmp_path / "many.xml", [(40, 40, 50, 60), (51, 40, 60, 60), (45, 61, 55, 62)])
    probability = np.zeros((200, 200), np.float32)
    probability[40:62, 40:60] = 0.99
    result = evaluate_slide("many", probability, xml)
    assert len(result.deposits) == 1
    deposit = result.deposits[0]
    assert deposit.areas == 1
    mm_per_cell = CELL * BUNDLE_SPACING_UM / 1000
    assert deposit.truth_mm == pytest.approx(np.hypot(20, 20) * mm_per_cell)
    assert deposit.found_mm == pytest.approx(np.hypot(20, 22) * mm_per_cell)
    assert result.stray_areas == 0


def test_an_area_is_credited_only_to_the_deposit_its_cells_touch(tmp_path):
    xml = outline_xml(tmp_path / "near.xml", [(10, 10, 100, 12), (80, 80, 84, 84)])
    probability = np.zeros((200, 200), np.float32)
    probability[10:12, 10:100] = 0.99
    probability[10:100, 10:12] = 0.99
    probability[80:84, 80:84] = 0.99
    probability[150:153, 150:153] = 0.99
    result = evaluate_slide("near", probability, xml)
    bar, small = result.deposits
    assert bar.areas == 1
    assert bar.found_mm is not None
    assert bar.found_mm > bar.truth_mm
    assert small.areas == 1
    assert small.truth_over_found == pytest.approx(1.0)
    assert result.stray_areas == 1


def test_the_summary_keeps_the_spread_of_true_over_found_size(tmp_path):
    xml = outline_xml(tmp_path / "spread.xml", [(40, 40, 60, 60), (140, 140, 160, 160)])
    probability = np.zeros((200, 200), np.float32)
    probability[40:60, 40:60] = 0.99
    probability[140:150, 140:150] = 0.99
    report = summary([evaluate_slide("spread", probability, xml)])
    low, high = report["truth_over_found"]
    assert low == pytest.approx(1.0)
    assert high == pytest.approx(2.0)
    assert report["deposits_missed"] == 0
    assert report["stray_areas_on_annotated"] == 0


def test_an_area_over_two_deposits_is_credited_to_the_one_it_covers_most(tmp_path):
    xml = outline_xml(tmp_path / "merged.xml", [(40, 40, 70, 60), (73, 40, 76, 43)])
    probability = np.zeros((200, 200), np.float32)
    probability[40:61, 40:77] = 0.99
    result = evaluate_slide("merged", probability, xml)
    large, small = result.deposits
    assert large.areas == 1
    assert not large.merged
    assert small.found_mm is None
    assert small.merged
    assert result.deposits_missed == 0
    assert result.deposits_merged == 1
    assert result.stray_areas == 0
