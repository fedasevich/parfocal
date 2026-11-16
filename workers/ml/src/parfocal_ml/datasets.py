import csv
import hashlib
import io
import os
import re
import shutil
import urllib.request
import zipfile
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import cast
from xml.etree import ElementTree

import numpy as np
from numpy.typing import NDArray
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.io import loadmat

CHUNK = 1 << 20


class Role(StrEnum):
    REFERENCE = "reference"
    HELD_OUT = "held-out"
    NATIVE_20X = "native-20x"
    TUMOR_MAP = "tumor-map"


@dataclass(frozen=True)
class Archive:
    file: str
    url: str
    md5: str
    size: int


@dataclass(frozen=True)
class Sample:
    name: str
    rgb: NDArray[np.uint8]
    labels: NDArray[np.int32]
    ignore: NDArray[np.bool_] | None
    group: str | None
    classes: dict[int, str] | None = None


type Loader = Callable[[Path], Iterator[Sample]]


@dataclass(frozen=True)
class Dataset:
    name: str
    role: Role
    licence: str
    source: str
    citation: str
    mpp: float | None
    archive: Archive | None = None
    loader: Loader | None = None
    manual: str | None = None


class ChecksumError(ValueError):
    pass


class ManualDownloadError(RuntimeError):
    pass


def cache_dir() -> Path:
    configured = os.environ.get("PARFOCAL_DATASETS_DIR")
    if configured:
        return Path(configured)
    base = Path(os.environ.get("XDG_CACHE_HOME", Path.home() / ".cache"))
    return base / "parfocal" / "datasets"


def md5_of(path: Path) -> str:
    digest = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as handle:
        while chunk := handle.read(CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def verify(path: Path, archive: Archive) -> None:
    if path.stat().st_size != archive.size:
        raise ChecksumError(f"{path.name} has {path.stat().st_size} bytes, not {archive.size}")
    found = md5_of(path)
    if found != archive.md5:
        raise ChecksumError(f"{path.name} has MD5 {found}, not {archive.md5}")


def unpinned(dataset: Dataset, folder: Path) -> ManualDownloadError:
    if dataset.manual is None:
        return ManualDownloadError(f"{dataset.name} has no public download: see {dataset.source}")
    placed = folder / dataset.name / dataset.manual
    if not placed.exists():
        return ManualDownloadError(
            f"{dataset.name} needs a sign-in: download it from {dataset.source} to {placed}"
        )
    return ManualDownloadError(
        f"{placed.name} has {placed.stat().st_size} bytes and MD5 {md5_of(placed)}: "
        f"pin them in the registry before {dataset.name} loads"
    )


def fetch(dataset: Dataset, folder: Path | None = None) -> Path:
    if dataset.archive is None:
        raise unpinned(dataset, folder or cache_dir())
    target = (folder or cache_dir()) / dataset.name / dataset.archive.file
    if not target.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(target.suffix + ".part")
        with urllib.request.urlopen(dataset.archive.url) as response, partial.open("wb") as out:
            shutil.copyfileobj(response, out, CHUNK)
        verify(partial, dataset.archive)
        partial.rename(target)
    verify(target, dataset.archive)
    return target


def png(archive: zipfile.ZipFile, name: str) -> Image.Image:
    return Image.open(io.BytesIO(archive.read(name)))


def tnbc(path: Path) -> Iterator[Sample]:
    with zipfile.ZipFile(path) as archive:
        truths = sorted(
            name
            for name in archive.namelist()
            if re.search(r"/GT_\d+/[^/]+\.png$", name) and "__MACOSX" not in name
        )
        for truth in truths:
            folder, file = truth.rsplit("/", 1)
            slide = folder.rsplit("/", 1)[-1].replace("GT_", "")
            image = f"{folder.rsplit('/', 1)[0]}/Slide_{slide}/{file}"
            labels, _ = cast(
                "tuple[NDArray[np.int32], int]",
                ndimage.label(np.asarray(png(archive, truth)) > 0),
            )
            yield Sample(
                name=file.removesuffix(".png"),
                rgb=np.asarray(png(archive, image).convert("RGB")),
                labels=labels.astype(np.int32),
                ignore=None,
                group=f"slide {slide}",
            )


def nuinsseg(path: Path) -> Iterator[Sample]:
    with zipfile.ZipFile(path) as archive:
        names = set(archive.namelist())
        images = sorted(
            name for name in names if re.fullmatch(r"[^/]+/tissue images/[^/]+\.png", name)
        )
        for image in images:
            organ = image.split("/", 1)[0]
            stem = image.rsplit("/", 1)[-1].removesuffix(".png")
            vague = f"{organ}/vague areas/mask binary/{stem}.png"
            labels = np.asarray(png(archive, f"{organ}/label masks modify/{stem}.tif"))
            yield Sample(
                name=f"{organ.replace(' ', '_')}__{stem}",
                rgb=np.asarray(png(archive, image).convert("RGB")),
                labels=labels.astype(np.int32),
                ignore=np.asarray(png(archive, vague).convert("L")) > 0 if vague in names else None,
                group=organ,
            )


PANNUKE_CLASSES = ("neoplastic", "inflammatory", "connective", "dead", "epithelial")
LIZARD_CLASSES = {
    1: "neutrophil",
    2: "epithelial",
    3: "lymphocyte",
    4: "plasma",
    5: "eosinophil",
    6: "connective",
}


def member(archive: zipfile.ZipFile, pattern: str) -> list[str]:
    return sorted(
        name for name in archive.namelist() if "__MACOSX" not in name and re.search(pattern, name)
    )


def npy_rows(archive: zipfile.ZipFile, name: str) -> Iterator[NDArray[np.generic]]:
    with archive.open(name) as handle:
        version = np.lib.format.read_magic(handle)
        read_header = (
            np.lib.format.read_array_header_1_0
            if version == (1, 0)
            else np.lib.format.read_array_header_2_0
        )
        shape, fortran, dtype = read_header(handle)
        if fortran:
            raise ValueError(f"{name} is stored in Fortran order")
        row = int(np.prod(shape[1:])) * dtype.itemsize
        for _ in range(shape[0]):
            yield np.frombuffer(handle.read(row), dtype).reshape(shape[1:])


def pannuke_instances(mask: NDArray[np.generic]) -> tuple[NDArray[np.int32], dict[int, str]]:
    labels = np.zeros(mask.shape[:2], np.int32)
    classes: dict[int, str] = {}
    for channel, kind in enumerate(PANNUKE_CLASSES):
        ids = mask[..., channel].astype(np.int64)
        for instance in np.unique(ids[ids > 0]).tolist():
            number = len(classes) + 1
            labels[ids == instance] = number
            classes[number] = kind
    present = set(np.unique(labels[labels > 0]).tolist())
    return labels, {number: kind for number, kind in classes.items() if number in present}


def pannuke(path: Path) -> Iterator[Sample]:
    with zipfile.ZipFile(path) as archive:
        (images,) = member(archive, r"/images\.npy$")
        (masks,) = member(archive, r"/masks\.npy$")
        (types,) = member(archive, r"/types\.npy$")
        fold = images.rsplit("/", 2)[-2]
        tissues = np.load(io.BytesIO(archive.read(types)))
        rows = zip(npy_rows(archive, images), npy_rows(archive, masks), tissues, strict=True)
        for index, (image, mask, tissue) in enumerate(rows):
            labels, classes = pannuke_instances(mask)
            yield Sample(
                name=f"{fold}_{index:04d}",
                rgb=image.astype(np.uint8),
                labels=labels,
                ignore=None,
                group=str(tissue),
                classes=classes,
            )


def monuseg_labels(xml: bytes, size: tuple[int, int]) -> NDArray[np.int32]:
    canvas = Image.new("I", size, 0)
    draw = ImageDraw.Draw(canvas)
    number = 0
    for region in ElementTree.fromstring(xml).iter("Region"):
        points = [
            (float(vertex.attrib["X"]), float(vertex.attrib["Y"]))
            for vertex in region.iter("Vertex")
        ]
        if len(points) >= 3:
            number += 1
            draw.polygon(points, fill=number)
    labels = np.asarray(canvas, np.int32)
    kept = np.unique(labels[labels > 0])
    relabelled = np.zeros(int(labels.max()) + 1, np.int32)
    relabelled[kept] = np.arange(1, len(kept) + 1, dtype=np.int32)
    return relabelled[labels]


def monuseg(path: Path) -> Iterator[Sample]:
    with zipfile.ZipFile(path) as archive:
        for xml in member(archive, r"[^/]+\.xml$"):
            stem = xml.rsplit("/", 1)[-1].removesuffix(".xml")
            (image,) = member(archive, rf"(^|/){re.escape(stem)}\.tif$")
            rgb = np.asarray(png(archive, image).convert("RGB"))
            yield Sample(
                name=stem,
                rgb=rgb,
                labels=monuseg_labels(archive.read(xml), (rgb.shape[1], rgb.shape[0])),
                ignore=None,
                group=None,
            )


def cryonuseg(path: Path) -> Iterator[Sample]:
    with zipfile.ZipFile(path) as archive:
        for truth in member(
            archive, r"(^|/)Annotator 1 \(biologist\)/label masks modify/[^/]+\.tif$"
        ):
            stem = truth.rsplit("/", 1)[-1].removesuffix(".tif")
            (image,) = member(archive, rf"(^|/)tissue images/{re.escape(stem)}\.tif$")
            organ = re.sub(r"^Human_|_\d+$", "", stem)
            yield Sample(
                name=stem,
                rgb=np.asarray(png(archive, image).convert("RGB")),
                labels=np.asarray(png(archive, truth)).astype(np.int32),
                ignore=None,
                group=organ,
            )


def lizard(path: Path) -> Iterator[Sample]:
    with zipfile.ZipFile(path) as archive:
        sources: dict[str, str] = {}
        for info in member(archive, r"(^|/)Lizard_Labels/info\.csv$")[:1]:
            rows = csv.DictReader(io.StringIO(archive.read(info).decode()))
            sources = {row["Filename"]: row["Source"] for row in rows}
        for truth in member(archive, r"(^|/)Lizard_Labels/Labels/[^/]+\.mat$"):
            stem = truth.rsplit("/", 1)[-1].removesuffix(".mat")
            (image,) = member(archive, rf"(^|/)Lizard_Images[12]/{re.escape(stem)}\.png$")
            mat = loadmat(io.BytesIO(archive.read(truth)))
            ids = np.asarray(mat["id"]).ravel().tolist()
            kinds = np.asarray(mat["class"]).ravel().tolist()
            yield Sample(
                name=stem,
                rgb=np.asarray(png(archive, image).convert("RGB")),
                labels=np.asarray(mat["inst_map"]).astype(np.int32),
                ignore=None,
                group=sources.get(stem),
                classes={
                    int(number): LIZARD_CLASSES[int(kind)]
                    for number, kind in zip(ids, kinds, strict=True)
                },
            )


REGISTRY: dict[str, Dataset] = {
    dataset.name: dataset
    for dataset in (
        Dataset(
            name="tnbc",
            role=Role.HELD_OUT,
            licence="CC BY 4.0",
            source="https://zenodo.org/records/2579118",
            citation="Naylor et al., Segmentation of nuclei in histopathology images by deep "
            "regression of the distance map, IEEE TMI 2019",
            mpp=0.25,
            archive=Archive(
                file="TNBC_NucleiSegmentation.zip",
                url="https://zenodo.org/api/records/2579118/files/TNBC_NucleiSegmentation.zip/content",
                md5="1605712a752b201b57eacc8f866adb4f",
                size=25232361,
            ),
            loader=tnbc,
        ),
        Dataset(
            name="nuinsseg",
            role=Role.HELD_OUT,
            licence="CC BY 4.0",
            source="https://zenodo.org/records/10518968",
            citation="Mahbod et al., NuInsSeg: a fully annotated dataset for nuclei instance "
            "segmentation in H&E-stained histological images, Scientific Data 2024",
            mpp=0.25,
            archive=Archive(
                file="NuInsSeg.zip",
                url="https://zenodo.org/api/records/10518968/files/NuInsSeg.zip/content",
                md5="08f9a33e23e983d82ee93aa58e69d095",
                size=1627427342,
            ),
            loader=nuinsseg,
        ),
        Dataset(
            name="cryonuseg",
            role=Role.HELD_OUT,
            licence="MIT according to the Kaggle dataset's metadata",
            source="https://www.kaggle.com/datasets/ipateam/segmentation-of-nuclei-in-cryosectioned-he-images",
            citation="Mahbod et al., CryoNuSeg, Computers in Biology and Medicine 2021",
            mpp=0.25,
            loader=cryonuseg,
            manual="segmentation-of-nuclei-in-cryosectioned-he-images.zip",
        ),
        *(
            Dataset(
                name=f"monuseg-{split}",
                role=Role.REFERENCE,
                licence="CC BY-NC-SA 4.0",
                source="https://monuseg.grand-challenge.org/Data/",
                citation="Kumar et al., IEEE TMI 2017 and 2020",
                mpp=0.25,
                archive=archive,
                loader=monuseg,
            )
            for split, archive in (
                (
                    "train",
                    Archive(
                        file="MoNuSeg 2018 Training Data.zip",
                        url="https://drive.usercontent.google.com/download?id=1ZgqFJomqQGNnsx7w7QBzQQMVA16lbVCA&export=download&confirm=t",
                        md5="dfe849bcb72daec2a78ae5ba0ad10ade",
                        size=125778974,
                    ),
                ),
                (
                    "test",
                    Archive(
                        file="MoNuSegTestData.zip",
                        url="https://drive.usercontent.google.com/download?id=1NKkSQ5T0ZNQ8aUhh0a8Dt2YKYCQXIViw&export=download&confirm=t",
                        md5="0721da0cdbd267299e0463419d70e1a5",
                        size=41620178,
                    ),
                ),
            )
        ),
        *(
            Dataset(
                name=f"pannuke-fold{fold}",
                role=Role.REFERENCE,
                licence="CC BY-NC-SA 4.0",
                source="https://warwick.ac.uk/fac/cross_fac/tia/data/pannuke",
                citation="Gamper et al., PanNuke, ECDP 2019 and arXiv 2003.10778",
                mpp=0.25,
                archive=Archive(
                    file=f"fold_{fold}.zip",
                    url=f"https://warwick.ac.uk/fac/cross_fac/tia/data/pannuke/fold_{fold}.zip",
                    md5=md5,
                    size=size,
                ),
                loader=pannuke,
            )
            for fold, md5, size in (
                (1, "e1b16ef84db3e3368d9f5bd4e61ed65c", 700275281),
                (2, "f1839d332c4b8e12c7c01882020ac457", 658842552),
                (3, "441950a966ee73d6e9780196815a0b20", 717969882),
            )
        ),
        Dataset(
            name="lizard",
            role=Role.NATIVE_20X,
            licence="CC BY-NC-SA 4.0 per the Kaggle mirror (TODO: confirm on the Warwick page)",
            source="https://www.kaggle.com/datasets/aadimator/lizard-dataset",
            citation="Graham et al., Lizard, ICCV Workshops 2021",
            mpp=0.5,
            loader=lizard,
            manual="lizard-dataset.zip",
        ),
        Dataset(
            name="camelyon16",
            role=Role.TUMOR_MAP,
            licence="CC0",
            source="https://registry.opendata.aws/camelyon/",
            citation="Ehteshami Bejnordi et al., JAMA 2017",
            mpp=None,
        ),
    )
}


def samples(name: str, folder: Path | None = None) -> Iterator[Sample]:
    dataset = REGISTRY[name]
    if dataset.loader is None:
        raise ManualDownloadError(f"{name} has no loader yet: see {dataset.source}")
    return dataset.loader(fetch(dataset, folder))
