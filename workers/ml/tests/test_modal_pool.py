from dataclasses import replace

import pytest

from parfocal_ml.gpu_pool import POOLS, PoolLimitError
from parfocal_ml.modal_pool import APP_NAME, app, build_app, pool_entry, pool_functions


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
