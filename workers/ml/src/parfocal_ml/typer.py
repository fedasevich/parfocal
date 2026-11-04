from collections.abc import Callable, Sequence
from dataclasses import dataclass
from typing import Literal

import numpy as np
from numpy.typing import NDArray
from skimage.transform import resize

from parfocal_ml.type_evaluation import VIEWER_CLASSES

TYPER_MPP = 0.25
PANNUKE_TYPES = ("neoplastic", "inflammatory", "connective", "dead", "epithelial")
CLASS_CHANNELS = 1 + len(PANNUKE_TYPES)
CLOSE_MARGIN = 0.10
PROBABILITY_FLOOR = 1e-7
EPITHELIAL_TUMOR_TISSUES = frozenset({"uterus", "cervix", "prostate", "esophagus"})

type TissueDefault = Literal["other", "tumor"]
type ClassMap = NDArray[np.float32]
type Model = Callable[[NDArray[np.uint8]], ClassMap]


@dataclass(frozen=True)
class Outline:
    mask: NDArray[np.bool_]
    x: int
    y: int


@dataclass(frozen=True)
class TypedNucleus:
    probabilities: dict[str, float]
    type: str
    alternatives: list[str]
    foreground: float


def tissue_default_for(tissue: str | None) -> TissueDefault:
    if tissue is not None and tissue.strip().lower() in EPITHELIAL_TUMOR_TISSUES:
        return "tumor"
    return "other"


def pannuke_to_viewer(tissue_default: TissueDefault = "other") -> tuple[int, ...]:
    tumor, stroma, immune, other = range(len(VIEWER_CLASSES))
    epithelial = tumor if tissue_default == "tumor" else other
    return (tumor, immune, stroma, other, epithelial)


def to_viewer(
    pannuke: NDArray[np.floating], tissue_default: TissueDefault = "other"
) -> NDArray[np.float64]:
    pannuke = np.asarray(pannuke, np.float64)
    out = np.zeros((*pannuke.shape[:-1], len(VIEWER_CLASSES)), np.float64)
    for source, target in enumerate(pannuke_to_viewer(tissue_default)):
        out[..., target] += pannuke[..., source]
    return out


def average_inside(
    class_map: ClassMap, outline: Outline
) -> tuple[NDArray[np.float64], float] | None:
    _, height, width = class_map.shape
    rows, cols = outline.mask.shape
    top, left = max(0, outline.y), max(0, outline.x)
    bottom, right = min(height, outline.y + rows), min(width, outline.x + cols)
    if bottom <= top or right <= left:
        return None
    inside = outline.mask[
        top - outline.y : bottom - outline.y, left - outline.x : right - outline.x
    ]
    if not inside.any():
        return None
    pixels = class_map[:, top:bottom, left:right][:, inside].astype(np.float64)
    foreground = float(1.0 - pixels[0].mean())
    mass = pixels[1:].mean(axis=1)
    return mass / max(float(mass.sum()), PROBABILITY_FLOOR), foreground


def alternatives_of(probabilities: NDArray[np.floating]) -> list[str]:
    order = np.argsort(-np.asarray(probabilities), kind="stable")
    top = float(probabilities[order[0]])
    return [
        VIEWER_CLASSES[index]
        for index in order[1:]
        if top - float(probabilities[index]) < CLOSE_MARGIN
    ]


def typed(viewer: NDArray[np.floating], foreground: float) -> TypedNucleus:
    viewer = np.asarray(viewer, np.float64)
    return TypedNucleus(
        probabilities={name: float(viewer[index]) for index, name in enumerate(VIEWER_CLASSES)},
        type=VIEWER_CLASSES[int(np.argmax(viewer))],
        alternatives=alternatives_of(viewer),
        foreground=foreground,
    )


def class_map_at(rgb: NDArray[np.uint8], mpp: float, model: Model) -> ClassMap:
    height, width = rgb.shape[:2]
    scale = mpp / TYPER_MPP
    if np.isclose(scale, 1.0):
        class_map = model(rgb)
    else:
        size = (max(1, round(height * scale)), max(1, round(width * scale)))
        scaled = resize(rgb, size, order=1, preserve_range=True, anti_aliasing=scale < 1)
        class_map = model(np.asarray(scaled).astype(np.uint8))
    if class_map.shape[0] != CLASS_CHANNELS:
        raise ValueError(f"expected {CLASS_CHANNELS} class channels, got {class_map.shape[0]}")
    if class_map.shape[1:] != (height, width):
        class_map = resize(class_map, (CLASS_CHANNELS, height, width), order=1, preserve_range=True)
    return np.asarray(class_map, np.float32)


def type_nuclei(
    rgb: NDArray[np.uint8],
    outlines: Sequence[Outline],
    model: Model,
    mpp: float = TYPER_MPP,
    tissue_default: TissueDefault = "other",
) -> list[TypedNucleus]:
    if not outlines:
        return []
    class_map = class_map_at(rgb, mpp, model)
    nuclei = []
    for outline in outlines:
        averaged = average_inside(class_map, outline)
        if averaged is None:
            nuclei.append(typed(np.full(len(VIEWER_CLASSES), 1.0 / len(VIEWER_CLASSES)), 0.0))
            continue
        pannuke, foreground = averaged
        nuclei.append(typed(to_viewer(pannuke, tissue_default), foreground))
    return nuclei
