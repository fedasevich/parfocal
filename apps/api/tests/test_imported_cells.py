import json
import uuid
from collections import Counter
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from storage_support import with_store
from test_result_uploads import RESULTS, result_set, upload_result
from upload_support import Lab, keys_under, run_worker, single, status_of
from workspace_support import join_project, make_slide, owner, person

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.chunk_store import Cell, CellSummary, read_chunk, read_summary
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import ObjectResultStore

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

QUPATH = (RESULTS / "qupath-0.7-cells.geojson").read_bytes()
CELLS_TSV = (RESULTS / "cells.tsv").read_bytes()


def qupath_classes() -> Counter[str]:
    features = json.loads(QUPATH)["features"]
    return Counter(
        item["properties"]["classification"]["name"]
        for item in features
        if item["properties"]["objectType"] == "cell"
    )


def stored(
    tenant_id: uuid.UUID, slide_id: uuid.UUID, set_id: str
) -> tuple[CellSummary, list[Cell]]:
    prefix = result_set_prefix(tenant_id, slide_id, uuid.UUID(set_id))

    async def go(store: Any) -> tuple[CellSummary, list[Cell]]:
        results = ObjectResultStore(store)
        summary = await read_summary(results, prefix)
        cells = [
            cell
            for entry in summary.entries
            for cell in await read_chunk(results, entry.object_key)
        ]
        return summary, sorted(cells, key=lambda cell: cell.number)

    return with_store(go)


def imported(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path, slide_id: uuid.UUID, name: str, data: bytes
) -> dict[str, Any]:
    upload = upload_result(api, lab, name, data, slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path / "work")
    state = status_of(api, lab.lead, upload)
    assert state["status"] == "ready", state
    return state


def by_centre(cells: list[Cell]) -> dict[tuple[float, ...], int]:
    return {tuple(cell.ring): cell.number for cell in cells}


def test_a_qupath_export_imports_its_cells_into_chunks_of_a_ready_set(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "CMU-1-Small-Region")
    state = imported(api, database, lab, tmp_path, slide_id, "CMU-1-Small-Region.geojson", QUPATH)
    assert state["notices"] == []
    set_id = state["result_set_id"]
    detail = result_set(api, lab.colleague, set_id)
    assert (detail["status"], detail["region_count"], detail["cell_count"]) == ("ready", 1, 81)
    expected = qupath_classes()
    assert [(item["source_name"], item["object_count"]) for item in detail["classes"]] == [
        ("Tumor", 1 + expected["Tumor"]),
        ("Immune cells", expected["Immune cells"]),
    ]

    summary, cells = stored(lab.tenant_id, slide_id, set_id)
    assert [cell.number for cell in cells] == list(range(1, 82))
    assert sorted(summary.numbers()) == list(range(1, 82))
    assert {cell.region for cell in cells} == {1}
    assert all(cell.nucleus and cell.probs is None for cell in cells)
    totals = [sum(entry.class_counts[position] for entry in summary.entries) for position in (0, 1)]
    assert totals == [expected["Tumor"], expected["Immune cells"]]
    names = keys_under(f"t/{lab.tenant_id}/s/{slide_id}/results/{set_id}/")
    assert names == {
        "source.geojson",
        "summary.pfc",
        *(e.object_key.rsplit("/", 1)[1] for e in summary.entries),
    }
    rows = owner(
        database,
        f"SELECT sum(cell_count), count(*) FROM result_chunks WHERE result_set_id = '{set_id}'",
    )
    assert rows == [(81, len(summary.entries))]
    assert single(
        database,
        f"SELECT last FROM slide_counters WHERE slide_id = '{slide_id}' AND letter = 'C'",
    ) == (81,)


def test_a_second_import_of_the_same_export_inherits_every_cell_number(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "CMU-1-Small-Region")
    first = imported(api, database, lab, tmp_path, slide_id, "first.geojson", QUPATH)
    second = imported(api, database, lab, tmp_path, slide_id, "second.geojson", QUPATH)
    assert first["result_set_id"] != second["result_set_id"]

    _, before = stored(lab.tenant_id, slide_id, first["result_set_id"])
    _, after = stored(lab.tenant_id, slide_id, second["result_set_id"])
    assert len(after) == 81
    assert by_centre(after) == by_centre(before)
    assert single(
        database,
        f"SELECT last FROM slide_counters WHERE slide_id = '{slide_id}' AND letter = 'C'",
    ) == (81,)
    regions = owner(
        database,
        "SELECT result_set_id, number FROM result_objects WHERE kind = 'region' "
        f"AND result_set_id IN ('{first['result_set_id']}', '{second['result_set_id']}')",
    )
    assert sorted((str(set_id), number) for set_id, number in regions) == sorted(
        [(first["result_set_id"], 1), (second["result_set_id"], 1)]
    )


def test_a_file_of_only_cells_imports_them(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "Biopsy")
    state = imported(api, database, lab, tmp_path, slide_id, "cells.tsv", CELLS_TSV)
    detail = result_set(api, lab.lead, state["result_set_id"])
    assert (detail["name"], detail["region_count"], detail["cell_count"]) == ("CSV import", 0, 2)
    assert [(item["source_name"], item["object_count"]) for item in detail["classes"]] == [
        ("Tumor", 1),
        ("Stroma", 1),
    ]
    _, cells = stored(lab.tenant_id, slide_id, state["result_set_id"])
    assert [(c.number, c.ring, c.class_index, c.score, c.region) for c in cells] == [
        (1, [10.0, 20.0], 0, 204, 0),
        (2, [30.0, 40.0], 1, 153, 0),
    ]


def reviewer_of(database: str, lab: Lab) -> MemberPrincipal:
    reviewer = person(database, lab.tenant_id, "reviewer", Role.REVIEWER)
    join_project(database, lab.project, reviewer, "reviewer")
    return reviewer


def ordered(
    api: ApiAs,
    lab: Lab,
    reviewer: MemberPrincipal,
    slide_id: uuid.UUID,
    set_id: str,
    scope: dict[str, Any],
) -> list[str]:
    task = api(lab.lead).post(
        f"/api/projects/{lab.project}/review-tasks",
        json={
            "name": f"Imported cells, {scope['kind']}",
            "slide_ids": [str(slide_id)],
            "result_sets": [{"slide_id": str(slide_id), "result_set_id": set_id}],
            "reviewer_ids": [str(reviewer.user_id)],
            "split": "everyone",
            "scope": scope,
        },
    )
    assert task.status_code == 201, task.text
    order = api(reviewer).get(
        f"/api/review-tasks/{task.json()['id']}/slides/{slide_id}/order",
        params={"limit": 1000},
    )
    assert order.status_code == 200, order.text
    return [item["object"] for item in order.json()["objects"]]


def test_review_tasks_with_a_cell_scope_order_the_imported_cells_from_storage(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "CMU-1-Small-Region")
    state = imported(api, database, lab, tmp_path, slide_id, "cells.geojson", QUPATH)
    reviewer = reviewer_of(database, lab)
    every_cell = {f"C{number}" for number in range(1, 82)}

    below = ordered(
        api,
        lab,
        reviewer,
        slide_id,
        state["result_set_id"],
        {"kind": "cells-below-score", "score": 0.3},
    )
    assert sorted(below) == sorted(every_cell)

    sample = ordered(
        api, lab, reviewer, slide_id, state["result_set_id"], {"kind": "random-cells", "count": 10}
    )
    assert len(sample) == len(set(sample)) == 10
    assert set(sample) <= every_cell
