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

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy import ndimage

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


def fetch(dataset: Dataset, folder: Path | None = None) -> Path:
    if dataset.archive is None:
        raise ManualDownloadError(f"{dataset.name} has no public download: see {dataset.source}")
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
            licence="TODO: not stated where found",
            source="https://github.com/masih4/CryoNuSeg",
            citation="Mahbod et al., CryoNuSeg, Computers in Biology and Medicine 2021",
            mpp=0.25,
        ),
        Dataset(
            name="monuseg",
            role=Role.REFERENCE,
            licence="CC BY-NC-SA 4.0",
            source="https://monuseg.grand-challenge.org/Data/",
            citation="Kumar et al., IEEE TMI 2017 and 2020",
            mpp=0.25,
        ),
        Dataset(
            name="pannuke",
            role=Role.REFERENCE,
            licence="CC BY-NC-SA 4.0",
            source="https://warwick.ac.uk/fac/cross_fac/tia/data/pannuke",
            citation="Gamper et al., PanNuke, ECDP 2019 and arXiv 2003.10778",
            mpp=0.25,
        ),
        Dataset(
            name="lizard",
            role=Role.NATIVE_20X,
            licence="CC BY-NC-SA 4.0 (TODO: confirm on the Warwick page)",
            source="https://conic-challenge.grand-challenge.org/Data/",
            citation="Graham et al., Lizard, ICCV Workshops 2021",
            mpp=0.5,
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
