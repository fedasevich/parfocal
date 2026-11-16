import pytest

from parfocal_common.residency import (
    ENFORCED,
    QUEUE_REGIONS,
    REGION_VARIABLE,
    RESIDENCY_VARIABLE,
    UNPINNED,
    Placement,
    Region,
    home_of,
    placement_from,
)


@pytest.mark.parametrize("name", ["eu", "eu-west", "eu-north", "eu-south"])
def test_modal_eu_regions_are_home_to_eu_tenants(name: str) -> None:
    assert home_of(name) is Region.EU


@pytest.mark.parametrize("name", ["us", "us-east", "us-central", "us-south", "us-west"])
def test_modal_us_regions_are_home_to_us_tenants(name: str) -> None:
    assert home_of(name) is Region.US


@pytest.mark.parametrize("name", ["uk", "ap", "jp", "eu-west-1", "europe-west4", "", None])
def test_any_other_region_is_home_to_no_tenant(name: str | None) -> None:
    assert home_of(name) is None


def test_no_modal_region_belongs_to_two_tenant_regions() -> None:
    assert not QUEUE_REGIONS[Region.EU] & QUEUE_REGIONS[Region.US]
    assert set(QUEUE_REGIONS) == set(Region)


def test_an_enforced_queue_runs_only_its_own_regions_tenants() -> None:
    queue = Placement(region="eu-north", enforced=True)
    assert queue.may_run(Region.EU)
    assert not queue.may_run(Region.US)
    assert queue.tenant_regions() == {Region.EU}


def test_an_enforced_queue_with_no_known_region_runs_nobody() -> None:
    queue = Placement(region=None, enforced=True)
    assert not queue.may_run(Region.EU)
    assert not queue.may_run(Region.US)
    assert queue.tenant_regions() == frozenset()


def test_an_unenforced_queue_runs_every_tenant() -> None:
    assert UNPINNED.may_run(Region.EU)
    assert Placement(region="us-east").may_run(Region.EU)


def test_the_worker_reads_its_placement_from_modal_and_the_switch() -> None:
    assert placement_from({}) == UNPINNED
    enforced = {REGION_VARIABLE: "eu-west", RESIDENCY_VARIABLE: ENFORCED}
    assert placement_from(enforced) == Placement(region="eu-west", enforced=True)
    switched_off = {REGION_VARIABLE: "us-east", RESIDENCY_VARIABLE: "off"}
    assert placement_from(switched_off) == Placement(region="us-east")
