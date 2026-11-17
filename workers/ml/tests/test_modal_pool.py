import uuid
from collections.abc import Mapping
from dataclasses import replace

import pytest

from parfocal_common.model_runs import LAB_POOL_FUNCTION, lab_drain_call
from parfocal_common.tumor_maps import POOL_FUNCTION, drain_call, wake_tumor_map_pool
from parfocal_ml.gpu_pool import POOLS, Family, PoolLimitError, cpu_stand_in
from parfocal_ml.modal_pool import (
    APP_NAME,
    DATABASE_SECRET,
    LAB_MODEL_SECRETS,
    STORAGE_SECRET,
    TUMOR_MAP_SECRETS,
    VIEW_MAP_SECRETS,
    app,
    build_app,
    default_runners,
    pool_entry,
    pool_functions,
    secret_names,
)
from parfocal_ml.priority_gate import Kind, accepts
from parfocal_ml.tumor_map_job import POOL_FAMILY
from parfocal_ml.tumor_map_worker import Drain, NoCudaError, drain_of, refuse_cpu_on_a_gpu


def test_the_app_registers_one_function_per_family() -> None:
    assert app.name == APP_NAME
    assert sorted(pool_functions) == sorted(pool.function_name for pool in POOLS)


def test_building_an_app_with_a_broken_pool_fails_before_modal_sees_it() -> None:
    with pytest.raises(PoolLimitError):
        build_app("parfocal-test-pool", (replace(POOLS[0], min_containers=1),))


def test_a_probe_reports_its_family_and_container() -> None:
    reply = pool_entry(POOLS[0])({"kind": "probe", "seconds": 0})
    assert reply["family"] == "detector-best"
    assert isinstance(reply["container"], str)


def test_a_family_without_a_runner_refuses_other_calls() -> None:
    with pytest.raises(ValueError, match="no runner"):
        pool_entry(POOLS[0])({"kind": "detect"})


def test_only_the_detector_good_pool_runs_tumor_maps() -> None:
    families = {pool.family for pool in POOLS if Kind.TUMOR_MAP in default_runners(pool)}
    assert families == {POOL_FAMILY}


def test_a_tumor_map_call_goes_to_its_runner_with_the_call() -> None:
    pool = next(pool for pool in POOLS if pool.family is POOL_FAMILY)
    calls: list[Mapping[str, object]] = []

    def runner(call: Mapping[str, object]) -> Mapping[str, object]:
        calls.append(call)
        return {"finished": 1}

    entry = pool_entry(cpu_stand_in(pool, max_containers=1), {Kind.TUMOR_MAP: runner})
    reply = entry({"kind": "tumor-map", "idle_exit_seconds": 1})
    assert reply == {"family": "detector-good", "kind": "tumor-map", "finished": 1}
    assert calls == [{"kind": "tumor-map", "idle_exit_seconds": 1}]


def test_a_drain_call_reads_its_idle_exit_poll_and_tenant() -> None:
    tenant = uuid.uuid4()
    call = {"idle_exit_seconds": 2, "poll_seconds": 0.5, "tenant_id": str(tenant)}
    assert drain_of(call) == Drain(2.0, 0.5, tenant)
    assert drain_of({"idle_exit_seconds": "soon"}) == Drain()


def test_the_api_wakes_the_pool_that_runs_tumor_maps_with_a_call_it_accepts() -> None:
    pool = next(pool for pool in POOLS if pool.family is POOL_FAMILY)
    assert pool.function_name == POOL_FUNCTION
    assert drain_call()["kind"] == Kind.TUMOR_MAP
    assert accepts(pool, str(drain_call()["kind"]))
    assert drain_of(drain_call()) == Drain()


def test_the_tumor_map_pool_reads_the_database_and_the_view_map_pool_only_storage() -> None:
    held = {pool.family: secret_names(pool) for pool in POOLS if secret_names(pool)}
    assert held == {
        POOL_FAMILY: TUMOR_MAP_SECRETS,
        Family.EMBEDDER: VIEW_MAP_SECRETS,
        Family.LAB_MODEL: LAB_MODEL_SECRETS,
    }
    assert VIEW_MAP_SECRETS == (STORAGE_SECRET,)
    assert DATABASE_SECRET in TUMOR_MAP_SECRETS
    assert DATABASE_SECRET in LAB_MODEL_SECRETS


def test_lab_model_runs_go_to_a_cpu_pool_with_their_own_runner() -> None:
    pool = next(pool for pool in POOLS if pool.family is Family.LAB_MODEL)
    assert pool.gpu is None
    assert pool.hourly_usd_at_max == 0.0
    assert set(default_runners(pool)) == {Kind.LAB_MODEL}
    assert {p.family for p in POOLS if Kind.LAB_MODEL in default_runners(p)} == {Family.LAB_MODEL}
    calls: list[Mapping[str, object]] = []

    def runner(call: Mapping[str, object]) -> Mapping[str, object]:
        calls.append(call)
        return {"finished": 2}

    reply = pool_entry(pool, {Kind.LAB_MODEL: runner})({"kind": "lab-model"})
    assert reply == {"family": "lab-model", "kind": "lab-model", "finished": 2}
    assert calls == [{"kind": "lab-model"}]


class Pools:
    def __init__(self, fails: bool) -> None:
        self.fails = fails
        self.spawned: list[tuple[str, dict[str, object]]] = []

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.spawned.append((function_name, call))
        if self.fails:
            raise ConnectionError("the pool app is not deployed")

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        raise AssertionError("waking never waits for a reply")


def test_waking_the_pool_reports_a_failed_spawn_instead_of_raising() -> None:
    working, broken = Pools(fails=False), Pools(fails=True)
    assert wake_tumor_map_pool(working)
    assert not wake_tumor_map_pool(broken)
    assert working.spawned == broken.spawned == [(POOL_FUNCTION, {"kind": "tumor-map"})]


def test_a_gpu_pool_refuses_to_score_on_the_cpu() -> None:
    refuse_cpu_on_a_gpu(("CUDAExecutionProvider", "CPUExecutionProvider"), "T4")
    refuse_cpu_on_a_gpu(("CPUExecutionProvider",), None)
    with pytest.raises(NoCudaError, match="T4"):
        refuse_cpu_on_a_gpu(("CPUExecutionProvider",), "T4")


def test_the_api_wakes_the_lab_model_pool_with_a_call_it_runs() -> None:
    pool = next(pool for pool in POOLS if pool.family is Family.LAB_MODEL)
    assert pool.function_name == LAB_POOL_FUNCTION
    assert LAB_POOL_FUNCTION in pool_functions
    assert accepts(pool, str(lab_drain_call()["kind"]))
    assert str(lab_drain_call()["kind"]) in default_runners(pool)
    assert drain_of(lab_drain_call()) == Drain()
