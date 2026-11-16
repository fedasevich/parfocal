import asyncio
import os
import socket
import tempfile
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx2
import numpy as np
from numpy.typing import NDArray
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_common.db import create_engine
from parfocal_common.jobs import work
from parfocal_common.model_artifacts import ModelArtifacts
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_store import ObjectResultStore, ResultStore
from parfocal_common.settings import StorageSettings, load_settings
from parfocal_common.tumor_maps import MODEL, MODEL_VERSION
from parfocal_ml.sam_contract import onnx_dir
from parfocal_ml.stored_slides import StoredSlides
from parfocal_ml.tumor_map import Rgb, Scorer
from parfocal_ml.tumor_map_job import tumor_map_workflow

WEIGHTS_NAME = "model.onnx"
LOCAL_WEIGHTS = "camelyon-tumor.onnx"
INPUT_NAME = "pixels"
PROVIDERS = ("CUDAExecutionProvider", "CPUExecutionProvider")
DEFAULT_IDLE_EXIT_SECONDS = 30.0
DEFAULT_POLL_SECONDS = 1.0
STORAGE_TIMEOUT_SECONDS = 60.0


def local_weights(folder: Path | None = None) -> Path | None:
    path = (folder or onnx_dir()) / LOCAL_WEIGHTS
    return path if path.is_file() else None


class OnnxTumorScorer:
    def __init__(self, path: Path) -> None:
        import onnxruntime as ort

        available = set(ort.get_available_providers())
        chosen = [provider for provider in PROVIDERS if provider in available]
        self.session = ort.InferenceSession(str(path), providers=chosen)
        self.providers = tuple(self.session.get_providers())

    def score(self, rgb: Rgb) -> NDArray[np.float32]:
        scaled = rgb.astype(np.float32) / 127.5 - 1.0
        pixels = np.ascontiguousarray(scaled.transpose(2, 0, 1)[None])
        logits = np.asarray(self.session.run(None, {INPUT_NAME: pixels})[0], np.float32)
        return (1.0 / (1.0 + np.exp(-logits[0, 0]))).astype(np.float32)


@dataclass(frozen=True)
class Drain:
    idle_exit_seconds: float = DEFAULT_IDLE_EXIT_SECONDS
    poll_seconds: float = DEFAULT_POLL_SECONDS
    tenant_id: uuid.UUID | None = None


def drain_of(call: Mapping[str, object]) -> Drain:
    idle = call.get("idle_exit_seconds", DEFAULT_IDLE_EXIT_SECONDS)
    poll = call.get("poll_seconds", DEFAULT_POLL_SECONDS)
    tenant = call.get("tenant_id")
    return Drain(
        float(idle) if isinstance(idle, int | float) else DEFAULT_IDLE_EXIT_SECONDS,
        float(poll) if isinstance(poll, int | float) else DEFAULT_POLL_SECONDS,
        uuid.UUID(tenant) if isinstance(tenant, str) else None,
    )


async def drain_tumor_maps(
    engine: AsyncEngine,
    slides: StoredSlides,
    scorer: Scorer,
    store: ResultStore,
    worker: str,
    drain: Drain,
    gpu: str | None = None,
) -> int:
    plan = tumor_map_workflow(slides.open, scorer, store, gpu=gpu)
    try:
        return await work(
            engine, [plan], worker, drain.idle_exit_seconds, drain.poll_seconds, drain.tenant_id
        )
    finally:
        slides.close()


def worker_name() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


async def drained_from_storage(
    engine: AsyncEngine,
    storage: ObjectStore,
    scorer: Scorer,
    call: Mapping[str, object],
    gpu: str | None = None,
) -> int:
    with tempfile.TemporaryDirectory() as folder:
        slides = StoredSlides(storage, Path(folder))
        store = ObjectResultStore(storage)
        return await drain_tumor_maps(
            engine, slides, scorer, store, worker_name(), drain_of(call), gpu
        )


async def fetched_scorer(storage: ObjectStore, folder: Path) -> OnnxTumorScorer:
    weights = folder / WEIGHTS_NAME
    await ModelArtifacts(storage).fetch(MODEL, MODEL_VERSION, WEIGHTS_NAME, weights)
    return OnnxTumorScorer(weights)


async def drained_from_environment(call: Mapping[str, object], gpu: str | None) -> int:
    engine = create_engine(os.environ["DATABASE_URL"])
    location = load_settings(StorageSettings).storage()
    try:
        async with httpx2.AsyncClient(timeout=STORAGE_TIMEOUT_SECONDS) as http:
            storage = ObjectStore(location, http)
            with tempfile.TemporaryDirectory() as folder:
                scorer = await fetched_scorer(storage, Path(folder))
                return await drained_from_storage(engine, storage, scorer, call, gpu)
    finally:
        await engine.dispose()


def run_tumor_maps(call: Mapping[str, object], gpu: str | None = None) -> dict[str, Any]:
    return {"finished": asyncio.run(drained_from_environment(call, gpu))}
