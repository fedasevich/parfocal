import base64
import io
import json
import threading
from collections.abc import Iterator
from dataclasses import dataclass, field, replace
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

import numpy as np
import pytest
from PIL import Image

from parfocal_common.chunk_store import read_chunk
from parfocal_common.jobs import StepFailedError
from parfocal_common.lab_model_call import Endpoint, SignIn
from parfocal_common.link_fetch import policy_of
from parfocal_common.model_runs import tile_key
from parfocal_ml.lab_detector import LabDetector, LabModelSpec, lab_tile_core
from parfocal_ml.whole_slide import Tile, Window, plan_tiles, run_tiles

TOKEN = "lab-token-7c41e09d3f9a"
PREFIX = "tenant/slide/run"
SLIDE = Window(0, 0, 1000, 600)
SLIDE_MPP = 0.25
CLASSES = ("Tumor", "Immune", "Stroma")


def square(x: float, y: float, side: float = 12) -> dict[str, Any]:
    ring = [[x, y], [x + side, y], [x + side, y + side], [x, y + side], [x, y]]
    return {"type": "Polygon", "coordinates": [ring]}


@dataclass
class FakeLab:
    port: int = 0
    bodies: list[dict[str, Any]] = field(default_factory=list[dict[str, Any]])
    headers: list[dict[str, str]] = field(default_factory=list[dict[str, str]])
    refuse_first: int = 0
    version_after: dict[int, str] = field(default_factory=dict[int, str])

    @property
    def origin(self) -> str:
        return f"127.0.0.1:{self.port}"

    def answer(self, body: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        call = len(self.bodies)
        self.bodies.append(body)
        if call < self.refuse_first:
            return 503, {"error": "busy"}
        x, y = body["origin"]
        version = next(
            (changed for after, changed in sorted(self.version_after.items()) if call >= after),
            "2.1",
        )
        return 200, {
            "model": "lab-hovernet",
            "version": version,
            "objects": [
                {"kind": "cell", "class": "neoplastic", "geometry": square(x + 20, y + 20)},
                {"kind": "cell", "class": "inflammatory", "geometry": square(x + 60, y + 30)},
                {"kind": "cell", "class": "dead", "geometry": square(x + 90, y + 90)},
                {"kind": "cell", "class": "neoplastic", "geometry": square(x - 30, y + 40, 40)},
                {"kind": "region", "class": "tumor", "geometry": square(x, y, 100)},
            ],
        }


@pytest.fixture
def lab() -> Iterator[FakeLab]:
    fake = FakeLab()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format: str, *args: Any) -> None:
            return

        def do_POST(self) -> None:
            length = int(self.headers.get("content-length") or 0)
            fake.headers.append({name.lower(): value for name, value in self.headers.items()})
            status, answer = fake.answer(json.loads(self.rfile.read(length)))
            data = json.dumps(answer).encode()
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    fake.port = server.server_address[1]
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield fake
    finally:
        server.shutdown()
        server.server_close()


class FlatReader:
    mpp = SLIDE_MPP

    def __init__(self) -> None:
        self.reads: list[tuple[Window, int, int]] = []

    async def read(self, window: Window, width: int, height: int) -> np.ndarray:
        self.reads.append((window, width, height))
        return np.full((height, width, 3), (200, 120, 170), dtype=np.uint8)


class MemoryStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    async def get(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return self.objects[object_key]

    async def put(self, object_key: str, data: bytes) -> None:
        self.objects[object_key] = data


@dataclass
class MemoryProgress:
    marked: dict[int, int] = field(default_factory=dict[int, int])

    async def done(self) -> frozenset[int]:
        return frozenset(self.marked)

    async def total(self, count: int) -> None:
        return None

    async def mark(self, tile: Tile, objects: int) -> None:
        self.marked[tile.index] = objects

    async def should_stop(self) -> bool:
        return False


def spec_for(lab: FakeLab) -> LabModelSpec:
    return LabModelSpec(
        name="lab-hovernet",
        version="v2.1",
        endpoint=Endpoint(f"http://{lab.origin}/parfocal/infer", SignIn.TOKEN, TOKEN),
        tile_size=256,
        magnification=20,
        class_map={"neoplastic": "Tumor", "inflammatory": "Immune", "dead": None},
        classes=CLASSES,
    )


def detector_for(lab: FakeLab, pauses: list[float]) -> tuple[LabDetector, FlatReader]:
    reader = FlatReader()

    async def pause(seconds: float) -> None:
        pauses.append(seconds)

    detector = LabDetector(spec_for(lab), reader, policy_of([lab.origin]), pause=pause)
    return detector, reader


async def test_a_lab_model_runs_one_tile_per_call_into_stored_cells(lab: FakeLab) -> None:
    detector, reader = detector_for(lab, [])
    core = lab_tile_core(SLIDE_MPP, detector.spec)
    assert core == 512
    plan = plan_tiles(SLIDE, SLIDE, core, 0)
    store, progress = MemoryStore(), MemoryProgress()
    ran = await run_tiles(plan, plan.tiles, detector, store, PREFIX, progress)
    assert ran == len(plan.tiles) == 4
    assert [body["origin"] for body in lab.bodies] == [[0, 0], [512, 0], [0, 512], [512, 512]]
    assert {(body["size"], body["magnification"]) for body in lab.bodies} == {(256, 20)}
    assert {header["authorization"] for header in lab.headers} == {f"Bearer {TOKEN}"}
    edge = Image.open(io.BytesIO(base64.b64decode(lab.bodies[3]["tile"].split(",", 1)[1])))
    assert edge.size == (256, 256)
    assert reader.reads[3] == (Window(512, 512, 488, 88), 244, 44)
    for tile in plan.tiles:
        cells = await read_chunk(store, tile_key(PREFIX, tile.index))
        assert [CLASSES[cell.class_index] for cell in cells] == ["Tumor", "Immune", "Tumor"]
        assert progress.marked[tile.index] == 3
    first = await read_chunk(store, tile_key(PREFIX, 0))
    assert min(first[0].ring[0::2]) == 20
    assert (detector.regions_left_out, detector.classes_left_out) == (4, 4)
    assert detector.answered == ("lab-hovernet", "2.1")


async def test_a_cell_reaching_past_the_tile_is_clipped_to_it(lab: FakeLab) -> None:
    detector, _ = detector_for(lab, [])
    cells = await detector.detect(Window(512, 0, 488, 512))
    reaching = cells[2].ring
    assert (min(reaching[0::2]), max(reaching[0::2])) == (512, 522)


async def test_a_refused_tile_is_retried_twice_with_a_pause(lab: FakeLab) -> None:
    pauses: list[float] = []
    lab.refuse_first = 2
    detector, _ = detector_for(lab, pauses)
    cells = await detector.detect(Window(0, 0, 512, 512))
    assert len(cells) == 3
    assert len(lab.bodies) == 3
    assert pauses == [2.0, 4.0]


async def test_a_tile_refused_three_times_fails_the_run_with_the_refusal(lab: FakeLab) -> None:
    pauses: list[float] = []
    lab.refuse_first = 3
    detector, _ = detector_for(lab, pauses)
    with pytest.raises(StepFailedError) as failed:
        await detector.detect(Window(0, 0, 512, 512))
    assert failed.value.code == "lab-model-status"
    assert len(lab.bodies) == 3


async def test_a_server_answering_another_version_mid_run_fails_with_lab_model_changed(
    lab: FakeLab,
) -> None:
    lab.version_after = {2: "2.2"}
    detector, _ = detector_for(lab, [])
    plan = plan_tiles(SLIDE, SLIDE, 512, 0)
    store, progress = MemoryStore(), MemoryProgress()
    with pytest.raises(StepFailedError) as failed:
        await run_tiles(plan, plan.tiles, detector, store, PREFIX, progress)
    assert failed.value.code == "lab-model-changed"
    assert sorted(progress.marked) == [0, 1]
    assert len(store.objects) == 2


async def test_a_private_address_is_never_called(lab: FakeLab) -> None:
    detector, _ = detector_for(lab, [])
    detector.policy = policy_of([])
    with pytest.raises(StepFailedError) as failed:
        await detector.detect(Window(0, 0, 512, 512))
    assert failed.value.code.startswith("lab-model-")
    assert lab.bodies == []


async def test_a_mapped_region_is_kept_for_its_tile_and_clipped_to_it(lab: FakeLab) -> None:
    detector, _ = detector_for(lab, [])
    detector.spec = replace(detector.spec, class_map={**detector.spec.class_map, "tumor": "Tumor"})
    window = Window(512, 0, 64, 512)
    cells = await detector.detect(window)
    assert len(cells) == 3
    [region] = detector.take_regions(window)
    assert region.class_index == 0
    assert (min(region.ring[0::2]), max(region.ring[0::2])) == (512, 576)
    assert detector.take_regions(window) == []
    assert detector.regions_left_out == 0
