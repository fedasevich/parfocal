import asyncio
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

from parfocal_api.model_catalogue import BY_NAME, ModelMakes
from parfocal_api.tables import Role
from parfocal_common.ingest import slide_prefix
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ingest.tissue import TissueMask

MODEL = "pathosam-hovernext"
TISSUE_CELLS = 400
MPP = 0.25


def mask_png() -> bytes:
    cells = np.zeros((40, 40), dtype=bool)
    cells[:20, :20] = True
    return TissueMask(64, 20, cells, None).png()


def put_object(key: str, body: bytes) -> None:
    async def go() -> None:
        async with httpx2.AsyncClient(timeout=30) as http:
            await ObjectStore(TEST_STORAGE, http).put_object(key, body, "image/png")

    asyncio.run(go())


@dataclass(frozen=True)
class Lab:
    api: ApiAs
    people: dict[str, Any]
    project: uuid.UUID
    measured: uuid.UUID
    unmeasured: uuid.UUID
    unscaled: uuid.UUID

    def path(self, name: str = MODEL) -> str:
        return f"/api/projects/{self.project}/models/{name}/estimates"


@pytest.fixture(scope="module")
def lab(database: str, storage: StorageLocation) -> Iterator[Lab]:
    assert storage == TEST_STORAGE
    workspace = make_workspace(database, {"owner": Role.RESEARCHER})
    people: dict[str, Any] = dict(workspace.people)
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, people["owner"], "owner")
    measured = make_slide(database, workspace.tenant_id, project, "E1")
    unmeasured = make_slide(database, workspace.tenant_id, project, "E2")
    unscaled = make_slide(database, workspace.tenant_id, project, "E3")
    owner(
        database,
        f"UPDATE slides SET width = 2560, height = 2560, mpp_x = {MPP}, mpp_y = {MPP} "
        f"WHERE id IN ('{measured}', '{unmeasured}')",
    )
    owner(
        database,
        f"UPDATE slides SET width = 2560, height = 2560, mpp_x = NULL, mpp_y = NULL "
        f"WHERE id = '{unscaled}'",
    )
    for slide in (measured, unscaled):
        put_object(f"{slide_prefix(workspace.tenant_id, slide)}tissue.png", mask_png())
    with api_as(database) as api:
        yield Lab(api, people, project, measured, unmeasured, unscaled)


def test_the_pathosam_run_makes_cells_only() -> None:
    assert BY_NAME[MODEL].makes == (ModelMakes.CELLS,)


@pytest.mark.db
def test_a_slide_with_tissue_gets_a_projected_time_and_cost(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(
        lab.path(), params={"slide_id": [str(lab.measured), str(lab.unmeasured)]}
    )
    assert response.status_code == 200, response.text
    first, second = response.json()
    area = TISSUE_CELLS * 64 * MPP * 64 * MPP / 1_000_000
    assert first["tissue_mm2"] == pytest.approx(area, abs=0.01)
    assert first["projected"] is True
    rate = BY_NAME[MODEL].projected_seconds_per_mm2
    assert rate is not None
    seconds = rate * area
    assert first["minutes"] == int(-(-seconds // 60))
    assert first["dollars"] > 0
    assert first["unknown_because"] is None
    assert (second["tissue_mm2"], second["minutes"], second["dollars"]) == (None, None, None)


@pytest.mark.db
def test_a_slide_with_a_scale_and_no_tissue_mask_says_the_mask_is_missing(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(
        lab.path(), params={"slide_id": [str(lab.unmeasured)]}
    )
    assert response.status_code == 200, response.text
    found = response.json()[0]
    assert (found["minutes"], found["dollars"]) == (None, None)
    assert found["unknown_because"] == "no-tissue-mask"


@pytest.mark.db
def test_a_slide_with_tissue_and_no_scale_says_the_scale_is_missing(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(
        lab.path(), params={"slide_id": [str(lab.unscaled)]}
    )
    assert response.status_code == 200, response.text
    found = response.json()[0]
    assert (found["tissue_mm2"], found["minutes"], found["dollars"]) == (None, None, None)
    assert found["unknown_because"] == "no-scale"


@pytest.mark.db
def test_a_model_without_a_rate_has_no_estimate(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(
        lab.path("hovernet"), params={"slide_id": [str(lab.measured)]}
    )
    assert response.status_code == 200, response.text
    assert response.json()[0]["minutes"] is None
    assert response.json()[0]["unknown_because"] == "no-rate"


@pytest.mark.db
def test_an_unknown_model_is_refused(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(
        lab.path("nope"), params={"slide_id": [str(lab.measured)]}
    )
    assert response.status_code == 400, response.text
