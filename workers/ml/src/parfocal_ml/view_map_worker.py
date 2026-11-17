import asyncio
import tempfile
import threading
import time
from collections.abc import Awaitable, Callable, Mapping
from contextlib import AsyncExitStack
from functools import cache
from pathlib import Path

import httpx2

from parfocal_common.object_store import ObjectStore
from parfocal_common.settings import StorageSettings, load_settings
from parfocal_common.view_maps import timed
from parfocal_ml.stored_slides import StoredSlides
from parfocal_ml.tumor_map import Scorer
from parfocal_ml.tumor_map_job import SlideOpener
from parfocal_ml.tumor_map_worker import STORAGE_TIMEOUT_SECONDS, fetched_scorer
from parfocal_ml.view_map import answer_view_tile

type Setup = Callable[[AsyncExitStack], Awaitable[tuple[SlideOpener, Scorer]]]


class ViewMapService:
    def __init__(self, setup: Setup) -> None:
        self.setup = setup
        self.lock = threading.Lock()
        self.loop = asyncio.Runner()
        self.stack = AsyncExitStack()
        self.ready: tuple[SlideOpener, Scorer] | None = None

    def answer(self, call: Mapping[str, object]) -> dict[str, object]:
        with self.lock:
            started = time.perf_counter()
            reply = self.loop.run(self.answered(call))
            return timed(reply, time.perf_counter() - started)

    async def answered(self, call: Mapping[str, object]) -> dict[str, object]:
        if self.ready is None:
            self.ready = await self.setup(self.stack)
        open_slide, scorer = self.ready
        return await answer_view_tile(call, open_slide, scorer)

    def close(self) -> None:
        with self.lock:
            self.loop.run(self.stack.aclose())
            self.ready = None
            self.loop.close()


async def stored_opener(storage: ObjectStore, folder: Path, stack: AsyncExitStack) -> SlideOpener:
    slides = StoredSlides(storage, folder)
    stack.callback(slides.close)
    return slides.open


async def stored_setup(stack: AsyncExitStack) -> tuple[SlideOpener, Scorer]:
    location = load_settings(StorageSettings).storage()
    http = await stack.enter_async_context(httpx2.AsyncClient(timeout=STORAGE_TIMEOUT_SECONDS))
    folder = Path(stack.enter_context(tempfile.TemporaryDirectory()))
    storage = ObjectStore(location, http)
    scorer = await fetched_scorer(storage, folder)
    return await stored_opener(storage, folder / "slides", stack), scorer


@cache
def stored_service() -> ViewMapService:
    return ViewMapService(stored_setup)


def answer_view_map(call: Mapping[str, object]) -> dict[str, object]:
    return stored_service().answer(call)
