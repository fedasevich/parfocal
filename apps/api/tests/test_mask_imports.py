from pathlib import Path
from typing import cast

import pytest
from db_support import ApiAs
from test_import_checks import (
    FIXTURES,
    checked,
    choose,
    imported_classes,
    project_classes,
    sized_slide,
    upload,
)
from test_imported_cells import stored
from upload_support import Lab, exists, run_worker, status_of
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

RESULTS = FIXTURES / "results"


def mask(name: str) -> bytes:
    return (RESULTS / name).read_bytes()


def ring_bounds(ring: list[float] | tuple[float, ...]) -> tuple[float, ...]:
    xs, ys = ring[0::2], ring[1::2]
    return (min(xs), min(ys), max(xs), max(ys))


def region_bounds(database: str, set_id: str) -> list[tuple[float, ...]]:
    rows = owner(
        database,
        "SELECT class_index, ST_XMin(geometry), ST_YMin(geometry), ST_XMax(geometry), "
        f"ST_YMax(geometry) FROM result_objects WHERE result_set_id = '{set_id}' "
        "AND kind = 'region' ORDER BY class_index, ST_XMin(geometry), ST_YMin(geometry)",
    )
    return [tuple(round(cast("float", value), 1) for value in row) for row in rows]


def test_an_instance_mask_at_level_1_imports_its_labels_as_cells_at_level_0(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = sized_slide(database, lab, width=128, height=128)
    started = upload(api, lab, "A1_mask.png", mask("instance-mask.png"), slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path)
    state = status_of(api, lab.lead, started)
    assert state["status"] == "ready", state
    set_id = state["result_set_id"]
    detail = api(lab.lead).get(f"/api/result-sets/{set_id}").json()
    assert (detail["name"], detail["cell_count"], detail["region_count"]) == (
        "Instance mask import",
        3,
        0,
    )
    _, cells = stored(lab.tenant_id, slide_id, set_id)
    assert sorted(ring_bounds(list(cell.ring)) for cell in cells) == [
        (21.0, 21.0, 39.0, 39.0),
        (41.0, 21.0, 59.0, 39.0),
        (81.0, 81.0, 111.0, 99.0),
    ]
    assert exists(f"t/{lab.tenant_id}/s/{slide_id}/results/{set_id}/source.png")


def test_a_class_mask_maps_its_values_to_project_classes_by_key_and_asks_for_the_rest(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    ids = project_classes(api, lab, "Tumor", "Stroma", "Necrosis")
    slide_id = sized_slide(database, lab, width=128, height=128)
    started, found = checked(
        api, database, lab, tmp_path, "A1_mask.png", mask("class-mask.png"), slide_id=str(slide_id)
    )
    assert [(item["code"], item["names"]) for item in found["problems"]] == [
        ("classes-unknown", ["7"])
    ]
    mappings = [{"source_name": "7", "class_id": ids["Necrosis"]}]
    assert choose(api, lab, started, class_mappings=mappings).status_code == 200
    run_worker(database, lab.tenant_id, tmp_path)
    assert imported_classes(api, lab, started) == [("Tumor", 2), ("Stroma", 1), ("Necrosis", 1)]
    state = status_of(api, lab.lead, started)
    detail = api(lab.lead).get(f"/api/result-sets/{state['result_set_id']}").json()
    assert (detail["name"], detail["region_count"], detail["cell_count"]) == (
        "Class mask import",
        4,
        0,
    )
    bounds = region_bounds(database, state["result_set_id"])
    assert bounds == [
        (0, 11.0, 11.0, 29.0, 29.0),
        (0, 61.0, 61.0, 79.0, 79.0),
        (1, 11.0, 101.0, 49.0, 119.0),
        (2, 101.0, 101.0, 103.0, 103.0),
    ]


def test_a_mask_whose_size_matches_no_level_asks_for_its_level(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    project_classes(api, lab, "Tumor", "Stroma")
    slide_id = sized_slide(database, lab, width=128, height=128)
    started, found = checked(
        api,
        database,
        lab,
        tmp_path,
        "A1_classes.png",
        mask("mask-off-level.png"),
        slide_id=str(slide_id),
    )
    assert [item["code"] for item in found["problems"]] == ["mask-scale"]
    assert [item["level"] for item in found["problems"][0]["guesses"]] == [None, 0, 1, 2]
    unknown = choose(api, lab, started, heatmap_level=7)
    assert (unknown.status_code, unknown.json()["code"]) == (400, "unknown-heatmap-level")
    assert choose(api, lab, started, heatmap_level=1).status_code == 200
    run_worker(database, lab.tenant_id, tmp_path)
    assert imported_classes(api, lab, started) == [("Tumor", 1), ("Stroma", 1)]
    state = status_of(api, lab.lead, started)
    bounds = region_bounds(database, state["result_set_id"])
    assert [row[1:] for row in bounds] == [
        (17.0, 17.0, 39.0, 39.0),
        (49.0, 57.0, 87.0, 79.0),
    ]


def test_a_mask_of_only_background_is_refused_with_its_reason(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = sized_slide(database, lab, width=128, height=128)
    started = upload(api, lab, "A1_mask.png", mask("mask-background.png"), slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path)
    state = status_of(api, lab.lead, started)
    assert (state["status"], state["reason"]) == ("failed", "result-mask-empty")
    assert "only background" in state["message"]
    assert not exists(started["key"])
