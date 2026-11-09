from collections.abc import Collection
from enum import StrEnum
from typing import Protocol, cast

from fastapi import Request


class Serving(StrEnum):
    READY = "ready"
    OFFLINE = "offline"


class WorkerProbe(Protocol):
    def offline_models(self) -> Collection[str]: ...


class EveryWorkerAnswering:
    def offline_models(self) -> Collection[str]:
        return ()


def probe_of(request: Request) -> WorkerProbe:
    return cast("WorkerProbe", getattr(request.app.state, "worker_probe", EveryWorkerAnswering()))


def serving_of(probe: WorkerProbe, model_name: str | None) -> Serving:
    if model_name is not None and model_name in probe.offline_models():
        return Serving.OFFLINE
    return Serving.READY
