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
from workspace_support import join_project, make_project, make_slide, make_workspace

from parfocal_api.tables import Role
from parfocal_common.embedding_cache import (
    EMBEDDING_BYTES,
    SERVER_ENCODER,
    EmbeddingManifest,
    bitset,
    manifest_key,
    tile_key,
)
from parfocal_common.object_store import ObjectStore, StorageLocation

MANIFEST = EmbeddingManifest(
    encoder=SERVER_ENCODER,
    level=0,
    downsample=1.0,
    tile=512,
    level_width=1200,
    level_height=1000,
    columns=3,
    rows=2,
    tiles=bitset(3, 2, {(0, 0), (2, 1)}),
)
TILE = np.arange(EMBEDDING_BYTES // 2, dtype="<f2").tobytes()


@dataclass(frozen=True)
class Lab:
    api: ApiAs
    people: dict[str, Any]
    slide: uuid.UUID
    bare: uuid.UUID

    def path(self, tail: str = "", slide: uuid.UUID | None = None) -> str:
        return f"/api/slides/{slide or self.slide}/embeddings{tail}"


def put_objects(objects: dict[str, bytes]) -> None:
    async def go() -> None:
        async with httpx2.AsyncClient(timeout=30) as http:
            store = ObjectStore(TEST_STORAGE, http)
            for key, body in objects.items():
                await store.put_object(key, body, "application/octet-stream")

    asyncio.run(go())


@pytest.fixture(scope="module")
def lab(database: str, storage: StorageLocation) -> Iterator[Lab]:
    assert storage == TEST_STORAGE
    workspace = make_workspace(database, {"owner": Role.RESEARCHER, "unassigned": Role.REVIEWER})
    people: dict[str, Any] = dict(workspace.people)
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["unassigned"], "reviewer")
    slide = make_slide(database, workspace.tenant_id, project, "E1")
    bare = make_slide(database, workspace.tenant_id, project, "E2")
    tenant = workspace.tenant_id
    put_objects(
        {
            manifest_key(tenant, slide): MANIFEST.render(),
            tile_key(tenant, slide, 0, 0): TILE,
            tile_key(tenant, slide, 2, 1): TILE[:100],
        }
    )
    with api_as(database) as api:
        yield Lab(api, people, slide, bare)


@pytest.mark.db
def test_the_manifest_names_the_encoder_and_the_cached_tiles(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(lab.path())
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["encoder"] == SERVER_ENCODER
    assert (body["dtype"], body["dims"]) == ("float16-le", [1, 256, 64, 64])
    assert (body["tile"], body["columns"], body["rows"], body["tile_count"]) == (512, 3, 2, 2)
    assert "max-age" in response.headers["cache-control"]


@pytest.mark.db
def test_a_cached_tile_is_served_as_float16_bytes(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(lab.path("/0/0"))
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/octet-stream"
    assert response.content == TILE


@pytest.mark.db
def test_a_missing_or_short_tile_answers_missing(lab: Lab) -> None:
    for tail in ("/1/0", "/2/1"):
        response = lab.api(lab.people["owner"]).get(lab.path(tail))
        assert (response.status_code, response.json()["code"]) == (404, "embedding-tile-missing")


@pytest.mark.db
def test_a_slide_without_embeddings_answers_missing(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(lab.path(slide=lab.bare))
    assert (response.status_code, response.json()["code"]) == (404, "embeddings-missing")


@pytest.mark.db
def test_a_person_who_cannot_read_the_slide_gets_no_embeddings(lab: Lab) -> None:
    for tail in ("", "/0/0"):
        response = lab.api(lab.people["unassigned"]).get(lab.path(tail))
        assert response.status_code == 404, response.text
        assert response.json()["code"] not in ("embeddings-missing", "embedding-tile-missing")
