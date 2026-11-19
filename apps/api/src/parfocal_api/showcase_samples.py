from collections.abc import Sequence
from dataclasses import dataclass

from parfocal_api.sample_files import SampleFile, stored_facts
from parfocal_common.ingest import fixture_folder
from parfocal_common.object_store import ObjectStore

SMALL_FIXTURE_COUNT = 4


@dataclass(frozen=True)
class PoolSlide:
    file: str
    stored: SampleFile | None


class SamplePool:
    def __init__(self, slides: Sequence[PoolSlide]) -> None:
        self.slides = list(slides)
        self.taken = 0

    def next(self) -> PoolSlide:
        found = self.slides[self.taken % len(self.slides)]
        self.taken += 1
        return found


def size_of(slide: PoolSlide) -> int:
    return slide.stored.file_bytes if slide.stored is not None else 0


async def sample_pool(store: ObjectStore, files_with_results: Sequence[str]) -> SamplePool:
    found = [
        PoolSlide(name, await stored_facts(store, fixture_folder(name)))
        for name in files_with_results
    ]
    stored = sorted((slide for slide in found if slide.stored is not None), key=size_of)
    return SamplePool(stored[:SMALL_FIXTURE_COUNT] or found[:SMALL_FIXTURE_COUNT])
