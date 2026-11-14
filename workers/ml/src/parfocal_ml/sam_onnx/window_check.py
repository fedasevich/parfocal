import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np
from numpy.typing import NDArray

from parfocal_ml.datasets import Sample
from parfocal_ml.sam_contract import (
    EMBED_SIZE,
    GRAPHS,
    IMAGE_SIZE,
    WINDOW_MIN_IOU,
    WINDOW_SIZE,
    best_multimask,
    decoder_feeds,
    iou,
    onnx_dir,
    pixel_values,
    window_decoder_graph,
)
from parfocal_ml.sam_onnx.verify import nucleus_clicks, session, timed, tnbc_patches

PIXELS_PER_TOKEN = IMAGE_SIZE // EMBED_SIZE
OUTSIDE_LOGIT = -20.0


def window_origin(x: float, y: float, size: int) -> tuple[int, int]:
    limit = EMBED_SIZE - size

    def axis(value: float) -> int:
        return int(min(limit, max(0, np.floor(value / PIXELS_PER_TOKEN - size / 2 + 0.5))))

    return axis(x), axis(y)


def pasted(window: NDArray[np.float32], origin: tuple[int, int], size: int) -> NDArray[np.float32]:
    side = size * PIXELS_PER_TOKEN
    full = np.full((IMAGE_SIZE, IMAGE_SIZE), OUTSIDE_LOGIT, dtype=np.float32)
    x0 = origin[0] * PIXELS_PER_TOKEN
    y0 = origin[1] * PIXELS_PER_TOKEN
    full[y0 : y0 + side, x0 : x0 + side] = window
    return full


def touches_inner_edge(mask: NDArray[np.bool_], origin: tuple[int, int], size: int) -> bool:
    limit = EMBED_SIZE - size
    edges = [
        origin[1] > 0 and bool(mask[0].any()),
        origin[1] < limit and bool(mask[-1].any()),
        origin[0] > 0 and bool(mask[:, 0].any()),
        origin[0] < limit and bool(mask[:, -1].any()),
    ]
    return any(edges)


@dataclass
class WindowReport:
    graph: str
    size: int
    ious: list[float] = field(default_factory=list[float])
    edge_clicks: int = 0
    full_ms: list[float] = field(default_factory=list[float])
    window_ms: list[float] = field(default_factory=list[float])

    @property
    def mean_iou(self) -> float:
        return float(np.mean(self.ious)) if self.ious else 0.0

    @property
    def passed(self) -> bool:
        return bool(self.ious) and self.mean_iou >= WINDOW_MIN_IOU

    def summary(self) -> dict[str, object]:
        return {
            "graph": self.graph,
            "size": self.size,
            "clicks": len(self.ious) + self.edge_clicks,
            "kept_clicks": len(self.ious),
            "edge_clicks": self.edge_clicks,
            "mean_iou": round(self.mean_iou, 4),
            "min_iou": round(min(self.ious), 4) if self.ious else None,
            "full_cpu_ms": round(float(np.median(self.full_ms)), 1) if self.full_ms else None,
            "window_cpu_ms": round(float(np.median(self.window_ms)), 1) if self.window_ms else None,
            "threshold": WINDOW_MIN_IOU,
            "passed": self.passed,
        }


def check_window(
    patches: list[Sample], clicks_per_patch: int, folder: Path, size: int = WINDOW_SIZE
) -> WindowReport:
    graph = window_decoder_graph(size)
    report = WindowReport(graph=graph, size=size)
    encoder = session(folder, GRAPHS.encoder)
    full = session(folder, GRAPHS.decoder)
    window = session(folder, graph)
    for patch in patches:
        height, width = patch.rgb.shape[:2]
        side = max(height, width)
        (embeddings,) = encoder.run(None, {"pixel_values": pixel_values(patch.rgb)})
        for click in nucleus_clicks(patch.labels, clicks_per_patch):
            feeds = decoder_feeds(embeddings, click, side, side)
            feeds["orig_im_size"] = np.array([IMAGE_SIZE, IMAGE_SIZE], dtype=np.float32)
            (masks, scores, _), full_ms = timed(lambda feeds=feeds: full.run(None, feeds))
            x, y = (float(value) for value in feeds["point_coords"][0, 0])
            origin = window_origin(x, y, size)
            window_feeds = {name: value for name, value in feeds.items() if name != "orig_im_size"}
            window_feeds["window_origin"] = np.array(origin, dtype=np.float32)
            (window_masks, window_scores, _), window_ms = timed(
                lambda window_feeds=window_feeds: window.run(None, window_feeds)
            )
            report.full_ms.append(full_ms)
            report.window_ms.append(window_ms)
            best = 1 + int(np.argmax(window_scores[0, 1:]))
            if touches_inner_edge(window_masks[0, best] > 0, origin, size):
                report.edge_clicks += 1
                continue
            reference = best_multimask(masks, scores)
            candidate = pasted(window_masks[0, best], origin, size) > 0
            report.ious.append(iou(reference, candidate))
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Compare the window decoder with the full one")
    parser.add_argument("--patches", type=int, default=8)
    parser.add_argument("--clicks", type=int, default=10)
    parser.add_argument("--sizes", type=int, nargs="+", default=[WINDOW_SIZE])
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    patches = tnbc_patches(args.patches)
    reports = [check_window(patches, args.clicks, onnx_dir(), size) for size in args.sizes]
    summaries = [report.summary() for report in reports]
    print(json.dumps(summaries, indent=2))
    if args.json:
        raw = [asdict(report) for report in reports]
        args.json.write_text(json.dumps({"windows": summaries, "raw": raw}, indent=2))
    return 0 if all(report.passed for report in reports) else 1


if __name__ == "__main__":
    sys.exit(main())
