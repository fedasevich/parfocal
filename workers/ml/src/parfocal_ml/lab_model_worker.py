import asyncio
import os
import tempfile
import uuid
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

import httpx2
import numpy as np
from PIL import Image
from pydantic import SecretStr
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_common.db import create_engine
from parfocal_common.envelope import MasterKeyring
from parfocal_common.jobs import StepFailedError, StepFunction, StepRun, Workflow
from parfocal_common.link_fetch import LinkPolicy, policy_of
from parfocal_common.model_runs import (
    MODEL_STAGE,
    STAGES,
    Detectors,
    claim_model_run,
    run_model_run,
    run_prefix,
    workflow,
)
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_store import ObjectResultStore, ResultStore
from parfocal_common.settings import StorageSettings, load_settings
from parfocal_ml.lab_model_stage import LabSlide, lab_model_running
from parfocal_ml.nuclei import Rgb
from parfocal_ml.stored_slides import StoredSlides
from parfocal_ml.tumor_map import RegionReader as LevelZeroReader
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.tumor_map_worker import Drain, drain_of, worker_name
from parfocal_ml.whole_slide import Window

NO_SCALE = "lab-model-no-scale"
STORAGE_TIMEOUT_SECONDS = 60.0


class LabSettings(StorageSettings):
    master_keys: SecretStr | None = None


class SlideOpener(Protocol):
    async def open(self, tenant_id: uuid.UUID, slide_id: uuid.UUID) -> SlideImage: ...


async def passed(step: StepRun) -> Mapping[str, Any]:
    await step.set_total(1)
    if 0 not in await step.done_units():
        async with step.transaction() as connection:
            await step.mark_unit(connection, 0)
    return {"units": 1}


@dataclass
class ScaledReader:
    source: LevelZeroReader
    mpp: float

    def scaled(self, window: Window, width: int, height: int) -> Rgb:
        rgb = self.source.read(window.x, window.y, window.width, window.height)
        if rgb.shape[:2] == (height, width):
            return rgb
        resized = Image.fromarray(rgb).resize((width, height), Image.Resampling.BILINEAR)
        return np.asarray(resized, dtype=np.uint8)

    async def read(self, window: Window, width: int, height: int) -> Rgb:
        return await asyncio.to_thread(self.scaled, window, width, height)


def stored_slide_of(slides: SlideOpener) -> Callable[[StepRun], Awaitable[LabSlide]]:
    async def slide_of(step: StepRun) -> LabSlide:
        slide_id = uuid.UUID(str(step.input["slide_id"]))
        image = await slides.open(step.tenant_id, slide_id)
        if image.mpp is None:
            raise StepFailedError(NO_SCALE)
        bounds = Window(0, 0, image.width, image.height)
        reader = ScaledReader(image.reader, image.mpp)
        return LabSlide(reader, bounds, run_prefix(step.tenant_id, slide_id, step.job_id))

    return slide_of


def lab_run_workflow(
    slides: SlideOpener,
    keyring: MasterKeyring | None,
    policy: LinkPolicy,
    store: ResultStore,
    pause: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> Workflow:
    running = lab_model_running(stored_slide_of(slides), keyring, policy, store, pause)
    stages: dict[str, StepFunction] = dict.fromkeys(STAGES, passed)
    stages[MODEL_STAGE] = running
    return workflow(stages)


async def drain_lab_runs(
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
            engine, worker, plan, drain.tenant_id, detectors=Detectors.LAB
        )
        if claimed is None:
            await sleep(drain.poll_seconds)
            idle += drain.poll_seconds
            continue
        await run_model_run(engine, claimed, worker)
        finished += 1
        idle = 0.0
    return finished


def keyring_of(settings: LabSettings) -> MasterKeyring | None:
    if settings.master_keys is None:
        return None
    return MasterKeyring.from_setting(settings.master_keys.get_secret_value())


async def drained_from_environment(call: Mapping[str, object]) -> int:
    settings = load_settings(LabSettings)
    engine = create_engine(os.environ["DATABASE_URL"])
    try:
        async with httpx2.AsyncClient(timeout=STORAGE_TIMEOUT_SECONDS) as http:
            storage = ObjectStore(settings.storage(), http)
            with tempfile.TemporaryDirectory() as folder:
                slides = StoredSlides(storage, Path(folder))
                try:
                    plan = lab_run_workflow(
                        slides,
                        keyring_of(settings),
                        policy_of(settings.link_trusted_origins),
                        ObjectResultStore(storage),
                    )
                    return await drain_lab_runs(engine, plan, worker_name(), drain_of(call))
                finally:
                    slides.close()
    finally:
        await engine.dispose()


def run_lab_models(call: Mapping[str, object]) -> dict[str, Any]:
    return {"finished": asyncio.run(drained_from_environment(call))}
