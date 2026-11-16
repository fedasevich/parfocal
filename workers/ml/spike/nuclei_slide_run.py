import asyncio
import contextlib
import json
import os
import subprocess
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import modal

from parfocal_ml.gpu_pool import POOLS, Family
from parfocal_ml.modal_pool import pool_image

APP_NAME = "parfocal-spike-nuclei-throughput"
POOL = next(pool for pool in POOLS if pool.family is Family.DETECTOR_BEST)
TIMEOUT_SECONDS = 70 * 60
DEADLINE_SECONDS = 66 * 60
TARGET_SECONDS = 60 * 60
CLEARLY_OVER = 1.15
RATE_TILES = 8
PRINT_EVERY = 25
REMOTE_ONNX = "/models/onnx"
SLIDE_FOLDER = "/tmp/slides"
FIXTURE = "test_001.tif"
FIXTURE_SHA256 = "eda774b4f9f44eba0aead16a5fdf27a9452b7769f569b553d330ff7fc6719f0e"
GRAPH_NAMES = ("pathosam.encoder.onnx", "pathosam.ais_decoder_full.onnx")
CUDA = "CUDAExecutionProvider"
STORAGE_KEYS = ("R2_ENDPOINT", "R2_BUCKET", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY")


def repository_env() -> dict[str, str]:
    default = Path(__file__).resolve().parents[3] / ".env"
    source = Path(os.environ.get("PARFOCAL_ENV_FILE", default))
    values: dict[str, str] = {}
    for line in source.read_text().splitlines():
        name, _, value = line.partition("=")
        if name.strip() in STORAGE_KEYS:
            values[name.strip()] = value.strip().strip('"')
    missing = [name for name in STORAGE_KEYS if name not in values]
    if missing:
        raise SystemExit(f"The root .env lacks {', '.join(missing)}")
    return values


def spike_image() -> modal.Image:
    image = pool_image()
    if not modal.is_local():
        return image
    local = Path.home() / ".cache" / "parfocal" / "models" / "onnx"
    for name in GRAPH_NAMES:
        image = image.add_local_file((local / name).resolve(), f"{REMOTE_ONNX}/{name}")
    return image


app = modal.App(APP_NAME, image=spike_image())
secrets = [modal.Secret.from_dict(repository_env())] if modal.is_local() else []


@dataclass
class Clock:
    started: float = field(default_factory=time.perf_counter)
    parts: dict[str, float] = field(default_factory=dict)

    def elapsed(self) -> float:
        return time.perf_counter() - self.started

    def add(self, name: str, seconds: float) -> None:
        self.parts[name] = self.parts.get(name, 0.0) + seconds


def gpu_report() -> str:
    query = "--query-gpu=name,driver_version,memory.used,memory.total"
    done = subprocess.run(
        ["nvidia-smi", query, "--format=csv,noheader"], capture_output=True, text=True
    )
    return done.stdout.strip()


async def downloaded(clock: Clock) -> Path:
    import httpx2

    from parfocal_common.object_store import ObjectStore, StorageLocation

    location = StorageLocation(
        endpoint=os.environ["R2_ENDPOINT"].rstrip("/"),
        region="auto",
        bucket=os.environ["R2_BUCKET"],
        access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    )
    folder = Path(SLIDE_FOLDER)
    await asyncio.to_thread(folder.mkdir, parents=True, exist_ok=True)
    target = folder / FIXTURE
    partial = target.with_name(target.name + ".part")
    started = time.perf_counter()
    async with httpx2.AsyncClient(timeout=120.0) as http:
        result = await ObjectStore(location, http).download(f"fixtures/{FIXTURE}", partial)
    if result.sha256 != FIXTURE_SHA256:
        raise RuntimeError(f"{FIXTURE} arrived with SHA-256 {result.sha256}")
    partial.replace(target)
    clock.add("download", time.perf_counter() - started)
    return target


def measure_sync(full: bool) -> dict[str, object]:
    return asyncio.run(measure(full))


async def measure(full: bool) -> dict[str, object]:
    import numpy as np
    import openslide
    from PIL import Image

    from parfocal_common.jobs import JobStoppedError
    from parfocal_ml.nuclei import OnnxPathoSam, PathoSamDetector, Quality
    from parfocal_ml.stored_slides import LevelTable, opened
    from parfocal_ml.whole_slide import Tile, Window, plan_tiles, run_tiles, tile_sizes

    clock = Clock()
    path = await downloaded(clock)
    started = time.perf_counter()
    raw = openslide.OpenSlide(str(path))
    mpp = float(raw.properties["openslide.mpp-x"])
    table = LevelTable(raw.dimensions[0], raw.dimensions[1], mpp, raw.level_count)
    raw.close()
    slide = opened(path, table)
    tissue = slide.tissue()
    core, halo = tile_sizes(mpp, Quality.BEST.mpp)
    whole = Window(0, 0, slide.width, slide.height)
    plan = plan_tiles(whole, whole, core, halo, tissue)
    clock.add("open_and_plan", time.perf_counter() - started)

    started = time.perf_counter()
    model = OnnxPathoSam(Path(REMOTE_ONNX), providers=[CUDA, "CPUExecutionProvider"])
    providers = {
        "encoder": model.encoder.get_providers(),
        "decoder": model.decoder.get_providers(),
    }
    if providers["encoder"][0] != CUDA or providers["decoder"][0] != CUDA:
        return {"error": "the graphs did not load on CUDA", "providers": providers}
    clock.add("model_load", time.perf_counter() - started)

    class TimedReader:
        def __init__(self) -> None:
            self.mpp = mpp

        async def read(self, window: Window, width: int, height: int):
            began = time.perf_counter()
            rgb = slide.reader.read(window.x, window.y, window.width, window.height)
            resized = np.asarray(
                Image.fromarray(rgb).resize((width, height), Image.Resampling.BILINEAR)
            )
            clock.add("read", time.perf_counter() - began)
            return resized

    class TimedModel:
        windows = 0

        def maps(self, rgb):
            began = time.perf_counter()
            result = model.maps(rgb)
            clock.add("maps", time.perf_counter() - began)
            TimedModel.windows += 1
            return result

    detector = PathoSamDetector(TimedReader(), TimedModel(), Quality.BEST)

    class TimedDetector:
        classes = detector.classes
        cells = 0

        async def detect(self, window: Window):
            began = time.perf_counter()
            found = await detector.detect(window)
            clock.add("detect", time.perf_counter() - began)
            TimedDetector.cells += len(found)
            return found

    started = time.perf_counter()
    warm_windows = TimedModel.windows
    first = plan.tiles[len(plan.tiles) // 2]
    await detector.detect(plan.window_of(first))
    warm_seconds = time.perf_counter() - started
    clock.parts.pop("read", None)
    clock.parts.pop("maps", None)
    warm_windows = TimedModel.windows - warm_windows
    TimedModel.windows = 0

    step = max(1, len(plan.tiles) // RATE_TILES)
    sampled = plan.tiles[::step][:RATE_TILES]
    chosen = {tile.index for tile in sampled}
    order = list(sampled) + [tile for tile in plan.tiles if tile.index not in chosen]

    @dataclass
    class Store:
        objects: int = 0
        bytes: int = 0

        async def put(self, object_key: str, data: bytes) -> None:
            self.objects += 1
            self.bytes += len(data)

    @dataclass
    class Progress:
        marked: int = 0
        objects: int = 0
        tiles_started: float = 0.0
        rate_seconds: float | None = None
        projected: float | None = None
        stopped: str | None = None

        async def done(self) -> frozenset[int]:
            return frozenset()

        async def total(self, count: int) -> None:
            self.tiles_started = time.perf_counter()

        async def mark(self, tile: Tile, objects: int) -> None:
            self.marked += 1
            self.objects += objects
            if self.marked == RATE_TILES:
                self.rate_seconds = (time.perf_counter() - self.tiles_started) / RATE_TILES
                self.projected = clock.elapsed() + self.rate_seconds * (len(order) - RATE_TILES)
                print(
                    f"rate {self.rate_seconds:.2f} s per tile, projected {self.projected:.0f} s",
                    flush=True,
                )
            if self.marked % PRINT_EVERY == 0:
                print(f"{self.marked}/{len(order)} tiles at {clock.elapsed():.0f} s", flush=True)

        async def should_stop(self) -> bool:
            if self.marked == RATE_TILES and self.projected is not None:
                if not full:
                    self.stopped = "rate check only"
                elif self.projected > TARGET_SECONDS * CLEARLY_OVER:
                    self.stopped = "projected clearly over one hour"
            if self.stopped is None and clock.elapsed() > DEADLINE_SECONDS:
                self.stopped = "internal deadline"
            return self.stopped is not None

    store = Store()
    progress = Progress()
    with contextlib.suppress(JobStoppedError):
        await run_tiles(plan, order, TimedDetector(), store, "spike/", progress)
    tiles_seconds = time.perf_counter() - progress.tiles_started
    return {
        "fixture": FIXTURE,
        "slide": {"width": slide.width, "height": slide.height, "mpp": mpp},
        "tissue_cells": int(tissue.sum()),
        "core": core,
        "halo": halo,
        "tiles_planned": len(plan.tiles),
        "tiles_done": progress.marked,
        "windows_done": TimedModel.windows,
        "cells_detected": TimedDetector.cells,
        "cells_stored": progress.objects,
        "chunk_bytes": store.bytes,
        "stopped": progress.stopped,
        "rate_seconds_per_tile": progress.rate_seconds,
        "projected_seconds": progress.projected,
        "warm_up": {"seconds": warm_seconds, "windows": warm_windows},
        "tiles_seconds": tiles_seconds,
        "wall_seconds": clock.elapsed(),
        "parts": clock.parts,
        "providers": providers,
        "gpu": gpu_report(),
        "cpu_count": os.cpu_count(),
        "region": os.environ.get("MODAL_REGION"),
        "task": os.environ.get("MODAL_TASK_ID"),
    }


measure_remote = app.function(
    gpu=POOL.gpu.value if POOL.gpu is not None else None,
    memory=(POOL.memory_request_mib, POOL.memory_limit_mib),
    timeout=TIMEOUT_SECONDS,
    secrets=secrets,
)(measure_sync)


@app.local_entrypoint()
def main(full: bool = True, out: str = "") -> None:
    started = time.perf_counter()
    reply = measure_remote.remote(full)
    reply["client_seconds"] = time.perf_counter() - started
    reply["pool"] = {"family": POOL.family.value, "gpu": POOL.gpu.value if POOL.gpu else None}
    text = json.dumps(reply, indent=2)
    print(text)
    if out:
        Path(out).write_text(text)
    sys.stdout.flush()
