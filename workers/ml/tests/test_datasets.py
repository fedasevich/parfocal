from pathlib import Path

import pytest

from parfocal_ml.datasets import (
    REGISTRY,
    Archive,
    ChecksumError,
    ManualDownloadError,
    Role,
    cache_dir,
    fetch,
    samples,
    verify,
)


def cached(name: str) -> bool:
    archive = REGISTRY[name].archive
    return archive is not None and (cache_dir() / name / archive.file).exists()


def test_every_dataset_names_its_role_licence_source_and_citation() -> None:
    assert {name: dataset.role for name, dataset in REGISTRY.items()} == {
        "tnbc": Role.HELD_OUT,
        "nuinsseg": Role.HELD_OUT,
        "cryonuseg": Role.HELD_OUT,
        "monuseg": Role.REFERENCE,
        "pannuke": Role.REFERENCE,
        "lizard": Role.NATIVE_20X,
        "camelyon16": Role.TUMOR_MAP,
    }
    for dataset in REGISTRY.values():
        assert dataset.licence
        assert dataset.source.startswith("https://")
        assert dataset.citation


def test_an_archive_with_the_wrong_size_or_checksum_is_refused(tmp_path: Path) -> None:
    path = tmp_path / "data.zip"
    path.write_bytes(b"parfocal")
    verify(path, Archive("data.zip", "https://example.test", "2054a7a175de4123711931772ca0b0ff", 8))
    with pytest.raises(ChecksumError, match="bytes"):
        verify(path, Archive("data.zip", "https://example.test", "0" * 32, 9))
    with pytest.raises(ChecksumError, match="MD5"):
        verify(path, Archive("data.zip", "https://example.test", "0" * 32, 8))


def test_a_dataset_without_a_public_download_says_where_to_get_it() -> None:
    with pytest.raises(ManualDownloadError, match="grand-challenge"):
        fetch(REGISTRY["monuseg"])
    with pytest.raises(ManualDownloadError):
        next(samples("lizard"))


@pytest.mark.skipif(not cached("tnbc"), reason="TNBC is not in the dataset cache")
def test_tnbc_loads_fifty_images_with_their_nuclei() -> None:
    loaded = list(samples("tnbc"))
    assert len(loaded) == 50
    first = loaded[0]
    assert (first.name, first.rgb.shape, int(first.labels.max()), first.group) == (
        "01_1",
        (512, 512, 3),
        69,
        "slide 01",
    )
    assert sum(int(sample.labels.max()) for sample in loaded) == 4053


@pytest.mark.skipif(not cached("nuinsseg"), reason="NuInsSeg is not in the dataset cache")
def test_nuinsseg_loads_every_organ_with_its_vague_areas() -> None:
    loaded = list(samples("nuinsseg"))
    assert len(loaded) == 665
    assert len({sample.group for sample in loaded}) == 31
    nuclei = sum(len(set(sample.labels[sample.labels > 0].tolist())) for sample in loaded)
    assert nuclei == 30698
    assert all(sample.ignore is not None for sample in loaded)
