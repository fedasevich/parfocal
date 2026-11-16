from collections.abc import Mapping
from dataclasses import dataclass
from enum import StrEnum


class Region(StrEnum):
    EU = "eu"
    US = "us"


QUEUE_REGIONS: dict[Region, frozenset[str]] = {
    Region.EU: frozenset({"eu", "eu-west", "eu-north", "eu-south"}),
    Region.US: frozenset({"us", "us-east", "us-central", "us-south", "us-west"}),
}

ENFORCED = "enforced"
RESIDENCY_VARIABLE = "PARFOCAL_RESIDENCY"
REGION_VARIABLE = "MODAL_REGION"


def home_of(queue_region: str | None) -> Region | None:
    for region, names in QUEUE_REGIONS.items():
        if queue_region in names:
            return region
    return None


@dataclass(frozen=True)
class Placement:
    region: str | None = None
    enforced: bool = False

    @property
    def home(self) -> Region | None:
        return home_of(self.region)

    def may_run(self, tenant_region: Region) -> bool:
        return not self.enforced or self.home is tenant_region

    def tenant_regions(self) -> frozenset[Region]:
        home = self.home
        return frozenset() if home is None else frozenset({home})


UNPINNED = Placement()


def placement_from(environment: Mapping[str, str]) -> Placement:
    return Placement(
        region=environment.get(REGION_VARIABLE) or None,
        enforced=environment.get(RESIDENCY_VARIABLE) == ENFORCED,
    )
