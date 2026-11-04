import asyncio
import base64
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from typing import Any

import httpx2
import numpy as np
import pytest
from db_support import ApiAs, api_as
from storage_support import TEST_STORAGE
from workspace_support import join_project, make_project, make_slide, make_workspace, owner

from parfocal_api.slide_coverage import grid_for
from parfocal_api.slide_tissue import read_mask, tissue_bits
from parfocal_api.tables import Role
from parfocal_common.ingest import slide_prefix
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ingest.tissue import TissueMask

WIDTH = 1280
HEIGHT = 900


def ingest_png(cells: Any) -> bytes:
    return TissueMask(64, 20, np.asarray(cells, dtype=bool), None).png()


def blob(columns: int, rows: int) -> Any:
    yy, xx = np.mgrid[0:rows, 0:columns]
    return (xx - columns / 2) ** 2 / (columns / 3) ** 2 + (yy - rows / 2) ** 2 / (rows / 3) ** 2 < 1


def bit_set(encoded: str) -> set[int]:
    bits = base64.b64decode(encoded)
    return {index for index in range(len(bits) * 8) if bits[index >> 3] & (1 << (index & 7))}


def test_the_ingest_png_reads_back_cell_for_cell() -> None:
    cells = np.random.default_rng(16).random((15, 21)) > 0.6
    mask = read_mask(ingest_png(cells))
    assert (mask.width, mask.height) == (21, 15)
    read = np.array([[mask.is_tissue(x, y) for x in range(21)] for y in range(15)])
    assert (read == cells).all()


def test_the_mask_lands_on_the_coverage_grid() -> None:
    cells = blob(20, 15)
    grid = grid_for(WIDTH, HEIGHT)
    bits = tissue_bits(grid, read_mask(ingest_png(cells)))
    expected = {int(y) * grid.columns + int(x) for y, x in zip(*np.nonzero(cells), strict=True)}
    assert bit_set(base64.b64encode(bits).decode()) == expected


def test_a_coarser_grid_keeps_every_tissue_cell() -> None:
    big = grid_for(100_000, 1000)
    assert big.cell == 128
    cells = np.zeros((16, 1563), dtype=bool)
    cells[3, 0] = cells[3, 1] = cells[9, 1561] = True
    bits = tissue_bits(big, read_mask(ingest_png(cells)))
    assert bit_set(base64.b64encode(bits).decode()) == {
        1 * big.columns + 0,
        4 * big.columns + 780,
    }


@dataclass(frozen=True)
class Lab:
    api: ApiAs
    people: dict[str, Any]
    slide: uuid.UUID
    bare: uuid.UUID

    def path(self, slide: uuid.UUID | None = None) -> str:
        return f"/api/slides/{slide or self.slide}/tissue"


def put_object(key: str, body: bytes) -> None:
    async def go() -> None:
        async with httpx2.AsyncClient(timeout=30) as http:
            await ObjectStore(TEST_STORAGE, http).put_object(key, body, "image/png")

    asyncio.run(go())


@pytest.fixture(scope="module")
def lab(database: str, storage: StorageLocation) -> Iterator[Lab]:
    assert storage == TEST_STORAGE
    workspace = make_workspace(database, {"owner": Role.RESEARCHER, "unassigned": Role.REVIEWER})
    people: dict[str, Any] = dict(workspace.people)
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["unassigned"], "reviewer")
    slide = make_slide(database, workspace.tenant_id, project, "T1")
    bare = make_slide(database, workspace.tenant_id, project, "T2")
    for made in (slide, bare):
        owner(database, f"UPDATE slides SET width = {WIDTH}, height = {HEIGHT} WHERE id = '{made}'")
    put_object(f"{slide_prefix(workspace.tenant_id, slide)}tissue.png", ingest_png(blob(20, 15)))
    with api_as(database) as api:
        yield Lab(api, people, slide, bare)


@pytest.mark.db
def test_the_stored_mask_is_served_on_the_coverage_grid(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(lab.path())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["grid"] == grid_for(WIDTH, HEIGHT).model_dump()
    expected = {int(y) * 20 + int(x) for y, x in zip(*np.nonzero(blob(20, 15)), strict=True)}
    assert bit_set(body["tissue"]) == expected
    assert body["tissue_cells"] == len(expected)
    assert "max-age" in response.headers["cache-control"]


@pytest.mark.db
def test_a_slide_without_a_stored_mask_answers_missing(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(lab.path(lab.bare))
    assert (response.status_code, response.json()["code"]) == (404, "tissue-mask-missing")


@pytest.mark.db
def test_a_person_who_cannot_read_the_slide_gets_no_mask(lab: Lab) -> None:
    response = lab.api(lab.people["unassigned"]).get(lab.path())
    assert response.status_code == 404, response.text
    assert response.json()["code"] != "tissue-mask-missing"
