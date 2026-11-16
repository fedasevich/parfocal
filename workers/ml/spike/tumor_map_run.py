import argparse
import json
import time
from pathlib import Path

import numpy as np
import openslide
import torch
from monai.networks.nets import TorchVisionFCModel

from parfocal_ml.tumor_froc import (
    BUNDLE_SPACING_UM,
    FALSE_POSITIVE_RATES,
    NMS_BOX,
    NMS_THRESHOLD,
    annotation_polygons,
    detections,
    froc,
    lesions_of,
    slide_hits,
    tumor_mask,
)
from parfocal_ml.tumor_map import (
    CELL,
    CellBox,
    decoded,
    map_slide,
    planned_tiles,
    stored_objects,
    stored_values,
    tissue_cells,
)

THUMB_DOWNSAMPLE = 64
MPS_FRACTION = 0.3


class OpenSlideReader:
    def __init__(self, slide):
        self.slide = slide

    def read(self, x, y, width, height):
        rgba = np.asarray(self.slide.read_region((int(x), int(y)), 0, (int(width), int(height))))
        rgb = rgba[..., :3].copy()
        rgb[rgba[..., 3] == 0] = 255
        return rgb


class ResNetScorer:
    def __init__(self, weights, device):
        self.device = device
        net = TorchVisionFCModel("resnet18", num_classes=1, use_conv=True, pretrained=False)
        net.load_state_dict(torch.load(weights, map_location="cpu"))
        self.net = net.to(device).eval()

    def score(self, rgb):
        scaled = rgb.astype(np.float32) / 127.5 - 1.0
        batch = torch.from_numpy(np.ascontiguousarray(scaled.transpose(2, 0, 1)))[None]
        with torch.no_grad():
            logits = self.net(batch.to(self.device)).float()
        out = torch.sigmoid(logits)[0, 0].cpu().numpy()
        if self.device.type == "mps":
            torch.mps.empty_cache()
        return out


def device():
    if torch.backends.mps.is_available():
        torch.mps.set_per_process_memory_fraction(MPS_FRACTION)
        return torch.device("mps")
    return torch.device("cpu")


def tissue_of(slide):
    level = slide.get_best_level_for_downsample(THUMB_DOWNSAMPLE + 0.5)
    rgba = np.asarray(slide.read_region((0, 0), level, slide.level_dimensions[level]))
    rgb = rgba[..., :3].copy()
    rgb[rgba[..., 3] == 0] = 255
    width, height = slide.dimensions
    return tissue_cells(rgb, slide.level_downsamples[level], width, height)


def auc(scores, labels):
    order = np.argsort(scores, kind="mergesort")
    ranked = scores[order]
    ranks = np.empty(len(scores))
    ranks[order] = np.arange(1, len(scores) + 1)
    _, first, counts = np.unique(ranked, return_index=True, return_counts=True)
    for start, count in zip(first, counts, strict=False):
        if count > 1:
            ranks[order[start : start + count]] = start + (count + 1) / 2
    positives = labels.sum()
    negatives = len(labels) - positives
    return float((ranks[labels].sum() - positives * (positives + 1) / 2) / (positives * negatives))


def segmentation(probability, truth, tissue):
    on = tissue | truth
    report = {"cells": int(on.sum()), "tumor_cells": int(truth.sum())}
    if truth.any() and (~truth[on]).any():
        report["auc"] = auc(probability[on], truth[on])
    for threshold in (0.5, 0.7, 0.9):
        called = probability >= threshold
        both = int((called & truth).sum())
        report[f"t{threshold}"] = {
            "dice": 2 * both / max(1, int(called.sum()) + int(truth.sum())),
            "sensitivity": both / max(1, int(truth.sum())),
            "specificity": float((~called[on & ~truth]).mean()),
        }
    return report


def ours(probability, mask, cell_um):
    lesions = lesions_of(mask, cell_um)
    found = detections(probability)
    hits = slide_hits(found, lesions)
    result = froc([hits])
    return {
        "cell_um": cell_um,
        "froc": result.score,
        "sensitivities": dict(
            zip(map(str, FALSE_POSITIVE_RATES), result.sensitivities, strict=True)
        ),
        "lesions_total": int(lesions.labels.max()),
        "lesions_isolated": len(lesions.isolated),
        "lesions_counted": hits.lesions,
        "lesions_hit": int(sum(1 for p in hits.true_positives if p > 0)),
        "detections": len(found),
        "false_positives": len(hits.false_positives),
        "false_positive_probs": sorted(hits.false_positives, reverse=True),
        "hit_probs": sorted(hits.true_positives, reverse=True),
    }


def monai_froc(probability, mask, cell_um):
    from monai.apps.pathology.utils import (
        PathologyProbNMS,
        compute_isolated_tumor_cells,
        compute_multi_instance_mask,
    )
    from monai.metrics import compute_fp_tp_probs, compute_froc_curve_data, compute_froc_score

    level = 6
    outputs = PathologyProbNMS(sigma=0.0, prob_threshold=NMS_THRESHOLD, box_size=NMS_BOX)(
        probs_map=probability.copy(), resolution_level=level
    )
    probs, rows, columns = zip(*outputs, strict=False) if outputs else ((), (), ())
    labels = compute_multi_instance_mask(mask=mask.astype(np.uint8), threshold=75 / (cell_um * 2))
    itc = compute_isolated_tumor_cells(tumor_mask=labels, threshold=(200 + 75) / cell_um)
    fp, tp, targets = compute_fp_tp_probs(
        probs=np.array(probs),
        y_coord=np.array(rows),
        x_coord=np.array(columns),
        evaluation_mask=labels,
        labels_to_exclude=itc,
        resolution_level=level,
    )
    fps, sensitivity = compute_froc_curve_data(
        fp_probs=np.asarray(fp), tp_probs=np.asarray(tp), num_targets=targets, num_images=1
    )
    score = compute_froc_score(
        fps_per_image=fps, total_sensitivity=sensitivity, eval_thresholds=FALSE_POSITIVE_RATES
    )
    return {"froc": float(score), "lesions_counted": int(targets), "detections": len(outputs)}


def write_objects(tumor_map, out, mpp, level_count):
    stored = out / "stored"
    stored.mkdir(parents=True, exist_ok=True)
    sizes = {}
    for key, data in stored_objects(tumor_map, "", mpp, level_count):
        (stored / key).write_bytes(data)
        sizes[key] = len(data)
    return sizes


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("weights", type=Path)
    parser.add_argument("slide", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--xml", type=Path)
    parser.add_argument("--npz", type=Path)
    parser.add_argument("--box", type=int, nargs=4)
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--limit", type=int)
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    slide = openslide.OpenSlide(args.slide)
    mpp = float(slide.properties.get("openslide.mpp-x", "nan"))
    tissue = tissue_of(slide)
    box = CellBox(*args.box) if args.box else None
    tiles = planned_tiles(tissue, box)
    report = {
        "slide": args.slide.name,
        "dimensions": slide.dimensions,
        "mpp": mpp,
        "grid": tissue.shape,
        "tissue_cells": int(tissue.sum()),
        "tiles": len(tiles),
        "box": args.box,
    }
    if args.plan_only:
        print(json.dumps(report, indent=2))
        return
    dev = device()
    scorer = ResNetScorer(args.weights, dev)
    report["device"] = dev.type
    report["torch"] = torch.__version__
    progress = [0]

    def on_tile(done, total):
        progress[0] = done
        if done % 100 == 0:
            print(f"{done}/{total} {time.perf_counter() - started:.0f}s", flush=True)

    started = time.perf_counter()
    tumor_map = map_slide(
        OpenSlideReader(slide),
        scorer,
        tissue,
        box,
        should_stop=(lambda: progress[0] >= args.limit) if args.limit else None,
        on_tile=on_tile,
    )
    report["seconds"] = time.perf_counter() - started
    report["scored_tiles"] = tumor_map.scored
    report["seconds_per_tile"] = report["seconds"] / max(1, tumor_map.scored)
    report["stored_bytes"] = write_objects(tumor_map, args.out, mpp, slide.level_count)
    values = stored_values(tumor_map.probability, tumor_map.tissue)
    np.save(args.out / "stored.npy", values)
    shipped = decoded(values)
    if args.npz:
        poc = np.load(args.npz)
        stored = poc["probability"]
        rows = slice(box.top, box.bottom) if box else slice(None)
        columns = slice(box.left, box.right) if box else slice(None)
        both = tumor_map.tissue[rows, columns] & poc["tissue"][rows, columns]
        a, b = shipped[rows, columns][both], stored[rows, columns][both]
        report["poc_map"] = {
            "cells": int(both.sum()),
            "pearson": float(np.corrcoef(a, b)[0, 1]),
            "mean_abs_diff": float(np.abs(a - b).mean()),
            "same_side_of_0_5": float(((a >= 0.5) == (b >= 0.5)).mean()),
            "tissue_agreement": float(
                (tumor_map.tissue[rows, columns] == poc["tissue"][rows, columns]).mean()
            ),
        }
    if args.xml:
        mask = tumor_mask(annotation_polygons(args.xml), shipped.shape, CELL)
        report["segmentation"] = segmentation(shipped, mask, tumor_map.tissue)
        report["froc_bundle_spacing"] = ours(shipped, mask, BUNDLE_SPACING_UM * CELL)
        report["froc_slide_spacing"] = ours(shipped, mask, mpp * CELL)
        report["monai_bundle_spacing"] = monai_froc(shipped, mask, BUNDLE_SPACING_UM * CELL)
        report["monai_slide_spacing"] = monai_froc(shipped, mask, mpp * CELL)
    (args.out / "report.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({k: v for k, v in report.items() if k != "stored_bytes"}, indent=2))


if __name__ == "__main__":
    main()
