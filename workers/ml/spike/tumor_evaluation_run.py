import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np

from parfocal_ml.tumor_evaluation import evaluate_slide, summary
from parfocal_ml.tumor_froc import BUNDLE_SPACING_UM, annotation_polygons, tumor_mask
from parfocal_ml.tumor_map import CELL, decoded

MAP_RUN = Path(__file__).with_name("tumor_map_run.py")


def map_once(weights: Path, slide: Path, out: Path) -> None:
    if (out / "stored.npy").exists():
        print(f"{slide.stem}: cached map in {out}", flush=True)
        return
    subprocess.run([sys.executable, str(MAP_RUN), str(weights), str(slide), str(out)], check=True)


def monai_pooled(maps: list[tuple[np.ndarray, np.ndarray]], cell_um: float) -> dict[str, float]:
    from monai.apps.pathology.utils import (
        PathologyProbNMS,
        compute_isolated_tumor_cells,
        compute_multi_instance_mask,
    )
    from monai.metrics import compute_fp_tp_probs, compute_froc_curve_data, compute_froc_score

    from parfocal_ml.tumor_froc import FALSE_POSITIVE_RATES, NMS_BOX, NMS_THRESHOLD

    fps, tps, total = [], [], 0
    for probability, mask in maps:
        outputs = PathologyProbNMS(sigma=0.0, prob_threshold=NMS_THRESHOLD, box_size=NMS_BOX)(
            probs_map=probability.copy(), resolution_level=6
        )
        probs, rows, columns = zip(*outputs, strict=False) if outputs else ((), (), ())
        labels = compute_multi_instance_mask(
            mask=mask.astype(np.uint8), threshold=75 / (cell_um * 2)
        )
        itc = compute_isolated_tumor_cells(tumor_mask=labels, threshold=(200 + 75) / cell_um)
        fp, tp, targets = compute_fp_tp_probs(
            probs=np.array(probs),
            y_coord=np.array(rows),
            x_coord=np.array(columns),
            evaluation_mask=labels,
            labels_to_exclude=itc,
            resolution_level=6,
        )
        fps.append(np.asarray(fp))
        tps.append(np.asarray(tp))
        total += int(targets)
    curve_fps, sensitivity = compute_froc_curve_data(
        fp_probs=np.concatenate(fps),
        tp_probs=np.concatenate(tps),
        num_targets=total,
        num_images=len(maps),
    )
    score = compute_froc_score(
        fps_per_image=curve_fps, total_sensitivity=sensitivity, eval_thresholds=FALSE_POSITIVE_RATES
    )
    return {"froc": float(score), "lesions_counted": total}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("weights", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("slides", type=Path, nargs="+")
    parser.add_argument("--monai", action="store_true")
    args = parser.parse_args()
    evaluations, annotated = [], []
    for slide in args.slides:
        folder = args.out / slide.stem
        map_once(args.weights, slide, folder)
        probability = decoded(np.load(folder / "stored.npy"))
        xml = slide.with_suffix(".xml")
        evaluation = evaluate_slide(slide.stem, probability, xml if xml.exists() else None)
        evaluations.append(evaluation)
        if evaluation.annotated and xml.exists():
            mask = tumor_mask(annotation_polygons(xml), probability.shape, CELL)
            annotated.append((probability, mask))
        print(json.dumps(evaluation.as_json()), flush=True)
    report = {"summary": summary(evaluations), "slides": [e.as_json() for e in evaluations]}
    if args.monai and annotated:
        report["monai_pooled"] = monai_pooled(annotated, BUNDLE_SPACING_UM * CELL)
    (args.out / "evaluation.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report["summary"] | {"monai_pooled": report.get("monai_pooled")}, indent=2))


if __name__ == "__main__":
    main()
