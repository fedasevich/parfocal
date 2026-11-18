import argparse
import hashlib
import json
import resource
import time
from pathlib import Path

import numpy as np
import openslide
import timm
import torch
from tumor_map_run import MPS_FRACTION, OpenSlideReader, tissue_of

from parfocal_ml.tumor_map import map_slide, stored_values
from parfocal_ml.tumor_probe import (
    PROBE_PATCH,
    LinearProbe,
    Normalization,
    ProbeScorer,
    embed_centres,
    fit_probe,
    probe_reader,
    read_side,
    training_patches,
)

MODEL = "hf-hub:bioptimus/H-optimus-0"
MODEL_OPTIONS = {"init_values": 1e-5, "dynamic_img_size": False}


class FoundationEmbedder:
    def __init__(self, device):
        self.device = device
        model = timm.create_model(MODEL, pretrained=True, **MODEL_OPTIONS)
        config = timm.data.resolve_model_data_config(model)
        self.normalization = Normalization(tuple(config["mean"]), tuple(config["std"]))
        self.model = model.to(device=device, dtype=torch.float16).eval()

    def embed(self, patches):
        mean = torch.tensor(self.normalization.mean, device=self.device).view(1, 3, 1, 1)
        std = torch.tensor(self.normalization.std, device=self.device).view(1, 3, 1, 1)
        batch = torch.from_numpy(np.ascontiguousarray(patches)).to(self.device)
        batch = (batch.permute(0, 3, 1, 2).float() / 255.0 - mean) / std
        with torch.inference_mode():
            features = self.model(batch.half()).float().cpu().numpy()
        if self.device.type == "mps":
            torch.mps.empty_cache()
        return features


def device():
    if torch.backends.mps.is_available():
        torch.mps.set_per_process_memory_fraction(MPS_FRACTION)
        return torch.device("mps")
    return torch.device("cpu")


def peak_gb():
    return resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / 1e9


def weights_file():
    from huggingface_hub import hf_hub_download

    return Path(hf_hub_download("bioptimus/H-optimus-0", "pytorch_model.bin"))


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1 << 24), b""):
            digest.update(chunk)
    return digest.hexdigest()


def memory(args):
    weights = weights_file()
    report = {"weights_bytes": weights.stat().st_size, "weights_sha256": sha256(weights)}
    started = time.perf_counter()
    embedder = FoundationEmbedder(device())
    report["load_seconds"] = time.perf_counter() - started
    report["normalization"] = embedder.normalization.__dict__
    patches = np.random.default_rng(0).integers(
        0, 256, (args.batch, PROBE_PATCH, PROBE_PATCH, 3), np.uint8
    )
    started = time.perf_counter()
    features = embedder.embed(patches)
    report["batch"] = args.batch
    report["batch_seconds"] = time.perf_counter() - started
    report["feature_size"] = int(features.shape[1])
    report["peak_rss_gb"] = peak_gb()
    if embedder.device.type == "mps":
        report["mps_driver_gb"] = torch.mps.driver_allocated_memory() / 1e9
    print(json.dumps(report, indent=2))


def features(args):
    lines = [line for csv in args.csv for line in csv.read_text().splitlines()]
    wanted = [p for p in training_patches(lines) if p.slide == args.slide.stem]
    if args.limit:
        wanted = wanted[: args.limit]
    slide = openslide.OpenSlide(args.slide)
    side = read_side(float(slide.properties["openslide.mpp-x"]))
    embedder = FoundationEmbedder(device())
    started = time.perf_counter()
    values = embed_centres(
        OpenSlideReader(slide), embedder, [(p.x, p.y) for p in wanted], side, args.batch
    )
    labels = np.array([p.tumor for p in wanted])
    np.savez(args.out, features=values, labels=labels)
    print(
        json.dumps(
            {
                "slide": args.slide.stem,
                "patches": len(wanted),
                "tumor": int(labels.sum()),
                "seconds": time.perf_counter() - started,
                "peak_rss_gb": peak_gb(),
            }
        )
    )


def fit(args):
    stored = [np.load(path) for path in args.features]
    values = np.concatenate([s["features"] for s in stored])
    labels = np.concatenate([s["labels"] for s in stored])
    probe = fit_probe(values, labels, args.strength)
    probe.save(args.out)
    accuracy = float(((probe.probability(values) > 0.5) == labels).mean())
    print(
        json.dumps({"patches": len(labels), "tumor": int(labels.sum()), "train_accuracy": accuracy})
    )


def mapped(args):
    args.out.mkdir(parents=True, exist_ok=True)
    slide = openslide.OpenSlide(args.slide)
    spacing = float(slide.properties["openslide.mpp-x"])
    scorer = ProbeScorer(
        FoundationEmbedder(device()), LinearProbe.load(args.probe), spacing, args.block, args.batch
    )
    tissue = tissue_of(slide)
    result = map_slide(probe_reader(OpenSlideReader(slide), scorer), scorer, tissue)
    np.save(args.out / "stored.npy", stored_values(result.probability, result.tissue))
    report = {
        "slide": args.slide.name,
        "tiles": result.tiles,
        "seconds": result.seconds,
        "seconds_per_tile": result.seconds / max(1, result.scored),
        "block": args.block,
        "peak_rss_gb": peak_gb(),
    }
    (args.out / "probe_map.json").write_text(json.dumps(report, indent=2))
    print(json.dumps(report))


def main():
    parser = argparse.ArgumentParser()
    steps = parser.add_subparsers(dest="step", required=True)
    step = steps.add_parser("memory")
    step.add_argument("--batch", type=int, default=4)
    step.set_defaults(run=memory)
    step = steps.add_parser("features")
    step.add_argument("slide", type=Path)
    step.add_argument("out", type=Path)
    step.add_argument("csv", type=Path, nargs="+")
    step.add_argument("--batch", type=int, default=16)
    step.add_argument("--limit", type=int)
    step.set_defaults(run=features)
    step = steps.add_parser("fit")
    step.add_argument("out", type=Path)
    step.add_argument("features", type=Path, nargs="+")
    step.add_argument("--strength", type=float, default=1.0)
    step.set_defaults(run=fit)
    step = steps.add_parser("map")
    step.add_argument("probe", type=Path)
    step.add_argument("slide", type=Path)
    step.add_argument("out", type=Path)
    step.add_argument("--block", type=int, default=2)
    step.add_argument("--batch", type=int, default=16)
    step.set_defaults(run=mapped)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
