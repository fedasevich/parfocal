import asyncio
import logging
import os
import tempfile
import time
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import httpx2
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_common.chunk_store import Cell
from parfocal_common.db import create_engine
from parfocal_common.gpu_usage import report_gpu_seconds
from parfocal_common.ingest import folder_of
from parfocal_common.jobs import StepFailedError, StepFunction, StepRun, Workflow
from parfocal_common.model_artifacts import ModelArtifacts
from parfocal_common.model_runs import (
    MODEL_STAGE,
    NUCLEI_DETECTORS,
    STAGES,
    Detectors,
    ModelTier,
    RunScopeKind,
    RunSettings,
    claim_model_run,
    model_runs,
    run_model_run,
    run_prefix,
    settings_of,
    workflow,
)
from parfocal_common.object_store import ObjectStore
from parfocal_common.outline_types import SINGLE_VIEW, TYPER_CLASSES, TYPER_TEMPERATURES
from parfocal_common.result_store import ObjectResultStore, ResultStore
from parfocal_common.settings import StorageSettings, load_settings
from parfocal_ml.lab_model_worker import STORAGE_TIMEOUT_SECONDS, ScaledReader, passed
from parfocal_ml.nuclei import MapModel, OnnxPathoSam, PathoSamDetector, Quality
from parfocal_ml.outline_typer import typed_outlines
from parfocal_ml.outline_typer_worker import fetched_typer
from parfocal_ml.run_result_set import result_set_stages
from parfocal_ml.sam_contract import GRAPHS
from parfocal_ml.stored_slides import StoredSlides
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.tumor_map_worker import Drain, drain_of, refuse_cpu_on_a_gpu, worker_name
from parfocal_ml.typer import Model as TyperModel
from parfocal_ml.typer import TypedNucleus
from parfocal_ml.whole_slide import (
    Detector,
    StepProgress,
    Window,
    plan_tiles,
    run_tiles,
    tile_sizes,
)

NOT_SERVED = "model-not-served"
NO_SCALE = "model-run-no-scale"
NO_AREA = "model-run-no-area"
TYPER_MISSING = "typer-weights-missing"
TYPER_NOT_ASKED = "typer-not-asked"
PROBABILITY_SCALE = 255
WEIGHTS_FAMILY = "pathosam-vit-b-ais"
WEIGHTS_VERSION = "v1.2"
WEIGHTS_FILES = (GRAPHS.encoder, GRAPHS.ais_decoder_full)

type SlideOpener = Callable[[uuid.UUID, uuid.UUID, str | None], Awaitable[SlideImage]]
ORIGINAL_KEY = text("SELECT original_key FROM slides WHERE id = :slide_id")
logger = logging.getLogger("parfocal.nuclei_runs")


def probability_byte(value: float) -> int:
    return max(0, min(PROBABILITY_SCALE, round(value * PROBABILITY_SCALE)))


def typed_cell(cell: Cell, nucleus: TypedNucleus) -> Cell:
    return replace(
        cell,
        class_index=TYPER_CLASSES.index(nucleus.type),
        probs=[probability_byte(nucleus.probabilities[name]) for name in TYPER_CLASSES],
    )


def typed_cells(
    slide: SlideImage, cells: Sequence[Cell], typer: TyperModel, temperature: float
) -> list[Cell]:
    if not cells:
        return []
    nuclei = typed_outlines(slide, [tuple(cell.ring) for cell in cells], typer, temperature)
    return [typed_cell(cell, nucleus) for cell, nucleus in zip(cells, nuclei, strict=True)]


@dataclass
class TypingDetector:
    detector: Detector
    slide: SlideImage
    typer: TyperModel | None
    temperature: float = TYPER_TEMPERATURES[SINGLE_VIEW]
    classes: int = len(TYPER_CLASSES)

    async def detect(self, window: Window) -> Sequence[Cell]:
        cells = await self.detector.detect(window)
        if self.typer is None:
            return cells
        return await asyncio.to_thread(typed_cells, self.slide, cells, self.typer, self.temperature)


def quality_of(settings: RunSettings) -> Quality:
    return Quality.BEST if settings.tier in (None, ModelTier.BEST) else Quality.FAST


def points_of(coordinates: Any) -> list[tuple[float, float]]:
    if (
        isinstance(coordinates, Sequence)
        and len(coordinates) >= 2
        and all(isinstance(value, int | float) for value in coordinates[:2])
    ):
        return [(float(coordinates[0]), float(coordinates[1]))]
    if isinstance(coordinates, Sequence) and not isinstance(coordinates, str):
        return [point for item in coordinates for point in points_of(item)]
    return []


def bounds_of(settings: RunSettings, slide: Window) -> Window:
    scope = settings.scope or {}
    if settings.scope_kind is RunScopeKind.VIEW:
        return Window(int(scope["x"]), int(scope["y"]), int(scope["width"]), int(scope["height"]))
    if settings.scope_kind is RunScopeKind.SELECTION:
        geometry = scope.get("geometry")
        points = points_of(geometry.get("coordinates")) if isinstance(geometry, Mapping) else []
        if not points:
            raise StepFailedError(NO_AREA)
        xs, ys = [x for x, _ in points], [y for _, y in points]
        left, top = int(min(xs)), int(min(ys))
        return Window(left, top, int(max(xs)) - left + 1, int(max(ys)) - top + 1)
    return slide


async def run_of(step: StepRun, slide_id: uuid.UUID) -> tuple[RunSettings, str | None]:
    async with step.transaction() as connection:
        row = (
            await connection.execute(select(model_runs).where(model_runs.c.job_id == step.job_id))
        ).one()
        original = await connection.scalar(ORIGINAL_KEY, {"slide_id": slide_id})
    return settings_of(row), None if original is None else folder_of(str(original))


def nuclei_running(
    slide_of: SlideOpener,
    model: MapModel,
    store: ResultStore,
    gpu: str | None = None,
    typer: TyperModel | None = None,
) -> StepFunction:
    async def run(step: StepRun) -> Mapping[str, Any]:
        slide_id = uuid.UUID(str(step.input["slide_id"]))
        settings, folder = await run_of(step, slide_id)
        if settings.detector not in NUCLEI_DETECTORS:
            raise StepFailedError(NOT_SERVED)
        image = await slide_of(step.tenant_id, slide_id, folder)
        if image.mpp is None:
            raise StepFailedError(NO_SCALE)
        quality = quality_of(settings)
        whole = Window(0, 0, image.width, image.height)
        tissue = image.tissue()
        core, halo = tile_sizes(image.mpp, quality.mpp)
        plan = plan_tiles(whole, bounds_of(settings, whole), core, halo, tissue)
        typing = typer if settings.typer is not None else None
        detector = TypingDetector(
            PathoSamDetector(ScaledReader(image.reader, image.mpp), model, quality, tissue=tissue),
            image,
            typing,
        )
        prefix = run_prefix(step.tenant_id, slide_id, step.job_id)
        started = time.perf_counter()
        progress = StepProgress(step, typing=typing is not None)
        ran = await run_tiles(plan, plan.tiles, detector, store, prefix, progress)
        seconds = time.perf_counter() - started
        if ran:
            await report_gpu_seconds(step, seconds, gpu)
        found = {"tiles": len(plan.tiles), "ran": ran, "seconds": round(seconds, 1)}
        if settings.typer is None:
            return {**found, "untyped": TYPER_NOT_ASKED}
        return found if typing is not None else {**found, "untyped": TYPER_MISSING}

    return run


def nuclei_run_workflow(
    slide_of: SlideOpener,
    model: MapModel,
    store: ResultStore,
    gpu: str | None = None,
    typer: TyperModel | None = None,
) -> Workflow:
    stages: dict[str, StepFunction] = dict.fromkeys(STAGES, passed)
    stages[MODEL_STAGE] = nuclei_running(slide_of, model, store, gpu, typer)
    stages.update(result_set_stages(store))
    return workflow(stages)


async def drain_nuclei_runs(
    engine: AsyncEngine,
    plan: Workflow,
    worker: str,
    drain: Drain,
    sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> int:
    finished = 0
    idle = 0.0
    while idle < drain.idle_exit_seconds:
        claimed = await claim_model_run(
            engine, worker, plan, drain.tenant_id, detectors=Detectors.PARFOCAL
        )
        if claimed is None:
            await sleep(drain.poll_seconds)
            idle += drain.poll_seconds
            continue
        await run_model_run(engine, claimed, worker)
        finished += 1
        idle = 0.0
    return finished


async def fetched_weights(storage: ObjectStore, folder: Path) -> Path:
    artifacts = ModelArtifacts(storage)
    for name in WEIGHTS_FILES:
        await artifacts.fetch(WEIGHTS_FAMILY, WEIGHTS_VERSION, name, folder / name)
    return folder


async def loaded_typer(storage: ObjectStore, folder: Path) -> TyperModel | None:
    try:
        return await fetched_typer(storage, folder)
    except Exception as error:
        logger.warning("The cells stay untyped, because the typer did not load: %s", error)
        return None


async def drained_from_environment(call: Mapping[str, object], gpu: str | None) -> int:
    location = load_settings(StorageSettings).storage()
    engine = create_engine(os.environ["DATABASE_URL"])
    try:
        async with httpx2.AsyncClient(timeout=STORAGE_TIMEOUT_SECONDS) as http:
            storage = ObjectStore(location, http)
            with tempfile.TemporaryDirectory() as folder:
                weights = await fetched_weights(storage, Path(folder))
                model = await asyncio.to_thread(OnnxPathoSam, weights)
                refuse_cpu_on_a_gpu(tuple(model.encoder.get_providers()), gpu)
                typer = await loaded_typer(storage, Path(folder))
                slides = StoredSlides(storage, Path(folder))
                try:
                    results = ObjectResultStore(storage)
                    plan = nuclei_run_workflow(slides.open, model, results, gpu, typer)
                    return await drain_nuclei_runs(engine, plan, worker_name(), drain_of(call))
                finally:
                    slides.close()
    finally:
        await engine.dispose()


def run_nuclei_runs(call: Mapping[str, object], gpu: str | None = None) -> dict[str, Any]:
    return {"finished": asyncio.run(drained_from_environment(call, gpu))}
