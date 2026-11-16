import os
import socket
import time
from collections.abc import Callable, Mapping

import modal

from parfocal_common.repository import repository_root
from parfocal_ml.gpu_pool import (
    POOLS,
    Family,
    PoolLimits,
    concurrency_options,
    function_options,
    validate_pools,
)
from parfocal_ml.priority_gate import Kind, check_lane

APP_NAME = "parfocal-gpu-pool"
PYTHON_VERSION = "3.14"
CUDA_BASE = (
    "nvidia/cuda:13.3.1-cudnn-runtime-ubuntu24.04"
    "@sha256:2c9730db1d78ce3a7503a2f4ff2d64add3e7d1a47d57da504376192dda335242"
)
DATABASE_SECRET = "parfocal-api-keys"
STORAGE_SECRET = "parfocal-api-config"
TUMOR_MAP_SECRETS = (DATABASE_SECRET, STORAGE_SECRET)
VIEW_MAP_SECRETS = (STORAGE_SECRET,)
LOCK_PATH = "workers/deploy/locks/ml.txt"
UV_VERSION = "0.13.8"
LOCKED_INSTALL_OPTIONS = "--require-hashes --no-deps"
MAX_PROBE_SECONDS = 30.0


def probe(seconds: float) -> dict[str, object]:
    time.sleep(min(max(seconds, 0.0), MAX_PROBE_SECONDS))
    return {
        "container": os.environ.get("MODAL_TASK_ID") or socket.gethostname(),
        "region": os.environ.get("MODAL_REGION"),
        "cloud": os.environ.get("MODAL_CLOUD_PROVIDER"),
    }


def pool_image() -> modal.Image:
    base = modal.Image.from_registry(CUDA_BASE, add_python=PYTHON_VERSION)
    if not modal.is_local():
        return base
    return base.uv_pip_install(
        requirements=[str(repository_root(__file__) / LOCK_PATH)],
        uv_version=UV_VERSION,
        extra_options=LOCKED_INSTALL_OPTIONS,
    ).add_local_python_source("parfocal_common", "parfocal_ml", ignore=["**/__pycache__/**"])


type Runner = Callable[[Mapping[str, object]], Mapping[str, object]]
TUMOR_MAP_FAMILY = Family.DETECTOR_GOOD
VIEW_MAP_FAMILY = Family.EMBEDDER


def tumor_map_runner(pool: PoolLimits) -> Runner:
    gpu = pool.gpu.value if pool.gpu is not None else None

    def run(call: Mapping[str, object]) -> Mapping[str, object]:
        from parfocal_ml.tumor_map_worker import run_tumor_maps

        return run_tumor_maps(call, gpu)

    return run


def view_map_runner(call: Mapping[str, object]) -> Mapping[str, object]:
    from parfocal_ml.view_map_worker import answer_view_map

    return answer_view_map(call)


def secret_names(pool: PoolLimits) -> tuple[str, ...]:
    if pool.family is TUMOR_MAP_FAMILY:
        return TUMOR_MAP_SECRETS
    if pool.family is VIEW_MAP_FAMILY:
        return VIEW_MAP_SECRETS
    return ()


def default_runners(pool: PoolLimits) -> dict[str, Runner]:
    if pool.family is TUMOR_MAP_FAMILY:
        return {Kind.TUMOR_MAP: tumor_map_runner(pool)}
    if pool.family is VIEW_MAP_FAMILY:
        return {Kind.VIEW_MAP: view_map_runner}
    return {}


def pool_entry(
    pool: PoolLimits, runners: Mapping[str, Runner] | None = None
) -> Callable[[dict[str, object]], dict[str, object]]:
    family = pool.family.value
    chosen = default_runners(pool) if runners is None else runners

    def run(call: dict[str, object]) -> dict[str, object]:
        kind = str(call.get("kind"))
        check_lane(pool, kind)
        if kind == Kind.WARM:
            return {"family": family, "warm": True, **probe(0.0)}
        if kind in chosen:
            return {"family": family, "kind": kind, **chosen[kind](call)}
        if kind != Kind.PROBE:
            raise ValueError(f"{family} has no runner for {kind!r} yet")
        seconds = call.get("seconds", 0.0)
        reply = probe(float(seconds) if isinstance(seconds, int | float) else 0.0)
        return {"family": family, **reply}

    return run


def build_app(
    name: str, pools: tuple[PoolLimits, ...]
) -> tuple[modal.App, dict[str, modal.Function]]:
    validate_pools(pools)
    app = modal.App(name, image=pool_image())
    functions: dict[str, modal.Function] = {}
    for pool in pools:
        entry = modal.concurrent(**concurrency_options(pool))(pool_entry(pool))
        secrets = [modal.Secret.from_name(name) for name in secret_names(pool)]
        functions[pool.function_name] = app.function(**function_options(pool), secrets=secrets)(
            entry
        )
    return app, functions


app, pool_functions = build_app(APP_NAME, POOLS)
