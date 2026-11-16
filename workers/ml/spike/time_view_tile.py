import argparse
import json
import statistics
import sys
import time
import uuid
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests"))

from tumor_map_support import TISSUE_RED, fixture_slide, opener

from parfocal_common.view_maps import TILE_SPAN, ViewTile
from parfocal_ml.tumor_map_worker import OnnxTumorScorer, local_weights
from parfocal_ml.view_map_worker import ViewMapService


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runs", type=int, default=3)
    args = parser.parse_args()
    weights = local_weights()
    if weights is None:
        raise SystemExit("camelyon-tumor.onnx is not exported")
    scorer = OnnxTumorScorer(weights)
    slide = fixture_slide(np.full((TILE_SPAN, TILE_SPAN), TISSUE_RED, np.uint8))

    async def setup(stack):
        return opener(slide), scorer

    service = ViewMapService(setup)
    call = ViewTile(uuid.uuid4(), uuid.uuid4(), 0, 0).call()
    seconds = []
    try:
        for _ in range(args.runs):
            started = time.perf_counter()
            reply = service.answer(call)
            seconds.append(time.perf_counter() - started)
    finally:
        service.close()
    summary = {
        "providers": list(scorer.providers),
        "cells": len(reply["cells"]),
        "runs_s": [round(value, 3) for value in seconds],
        "median_s": round(statistics.median(seconds), 3),
    }
    print(json.dumps(summary))


if __name__ == "__main__":
    main()
