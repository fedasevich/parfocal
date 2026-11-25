import json
import os
import socket
import subprocess
import time
from collections.abc import Callable, Mapping
from functools import cache

import modal

from parfocal_common.repository import repository_root
from parfocal_ml.gpu_pool import (
    POOLS,
    Family,
    PoolLimits,
    card_label,
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
LAB_MODEL_SECRETS = (DATABASE_SECRET, STORAGE_SECRET)
NUCLEI_SECRETS = (DATABASE_SECRET, STORAGE_SECRET)
LOCK_PATH = "workers/deploy/locks/ml.txt"
UV_VERSION = "0.13.8"
LOCKED_INSTALL_OPTIONS = "--require-hashes --no-deps"
MAX_PROBE_SECONDS = 30.0
CARD_QUERY = ("nvidia-smi", "--query-gpu=name", "--format=csv,noheader")
CARD_QUERY_SECONDS = 10


@cache
def installed_card() -> str | None:
    try:
        found = subprocess.run(
            CARD_QUERY, capture_output=True, text=True, timeout=CARD_QUERY_SECONDS, check=True
        ).stdout
    except OSError, subprocess.SubprocessError:
        return None
    names = found.strip().splitlines()
    return card_label(names[0]) if names else None


def running_card(
    pool: PoolLimits, installed: Callable[[], str | None] = installed_card
) -> str | None:
    if pool.gpu is None:
        return None
    return installed() or pool.gpu.value


def probe(seconds: float) -> dict[str, object]:
    time.sleep(min(max(seconds, 0.0), MAX_PROBE_SECONDS))
    return {
        "container": os.environ.get("MODAL_TASK_ID") or socket.gethostname(),
        "region": os.environ.get("MODAL_REGION"),
        "cloud": os.environ.get("MODAL_CLOUD_PROVIDER"),
    }


def placement_line(pool: PoolLimits, kind: str) -> str:
    return json.dumps(
        {
            "message": "gpu pool run",
            "family": pool.family.value,
            "kind": kind,
            "gpu": running_card(pool),
            **probe(0.0),
        }
    )


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
LAB_MODEL_FAMILY = Family.LAB_MODEL
NUCLEI_FAMILY = Family.DETECTOR_BEST


def tumor_map_runner(pool: PoolLimits) -> Runner:
    def run(call: Mapping[str, object]) -> Mapping[str, object]:
        from parfocal_ml.tumor_map_worker import run_tumor_maps

        return run_tumor_maps(call, running_card(pool))

    return run


def nuclei_runner(pool: PoolLimits) -> Runner:
    def run(call: Mapping[str, object]) -> Mapping[str, object]:
        from parfocal_ml.nuclei_run_worker import run_nuclei_runs

        return run_nuclei_runs(call, running_card(pool))

    return run


def view_map_runner(call: Mapping[str, object]) -> Mapping[str, object]:
    from parfocal_ml.view_map_worker import answer_view_map

    return answer_view_map(call)


def outline_types_runner(call: Mapping[str, object]) -> Mapping[str, object]:
    from parfocal_ml.outline_typer_worker import answer_outline_types_call

    return answer_outline_types_call(call)


def view_embedding_runner(call: Mapping[str, object]) -> Mapping[str, object]:
    from parfocal_ml.view_embedding_worker import answer_view_embedding_call

    return answer_view_embedding_call(call)


def lab_model_runner(call: Mapping[str, object]) -> Mapping[str, object]:
    from parfocal_ml.lab_model_worker import run_lab_models

    return run_lab_models(call)


def secret_names(pool: PoolLimits) -> tuple[str, ...]:
    if pool.family is TUMOR_MAP_FAMILY:
        return TUMOR_MAP_SECRETS
    if pool.family is LAB_MODEL_FAMILY:
        return LAB_MODEL_SECRETS
    if pool.family is NUCLEI_FAMILY:
        return NUCLEI_SECRETS
    if pool.family is VIEW_MAP_FAMILY:
        return VIEW_MAP_SECRETS
    return ()


def default_runners(pool: PoolLimits) -> dict[str, Runner]:
    if pool.family is TUMOR_MAP_FAMILY:
        return {Kind.TUMOR_MAP: tumor_map_runner(pool)}
    if pool.family is VIEW_MAP_FAMILY:
        return {
            Kind.VIEW_MAP: view_map_runner,
            Kind.OUTLINE_TYPES: outline_types_runner,
            Kind.VIEW_EMBEDDING: view_embedding_runner,
        }
    if pool.family is LAB_MODEL_FAMILY:
        return {Kind.LAB_MODEL: lab_model_runner}
    if pool.family is NUCLEI_FAMILY:
        return {Kind.DETECT: nuclei_runner(pool)}
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
            return {"family": family, "warm": True, "gpu": running_card(pool), **probe(0.0)}
        if kind in chosen:
            print(placement_line(pool, kind), flush=True)
            return {"family": family, "kind": kind, **chosen[kind](call)}
        if kind != Kind.PROBE:
            raise ValueError(f"{family} has no runner for {kind!r} yet")
        seconds = call.get("seconds", 0.0)
        reply = probe(float(seconds) if isinstance(seconds, int | float) else 0.0)
        return {"family": family, "gpu": running_card(pool), **reply}

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
