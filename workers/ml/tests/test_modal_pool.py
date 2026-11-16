import uuid
from collections.abc import Mapping
from dataclasses import replace

import pytest

from parfocal_ml.gpu_pool import POOLS, PoolLimitError, cpu_stand_in
from parfocal_ml.modal_pool import (
    APP_NAME,
    app,
    build_app,
    default_runners,
    pool_entry,
    pool_functions,
)
from parfocal_ml.priority_gate import Kind
from parfocal_ml.tumor_map_job import POOL_FAMILY
from parfocal_ml.tumor_map_worker import Drain, drain_of


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
