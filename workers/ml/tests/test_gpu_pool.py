from dataclasses import replace

import pytest

from parfocal_ml.gpu_pool import (
    GPU_MEMORY_MIB,
    INTERACTIVE_SCALEDOWN_SECONDS,
    MAX_CONTAINERS_PER_POOL,
    MAX_HOURLY_SPEND_USD,
    POOLS,
    Family,
    Gpu,
    PoolLimitError,
    concurrency_options,
    cpu_stand_in,
    function_options,
    validate_pools,
    worst_case_hourly_usd,
)

BATCH_FAMILIES = {Family.DETECTOR_BEST, Family.DETECTOR_GOOD, Family.TYPER_BEST, Family.TYPER_GOOD}


def pool_for(family: Family):
    return next(pool for pool in POOLS if pool.family is family)


def test_every_model_family_has_exactly_one_pool() -> None:
    assert sorted(pool.family for pool in POOLS) == sorted(Family)
    validate_pools(POOLS)


def test_only_t4_and_l4_class_cards_are_allowed() -> None:
    assert {gpu.value for gpu in Gpu} == {"T4", "L4", "A10G"}
    with pytest.raises(ValueError, match="is not a valid Gpu"):
        Gpu("A100")
    with pytest.raises(ValueError, match="is not a valid Gpu"):
        Gpu("H100")


def test_best_tiers_run_on_l4_and_the_rest_on_t4() -> None:
    assert pool_for(Family.DETECTOR_BEST).gpu is Gpu.L4
    assert pool_for(Family.TYPER_BEST).gpu is Gpu.L4
    assert pool_for(Family.DETECTOR_GOOD).gpu is Gpu.T4
    assert pool_for(Family.TYPER_GOOD).gpu is Gpu.T4
    assert pool_for(Family.EMBEDDER).gpu is Gpu.T4
    assert {function_options(pool)["gpu"] for pool in POOLS} == {"T4", "L4"}


def test_model_gpu_memory_fits_its_card() -> None:
    for pool in POOLS:
        assert pool.gpu is not None
        assert pool.gpu_memory_budget_mib <= GPU_MEMORY_MIB[pool.gpu]
    assert GPU_MEMORY_MIB[Gpu.T4] == 16 * 1024
    assert GPU_MEMORY_MIB[Gpu.L4] == 24 * 1024


def test_container_memory_has_a_hard_limit_above_its_request() -> None:
    for pool in POOLS:
        request, limit = function_options(pool)["memory"]
        assert 0 < request <= limit
        assert limit <= 16 * 1024


def test_batch_pools_take_one_input_per_container() -> None:
    for pool in POOLS:
        expected = 1 if pool.family in BATCH_FAMILIES else 4
        assert concurrency_options(pool) == {"max_inputs": expected}


def test_container_counts_are_capped() -> None:
    for pool in POOLS:
        assert 1 <= function_options(pool)["max_containers"] <= MAX_CONTAINERS_PER_POOL
    assert pool_for(Family.EMBEDDER).max_containers == 1


def test_every_pool_scales_to_zero_when_idle() -> None:
    for pool in POOLS:
        options = function_options(pool)
        assert options["min_containers"] == 0
        assert options["buffer_containers"] == 0
        assert 0 < options["scaledown_window"] <= INTERACTIVE_SCALEDOWN_SECONDS
    assert pool_for(Family.EMBEDDER).scaledown_window_seconds == INTERACTIVE_SCALEDOWN_SECONDS


def test_every_call_has_a_timeout() -> None:
    for pool in POOLS:
        assert 0 < function_options(pool)["timeout"] <= 3600
    assert pool_for(Family.EMBEDDER).timeout_seconds <= 60


def test_all_pools_at_their_cap_stay_under_the_hourly_spend_cap() -> None:
    assert worst_case_hourly_usd(POOLS) == pytest.approx(2 * 0.80 + 2 * 0.59 + 0.80 + 0.59 + 0.59)
    assert worst_case_hourly_usd(POOLS) <= MAX_HOURLY_SPEND_USD


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"gpu_memory_budget_mib": 17 * 1024}, "exceeds the card"),
        ({"memory_request_mib": 20 * 1024}, "at most the limit"),
        ({"max_inputs": 0}, "max_inputs"),
        ({"max_containers": MAX_CONTAINERS_PER_POOL + 1}, "per-pool cap"),
        ({"min_containers": 1}, "scale to zero"),
        ({"buffer_containers": 1}, "scale to zero"),
        ({"scaledown_window_seconds": 3600}, "idle cap"),
        ({"timeout_seconds": 0}, "job cap"),
    ],
)
def test_a_pool_that_breaks_a_limit_is_rejected(change: dict[str, int], message: str) -> None:
    broken = replace(pool_for(Family.DETECTOR_GOOD), **change)
    others = tuple(pool for pool in POOLS if pool.family is not Family.DETECTOR_GOOD)
    with pytest.raises(PoolLimitError, match=message):
        validate_pools((*others, broken))


def test_large_cards_at_the_container_cap_break_the_spend_cap() -> None:
    wide = tuple(
        replace(pool, gpu=Gpu.A10G, max_containers=MAX_CONTAINERS_PER_POOL) for pool in POOLS
    )
    with pytest.raises(PoolLimitError, match="hourly spend cap"):
        validate_pools(wide)


def test_a_family_cannot_have_two_pools() -> None:
    with pytest.raises(PoolLimitError, match="one pool"):
        validate_pools((*POOLS, POOLS[0]))


def test_cpu_stand_in_keeps_the_family_and_drops_the_gpu() -> None:
    stand_in = cpu_stand_in(pool_for(Family.DETECTOR_GOOD), max_containers=3)
    options = function_options(stand_in)
    assert options["gpu"] is None
    assert options["max_containers"] == 3
    assert options["name"] == "detector_good"
    validate_pools((stand_in,))
