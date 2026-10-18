import pytest

from parfocal_common.object_ids import (
    Letter,
    ObjectId,
    ObjectIdError,
    ObjectPath,
    by_area,
    in_reading_order,
    parse,
    parse_path,
)

FORMS = [
    (ObjectId(Letter.REGION, 2), "T2", "T2"),
    (ObjectId(Letter.CELL, 145), "C145", "C145"),
    (ObjectId(Letter.CELL, 145, region=2), "T2·C145", "T2.C145"),
    (ObjectId(Letter.ROI, 3), "R3", "R3"),
    (ObjectId(Letter.ZONE, 1), "Z1", "Z1"),
    (ObjectId(Letter.MEASUREMENT, 12), "M12", "M12"),
    (ObjectId(Letter.REGION, 6, person=True), "T6⁺", "T6+"),
    (ObjectId(Letter.REGION, 2, split="a"), "T2a", "T2a"),
    (ObjectId(Letter.REGION, 2, split="aa", person=True), "T2aa⁺", "T2aa+"),
    (ObjectId(Letter.CELL, 7, person=True, region=4), "T4·C7⁺", "T4.C7+"),
]


@pytest.mark.parametrize(("object_id", "display", "ascii"), FORMS)
def test_every_form_is_written_and_parsed_back(
    object_id: ObjectId, display: str, ascii: str
) -> None:
    assert (object_id.text(), object_id.text(ascii=True)) == (display, ascii)
    assert parse(display) == object_id
    assert parse(ascii) == object_id
    assert parse(f"  {display.lower()} ") == object_id


def test_a_cell_inside_a_region_is_the_same_cell() -> None:
    inside, alone = parse("T2·C145"), parse("C145")
    assert inside != alone
    assert inside.key == alone.key


@pytest.mark.parametrize(
    "text",
    ["", "T", "T0", "C01", "X5", "T2·T3", "R2·C5", "T2.C5.C6", "C5++", "T2a1", "T-3"],
)
def test_malformed_ids_are_refused(text: str) -> None:
    with pytest.raises(ObjectIdError):
        parse(text)


def test_a_region_prefix_belongs_only_to_cells() -> None:
    with pytest.raises(ObjectIdError):
        ObjectId(Letter.ZONE, 1, region=2)
    with pytest.raises(ObjectIdError):
        ObjectId(Letter.REGION, 1, split="A")


def test_the_full_path_is_percent_encoded_per_segment() -> None:
    path = ObjectPath("P07", "S26-04812", "A1", parse("T2·C145"))
    assert path.text() == "P07/S26-04812/A1/T2.C145"
    assert parse_path(path.text()) == path
    odd = ObjectPath("P07", "Case 1/2 ü", "A 1", parse("T6⁺"))
    assert odd.text() == "P07/Case%201%2F2%20%C3%BC/A%201/T6+"
    assert parse_path(odd.text()) == odd


def test_a_loose_slide_uses_a_tilde_and_a_tilde_case_is_refused() -> None:
    loose = ObjectPath("P07", None, "tcga-0042", parse("T2"))
    assert loose.text() == "P07/~/tcga-0042/T2"
    assert parse_path("P07/~/tcga-0042/T2") == loose
    with pytest.raises(ObjectIdError):
        ObjectPath("P07", "~", "A1", parse("T2")).text()
    assert parse_path("P07/%7E/A1/T2").case == "~"


@pytest.mark.parametrize("text", ["P07/A1/T2", "P07//A1/T2", "P07/S1/A1/T2/x", "P07/S1/A1/Q2"])
def test_malformed_paths_are_refused(text: str) -> None:
    with pytest.raises(ObjectIdError):
        parse_path(text)


def test_regions_and_zones_are_numbered_by_area_largest_first() -> None:
    assert by_area([10.0, 250.0, 40.0, 250.0], first=1) == [4, 1, 3, 2]
    assert by_area([5.0, 9.0], first=7) == [8, 7]
    assert by_area([], first=1) == []


def test_cells_are_numbered_top_to_bottom_then_left_to_right() -> None:
    centroids = [(50.0, 10.0), (10.0, 10.0), (30.0, 5.0), (0.0, 40.0), (10.0, 10.0)]
    assert in_reading_order(centroids, first=1) == [4, 2, 1, 5, 3]
    assert in_reading_order(centroids, first=101) == [104, 102, 101, 105, 103]
