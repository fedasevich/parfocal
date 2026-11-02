import json
import os
import statistics
import time

import modal

GPU = "T4"
IDLE_SCALEDOWN_SECONDS = 300
SLIDE_JOB_SECONDS = 120
WARM_REQUESTS = 20

image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "torch==2.9.0", "torchvision==0.24.0", "segment-anything==1.0", "numpy"
)

app = modal.App("parfocal-spike-gpu-serving", image=image)


def build_sam_encoder():
    import torch
    from segment_anything import sam_model_registry

    model = sam_model_registry["vit_b"](checkpoint=None).image_encoder
    return model.to("cuda").eval().half(), torch


def tile_from_seed(torch, seed: int):
    generator = torch.Generator(device="cuda").manual_seed(seed)
    return torch.rand((1, 3, 1024, 1024), generator=generator, device="cuda", dtype=torch.float16)


def encode(embedding, encoding: str) -> bytes:
    if encoding == "none":
        return b""
    if encoding == "int8":
        scale = embedding.abs().amax().clamp(min=1e-6) / 127
        return (embedding / scale).round().clamp(-127, 127).cpu().numpy().astype("int8").tobytes()
    return embedding.cpu().numpy().tobytes()


@app.cls(gpu=GPU, scaledown_window=IDLE_SCALEDOWN_SECONDS, timeout=600)
class Embedder:
    @modal.enter()
    def load(self) -> None:
        started = time.perf_counter()
        self.encoder, self.torch = build_sam_encoder()
        with self.torch.inference_mode():
            self.encoder(tile_from_seed(self.torch, 0))
        self.torch.cuda.synchronize()
        self.load_seconds = time.perf_counter() - started
        self.served = 0

    @modal.method()
    def ping(self, payload_bytes: int = 0) -> dict[str, object]:
        return {
            "region": os.environ.get("MODAL_REGION"),
            "cloud": os.environ.get("MODAL_CLOUD_PROVIDER"),
            "payload": os.urandom(payload_bytes),
        }

    @modal.method()
    def embed(self, seed: int, encoding: str = "float16") -> dict[str, object]:
        started = time.perf_counter()
        with self.torch.inference_mode():
            embedding = self.encoder(tile_from_seed(self.torch, seed))
        payload = encode(embedding, encoding)
        self.served += 1
        return {
            "compute_seconds": time.perf_counter() - started,
            "load_seconds": self.load_seconds,
            "first_request": self.served == 1,
            "embedding_bytes": len(payload),
            "embedding_shape": list(embedding.shape),
            "gpu": self.torch.cuda.get_device_name(0),
            "torch": str(self.torch.__version__),
            "payload": payload,
        }


@app.function(gpu=GPU, timeout=300)
def slide_job(seconds: int, running: modal.Dict) -> dict[str, object]:
    started = time.perf_counter()
    encoder, torch = build_sam_encoder()
    loaded = time.perf_counter()
    running["since"] = time.time()
    tiles = 0
    with torch.inference_mode():
        while time.perf_counter() - loaded < seconds:
            encoder(tile_from_seed(torch, tiles))
            torch.cuda.synchronize()
            tiles += 1
    return {
        "load_seconds": loaded - started,
        "busy_seconds": time.perf_counter() - loaded,
        "tiles": tiles,
        "started_at": time.time() - (time.perf_counter() - started),
        "finished_at": time.time(),
    }


def timed_ping(embedder: Embedder, payload_bytes: int = 0) -> float:
    started = time.perf_counter()
    embedder.ping.remote(payload_bytes)
    return time.perf_counter() - started


def summary(values: list[float]) -> dict[str, float]:
    return {
        "min": round(min(values), 3),
        "median": round(statistics.median(values), 3),
        "p95": round(percentile(values, 0.95), 3),
        "max": round(max(values), 3),
    }


def percentile(values: list[float], share: float) -> float:
    ordered = sorted(values)
    index = min(len(ordered) - 1, round(share * (len(ordered) - 1)))
    return ordered[index]


def timed_embed(embedder: Embedder, seed: int, encoding: str = "float16") -> dict[str, object]:
    started = time.perf_counter()
    reply = embedder.embed.remote(seed, encoding)
    reply["round_trip_seconds"] = time.perf_counter() - started
    reply["finished_at"] = time.time()
    del reply["payload"]
    return reply


@app.local_entrypoint()
def main() -> None:
    embedder = Embedder()
    cold = timed_embed(embedder, 1)
    placement = embedder.ping.remote()
    del placement["payload"]

    with modal.Dict.ephemeral() as running:
        spawned = time.perf_counter()
        job = slide_job.spawn(SLIDE_JOB_SECONDS, running)
        while running.get("since") is None:
            time.sleep(1)
        job_cold_start_seconds = time.perf_counter() - spawned

        with_payload: list[dict[str, object]] = []
        without_payload: list[dict[str, object]] = []
        int8_payload: list[dict[str, object]] = []
        pings: list[float] = []
        pings_under_2_mib: list[float] = []
        pings_over_2_mib: list[float] = []
        for seed in range(2, 2 + WARM_REQUESTS):
            with_payload.append(timed_embed(embedder, seed))
            without_payload.append(timed_embed(embedder, seed, "none"))
            int8_payload.append(timed_embed(embedder, seed, "int8"))
            pings.append(timed_ping(embedder))
            pings_under_2_mib.append(timed_ping(embedder, 1_900_000))
            pings_over_2_mib.append(timed_ping(embedder, 2_200_000))
        job_result = job.get()

    job_window = (
        float(job_result["started_at"]) + float(job_result["load_seconds"]),
        float(job_result["finished_at"]),
    )
    warm = with_payload + without_payload + int8_payload
    overlapping = sum(
        1 for reply in warm if job_window[0] <= float(reply["finished_at"]) <= job_window[1]
    )
    print(
        json.dumps(
            {
                "placement": placement,
                "cold": cold,
                "slide_job": job_result,
                "slide_job_spawn_to_running_seconds": round(job_cold_start_seconds, 3),
                "embed_with_payload_round_trip": summary(
                    [float(r["round_trip_seconds"]) for r in with_payload]
                ),
                "embed_without_payload_round_trip": summary(
                    [float(r["round_trip_seconds"]) for r in without_payload]
                ),
                "embed_int8_round_trip": summary(
                    [float(r["round_trip_seconds"]) for r in int8_payload]
                ),
                "int8_bytes": int8_payload[0]["embedding_bytes"],
                "ping_round_trip": summary(pings),
                "ping_1_9_mb_round_trip": summary(pings_under_2_mib),
                "ping_2_2_mb_round_trip": summary(pings_over_2_mib),
                "embed_compute": summary([float(r["compute_seconds"]) for r in warm]),
                "embeds_finished_during_job": f"{overlapping} of {len(warm)}",
                "with_payload_round_trips": [
                    round(float(r["round_trip_seconds"]), 3) for r in with_payload
                ],
            },
            indent=2,
        )
    )
