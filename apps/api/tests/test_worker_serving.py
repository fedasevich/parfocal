from collections.abc import Collection, Generator
from contextlib import contextmanager

import pytest
from db_support import ApiAs
from test_model_runs import Lab, make_lab, ok, problem, start

from parfocal_api.worker_serving import EveryWorkerAnswering, Serving, serving_of


class Outage:
    def __init__(self, models: Collection[str]) -> None:
        self.models = models

    def offline_models(self) -> Collection[str]:
        return self.models


@contextmanager
def worker_outage(api: ApiAs, *models: str) -> Generator[None]:
    api.app.state.worker_probe = Outage(models)
    try:
        yield
    finally:
        del api.app.state.worker_probe


def test_a_model_without_an_offline_worker_is_ready() -> None:
    assert serving_of(EveryWorkerAnswering(), "hovernet") is Serving.READY
    assert serving_of(Outage(["hovernet"]), "hovernet") is Serving.OFFLINE
    assert serving_of(Outage(["hovernet"]), None) is Serving.READY


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database)


@pytest.mark.db
def test_tiers_and_project_models_show_the_offline_worker(api: ApiAs, lab: Lab) -> None:
    owner = api(lab.people["owner"])
    with worker_outage(api, "hovernet"):
        tiers = ok(owner.get("/api/tenant/model-tiers"))
        models = ok(owner.get(f"/api/projects/{lab.project}/models"))
    offline_tiers = {(row["task"], row["tier"]) for row in tiers if row["serving"] == "offline"}
    assert offline_tiers == {("outline", "good"), ("typer", "good")}
    assert {row["name"] for row in models if row["serving"] == "offline"} == {"hovernet"}
    assert {row["serving"] for row in ok(owner.get("/api/tenant/model-tiers"))} == {"ready"}


@pytest.mark.db
def test_a_run_on_a_model_with_no_worker_is_refused(api: ApiAs, lab: Lab) -> None:
    with worker_outage(api, "hovernet-pannuke"):
        refused = start(api, lab)
    assert problem(refused) == (409, "model-offline")
    assert start(api, lab).status_code == 201
