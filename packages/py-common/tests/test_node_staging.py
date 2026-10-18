import pytest

from parfocal_common.node_staging import (
    Area,
    Call,
    Category,
    Cell,
    Range,
    State,
    category_of,
    count_is_firm,
    count_of,
    stage_node,
)


@pytest.mark.parametrize(
    ("size_mm", "cells", "category"),
    [
        (2.01, None, Category.MACRO),
        (2.0, None, Category.MICRO),
        (0.21, None, Category.MICRO),
        (0.2, None, Category.ITC),
        (0.2, 201, Category.MICRO),
        (0.2, 200, Category.ITC),
        (0.05, 0, Category.ITC),
    ],
)
def test_each_category_boundary(size_mm: float, cells: int | None, category: Category) -> None:
    assert category_of(size_mm, cells) is category


def test_the_count_range_counts_each_call_with_its_chance_of_being_wrong() -> None:
    cells = [
        Cell(0.9, called_tumor=True),
        Cell(0.6, called_tumor=True),
        Cell(0.3, called_tumor=False),
        Cell(0.1, called_tumor=False),
        Cell(0.5, called_tumor=True, checked=True),
        Cell(0.7, called_tumor=True, checked=False),
    ]
    count = count_of(cells)
    assert count.low == pytest.approx(1 + 0.9 + 0.6)
    assert count.value == 3
    assert count.high == pytest.approx(3 + 0.3 + 0.1)


@pytest.mark.parametrize(
    ("low", "high", "firm"),
    [(150, 200, True), (150, 200.5, False), (200, 250, False), (200.5, 250, True)],
)
def test_a_count_is_firm_once_its_range_cannot_cross_200(
    low: float, high: float, firm: bool
) -> None:
    assert count_is_firm(Range(low, (low + high) / 2, high)) is firm


def cluster(tumor: int, unsure: int, *, checked: int = 0) -> list[Cell]:
    confirmed = [Cell(0.55, called_tumor=True, checked=True) for _ in range(checked)]
    sure = [Cell(1.0, called_tumor=True) for _ in range(tumor - checked)]
    doubtful = [Cell(0.5, called_tumor=False) for _ in range(unsure)]
    return confirmed + sure + doubtful


def test_the_largest_area_leads_until_it_is_ruled_out() -> None:
    areas = [
        Area("T1", 3.1),
        Area("T2", 0.9),
        Area("T3", 0.15, cells=cluster(40, 0)),
    ]
    first = stage_node(areas)
    assert (first.lead, first.category, first.stage, first.state) == (
        "T1",
        Category.MACRO,
        "pN1a(sn)",
        State.OPEN,
    )
    assert first.size is not None
    assert (first.size.low, first.size.value, first.size.high) == pytest.approx((2.79, 3.1, 3.41))
    ruled_out = stage_node([Area("T1", 3.1, Call.NOT_TUMOR), *areas[1:]])
    assert (ruled_out.lead, ruled_out.category, ruled_out.stage) == (
        "T2",
        Category.MICRO,
        "pN1mi(sn)",
    )
    only_cluster = stage_node(
        [Area("T1", 3.1, Call.NOT_TUMOR), Area("T2", 0.9, Call.NOT_TUMOR), areas[2]]
    )
    assert (only_cluster.lead, only_cluster.category, only_cluster.needs_count) == (
        "T3",
        Category.ITC,
        True,
    )
    negative = stage_node([Area("T1", 3.1, Call.NOT_TUMOR)])
    assert (negative.lead, negative.category, negative.stage, negative.state) == (
        None,
        Category.NONE,
        "pN0(sn)",
        State.SETTLED,
    )
    assert stage_node([]).state is State.SO_FAR


def test_a_measurement_replaces_the_ai_size_and_can_change_the_lead() -> None:
    staged = stage_node([Area("T1", 1.0), Area("T2", 0.8, Call.TUMOR, measured_mm=2.4)])
    assert (staged.lead, staged.category, staged.size) == (
        "T2",
        Category.MACRO,
        Range(2.4, 2.4, 2.4),
    )


def test_the_node_settles_once_the_lead_is_confirmed_measured_and_nothing_else_can_outrank_it() -> (
    None
):
    unmeasured = stage_node([Area("T1", 2.6, Call.TUMOR), Area("T2", 0.3)])
    assert (unmeasured.state, unmeasured.category) == (State.SO_FAR, Category.MACRO)
    settled = stage_node([Area("T1", 2.6, Call.TUMOR, measured_mm=2.5), Area("T2", 0.3)])
    assert settled.state is State.SETTLED
    assert [area.can_change_category for area in settled.areas] == [False, False]
    close = stage_node([Area("T1", 0.4, Call.TUMOR, measured_mm=0.35), Area("T2", 1.9)])
    assert (close.lead, close.state) == ("T2", State.OPEN)
    rival = stage_node([Area("T1", 1.9, Call.TUMOR, measured_mm=1.95), Area("T2", 1.85)])
    assert rival.state is State.SO_FAR
    assert [area.can_change_category for area in rival.areas] == [False, True]
    unsure = stage_node([Area("T1", 1.0, Call.UNSURE, measured_mm=1.0)])
    assert unsure.state is State.OPEN


def test_a_small_cluster_settles_only_when_its_count_cannot_cross_200() -> None:
    unclear = stage_node([Area("T1", 0.18, Call.TUMOR, 0.17, cluster(175, 60))])
    assert unclear.needs_count is True
    assert unclear.count is not None
    assert (unclear.count.low, unclear.count.value, unclear.count.high) == (175, 175, 205)
    assert (unclear.category, unclear.stage, unclear.state) == (
        Category.ITC,
        "pN0(i+)(sn)",
        State.SO_FAR,
    )
    checked = [Cell(0.5, called_tumor=False, checked=False) for _ in range(20)] + cluster(175, 40)
    firm = stage_node([Area("T1", 0.18, Call.TUMOR, 0.17, checked)])
    assert firm.count is not None
    assert firm.count.high == 195
    assert firm.state is State.SETTLED
    many = stage_node([Area("T1", 0.18, Call.TUMOR, 0.17, cluster(260, 0))])
    assert (many.category, many.stage, many.state) == (Category.MICRO, "pN1mi(sn)", State.SETTLED)
    no_nuclei = stage_node([Area("T1", 0.18, Call.TUMOR, 0.17)])
    assert (no_nuclei.needs_count, no_nuclei.count, no_nuclei.state) == (True, None, State.SO_FAR)


def test_a_smaller_cluster_that_could_pass_200_cells_keeps_an_itc_lead_open() -> None:
    staged = stage_node(
        [
            Area("T1", 0.19, Call.TUMOR, 0.19, cluster(30, 0)),
            Area("T2", 0.1, cells=cluster(190, 30)),
        ]
    )
    assert (staged.lead, staged.category, staged.state) == ("T1", Category.ITC, State.SO_FAR)
    assert staged.areas[1].can_change_category is True
