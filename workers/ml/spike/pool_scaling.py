import json
import time

from parfocal_ml.gpu_pool import POOLS, Family, cpu_stand_in
from parfocal_ml.modal_pool import build_app

STAND_IN_CONTAINERS = 3
DEEP_QUEUE = 6
PROBE_SECONDS = 15

stand_in = cpu_stand_in(
    next(pool for pool in POOLS if pool.family is Family.DETECTOR_GOOD), STAND_IN_CONTAINERS
)
app, functions = build_app("parfocal-pool-scaling-check", (stand_in,))
pool_function = functions[stand_in.function_name]


def drain(depth: int) -> dict[str, object]:
    started = time.perf_counter()
    calls = [pool_function.spawn({"kind": "probe", "seconds": PROBE_SECONDS}) for _ in range(depth)]
    replies = [call.get() for call in calls]
    return {
        "queue_depth": depth,
        "containers": len({str(reply["container"]) for reply in replies}),
        "seconds": round(time.perf_counter() - started, 1),
        "regions": sorted({str(reply["region"]) for reply in replies}),
    }


@app.local_entrypoint()
def main() -> None:
    shallow = drain(1)
    deep = drain(DEEP_QUEUE)
    print(json.dumps({"cap": STAND_IN_CONTAINERS, "shallow": shallow, "deep": deep}, indent=2))
    assert shallow["containers"] == 1
    assert deep["containers"] in range(2, STAND_IN_CONTAINERS + 1)
