import json
import sys
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
import openslide
import torch
from monai.networks.nets import TorchVisionFCModel
from shapely.geometry import Polygon, box
from shapely.ops import unary_union
from shapely.prepared import prep

WINDOW = 224
STRIDE = 32
MARGIN = (WINDOW - STRIDE) // 2
CELL = 64
THUMB_LEVEL_DOWNSAMPLE = 64
NEGATIVE_CLEARANCE = 448
TISSUE_FRACTION = 0.5
BATCH = 16
SEED = 20261116


def device():
    if torch.backends.mps.is_available():
        torch.mps.set_per_process_memory_fraction(0.3)
        return torch.device("mps")
    return torch.device("cpu")


def load_net(weights, dev):
    net = TorchVisionFCModel("resnet18", num_classes=1, use_conv=True, pretrained=False)
    net.load_state_dict(torch.load(weights, map_location="cpu"))
    return net.to(dev).eval()


def read_rgb(slide, x, y, size):
    rgba = np.asarray(slide.read_region((int(x), int(y)), 0, (size, size)))
    rgb = rgba[..., :3].copy()
    rgb[rgba[..., 3] == 0] = 255
    return rgb


def probabilities(net, dev, patches):
    out = []
    for start in range(0, len(patches), BATCH):
        chunk = np.stack(patches[start : start + BATCH]).astype(np.float32) / 127.5 - 1.0
        batch = torch.from_numpy(np.ascontiguousarray(chunk.transpose(0, 3, 1, 2))).to(dev)
        with torch.no_grad():
            logits = net(batch).float()
        out.extend(torch.sigmoid(logits).reshape(len(chunk), -1)[:, 0].cpu().tolist())
        if dev.type == "mps":
            torch.mps.empty_cache()
    return np.asarray(out)


def saturation(rgb):
    rgb = rgb.astype(np.float32)
    high = rgb.max(axis=-1)
    low = rgb.min(axis=-1)
    return np.where(high > 0, (high - low) / np.maximum(high, 1), 0) * 255


def otsu(values):
    hist, edges = np.histogram(values, bins=256, range=(0, 256))
    weights = hist.astype(np.float64)
    centres = (edges[:-1] + edges[1:]) / 2
    best, threshold = -1.0, 0.0
    for i in range(1, 256):
        w0, w1 = weights[:i].sum(), weights[i:].sum()
        if w0 == 0 or w1 == 0:
            continue
        m0 = (weights[:i] * centres[:i]).sum() / w0
        m1 = (weights[i:] * centres[i:]).sum() / w1
        spread = w0 * w1 * (m0 - m1) ** 2
        if spread > best:
            best, threshold = spread, centres[i]
    return max(threshold, 20.0)


def polygons(xml_path):
    groups = {}
    for annotation in ET.parse(xml_path).getroot().iter("Annotation"):
        points = [
            (float(c.get("X")), float(c.get("Y")))
            for c in sorted(annotation.iter("Coordinate"), key=lambda c: int(c.get("Order")))
        ]
        if len(points) >= 3:
            groups.setdefault(annotation.get("PartOfGroup"), []).append(Polygon(points).buffer(0))
    return groups


def thumbnail(slide):
    level = slide.get_best_level_for_downsample(THUMB_LEVEL_DOWNSAMPLE + 0.5)
    rgba = np.asarray(slide.read_region((0, 0), level, slide.level_dimensions[level]))
    rgb = rgba[..., :3].copy()
    rgb[rgba[..., 3] == 0] = 255
    return rgb, slide.level_downsamples[level]


def auc(scores, labels):
    order = np.argsort(scores)
    ranks = np.empty(len(scores))
    ranks[order] = np.arange(1, len(scores) + 1)
    for value in np.unique(scores):
        tied = scores == value
        ranks[tied] = ranks[tied].mean()
    positives = labels.sum()
    negatives = len(labels) - positives
    return (ranks[labels == 1].sum() - positives * (positives + 1) / 2) / (positives * negatives)


def bootstrap_auc(scores, labels, rng, rounds=1000):
    values = []
    for _ in range(rounds):
        pick = rng.integers(0, len(scores), len(scores))
        if 0 < labels[pick].sum() < len(pick):
            values.append(auc(scores[pick], labels[pick]))
    return float(np.percentile(values, 2.5)), float(np.percentile(values, 97.5))


def sample_test_slide(slide, groups, count, rng):
    tumor = unary_union(groups.get("Tumor", []))
    other = unary_union(groups.get("None", [])) if groups.get("None") else None
    tumor_inside = prep(tumor.difference(other) if other is not None else tumor)
    annotated = unary_union([g for g in (tumor, other) if g is not None])
    keep_out = prep(annotated.buffer(NEGATIVE_CLEARANCE))
    rgb, downsample = thumbnail(slide)
    sat = saturation(rgb)
    threshold = otsu(sat.ravel())
    tissue_rows, tissue_cols = np.nonzero(sat > threshold)
    half = WINDOW // 2
    positives, negatives = [], []
    minx, miny, maxx, maxy = tumor.bounds
    tries = 0
    while len(positives) < count and tries < count * 400:
        tries += 1
        x, y = rng.uniform(minx, maxx), rng.uniform(miny, maxy)
        if tumor_inside.contains(box(x - half, y - half, x + half, y + half)):
            positives.append((x, y))
    tries = 0
    while len(negatives) < count and tries < count * 400:
        tries += 1
        pick = rng.integers(0, len(tissue_rows))
        x = (tissue_cols[pick] + rng.uniform()) * downsample
        y = (tissue_rows[pick] + rng.uniform()) * downsample
        if keep_out.intersects(box(x - half, y - half, x + half, y + half)):
            continue
        patch = read_rgb(slide, x - half, y - half, WINDOW)
        if (saturation(patch) > threshold).mean() < TISSUE_FRACTION:
            continue
        negatives.append((x, y, patch))
    pos_patches = [read_rgb(slide, x - half, y - half, WINDOW) for x, y in positives]
    return pos_patches, [n[2] for n in negatives], threshold, tumor.area


def check_against_poc_map(slide, npz_path, net, dev, rng, cells):
    stored = np.load(npz_path)
    probability, tissue = stored["probability"], stored["tissue"]
    rows, cols = np.nonzero(tissue)
    picks = rng.choice(len(rows), cells, replace=False)
    ours, theirs = [], []
    for pick in picks:
        row, col = rows[pick], cols[pick]
        patches = [
            read_rgb(slide, col * CELL - MARGIN + dx, row * CELL - MARGIN + dy, WINDOW)
            for dy in (0, STRIDE)
            for dx in (0, STRIDE)
        ]
        ours.append(float(probabilities(net, dev, patches).mean()))
        theirs.append(float(probability[row, col]))
    ours, theirs = np.asarray(ours), np.asarray(theirs)
    return {
        "cells": cells,
        "pearson": float(np.corrcoef(ours, theirs)[0, 1]),
        "mean_abs_diff": float(np.abs(ours - theirs).mean()),
        "same_side_of_0_5": float(((ours >= 0.5) == (theirs >= 0.5)).mean()),
    }


def main():
    weights, test_tif, test_xml, train_tif, train_npz, out = map(Path, sys.argv[1:7])
    count = int(sys.argv[7]) if len(sys.argv) > 7 else 200
    rng = np.random.default_rng(SEED)
    dev = device()
    net = load_net(weights, dev)
    report = {"seed": SEED, "device": dev.type, "torch": torch.__version__}
    started = time.perf_counter()
    train_slide = openslide.OpenSlide(train_tif)
    report["poc_map_check"] = check_against_poc_map(train_slide, train_npz, net, dev, rng, 40)
    slide = openslide.OpenSlide(test_tif)
    pos, neg, threshold, tumor_area = sample_test_slide(slide, polygons(test_xml), count, rng)
    scores = np.concatenate([probabilities(net, dev, pos), probabilities(net, dev, neg)])
    labels = np.concatenate([np.ones(len(pos), int), np.zeros(len(neg), int)])
    report["test_001"] = {
        "positives": len(pos),
        "negatives": len(neg),
        "saturation_threshold": float(threshold),
        "tumor_area_px": float(tumor_area),
        "mpp": float(slide.properties.get("openslide.mpp-x", "nan")),
        "auc": float(auc(scores, labels)),
        "auc_95": bootstrap_auc(scores, labels, rng),
        "median_positive": float(np.median(scores[labels == 1])),
        "median_negative": float(np.median(scores[labels == 0])),
        "thresholds": {
            str(t): {
                "sensitivity": float((scores[labels == 1] >= t).mean()),
                "specificity": float((scores[labels == 0] < t).mean()),
            }
            for t in (0.5, 0.7, 0.9)
        },
    }
    report["seconds"] = time.perf_counter() - started
    out.write_text(json.dumps(report, indent=2))
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
