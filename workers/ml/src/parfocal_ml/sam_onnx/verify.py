import argparse
import gc
import itertools
import json
import platform
import sys
import time
from collections.abc import Callable
from dataclasses import asdict, dataclass, field
from functools import partial
from pathlib import Path

import numpy as np
import onnxruntime as ort
import torch
from numpy.typing import NDArray
from scipy import ndimage
from segment_anything import SamPredictor

from parfocal_ml.datasets import Sample, samples
from parfocal_ml.sam_contract import (
    AIS_MAX_ABS,
    AIS_QUANTISED_MIN_IOU,
    FP32_MIN_IOU,
    FP32_NOISE_LOGIT,
    GRAPHS,
    QUANTISED_MIN_IOU,
    best_multimask,
    decoder_feeds,
    iou,
    onnx_dir,
    pixel_values,
    scaled_point,
)
from parfocal_ml.sam_onnx.export import AisDecoder, BatchDecoder, load_instance_decoder, load_sam

MIN_NUCLEUS_AREA = 30


@dataclass
class EncoderReport:
    graph: str
    minimum_iou: float
    ious: list[float] = field(default_factory=list[float])
    same_mask_ious: list[float] = field(default_factory=list[float])
    flipped_max_logit: float = 0.0
    embedding_max_abs: float = 0.0
    encode_ms: list[float] = field(default_factory=list[float])

    @property
    def mean_iou(self) -> float:
        return float(np.mean(self.ious))

    @property
    def exact_clicks(self) -> int:
        return sum(value == 1.0 for value in self.ious)

    @property
    def passed(self) -> bool:
        if self.minimum_iou >= FP32_MIN_IOU:
            return self.flipped_max_logit < FP32_NOISE_LOGIT
        return self.mean_iou >= self.minimum_iou


@dataclass
class AisReport:
    graph: str
    max_abs: float = 0.0
    foreground_ious: list[float] = field(default_factory=list[float])
    decode_ms: list[float] = field(default_factory=list[float])

    @property
    def passed(self) -> bool:
        return float(np.mean(self.foreground_ious)) >= AIS_QUANTISED_MIN_IOU

    def summary(self) -> dict[str, object]:
        return {
            "graph": self.graph,
            "max_abs": float(f"{self.max_abs:.3g}"),
            "min_foreground_iou": round(min(self.foreground_ious), 4),
            "mean_foreground_iou": round(float(np.mean(self.foreground_ious)), 4),
            "decode_ms": round(float(np.median(self.decode_ms))),
        }


@dataclass
class Report:
    patches: int
    clicks: int
    torch_encode_ms: list[float]
    decode_ms: list[float]
    encoders: list[EncoderReport]
    batch_ious: list[float]
    batch_score_max_abs: float
    ais_max_abs: float
    ais_foreground_iou: list[float]
    quantised_ais: list[AisReport]
    versions: dict[str, str]

    @property
    def passed(self) -> bool:
        return (
            all(encoder.passed for encoder in self.encoders)
            and min(self.batch_ious) >= FP32_MIN_IOU
            and self.ais_max_abs < AIS_MAX_ABS
            and all(report.passed for report in self.quantised_ais)
        )

    def summary(self) -> dict[str, object]:
        return {
            "patches": self.patches,
            "clicks": self.clicks,
            "torch_encode_ms": round(float(np.median(self.torch_encode_ms))),
            "onnx_decode_ms": round(float(np.median(self.decode_ms)), 1),
            "encoders": [
                {
                    "graph": encoder.graph,
                    "exact_clicks": encoder.exact_clicks,
                    "min_iou": round(min(encoder.ious), 4),
                    "mean_iou": round(encoder.mean_iou, 4),
                    "same_mask_mean_iou": round(float(np.mean(encoder.same_mask_ious)), 4),
                    "flipped_max_logit": float(f"{encoder.flipped_max_logit:.3g}"),
                    "threshold": encoder.minimum_iou,
                    "embedding_max_abs": float(f"{encoder.embedding_max_abs:.3g}"),
                    "encode_ms": round(float(np.median(encoder.encode_ms))),
                }
                for encoder in self.encoders
            ],
            "batch_min_iou": round(min(self.batch_ious), 4),
            "batch_score_max_abs": float(f"{self.batch_score_max_abs:.3g}"),
            "ais_max_abs": float(f"{self.ais_max_abs:.3g}"),
            "ais_min_foreground_iou": round(min(self.ais_foreground_iou), 4),
            "quantised_ais": [report.summary() for report in self.quantised_ais],
            "versions": self.versions,
            "passed": self.passed,
        }


def nucleus_clicks(labels: NDArray[np.int32], limit: int) -> list[tuple[float, float]]:
    clicks: list[tuple[float, float]] = []
    for index, found in enumerate(ndimage.find_objects(labels), start=1):
        if found is None:
            continue
        inside = labels[found] == index
        if int(inside.sum()) < MIN_NUCLEUS_AREA:
            continue
        depth = ndimage.distance_transform_edt(inside)
        y, x = np.unravel_index(int(np.argmax(depth)), inside.shape)
        clicks.append((float(found[1].start + x), float(found[0].start + y)))
        if len(clicks) == limit:
            break
    return clicks


def session(folder: Path, name: str) -> ort.InferenceSession:
    return ort.InferenceSession(str(folder / name), providers=["CPUExecutionProvider"])


def timed[T](run: Callable[[], T]) -> tuple[T, float]:
    started = time.perf_counter()
    result = run()
    return result, (time.perf_counter() - started) * 1000


@dataclass
class Reference:
    height: int
    width: int
    pixels: NDArray[np.float32]
    clicks: list[tuple[float, float]]
    embeddings: NDArray[np.float32]
    logits: list[NDArray[np.float32]]
    chosen: list[int]
    batch_masks: NDArray[np.float32]
    batch_scores: NDArray[np.float32]
    coords: NDArray[np.float32]
    labels: NDArray[np.float32]
    maps: NDArray[np.float32] | None = None


def batch_prompts(
    clicks: list[tuple[float, float]], height: int, width: int
) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    coords = np.array(
        [[list(scaled_point(x, y, height, width)), [0.0, 0.0]] for x, y in clicks],
        dtype=np.float32,
    )
    labels = np.tile(np.array([[1.0, -1.0]], dtype=np.float32), (len(clicks), 1))
    return coords, labels


@torch.no_grad()
def torch_references(
    patches: list[Sample], clicks_per_patch: int, encode_ms: list[float]
) -> list[Reference]:
    sam = load_sam()
    predictor = SamPredictor(sam)
    batch_model = BatchDecoder(sam).eval()
    references: list[Reference] = []
    for patch in patches:
        height, width = patch.rgb.shape[:2]
        clicks = nucleus_clicks(patch.labels, clicks_per_patch)
        _, elapsed = timed(partial(predictor.set_image, patch.rgb))
        encode_ms.append(elapsed)
        embeddings = predictor.get_image_embedding()
        predictions = [
            predictor.predict(
                point_coords=np.array([click], dtype=np.float32),
                point_labels=np.array([1], dtype=np.int32),
                multimask_output=True,
                return_logits=True,
            )
            for click in clicks
        ]
        chosen = [int(np.argmax(scores)) for _, scores, _ in predictions]
        coords, labels = batch_prompts(clicks, height, width)
        batch_masks, batch_scores = batch_model(
            embeddings, torch.from_numpy(coords), torch.from_numpy(labels)
        )
        references.append(
            Reference(
                height=height,
                width=width,
                pixels=pixel_values(patch.rgb),
                clicks=clicks,
                embeddings=embeddings.numpy().copy(),
                logits=[
                    logits[index] for (logits, _, _), index in zip(predictions, chosen, strict=True)
                ],
                chosen=chosen,
                batch_masks=batch_masks.numpy().copy(),
                batch_scores=batch_scores.numpy().copy(),
                coords=coords,
                labels=labels,
            )
        )
    del predictor, batch_model, sam
    gc.collect()
    ais_model = AisDecoder(load_instance_decoder()).eval()
    for reference in references:
        reference.maps = ais_model(torch.from_numpy(reference.embeddings)).numpy().copy()
    del ais_model
    gc.collect()
    return references


def check_encoder(
    report: EncoderReport,
    references: list[Reference],
    folder: Path,
    decoder: ort.InferenceSession,
    decode_ms: list[float],
) -> None:
    encoder = session(folder, report.graph)
    for reference in references:
        outputs, elapsed = timed(partial(encoder.run, None, {"pixel_values": reference.pixels}))
        report.encode_ms.append(elapsed)
        embeddings = outputs[0]
        report.embedding_max_abs = max(
            report.embedding_max_abs, float(np.abs(embeddings - reference.embeddings).max())
        )
        for click, logits, index in zip(
            reference.clicks, reference.logits, reference.chosen, strict=True
        ):
            expected = logits > 0
            feeds = decoder_feeds(embeddings, click, reference.height, reference.width)
            (masks, scores, _), elapsed = timed(partial(decoder.run, None, feeds))
            decode_ms.append(elapsed)
            selected = best_multimask(masks, scores)
            report.ious.append(iou(expected, selected))
            report.same_mask_ious.append(iou(expected, masks[0, index + 1] > 0))
            flipped = expected != selected
            if flipped.any():
                report.flipped_max_logit = max(
                    report.flipped_max_logit, float(np.abs(logits[flipped]).max())
                )
    del encoder
    gc.collect()


def check_ais(report: AisReport, references: list[Reference], folder: Path) -> AisReport:
    graph = session(folder, report.graph)
    for reference in references:
        expected = reference.maps
        assert expected is not None
        got, elapsed = timed(partial(graph.run, None, {"image_embeddings": reference.embeddings}))
        report.decode_ms.append(elapsed)
        report.max_abs = max(report.max_abs, float(np.abs(expected - got[0]).max()))
        report.foreground_ious.append(iou(expected[0, 0] > 0.5, got[0][0, 0] > 0.5))
    del graph
    return report


def verify(patches: list[Sample], clicks_per_patch: int, folder: Path | None = None) -> Report:
    folder = folder or onnx_dir()
    torch_encode_ms: list[float] = []
    references = torch_references(patches, clicks_per_patch, torch_encode_ms)
    decode_ms: list[float] = []
    encoders = [
        EncoderReport(GRAPHS.encoder, FP32_MIN_IOU),
        EncoderReport(GRAPHS.encoder_uint8, QUANTISED_MIN_IOU),
        EncoderReport(GRAPHS.encoder_q4, QUANTISED_MIN_IOU),
    ]
    decoder = session(folder, GRAPHS.decoder)
    for report in encoders:
        check_encoder(report, references, folder, decoder, decode_ms)
    del decoder

    batch = session(folder, GRAPHS.batch_decoder)
    batch_ious: list[float] = []
    batch_score_max_abs = 0.0
    for reference in references:
        got_masks, got_scores = batch.run(
            None,
            {
                "image_embeddings": reference.embeddings,
                "point_coords": reference.coords,
                "point_labels": reference.labels,
            },
        )
        batch_ious.extend(
            iou(expected > 0, got > 0)
            for expected, got in zip(reference.batch_masks, got_masks, strict=True)
        )
        batch_score_max_abs = max(
            batch_score_max_abs, float(np.abs(reference.batch_scores - got_scores).max())
        )
    del batch

    ais = session(folder, GRAPHS.ais_decoder)
    ais_max_abs = 0.0
    ais_foreground_iou: list[float] = []
    for reference in references:
        expected = reference.maps
        assert expected is not None
        got = ais.run(None, {"image_embeddings": reference.embeddings})[0]
        ais_max_abs = max(ais_max_abs, float(np.abs(expected - got).max()))
        ais_foreground_iou.append(iou(expected[0, 0] > 0.5, got[0, 0] > 0.5))
    del ais
    quantised_ais = [
        check_ais(AisReport(graph), references, folder)
        for graph in (GRAPHS.ais_decoder_uint8, GRAPHS.ais_decoder_int8_weights)
    ]
    gc.collect()

    return Report(
        patches=len(patches),
        clicks=sum(len(reference.clicks) for reference in references),
        torch_encode_ms=torch_encode_ms,
        decode_ms=decode_ms,
        encoders=encoders,
        batch_ious=batch_ious,
        batch_score_max_abs=batch_score_max_abs,
        ais_max_abs=ais_max_abs,
        ais_foreground_iou=ais_foreground_iou,
        quantised_ais=quantised_ais,
        versions={
            "torch": torch.__version__,
            "onnxruntime": ort.__version__,
            "python": platform.python_version(),
            "machine": platform.machine(),
        },
    )


def tnbc_patches(count: int) -> list[Sample]:
    return list(itertools.islice(samples("tnbc"), count))


def main() -> int:
    parser = argparse.ArgumentParser(description="Check the PathoSAM ONNX graphs against PyTorch")
    parser.add_argument("--patches", type=int, default=8)
    parser.add_argument("--clicks", type=int, default=10)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args()
    report = verify(tnbc_patches(args.patches), args.clicks)
    summary = report.summary()
    print(json.dumps(summary, indent=2))
    if args.json:
        args.json.write_text(json.dumps({**summary, "raw": asdict(report)}, indent=2))
    return 0 if report.passed else 1


if __name__ == "__main__":
    sys.exit(main())
