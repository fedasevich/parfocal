import asyncio
import tempfile
import threading
import time
from collections.abc import Awaitable, Callable, Mapping
from contextlib import AsyncExitStack
from functools import cache
from pathlib import Path

import httpx2
import numpy as np
from numpy.typing import NDArray

from parfocal_common.model_artifacts import ModelArtifacts
from parfocal_common.object_store import ObjectStore
from parfocal_common.outline_types import TYPER_VERSION, TYPER_WEIGHTS
from parfocal_common.settings import StorageSettings, load_settings
from parfocal_common.view_maps import timed
from parfocal_ml.outline_typer import answer_outline_types
from parfocal_ml.tumor_map_job import SlideOpener
from parfocal_ml.tumor_map_worker import PROVIDERS, STORAGE_TIMEOUT_SECONDS
from parfocal_ml.typer import ClassMap, Model
from parfocal_ml.view_map_worker import stored_opener

WEIGHTS_NAME = "typer.onnx"
INPUT_NAME = "pixels"

type Setup = Callable[[AsyncExitStack], Awaitable[tuple[SlideOpener, Model]]]


class OnnxTyper:
    def __init__(self, path: Path) -> None:
        import onnxruntime as ort

        available = set(ort.get_available_providers())
        chosen = [provider for provider in PROVIDERS if provider in available]
        self.session = ort.InferenceSession(str(path), providers=chosen)

    def __call__(self, rgb: NDArray[np.uint8]) -> ClassMap:
        pixels = np.ascontiguousarray(rgb[None])
        outputs = self.session.run(None, {INPUT_NAME: pixels})
        return np.asarray(outputs[0], np.float32)[0]


class OutlineTyperService:
    def __init__(self, setup: Setup) -> None:
        self.setup = setup
        self.lock = threading.Lock()
        self.loop = asyncio.Runner()
        self.stack = AsyncExitStack()
        self.ready: tuple[SlideOpener, Model] | None = None

    def answer(self, call: Mapping[str, object]) -> dict[str, object]:
        with self.lock:
            started = time.perf_counter()
            reply = self.loop.run(self.answered(call))
            return timed(reply, time.perf_counter() - started)

    async def answered(self, call: Mapping[str, object]) -> dict[str, object]:
        if self.ready is None:
            self.ready = await self.setup(self.stack)
        open_slide, model = self.ready
        return await answer_outline_types(call, open_slide, model)

    def close(self) -> None:
        with self.lock:
            self.loop.run(self.stack.aclose())
            self.ready = None
            self.loop.close()


async def fetched_typer(storage: ObjectStore, folder: Path) -> OnnxTyper:
    weights = folder / WEIGHTS_NAME
    await ModelArtifacts(storage).fetch(TYPER_WEIGHTS, TYPER_VERSION, WEIGHTS_NAME, weights)
    return OnnxTyper(weights)


async def stored_setup(stack: AsyncExitStack) -> tuple[SlideOpener, Model]:
    location = load_settings(StorageSettings).storage()
    http = await stack.enter_async_context(httpx2.AsyncClient(timeout=STORAGE_TIMEOUT_SECONDS))
    folder = Path(stack.enter_context(tempfile.TemporaryDirectory()))
    storage = ObjectStore(location, http)
    model = await fetched_typer(storage, folder)
    return await stored_opener(storage, folder / "slides", stack), model


@cache
def stored_service() -> OutlineTyperService:
    return OutlineTyperService(stored_setup)


def answer_outline_types_call(call: Mapping[str, object]) -> dict[str, object]:
    return stored_service().answer(call)
