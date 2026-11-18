import json
import statistics
import sys
import time
import uuid
from pathlib import Path

import modal

from parfocal_ml.modal_pool import pool_image

ML_ROOT = Path(__file__).resolve().parents[1]
WEIGHTS = Path.home() / ".cache/parfocal/models/onnx/camelyon-tumor.onnx"
REMOTE_TESTS = "/root/ml_tests"
REMOTE_WEIGHTS = "/root/camelyon-tumor.onnx"
RUNS = 8

image = (
    pool_image()
    .add_local_dir(str(ML_ROOT / "tests"), REMOTE_TESTS, ignore=["**/__pycache__/**"])
    .add_local_file(str(WEIGHTS), REMOTE_WEIGHTS)
)

app = modal.App("parfocal-spike-view-tile-t4", image=image)


@app.function(gpu="T4", timeout=900)
def time_view_tile(runs: int) -> dict[str, object]:
    from unittest import mock

    sys.modules.setdefault("pytest", mock.MagicMock())
    sys.path.insert(0, REMOTE_TESTS)
    import numpy as np
    from tumor_map_support import TISSUE_RED, fixture_slide, opener

    from parfocal_common.view_maps import TILE_SPAN, ViewTile
    from parfocal_ml.tumor_map_worker import OnnxTumorScorer
    from parfocal_ml.view_map_worker import ViewMapService

    started = time.perf_counter()
    scorer = OnnxTumorScorer(Path(REMOTE_WEIGHTS), "T4")
    load_seconds = time.perf_counter() - started
    slide = fixture_slide(np.full((TILE_SPAN, TILE_SPAN), TISSUE_RED, np.uint8))

    async def setup(stack):
        return opener(slide), scorer

    service = ViewMapService(setup)
    call = ViewTile(uuid.uuid4(), uuid.uuid4(), 0, 0).call()
    seconds = []
    try:
        for _ in range(runs):
            began = time.perf_counter()
            reply = service.answer(call)
            seconds.append(time.perf_counter() - began)
    finally:
        service.close()
    return {
        "providers": list(scorer.providers),
        "scorer_load_s": round(load_seconds, 3),
        "cells": len(reply["cells"]),
        "runs_s": [round(value, 3) for value in seconds],
        "first_s": round(seconds[0], 3),
        "warm_median_s": round(statistics.median(seconds[1:]), 3),
    }


@app.local_entrypoint()
def main() -> None:
    print(json.dumps(time_view_tile.remote(RUNS)))
