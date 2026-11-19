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
from parfocal_common.settings import StorageSettings, load_settings
from parfocal_common.view_embeddings import (
    ENCODER_VERSION,
    ENCODER_WEIGHTS,
    ViewEmbeddingCallError,
    reply_of,
    view_embedding_call_of,
)
from parfocal_common.view_maps import timed
from parfocal_ml.embedding_service import Encoder, pack_embedding
from parfocal_ml.sam_contract import pixel_values
from parfocal_ml.stored_slides import StoredSlides
from parfocal_ml.tumor_map_job import SlideImage, SlideOpener
from parfocal_ml.tumor_map_worker import PROVIDERS, STORAGE_TIMEOUT_SECONDS

WEIGHTS_NAME = "encoder.onnx"
INPUT_NAME = "pixel_values"

type Setup = Callable[[AsyncExitStack], Awaitable[tuple[SlideOpener, Encoder]]]


class OnnxEncoder:
    def __init__(self, path: Path) -> None:
        import onnxruntime as ort

        available = set(ort.get_available_providers())
        chosen = [provider for provider in PROVIDERS if provider in available]
        self.session = ort.InferenceSession(str(path), providers=chosen)

    def __call__(self, pixels: NDArray[np.float32]) -> NDArray[np.float32]:
        outputs = self.session.run(None, {INPUT_NAME: pixels})
        return np.asarray(outputs[0], np.float32)


def view_pixels(slide: SlideImage, x: int, y: int, width: int, height: int) -> NDArray[np.uint8]:
    if x + width > slide.width or y + height > slide.height:
        raise ViewEmbeddingCallError("The view reaches past the slide")
    return slide.reader.read(x, y, width, height)


async def answer_view_embedding(
    call: Mapping[str, object], open_slide: SlideOpener, encode: Encoder
) -> dict[str, object]:
    request = view_embedding_call_of(call)
    slide = await open_slide(request.tenant_id, request.slide_id, request.folder)
    rgb = view_pixels(slide, request.x, request.y, request.width, request.height)
    return reply_of(pack_embedding(encode(pixel_values(rgb))))


class ViewEmbeddingService:
    def __init__(self, setup: Setup) -> None:
        self.setup = setup
        self.lock = threading.Lock()
        self.loop = asyncio.Runner()
        self.stack = AsyncExitStack()
        self.ready: tuple[SlideOpener, Encoder] | None = None

    def answer(self, call: Mapping[str, object]) -> dict[str, object]:
        with self.lock:
            started = time.perf_counter()
            reply = self.loop.run(self.answered(call))
            return timed(reply, time.perf_counter() - started)

    async def answered(self, call: Mapping[str, object]) -> dict[str, object]:
        if self.ready is None:
            async with AsyncExitStack() as attempt:
                ready = await self.setup(attempt)
                await self.stack.enter_async_context(attempt.pop_all())
            self.ready = ready
        open_slide, encode = self.ready
        return await answer_view_embedding(call, open_slide, encode)

    def close(self) -> None:
        with self.lock:
            self.loop.run(self.stack.aclose())
            self.ready = None
            self.loop.close()


async def fetched_encoder(storage: ObjectStore, folder: Path) -> OnnxEncoder:
    weights = folder / WEIGHTS_NAME
    await ModelArtifacts(storage).fetch(ENCODER_WEIGHTS, ENCODER_VERSION, WEIGHTS_NAME, weights)
    return await asyncio.to_thread(OnnxEncoder, weights)


async def stored_setup(stack: AsyncExitStack) -> tuple[SlideOpener, Encoder]:
    location = load_settings(StorageSettings).storage()
    http = await stack.enter_async_context(httpx2.AsyncClient(timeout=STORAGE_TIMEOUT_SECONDS))
    folder = Path(stack.enter_context(tempfile.TemporaryDirectory()))
    storage = ObjectStore(location, http)
    encoder = await fetched_encoder(storage, folder)
    slides = StoredSlides(storage, folder / "slides")
    stack.callback(slides.close)
    return slides.open, encoder


@cache
def stored_service() -> ViewEmbeddingService:
    return ViewEmbeddingService(stored_setup)


def answer_view_embedding_call(call: Mapping[str, object]) -> dict[str, object]:
    return stored_service().answer(call)
