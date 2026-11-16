import argparse
import itertools
import json
import multiprocessing
import os
import platform
import queue
import statistics
import threading
import time
import uuid
from collections.abc import Callable
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from multiprocessing.context import SpawnContext
from pathlib import Path

SINGLE_THREAD_ENV = (
    "OMP_NUM_THREADS",
    "OPENBLAS_NUM_THREADS",
    "MKL_NUM_THREADS",
    "VECLIB_MAXIMUM_THREADS",
)
STAND_IN_WIDTH = 1024
SPIKE_T4_ENCODE_SECONDS = 0.14
CONTROL_JOB_DEPTH = 8
REPLY_TIMEOUT_SECONDS = 120.0
TENANT = uuid.UUID(int=7)
SLIDE = uuid.UUID(int=8)


def number(value: object) -> float:
    if not isinstance(value, int | float):
        raise TypeError(f"expected a number, got {value!r}")
    return float(value)


def whole(value: object) -> int:
    return int(number(value))


@dataclass(frozen=True)
class ContainerSpec:
    name: str
    max_inputs: int
    depth: int
    width: int = STAND_IN_WIDTH


class StandInEncoder:
    def __init__(
        self, width: int, depth: int | None = None, target_seconds: float = 0.0, seed: int = 0
    ) -> None:
        import numpy as np

        rng = np.random.default_rng(seed)
        self.np = np
        self.patch = rng.standard_normal((768, width), dtype=np.float32) / 28
        self.layer = rng.standard_normal((width, width), dtype=np.float32) / 32
        self.neck = rng.standard_normal((width, 256), dtype=np.float32) / 32
        self.depth = 1
        if depth is not None:
            self.depth = depth
            return
        self.timed()
        base = self.timed()
        self.timed_layer()
        per_layer = max(self.timed_layer(), 1e-4)
        self.depth = max(1, round((target_seconds - base) / per_layer) + 1)

    def timed(self) -> float:
        pixels = self.np.zeros((1, 3, 1024, 1024), dtype=self.np.float32)
        started = time.perf_counter()
        self(pixels)
        return time.perf_counter() - started

    def timed_layer(self) -> float:
        tokens = self.np.ones((4096, self.layer.shape[0]), dtype=self.np.float32)
        started = time.perf_counter()
        self.np.tanh(tokens @ self.layer)
        return time.perf_counter() - started

    def __call__(self, pixels):
        np = self.np
        patches = pixels[0].reshape(3, 64, 16, 64, 16).transpose(1, 3, 0, 2, 4).reshape(4096, 768)
        tokens = np.tanh(patches @ self.patch)
        for _ in range(self.depth):
            tokens = np.tanh(tokens @ self.layer)
        return (tokens @ self.neck).T.reshape(1, 256, 64, 64)


def fake_reader(x: int, y: int, width: int, height: int):
    import numpy as np

    return np.full((height, width, 3), (x // 7 + y // 11) % 256, dtype=np.uint8)


def container_main(spec: ContainerSpec, inbox, outbox) -> None:
    from parfocal_ml.priority_gate import EmbedTile, embed_tile
    from parfocal_ml.sam_contract import pixel_values

    started = time.time()
    encoder = StandInEncoder(spec.width, spec.depth)
    gpu = threading.Lock()
    store: dict[str, int] = {}

    def encode(pixels):
        with gpu:
            return encoder(pixels)

    def write(key: str, body: bytes, _content_type: str) -> None:
        store[key] = len(body)

    def run_job(seconds: float) -> dict[str, object]:
        window_start = time.time()
        tiles = 0
        while time.time() - window_start < seconds:
            encode(pixel_values(fake_reader(tiles * 512, 0, 512, 512)))
            tiles += 1
        return {"tiles": tiles, "window_start": window_start, "window_end": time.time()}

    def handle(call: dict[str, object]) -> dict[str, object]:
        kind = call["kind"]
        begun = time.time()
        if kind == "warm":
            return {"warm": True}
        if kind == "embed":
            request = EmbedTile(TENANT, SLIDE, whole(call["column"]), whole(call["row"]), 0, 0, 512)
            reply = embed_tile(request, fake_reader, encode, write)
            return {**reply, "served_at": time.time(), "began": begun}
        if kind == "detect":
            seconds = number(call.get("seconds", 0.0))
            if seconds > 0:
                return run_job(seconds)
            encode(pixel_values(fake_reader(0, 0, 512, 512)))
            return {"tiles": 1}
        raise ValueError(f"no stand-in for {kind!r}")

    outbox.put(
        (
            "ready",
            0,
            {
                "load_seconds": time.time() - started,
                "depth": encoder.depth,
                "encode_seconds": statistics.median(encoder.timed() for _ in range(3)),
            },
        )
    )
    executor = ThreadPoolExecutor(spec.max_inputs)

    def answer(request_id: int, call: dict[str, object]) -> None:
        try:
            outbox.put(("reply", request_id, handle(call)))
        except Exception as error:
            outbox.put(("error", request_id, repr(error)))

    while True:
        item = inbox.get()
        if item is None:
            break
        executor.submit(answer, *item)
    executor.shutdown(wait=True)
    outbox.put(("stopped", 0, {}))


class LocalContainer:
    def __init__(self, context: SpawnContext, spec: ContainerSpec) -> None:
        self.spec = spec
        self.inbox = context.Queue()
        self.outbox = context.Queue()
        self.process = context.Process(
            target=container_main, args=(spec, self.inbox, self.outbox), daemon=True
        )
        self.futures: dict[int, Future[dict[str, object]]] = {}
        self.ids = itertools.count(1)
        self.lock = threading.Lock()
        self.ready = threading.Event()
        self.info: dict[str, object] = {}
        self.spawned_at = time.time()
        self.process.start()
        self.reader = threading.Thread(target=self.read, daemon=True)
        self.reader.start()

    def read(self) -> None:
        while True:
            try:
                kind, request_id, body = self.outbox.get(timeout=1.0)
            except queue.Empty:
                if not self.process.is_alive():
                    return
                continue
            if kind == "ready":
                self.info = {**body, "ready_after": time.time() - self.spawned_at}
                self.ready.set()
            elif kind == "stopped":
                return
            else:
                with self.lock:
                    future = self.futures.pop(request_id)
                if kind == "error":
                    future.set_exception(RuntimeError(body))
                else:
                    future.set_result(body)

    def submit(self, call: dict[str, object]) -> Future[dict[str, object]]:
        future: Future[dict[str, object]] = Future()
        with self.lock:
            request_id = next(self.ids)
            self.futures[request_id] = future
        self.inbox.put((request_id, call))
        return future

    def stop(self) -> None:
        self.inbox.put(None)
        self.process.join(timeout=30)
        if self.process.is_alive():
            self.process.terminate()
            self.process.join(timeout=5)


class LocalPools:
    def __init__(self, context: SpawnContext, specs: dict[str, ContainerSpec]) -> None:
        self.context = context
        self.specs = specs
        self.containers: dict[str, LocalContainer] = {}
        self.lock = threading.Lock()

    def container(self, function_name: str) -> LocalContainer:
        with self.lock:
            if function_name not in self.containers:
                spec = self.specs[function_name]
                self.containers[function_name] = LocalContainer(self.context, spec)
            return self.containers[function_name]

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.container(function_name).submit(call)

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        return self.container(function_name).submit(call).result(timeout=REPLY_TIMEOUT_SECONDS)

    def stop(self) -> None:
        for container in self.containers.values():
            container.stop()
        self.containers.clear()


@dataclass
class Sample:
    started: float
    ended: float

    @property
    def seconds(self) -> float:
        return self.ended - self.started


@dataclass
class Arm:
    name: str
    clients: int
    samples: list[Sample] = field(default_factory=list[Sample])
    window: tuple[float, float] | None = None
    job_tiles: int | None = None

    def summary(self) -> dict[str, object]:
        seconds = sorted(sample.seconds for sample in self.samples)
        inside = None
        if self.window is not None:
            start, end = self.window
            inside = sum(start <= s.started and s.ended <= end for s in self.samples)
        return {
            "arm": self.name,
            "clients": self.clients,
            "calls": len(seconds),
            "min": round(seconds[0], 3),
            "median": round(statistics.median(seconds), 3),
            "p95": round(seconds[max(0, round(0.95 * len(seconds)) - 1)], 3),
            "max": round(seconds[-1], 3),
            "inside_job_window": inside,
            "job_tiles": self.job_tiles,
        }


def drive(clients: int, calls: int, send: Callable[[dict[str, object]], object]) -> list[Sample]:
    samples: list[Sample] = []
    lock = threading.Lock()
    columns = itertools.count()

    def client() -> None:
        for _ in range(calls):
            column = next(columns)
            started = time.time()
            send({"kind": "embed", "column": column, "row": 0})
            ended = time.time()
            with lock:
                samples.append(Sample(started, ended))

    threads = [threading.Thread(target=client) for _ in range(clients)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    return samples


def wait_until_running(job: Future[dict[str, object]], container: LocalContainer) -> None:
    container.ready.wait(timeout=REPLY_TIMEOUT_SECONDS)
    time.sleep(0.5)
    if job.done():
        raise RuntimeError("the job ended before the interactive calls started")


def gated_arm(
    context: SpawnContext, depth: int, clients: int, calls: int, job_seconds: float
) -> tuple[Arm, dict[str, object]]:
    from parfocal_ml.gpu_pool import POOLS, Family
    from parfocal_ml.priority_gate import Device, InteractiveGate, interactive_pool

    embedder = interactive_pool()
    job_pool = next(pool for pool in POOLS if pool.family is Family.DETECTOR_GOOD)
    pools = LocalPools(
        context,
        {
            embedder.function_name: ContainerSpec(
                embedder.function_name, embedder.max_inputs, depth
            ),
            job_pool.function_name: ContainerSpec(
                job_pool.function_name, job_pool.max_inputs, depth
            ),
        },
    )
    try:
        gate = InteractiveGate(pools)
        warmed = gate.activate(Device.SLOW)
        job_container = pools.container(job_pool.function_name)
        job = job_container.submit({"kind": "detect", "seconds": job_seconds})
        pools.container(embedder.function_name).ready.wait(timeout=REPLY_TIMEOUT_SECONDS)
        wait_until_running(job, job_container)
        arm = Arm(f"gated, {clients} clients", clients)
        arm.samples = drive(clients, calls, gate.request)
        reply = job.result(timeout=REPLY_TIMEOUT_SECONDS + job_seconds)
        arm.window = (number(reply["window_start"]), number(reply["window_end"]))
        arm.job_tiles = whole(reply["tiles"])
        info = {
            "warm": warmed.value,
            "embedder": pools.containers[embedder.function_name].info,
            "job": job_container.info,
        }
        return arm, info
    finally:
        pools.stop()


def baseline_arm(context: SpawnContext, depth: int, clients: int, calls: int) -> Arm:
    from parfocal_ml.priority_gate import Device, InteractiveGate, interactive_pool

    embedder = interactive_pool()
    pools = LocalPools(
        context,
        {embedder.function_name: ContainerSpec(embedder.function_name, embedder.max_inputs, depth)},
    )
    try:
        gate = InteractiveGate(pools)
        gate.activate(Device.SLOW)
        pools.container(embedder.function_name).ready.wait(timeout=REPLY_TIMEOUT_SECONDS)
        arm = Arm("no job running", clients)
        arm.samples = drive(clients, calls, gate.request)
        return arm
    finally:
        pools.stop()


def control_arm(context: SpawnContext, depth: int, clients: int, calls: int) -> Arm:
    shared = LocalContainer(context, ContainerSpec("shared", 1, depth))
    stop = threading.Event()
    window: list[float] = []
    tiles = itertools.count()

    def feed() -> None:
        in_flight: list[Future[dict[str, object]]] = []
        window.append(time.time())
        while not stop.is_set():
            in_flight = [future for future in in_flight if not future.done()]
            while len(in_flight) < CONTROL_JOB_DEPTH:
                in_flight.append(shared.submit({"kind": "detect"}))
                next(tiles)
            time.sleep(0.01)
        for future in in_flight:
            future.result(timeout=REPLY_TIMEOUT_SECONDS)
        window.append(time.time())

    try:
        shared.ready.wait(timeout=REPLY_TIMEOUT_SECONDS)
        feeder = threading.Thread(target=feed)
        feeder.start()
        time.sleep(1.0)
        arm = Arm("one shared queue, no gate", clients)
        arm.samples = drive(
            clients, calls, lambda call: shared.submit(call).result(timeout=REPLY_TIMEOUT_SECONDS)
        )
        stop.set()
        feeder.join()
        arm.window = (window[0], window[1])
        arm.job_tiles = next(tiles)
        return arm
    finally:
        shared.stop()


def first_call(context: SpawnContext, depth: int, warm: bool, rounds: int) -> dict[str, object]:
    from parfocal_ml.priority_gate import Device, InteractiveGate, interactive_pool

    embedder = interactive_pool()
    seconds: list[float] = []
    for _ in range(rounds):
        pools = LocalPools(
            context,
            {
                embedder.function_name: ContainerSpec(
                    embedder.function_name, embedder.max_inputs, depth
                )
            },
        )
        try:
            gate = InteractiveGate(pools)
            if warm:
                gate.activate(Device.SLOW)
                pools.container(embedder.function_name).ready.wait(timeout=REPLY_TIMEOUT_SECONDS)
                time.sleep(0.3)
            started = time.time()
            gate.request({"kind": "embed", "column": 0, "row": 0})
            seconds.append(time.time() - started)
        finally:
            pools.stop()
    return {
        "pre_warmed": warm,
        "rounds": rounds,
        "min": round(min(seconds), 3),
        "median": round(statistics.median(seconds), 3),
        "max": round(max(seconds), 3),
    }


def passes(arm: dict[str, object], target: float) -> bool:
    return (
        number(arm["p95"]) < target
        and number(arm["max"]) < target
        and arm["inside_job_window"] == arm["calls"]
    )


def calibrated_depth(target_seconds: float) -> int:
    return StandInEncoder(STAND_IN_WIDTH, target_seconds=target_seconds).depth


def run(
    calls: int, job_seconds: float, sweep: tuple[int, ...], first_rounds: int, encode: float
) -> dict[str, object]:
    from parfocal_ml.gpu_pool import INTERACTIVE_SCALEDOWN_SECONDS
    from parfocal_ml.priority_gate import INTERACTIVE_TARGET_SECONDS, interactive_pool

    context = multiprocessing.get_context("spawn")
    with context.Pool(1) as pool:
        depth = pool.apply(calibrated_depth, (encode,))
    max_inputs = interactive_pool().max_inputs
    report: dict[str, object] = {
        "machine": platform.machine(),
        "system": f"{platform.system()} {platform.release()}",
        "python": platform.python_version(),
        "cpus": os.cpu_count(),
        "target_seconds": INTERACTIVE_TARGET_SECONDS,
        "scaledown_seconds": INTERACTIVE_SCALEDOWN_SECONDS,
        "embedder_max_inputs": max_inputs,
        "calls_per_client": calls,
        "job_seconds": job_seconds,
        "control_job_depth": CONTROL_JOB_DEPTH,
        "stand_in_depth": depth,
        "load_average_before": os.getloadavg(),
    }
    report["baseline"] = baseline_arm(context, depth, 1, calls).summary()
    gated: list[dict[str, object]] = []
    for clients in sweep:
        arm, info = gated_arm(context, depth, clients, calls, job_seconds)
        summary = arm.summary()
        gated.append(
            {**summary, "passes": passes(summary, INTERACTIVE_TARGET_SECONDS), "containers": info}
        )
    report["gated"] = gated
    report["control"] = control_arm(context, depth, 1, calls).summary()
    report["first_call"] = [
        first_call(context, depth, warm=False, rounds=first_rounds),
        first_call(context, depth, warm=True, rounds=first_rounds),
    ]
    report["load_average_after"] = os.getloadavg()
    report["meets_target"] = all(
        arm["passes"] for arm in gated if whole(arm["clients"]) <= max_inputs
    )
    return report


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Local load test of the interactive priority gate")
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--calls", type=int, default=20)
    parser.add_argument("--job-seconds", type=float, default=45.0)
    parser.add_argument("--sweep", default="1,2,4,8")
    parser.add_argument("--first-rounds", type=int, default=3)
    parser.add_argument("--encode-seconds", type=float, default=SPIKE_T4_ENCODE_SECONDS)
    args = parser.parse_args(argv)
    for name in SINGLE_THREAD_ENV:
        os.environ[name] = "1"
    sweep = tuple(int(part) for part in args.sweep.split(","))
    report = run(args.calls, args.job_seconds, sweep, args.first_rounds, args.encode_seconds)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(
        json.dumps(
            {
                key: report[key]
                for key in ("baseline", "gated", "control", "first_call", "meets_target")
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
