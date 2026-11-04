import base64
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs, api_as
from workspace_support import join_project, make_project, make_slide, make_workspace, owner

from parfocal_api.slide_coverage import grid_for
from parfocal_api.tables import Role

WIDTH = 8192
HEIGHT = 4096
GRID = {"cell": 64, "columns": 128, "rows": 64}


def view_cells(left: int, right: int, top: int, bottom: int) -> list[int]:
    return [
        row * GRID["columns"] + column
        for row in range(top, bottom)
        for column in range(left, right)
    ]


PAN_PATH = [view_cells(0, 32, 0, 16), view_cells(16, 48, 0, 16), view_cells(32, 64, 0, 16)]


@dataclass(frozen=True)
class Lab:
    api: ApiAs
    people: dict[str, Any]
    slide: uuid.UUID
    unmeasured: uuid.UUID

    def path(self, slide: uuid.UUID | None = None) -> str:
        return f"/api/slides/{slide or self.slide}/coverage"


@pytest.fixture(scope="module")
def lab(database: str) -> Iterator[Lab]:
    workspace = make_workspace(
        database,
        {"owner": Role.RESEARCHER, "colleague": Role.RESEARCHER, "unassigned": Role.REVIEWER},
    )
    people: dict[str, Any] = dict(workspace.people)
    people["outsider"] = make_workspace(database, {"outsider": Role.RESEARCHER}).people["outsider"]
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["colleague"], "owner")
    join_project(database, project, people["unassigned"], "reviewer")
    slide = make_slide(database, workspace.tenant_id, project, "A1")
    owner(database, f"UPDATE slides SET width = {WIDTH}, height = {HEIGHT} WHERE id = '{slide}'")
    unmeasured = make_slide(database, workspace.tenant_id, project, "A2")
    with api_as(database) as api:
        yield Lab(api, people, slide, unmeasured)


def seen_cells(body: dict[str, Any]) -> set[int]:
    bits = base64.b64decode(body["seen"])
    return {index for index in range(len(bits) * 8) if bits[index >> 3] & (1 << (index & 7))}


def test_the_grid_matches_the_viewer_engine() -> None:
    assert grid_for(WIDTH, HEIGHT).model_dump() == GRID
    assert grid_for(100_000, 80_000).model_dump() == {"cell": 128, "columns": 782, "rows": 625}
    assert grid_for(1, 1).model_dump() == {"cell": 64, "columns": 1, "rows": 1}


@pytest.mark.db
def test_a_scripted_pan_path_is_kept_per_person_and_survives_a_reload(lab: Lab) -> None:
    me = lab.api(lab.people["owner"])
    empty = me.get(lab.path())
    assert empty.status_code == 200, empty.text
    assert empty.json()["grid"] == GRID
    assert empty.json()["seen_cells"] == 0
    assert empty.json()["updated_at"] is None
    assert len(base64.b64decode(empty.json()["seen"])) == 128 * 64 // 8
    for cells in PAN_PATH:
        response = me.post(lab.path(), json={"grid": GRID, "cells": cells})
        assert response.status_code == 200, response.text
    reloaded = me.get(lab.path()).json()
    expected = set(view_cells(0, 64, 0, 16))
    assert seen_cells(reloaded) == expected
    assert reloaded["seen_cells"] == 1024
    assert reloaded["seen_cells"] / (128 * 64) == 0.125
    assert reloaded["updated_at"] is not None
    other = lab.api(lab.people["colleague"]).get(lab.path()).json()
    assert other["seen_cells"] == 0


@pytest.mark.db
def test_a_batch_on_another_grid_or_outside_the_grid_is_refused(lab: Lab) -> None:
    me = lab.api(lab.people["owner"])
    wrong = me.post(lab.path(), json={"grid": {**GRID, "cell": 128}, "cells": [0]})
    assert (wrong.status_code, wrong.json()["code"]) == (409, "coverage-grid-mismatch")
    outside = me.post(lab.path(), json={"grid": GRID, "cells": [128 * 64]})
    assert (outside.status_code, outside.json()["code"]) == (400, "coverage-cell-outside")
    empty = me.post(lab.path(), json={"grid": GRID, "cells": []})
    assert empty.status_code == 422


@pytest.mark.db
def test_a_slide_without_a_size_has_no_coverage(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(lab.path(lab.unmeasured))
    assert (response.status_code, response.json()["code"]) == (409, "slide-not-measured")


@pytest.mark.db
@pytest.mark.parametrize("who", ["outsider", "unassigned"])
def test_a_person_who_cannot_read_the_slide_keeps_no_coverage(lab: Lab, who: str) -> None:
    response = lab.api(lab.people[who]).post(lab.path(), json={"grid": GRID, "cells": [0]})
    assert response.status_code == 404, response.text
