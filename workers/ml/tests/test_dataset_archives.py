import io
import zipfile
from collections import Counter
from pathlib import Path

import numpy as np
import pytest
from numpy.typing import NDArray
from PIL import Image
from scipy.io import savemat

from parfocal_ml.datasets import (
    REGISTRY,
    ManualDownloadError,
    cache_dir,
    fetch,
    md5_of,
    samples,
)


def cached(name: str) -> bool:
    archive = REGISTRY[name].archive
    return archive is not None and (cache_dir() / name / archive.file).exists()


def encoded(array: NDArray[np.generic], kind: str) -> bytes:
    buffer = io.BytesIO()
    Image.fromarray(array).save(buffer, format=kind)
    return buffer.getvalue()


def npy(array: NDArray[np.generic]) -> bytes:
    buffer = io.BytesIO()
    np.save(buffer, array)
    return buffer.getvalue()


def tissue(seed: int, size: int) -> NDArray[np.uint8]:
    return np.random.default_rng(seed).integers(0, 255, (size, size, 3), dtype=np.uint8)


def load(name: str, path: Path) -> list:
    loader = REGISTRY[name].loader
    assert loader is not None
    return list(loader(path))


def test_every_split_of_a_signed_in_dataset_has_a_loader_and_says_how_it_arrives() -> None:
    for name in ("cryonuseg", "monuseg-train", "monuseg-test", "lizard"):
        assert REGISTRY[name].loader is not None
    for fold in (1, 2, 3):
        archive = REGISTRY[f"pannuke-fold{fold}"].archive
        assert archive is not None
        assert archive.url.endswith(f"/pannuke/fold_{fold}.zip")
    assert REGISTRY["cryonuseg"].manual
    assert REGISTRY["lizard"].manual
    assert REGISTRY["cryonuseg"].archive is None
    assert REGISTRY["lizard"].archive is None


def test_a_signed_in_archive_says_where_it_goes_and_then_which_checksum_to_pin(
    tmp_path: Path,
) -> None:
    dataset = REGISTRY["lizard"]
    with pytest.raises(ManualDownloadError, match="needs a sign-in"):
        fetch(dataset, tmp_path)
    placed = tmp_path / "lizard" / "lizard-dataset.zip"
    placed.parent.mkdir()
    placed.write_bytes(b"parfocal")
    with pytest.raises(ManualDownloadError, match=md5_of(placed)):
        fetch(dataset, tmp_path)


def test_pannuke_merges_the_class_channels_into_typed_instances(tmp_path: Path) -> None:
    masks = np.zeros((2, 8, 8, 6), np.float64)
    masks[0, 0:2, 0:2, 0] = 7
    masks[0, 4:6, 4:6, 0] = 9
    masks[0, 0:2, 5:7, 2] = 3
    masks[1, 3:5, 3:5, 1] = 12
    masks[..., 5] = (masks[..., :5].sum(-1) == 0).astype(np.float64)
    images = np.stack([tissue(0, 8), tissue(1, 8)]).astype(np.float64)
    path = tmp_path / "fold_9.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("Fold 9/images/fold9/images.npy", npy(images))
        archive.writestr("Fold 9/images/fold9/types.npy", npy(np.array(["Breast", "Colon"])))
        archive.writestr("Fold 9/masks/fold9/masks.npy", npy(masks))
    first, second = load("pannuke-fold1", path)
    assert (first.name, first.group, int(first.labels.max())) == ("fold9_0000", "Breast", 3)
    assert first.classes == {1: "neoplastic", 2: "neoplastic", 3: "connective"}
    assert np.array_equal(first.rgb, images[0].astype(np.uint8))
    assert (second.group, second.classes, int((second.labels == 1).sum())) == (
        "Colon",
        {1: "inflammatory"},
        4,
    )


def test_monuseg_draws_each_annotated_region_as_one_nucleus(tmp_path: Path) -> None:
    regions = "".join(
        f'<Region Id="{index}"><Vertices>'
        + "".join(f'<Vertex X="{x}" Y="{y}"/>' for x, y in corners)
        + "</Vertices></Region>"
        for index, corners in enumerate(
            (
                ((1, 1), (5, 1), (5, 5), (1, 5)),
                ((10, 10), (14, 10), (14, 14)),
                ((20, 20), (21, 21)),
            )
        )
    )
    xml = f"<Annotations><Annotation><Regions>{regions}</Regions></Annotation></Annotations>"
    path = tmp_path / "MoNuSegTestData.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr(
            "MoNuSegTestData/TCGA-00-0000-01A-01-TS1.tif", encoded(tissue(2, 24), "TIFF")
        )
        archive.writestr("MoNuSegTestData/TCGA-00-0000-01A-01-TS1.xml", xml)
    (sample,) = load("monuseg-test", path)
    assert (sample.name, sample.rgb.shape, int(sample.labels.max())) == (
        "TCGA-00-0000-01A-01-TS1",
        (24, 24, 3),
        2,
    )
    assert int((sample.labels == 1).sum()) == 25
    assert sample.labels[12, 13] == 2


def test_cryonuseg_reads_the_first_annotators_label_masks_from_the_kaggle_layout(
    tmp_path: Path,
) -> None:
    labels = np.zeros((16, 16), np.uint16)
    labels[2:6, 2:6] = 1
    labels[9:12, 9:14] = 2
    other = np.zeros((16, 16), np.uint16)
    path = tmp_path / "segmentation-of-nuclei-in-cryosectioned-he-images.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("tissue images/Human_AdrenalGland_01.tif", encoded(tissue(3, 16), "TIFF"))
        archive.writestr(
            "Annotator 1 (biologist)/label masks modify/Human_AdrenalGland_01.tif",
            encoded(labels, "TIFF"),
        )
        archive.writestr(
            "Annotator 2 (bioinformatician)/Annotator 2 (bioinformatician)/label masks modify/"
            "Human_AdrenalGland_01.tif",
            encoded(other, "TIFF"),
        )
    (sample,) = load("cryonuseg", path)
    assert (sample.name, sample.group, sample.rgb.shape) == (
        "Human_AdrenalGland_01",
        "AdrenalGland",
        (16, 16, 3),
    )
    assert np.array_equal(sample.labels, labels.astype(np.int32))


def test_lizard_reads_instances_classes_and_sources_from_the_release_layout(
    tmp_path: Path,
) -> None:
    inst_map = np.zeros((12, 12), np.int32)
    inst_map[1:4, 1:4] = 1
    inst_map[6:9, 6:10] = 2
    mat = io.BytesIO()
    savemat(
        mat,
        {
            "inst_map": inst_map,
            "id": np.array([[1], [2]]),
            "class": np.array([[3], [6]]),
        },
    )
    path = tmp_path / "lizard-dataset.zip"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("lizard_images2/Lizard_Images2/glas_1.png", encoded(tissue(4, 12), "PNG"))
        archive.writestr("lizard_labels/Lizard_Labels/Labels/glas_1.mat", mat.getvalue())
        archive.writestr(
            "lizard_labels/Lizard_Labels/info.csv", "Filename,Source,Split\nglas_1,glas,1\n"
        )
    (sample,) = load("lizard", path)
    assert (sample.name, sample.group, sample.rgb.shape) == ("glas_1", "glas", (12, 12, 3))
    assert sample.classes == {1: "lymphocyte", 2: "connective"}
    assert np.array_equal(sample.labels, inst_map)


@pytest.mark.skipif(not cached("monuseg-test"), reason="MoNuSeg is not in the dataset cache")
def test_monuseg_test_set_has_the_fourteen_images_and_nuclei_the_poc_scored() -> None:
    loaded = list(samples("monuseg-test"))
    assert len(loaded) == 14
    assert {sample.rgb.shape for sample in loaded} == {(1000, 1000, 3)}
    assert sum(len(np.unique(sample.labels[sample.labels > 0])) for sample in loaded) == 6697


@pytest.mark.skipif(not cached("monuseg-train"), reason="MoNuSeg is not in the dataset cache")
def test_monuseg_training_set_loads_every_annotated_image() -> None:
    loaded = list(samples("monuseg-train"))
    assert len(loaded) == 37
    assert sum(len(np.unique(sample.labels[sample.labels > 0])) for sample in loaded) == 24131


@pytest.mark.skipif(
    not cached("pannuke-fold3"), reason="PanNuke fold 3 is not in the dataset cache"
)
def test_pannuke_fold_three_streams_every_patch_with_typed_nuclei() -> None:
    images = 0
    tissues: set[str] = set()
    kinds: Counter[str] = Counter()
    for sample in samples("pannuke-fold3"):
        images += 1
        tissues.add(str(sample.group))
        assert sample.classes is not None
        kinds.update(sample.classes.values())
    assert (images, len(tissues)) == (2722, 19)
    assert kinds == {
        "neoplastic": 28471,
        "inflammatory": 10825,
        "connective": 17441,
        "dead": 1057,
        "epithelial": 8860,
    }
