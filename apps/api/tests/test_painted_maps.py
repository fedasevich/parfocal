import base64
import math
import struct
import uuid
from dataclasses import dataclass

import pytest
from db_support import ApiAs
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.painted_maps import MEDIA_TYPE, PaintedMapFileError, read_painted_map
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

WIDTH = 1_000
HEIGHT = 600
CELL = 100
TILE_CELLS = 4


def painted_file(
    cells: dict[tuple[int, int], int],
    width: int = WIDTH,
    height: int = HEIGHT,
    cell: int = CELL,
    tile_cells: int = TILE_CELLS,
) -> bytes:
    columns = math.ceil(width / cell)
    rows = math.ceil(height / cell)
    tiles: dict[tuple[int, int], bytearray] = {}
    for (column, row), value in cells.items():
        key = (row // tile_cells, column // tile_cells)
        tile_width = min(tile_cells, columns - key[1] * tile_cells)
        tile_height = min(tile_cells, rows - key[0] * tile_cells)
        values = tiles.setdefault(key, bytearray(tile_width * tile_height))
        values[(row % tile_cells) * tile_width + column % tile_cells] = value
    body = b"".join(
        struct.pack("<HH", column, row) + bytes(values)
        for (row, column), values in sorted(tiles.items())
    )
    header = struct.pack("<4sHHIIII", b"PFPM", 1, tile_cells, cell, width, height, len(tiles))
    return header + body


def encoded(content: bytes) -> str:
    return base64.b64encode(content).decode()


def test_a_painted_map_file_is_read_and_its_painted_cells_counted() -> None:
    content = painted_file({(0, 0): 255, (1, 0): 80, (9, 5): 1})
    read = read_painted_map(content)
    assert (read.cell, read.tile_cells, read.width, read.height) == (
        CELL,
        TILE_CELLS,
        WIDTH,
        HEIGHT,
    )
    assert read.painted_cells == 3


def test_the_file_reader_matches_the_viewer_engine_encoding() -> None:
    empty = painted_file({})
    assert empty.hex() == "5046504d0100040064000000e803000058020000" + "00000000"
    one = painted_file({(0, 0): 255})
    assert len(one) == 24 + 4 + 16
    assert one[24:28] == b"\x00\x00\x00\x00"
    assert one[28] == 255


@pytest.mark.parametrize(
    "content",
    [
        b"PFPM",
        b"XXXX" + painted_file({})[4:],
        painted_file({(0, 0): 9})[:-1],
        painted_file({(0, 0): 9}) + b"\x00",
        painted_file({}, cell=8),
        struct.pack("<4sHHIIII", b"PFPM", 2, TILE_CELLS, CELL, WIDTH, HEIGHT, 0),
        struct.pack("<4sHHIIII", b"PFPM", 1, TILE_CELLS, CELL, WIDTH, HEIGHT, 1)
        + struct.pack("<HH", 7, 0)
        + bytes(16),
        struct.pack("<4sHHIIII", b"PFPM", 1, TILE_CELLS, CELL, WIDTH, HEIGHT, 2)
        + struct.pack("<HH", 1, 0)
        + bytes(16)
        + struct.pack("<HH", 0, 0)
        + bytes(16),
    ],
    ids=["short", "magic", "cut", "extra", "cell", "format", "outside", "order"],
)
def test_a_damaged_painted_map_file_is_refused(content: bytes) -> None:
    with pytest.raises(PaintedMapFileError):
        read_painted_map(content)


@dataclass(frozen=True)
class Studio:
    people: dict[str, MemberPrincipal]
    project: uuid.UUID
    slide: uuid.UUID

    @property
    def path(self) -> str:
        return f"/api/slides/{self.slide}/painted-maps"


def make_slide(
    database: str, tenant_id: uuid.UUID, project_id: uuid.UUID, measured: bool = True
) -> uuid.UUID:
    size = f"{WIDTH}, {HEIGHT}" if measured else "NULL, NULL"
    rows = owner(
        database,
        "INSERT INTO slides (tenant_id, project_id, label, width, height) "
        f"VALUES ('{tenant_id}', '{project_id}', 'Slide {uuid.uuid4().hex[:8]}', {size}) "
        "RETURNING id",
    )
    return uuid.UUID(str(rows[0][0]))


def studio(database: str, measured: bool = True) -> Studio:
    workspace = make_workspace(
        database,
        {"owner": Role.RESEARCHER, "viewer": Role.RESEARCHER, "outsider": Role.RESEARCHER},
    )
    project = make_project(database, workspace.tenant_id, "de-identified")
    join_project(database, project, workspace.people["owner"], "owner")
    join_project(database, project, workspace.people["viewer"], "viewer")
    return Studio(
        workspace.people, project, make_slide(database, workspace.tenant_id, project, measured)
    )


@pytest.mark.db
def test_a_painted_map_is_stored_versioned_and_exported_byte_for_byte(
    api: ApiAs, database: str
) -> None:
    s = studio(database)
    client = api(s.people["owner"])
    first = painted_file({(0, 0): 255, (5, 2): 120})
    created = client.post(s.path, json={"name": "Tumor bed", "content": encoded(first)})
    assert created.status_code == 201, created.text
    made = created.json()
    assert (made["name"], made["version"], made["cell"], made["tile_cells"]) == (
        "Tumor bed",
        1,
        CELL,
        TILE_CELLS,
    )
    assert made["painted_cells"] == 2
    one = f"{s.path}/{made['id']}"

    second = painted_file({(0, 0): 255, (5, 2): 120, (9, 5): 200})
    saved = client.put(one, json={"version": 1, "content": encoded(second), "name": "Tumor"})
    assert saved.status_code == 200, saved.text
    assert (saved.json()["version"], saved.json()["painted_cells"], saved.json()["name"]) == (
        2,
        3,
        "Tumor",
    )

    listed = client.get(s.path)
    assert [entry["id"] for entry in listed.json()] == [made["id"]]
    versions = client.get(f"{one}/versions").json()
    assert [(entry["version"], entry["painted_cells"]) for entry in versions] == [(1, 2), (2, 3)]

    old = client.get(f"{one}/versions/1")
    assert old.status_code == 200, old.text
    assert base64.b64decode(old.json()["content"]) == first
    exported = client.get(f"{one}/versions/2/file")
    assert exported.status_code == 200, exported.text
    assert exported.headers["content-type"] == MEDIA_TYPE
    assert "attachment" in exported.headers["content-disposition"]
    assert exported.content == second

    again = client.post(s.path, json={"name": "Reimported", "content": encoded(exported.content)})
    assert again.status_code == 201, again.text
    copy = client.get(f"{s.path}/{again.json()['id']}/versions/1/file")
    assert copy.content == second
    assert client.get(f"{one}/versions/3").status_code == 404


@pytest.mark.db
def test_a_stale_save_and_a_changed_grid_are_refused(api: ApiAs, database: str) -> None:
    s = studio(database)
    client = api(s.people["owner"])
    created = client.post(s.path, json={"name": "Map", "content": encoded(painted_file({}))})
    one = f"{s.path}/{created.json()['id']}"
    content = encoded(painted_file({(1, 1): 5}))
    assert client.put(one, json={"version": 1, "content": content}).status_code == 200
    stale = client.put(one, json={"version": 1, "content": content})
    assert (stale.status_code, stale.json()["code"]) == (409, "painted-map-changed")
    coarser = encoded(painted_file({}, cell=200))
    changed = client.put(one, json={"version": 2, "content": coarser})
    assert (changed.status_code, changed.json()["code"]) == (409, "painted-map-grid-changed")


@pytest.mark.db
def test_a_file_for_another_slide_or_an_unmeasured_slide_is_refused(
    api: ApiAs, database: str
) -> None:
    s = studio(database)
    client = api(s.people["owner"])
    other_size = encoded(painted_file({}, width=2_000))
    mismatch = client.post(s.path, json={"name": "Map", "content": other_size})
    assert (mismatch.status_code, mismatch.json()["code"]) == (409, "painted-map-slide-mismatch")
    garbage = client.post(s.path, json={"name": "Map", "content": encoded(b"not a map")})
    assert (garbage.status_code, garbage.json()["code"]) == (400, "painted-map-file")
    not_base64 = client.post(s.path, json={"name": "Map", "content": "%%%"})
    assert (not_base64.status_code, not_base64.json()["code"]) == (400, "painted-map-file")
    unmeasured = studio(database, measured=False)
    refused = api(unmeasured.people["owner"]).post(
        unmeasured.path, json={"name": "Map", "content": encoded(painted_file({}))}
    )
    assert (refused.status_code, refused.json()["code"]) == (409, "slide-not-measured")


@pytest.mark.db
def test_only_drawers_paint_only_readers_see_and_other_workspaces_see_nothing(
    api: ApiAs, database: str
) -> None:
    s = studio(database)
    created = api(s.people["owner"]).post(
        s.path, json={"name": "Map", "content": encoded(painted_file({(0, 0): 1}))}
    )
    one = f"{s.path}/{created.json()['id']}"
    viewer = api(s.people["viewer"])
    assert viewer.get(s.path).status_code == 200
    assert viewer.get(f"{one}/versions/1/file").status_code == 200
    refused = viewer.post(s.path, json={"name": "Map", "content": encoded(painted_file({}))})
    assert (refused.status_code, refused.json()["code"]) == (403, "annotating-not-allowed")
    outsider = api(s.people["outsider"])
    assert outsider.get(s.path).status_code == 404
    assert outsider.get(f"{one}/versions").status_code == 404
    stranger = studio(database)
    elsewhere = api(stranger.people["owner"])
    assert elsewhere.get(s.path).status_code == 404
    assert elsewhere.get(f"{stranger.path}/{created.json()['id']}/versions").status_code == 404
