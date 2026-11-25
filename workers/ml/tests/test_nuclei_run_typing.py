import asyncio
import uuid
from collections.abc import AsyncGenerator, Mapping
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

import numpy as np
import pytest
from fixture_support import fixture_path
from nuclei_support import StainMaps, disks
from tumor_map_support import MemoryStore

from parfocal_common.cell_chunks import UNCLASSIFIED
from parfocal_common.chunk_store import Cell, cells_in, chunk_of
from parfocal_common.jobs import StepRun
from parfocal_common.model_artifacts import MissingArtifactError
from parfocal_common.model_runs import RunScopeKind, RunSettings, run_prefix, tile_key
from parfocal_common.object_store import ObjectStore
from parfocal_common.outline_types import TYPER_CLASSES
from parfocal_ml import nuclei_run_worker
from parfocal_ml.nuclei_run_worker import TYPER_MISSING, loaded_typer, nuclei_running
from parfocal_ml.sam_contract import onnx_dir
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.typer import CLASS_CHANNELS

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-000000000002")
JOB = uuid.UUID("00000000-0000-4000-8000-000000000003")
RADIUS = 9.0
NEOPLASTIC, CONNECTIVE = 1, 3
TISSUE = (200, 120, 170)
TYPER_GRAPH = onnx_dir() / "hovernext-pannuke.typer.onnx"


class PixelReader:
    def __init__(self, rgb: np.ndarray) -> None:
        self.rgb = rgb

    def read(self, x: int, y: int, width: int, height: int) -> np.ndarray:
        out = np.full((height, width, 3), 255, np.uint8)
        top, left = max(0, y), max(0, x)
        bottom, right = min(self.rgb.shape[0], y + height), min(self.rgb.shape[1], x + width)
        if bottom > top and right > left:
            out[top - y : bottom - y, left - x : right - x] = self.rgb[top:bottom, left:right]
        return out


def slide_of(rgb: np.ndarray, mpp: float) -> SlideImage:
    downsample = 16
    height, width = rgb.shape[:2]
    return SlideImage(
        reader=PixelReader(rgb),
        thumbnail=rgb[::downsample, ::downsample].copy(),
        downsample=float(downsample),
        width=width,
        height=height,
        mpp=mpp,
    )


@dataclass
class FakeStep:
    input: Mapping[str, Any] = field(default_factory=lambda: {"slide_id": str(SLIDE)})
    tenant_id: uuid.UUID = TENANT
    job_id: uuid.UUID = JOB
    units: dict[int, Mapping[str, Any]] = field(default_factory=dict[int, Mapping[str, Any]])
    total: int | None = None

    @asynccontextmanager
    async def transaction(self) -> AsyncGenerator[None]:
        yield None

    async def done_units(self) -> frozenset[int]:
        return frozenset(self.units)

    async def set_total(self, total: int) -> None:
        self.total = total

    async def mark_unit(
        self, connection: object, unit: int, result: Mapping[str, Any] | None = None
    ) -> None:
        self.units[unit] = dict(result or {})

    async def should_stop(self) -> bool:
        return False


def settings(scope: Mapping[str, int] | None = None) -> RunSettings:
    return RunSettings(
        scope_kind=RunScopeKind.SLIDE if scope is None else RunScopeKind.VIEW,
        scope=scope,
        detector="pathosam-hovernext",
        detector_version="v1.2",
    )


@pytest.fixture
def no_database(monkeypatch: pytest.MonkeyPatch) -> list[RunSettings]:
    chosen = [settings()]

    async def run_of(step: object, slide_id: uuid.UUID) -> tuple[RunSettings, str | None]:
        return chosen[0], None

    async def no_gpu_seconds(step: object, seconds: float, gpu: str | None = None) -> None:
        return None

    monkeypatch.setattr(nuclei_run_worker, "run_of", run_of)
    monkeypatch.setattr(nuclei_run_worker, "report_gpu_seconds", no_gpu_seconds)
    return chosen


def ran(slide: SlideImage, typer: Any) -> tuple[FakeStep, Mapping[str, Any], MemoryStore]:
    async def open_slide(tenant: uuid.UUID, slide_id: uuid.UUID, folder: str | None):
        return slide

    store, step = MemoryStore(), FakeStep()
    running = nuclei_running(open_slide, StainMaps(RADIUS), store, None, typer)
    found = asyncio.run(running(cast("StepRun", step)))
    assert found is not None
    return step, found, store


def stored_cells(store: MemoryStore, step: FakeStep) -> list[Cell]:
    prefix = run_prefix(TENANT, SLIDE, JOB)
    cells: list[Cell] = []
    for unit in sorted(step.units):
        header, arrays = chunk_of(store.objects[tile_key(prefix, unit)])
        assert header["classes"] == len(TYPER_CLASSES)
        cells += cells_in(header, arrays)
    return cells


def dark_is_neoplastic(rgb: np.ndarray) -> np.ndarray:
    dark = rgb.mean(axis=2) < 128
    class_map = np.zeros((CLASS_CHANNELS, *dark.shape), np.float32)
    class_map[0] = 0.1
    class_map[NEOPLASTIC] = np.where(dark, 0.8, 0.1)
    class_map[CONNECTIVE] = np.where(dark, 0.1, 0.8)
    return class_map


def disk_slide() -> SlideImage:
    centres = [(float(x), float(y)) for y in range(60, 1000, 80) for x in range(60, 1500, 80)]
    rgb = disks(1024, 1536, centres, RADIUS)
    rgb[(rgb == 240).all(axis=2)] = TISSUE
    return slide_of(rgb, 0.25)


def test_a_run_types_every_cell_it_stores_with_the_typer_classes_and_probabilities(
    no_database: list[RunSettings],
) -> None:
    step, found, store = ran(disk_slide(), dark_is_neoplastic)
    cells = stored_cells(store, step)
    assert len(cells) > 100
    assert "untyped" not in found
    assert all(cell.class_index == TYPER_CLASSES.index("tumor") for cell in cells)
    assert all(cell.probs is not None and len(cell.probs) == 4 for cell in cells)
    assert all(cell.probs[0] == max(cell.probs) for cell in cells if cell.probs)
    assert sum(unit["typed"] for unit in step.units.values()) == len(cells)
    assert sum(unit["objects"] for unit in step.units.values()) == len(cells)


def test_without_typer_weights_the_run_finishes_with_untyped_cells_and_says_why(
    no_database: list[RunSettings],
) -> None:
    step, found, store = ran(disk_slide(), None)
    cells = stored_cells(store, step)
    assert len(cells) > 100
    assert found["untyped"] == TYPER_MISSING
    assert all(cell.class_index == UNCLASSIFIED and cell.probs is None for cell in cells)
    assert all("typed" not in unit for unit in step.units.values())


def test_a_typer_that_cannot_be_fetched_loads_as_none(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    async def missing(storage: object, folder: Path) -> None:
        raise MissingArtifactError("hovernext-pannuke v1.2 has no file typer.onnx")

    monkeypatch.setattr(nuclei_run_worker, "fetched_typer", missing)
    assert asyncio.run(loaded_typer(cast("ObjectStore", object()), tmp_path)) is None


@pytest.mark.weights
def test_the_real_typer_types_every_cell_of_a_fixture_slide_run(
    no_database: list[RunSettings],
) -> None:
    from parfocal_ml.outline_typer_worker import OnnxTyper

    pytest.importorskip("onnxruntime")
    if not TYPER_GRAPH.exists():
        pytest.skip(f"The HoVer-NeXt typer graph is not at {TYPER_GRAPH}")
    openslide = pytest.importorskip("openslide")
    source = openslide.OpenSlide(str(fixture_path("CMU-1-Small-Region.svs")))
    rgb = np.asarray(source.read_region((0, 0), 0, source.dimensions).convert("RGB"))
    slide = slide_of(rgb, float(source.properties["openslide.mpp-x"]))
    no_database[0] = settings({"x": 600, "y": 800, "width": 1024, "height": 1024})
    step, found, store = ran(slide, OnnxTyper(TYPER_GRAPH))
    cells = stored_cells(store, step)
    assert len(cells) > 50
    assert "untyped" not in found
    assert all(0 <= cell.class_index < len(TYPER_CLASSES) for cell in cells)
    assert all(cell.probs is not None and max(cell.probs) > 0 for cell in cells)
    assert all(cell.probs[cell.class_index] == max(cell.probs) for cell in cells if cell.probs)
    assert len({cell.class_index for cell in cells}) > 1
