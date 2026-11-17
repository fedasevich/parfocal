from parfocal_api.sample_files import SampleFile, stored_facts
from parfocal_api.showcase import FORMAT_GALLERY, fixture_facts, gallery_facts
from parfocal_common.ingest import fixture_folder, fixture_original_key
from parfocal_common.object_store import StorageError

PHILIPS = next(slide for slide in FORMAT_GALLERY if slide.file == "Philips-4.tiff")


def stored_philips(original_key: str) -> SampleFile:
    return SampleFile(
        original_key=original_key,
        file_bytes=290991342,
        sha256="a" * 64,
        format="philips-tiff",
        variant="bigtiff",
        reader="tifffile",
        width=100,
        height=50,
        level_count=3,
        mpp_x=0.25,
        mpp_y=0.25,
        objective_power=40.0,
        notices=[],
    )


class FactsStore:
    def __init__(self, objects: dict[str, bytes]) -> None:
        self.objects = objects

    async def get_object(self, key: str) -> bytes:
        if key not in self.objects:
            raise StorageError(404, "NoSuchKey")
        return self.objects[key]


def test_every_gallery_file_is_in_the_fixture_manifest() -> None:
    manifest = fixture_facts()
    assert all(slide.file in manifest for slide in FORMAT_GALLERY)
    assert "ome-tiff" in {slide.format for slide in FORMAT_GALLERY}


def test_a_stored_fixture_slide_seeds_its_own_copy_and_dimensions() -> None:
    facts = gallery_facts(PHILIPS, fixture_facts(), stored_philips(fixture_original_key("x.tiff")))
    assert facts["original_key"] == "fixture-slides/x-tiff/original.tiff"
    assert (facts["width"], facts["height"], facts["level_count"]) == (100, 50, 3)


def test_without_stored_facts_the_seed_still_names_the_shared_fixture() -> None:
    facts = gallery_facts(PHILIPS, fixture_facts())
    assert facts["original_key"] == "fixtures/Philips-4.tiff"


async def test_stored_facts_must_point_into_their_own_folder() -> None:
    folder = fixture_folder(PHILIPS.file)
    own = stored_philips(fixture_original_key(PHILIPS.file)).model_dump_json().encode()
    other = stored_philips("fixtures/Philips-4.tiff").model_dump_json().encode()
    found = await stored_facts(FactsStore({f"{folder}facts.json": own}), folder)  # type: ignore[arg-type]
    assert found is not None
    assert found.original_key.startswith(folder)
    assert await stored_facts(FactsStore({f"{folder}facts.json": other}), folder) is None  # type: ignore[arg-type]
    assert await stored_facts(FactsStore({}), folder) is None  # type: ignore[arg-type]
