from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.tumor_froc import (
    Detection,
    Lesions,
    SlideHits,
    annotation_polygons,
    detections,
    froc,
    lesions_of,
    slide_hits,
    tumor_mask,
)

CELL_UM = 0.243 * 64


def test_suppression_keeps_one_peak_per_box_and_stops_below_the_threshold():
    probability = np.zeros((200, 200))
    probability[50, 50] = 0.9
    probability[60, 60] = 0.8
    probability[150, 150] = 0.7
    probability[10, 190] = 0.4
    found = detections(probability)
    assert found == [Detection(0.9, 50, 50), Detection(0.7, 150, 150)]


def test_suppression_does_not_touch_the_map_it_was_given():
    probability = np.full((4, 4), 0.9)
    detections(probability, box=2)
    assert probability.min() == 0.9


def test_a_lesion_narrower_than_isolated_cells_is_left_out_of_the_count():
    mask = np.zeros((300, 300), bool)
    mask[100:160, 100:160] = True
    mask[20, 20] = True
    lesions = lesions_of(mask, CELL_UM)
    assert lesions.labels.max() == 2
    assert lesions.counted == 1
    assert lesions.labels[20, 20] in lesions.isolated


def test_a_slide_without_tumour_has_no_lesions_at_all():
    lesions = lesions_of(np.zeros((50, 50), bool), CELL_UM)
    assert lesions.labels.max() == 0
    assert lesions.counted == 0


def test_deposits_closer_than_the_grown_distance_become_one_lesion():
    mask = np.zeros((100, 200), bool)
    mask[40:60, 40:60] = True
    mask[40:60, 63:83] = True
    mask[40:60, 120:140] = True
    assert lesions_of(mask, CELL_UM).labels.max() == 2


def test_hits_keep_the_best_probability_per_lesion_and_ignore_isolated_cells():
    labels = np.zeros((10, 10), np.int32)
    labels[0:3, 0:3] = 1
    labels[7:9, 7:9] = 2
    lesions = Lesions(labels, frozenset({2}))
    found = [
        Detection(0.6, 1, 1),
        Detection(0.9, 2, 2),
        Detection(0.8, 8, 8),
        Detection(0.7, 5, 5),
    ]
    hits = slide_hits(found, lesions)
    assert hits.false_positives == (0.7,)
    assert hits.true_positives[0] == pytest.approx(0.9)
    assert hits.lesions == 1


def test_finding_every_lesion_above_every_false_alarm_scores_one():
    assert froc([SlideHits((0.1,), (0.9, 0.8), 2)]).score == pytest.approx(1.0)


def test_the_lowest_probability_is_never_a_threshold_as_in_the_challenge_code():
    assert froc([SlideHits((), (0.9, 0.8), 2)]).score == pytest.approx(0.5)


def test_froc_averages_sensitivity_at_the_challenge_rates():
    slides = [SlideHits((0.95, 0.6), (0.9, 0.0), 2), SlideHits((0.55,), (), 0)]
    result = froc(slides)
    assert result.sensitivities == pytest.approx((0.0, 0.5, 0.5, 0.5, 0.5, 0.5))
    assert result.score == pytest.approx(2.5 / 6)
    assert (result.slides, result.lesions, result.false_positives) == (2, 2, 3)


def test_no_detection_at_all_scores_zero():
    assert froc([SlideHits((), (0.0,), 1)]).score == 0.0


XML = """<?xml version="1.0"?>
<ASAP_Annotations><Annotations>
<Annotation Name="a" PartOfGroup="Tumor"><Coordinates>
<Coordinate Order="0" X="640" Y="640"/><Coordinate Order="1" X="1920" Y="640"/>
<Coordinate Order="2" X="1920" Y="1920"/><Coordinate Order="3" X="640" Y="1920"/>
</Coordinates></Annotation>
<Annotation Name="b" PartOfGroup="None"><Coordinates>
<Coordinate Order="0" X="1100" Y="1100"/><Coordinate Order="1" X="1500" Y="1100"/>
<Coordinate Order="2" X="1500" Y="1500"/><Coordinate Order="3" X="1100" Y="1500"/>
</Coordinates></Annotation>
<Annotation Name="c" PartOfGroup="Tumor"><Coordinates>
<Coordinate Order="0" X="3000" Y="300"/><Coordinate Order="1" X="3010" Y="300"/>
<Coordinate Order="2" X="3005" Y="310"/>
</Coordinates></Annotation>
</Annotations></ASAP_Annotations>"""


def test_the_tumor_mask_fills_tumor_polygons_minus_the_excluded_ones(tmp_path: Path):
    path = tmp_path / "slide.xml"
    path.write_text(XML)
    groups = annotation_polygons(path)
    assert sorted((name, len(found)) for name, found in groups.items()) == [
        ("None", 1),
        ("Tumor", 2),
    ]
    mask = tumor_mask(groups, (40, 60), 64)
    assert mask[12, 12]
    assert mask[25, 25]
    assert not mask[19, 19]
    assert mask[3:7, 45:49].any()
    assert not mask[35, 5]
