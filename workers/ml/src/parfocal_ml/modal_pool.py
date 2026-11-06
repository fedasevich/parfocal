import os
import socket
import time
from collections.abc import Callable

import modal

from parfocal_ml.gpu_pool import (
    POOLS,
    PoolLimits,
    concurrency_options,
    function_options,
    validate_pools,
)

APP_NAME = "parfocal-gpu-pool"
PYTHON_VERSION = "3.14"
MAX_PROBE_SECONDS = 30.0


def probe(seconds: float) -> dict[str, object]:
    time.sleep(min(max(seconds, 0.0), MAX_PROBE_SECONDS))
    return {
        "container": os.environ.get("MODAL_TASK_ID") or socket.gethostname(),
        "region": os.environ.get("MODAL_REGION"),
        "cloud": os.environ.get("MODAL_CLOUD_PROVIDER"),
    }


def pool_image() -> modal.Image:
    return modal.Image.debian_slim(python_version=PYTHON_VERSION).add_local_python_source(
        "parfocal_ml"
    )


def pool_entry(pool: PoolLimits) -> Callable[[dict[str, object]], dict[str, object]]:
    family = pool.family.value

    def run(call: dict[str, object]) -> dict[str, object]:
        kind = call.get("kind")
        if kind != "probe":
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
        functions[pool.function_name] = app.function(**function_options(pool))(entry)
    return app, functions


app, pool_functions = build_app(APP_NAME, POOLS)
