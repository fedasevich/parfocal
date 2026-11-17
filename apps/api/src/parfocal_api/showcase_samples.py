from collections.abc import Sequence

from parfocal_api.sample_files import SampleFile, stored_facts, stored_sample_file
from parfocal_api.sample_project import SAMPLE_SLIDES
from parfocal_common.ingest import fixture_folder
from parfocal_common.object_store import ObjectStore

SMALL_FIXTURE_COUNT = 4


class SamplePool:
    def __init__(self, files: Sequence[SampleFile]) -> None:
        self.files = list(files)
        self.taken = 0

    def next(self) -> SampleFile | None:
        if not self.files:
            return None
        found = self.files[self.taken % len(self.files)]
        self.taken += 1
        return found


async def sample_pool(store: ObjectStore, gallery_files: Sequence[str]) -> SamplePool:
    samples = [await stored_sample_file(store, label) for label in SAMPLE_SLIDES]
    published = [found for found in samples if found is not None]
    if published:
        return SamplePool(published)
    fixtures = [await stored_facts(store, fixture_folder(name)) for name in gallery_files]
    stored = sorted((found for found in fixtures if found is not None), key=lambda f: f.file_bytes)
    return SamplePool(stored[:SMALL_FIXTURE_COUNT])
