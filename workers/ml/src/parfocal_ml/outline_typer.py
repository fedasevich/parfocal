import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

import numpy as np
from skimage.draw import polygon

from parfocal_common.outline_types import Points, outline_types_call_of
from parfocal_ml.tumor_map_job import SlideImage, SlideOpener
from parfocal_ml.type_evaluation import VIEWER_CLASSES
from parfocal_ml.typer import Model, Outline, TypedNucleus, type_nuclei, typed

WINDOW = 1024
MARGIN = 16


class SlideWithoutScaleError(ValueError):
    pass


@dataclass(frozen=True)
class Box:
    left: int
    top: int
    right: int
    bottom: int

    @property
    def empty(self) -> bool:
        return self.right <= self.left or self.bottom <= self.top


def box_of(points: Points) -> Box:
    xs, ys = points[0::2], points[1::2]
    return Box(
        math.floor(min(xs)), math.floor(min(ys)), math.floor(max(xs)) + 1, math.floor(max(ys)) + 1
    )


def window_of(boxes: Sequence[Box], slide: SlideImage) -> Box:
    return Box(
        max(0, min(box.left for box in boxes) - MARGIN),
        max(0, min(box.top for box in boxes) - MARGIN),
        min(slide.width, max(box.right for box in boxes) + MARGIN),
        min(slide.height, max(box.bottom for box in boxes) + MARGIN),
    )


def grouped(outlines: Sequence[Points]) -> list[list[int]]:
    groups: dict[tuple[int, int], list[int]] = {}
    for index, points in enumerate(outlines):
        box = box_of(points)
        groups.setdefault((box.left // WINDOW, box.top // WINDOW), []).append(index)
    return list(groups.values())


def outline_in(points: Points, window: Box) -> Outline:
    box = box_of(points)
    mask = np.zeros((box.bottom - box.top, box.right - box.left), bool)
    rows = np.asarray(points[1::2], np.float64) - box.top
    cols = np.asarray(points[0::2], np.float64) - box.left
    mask[polygon(rows, cols, mask.shape)] = True
    return Outline(mask, box.left - window.left, box.top - window.top)


def unknown() -> TypedNucleus:
    return typed(np.full(len(VIEWER_CLASSES), 1.0 / len(VIEWER_CLASSES)), 0.0)


def answered(nucleus: TypedNucleus) -> dict[str, object]:
    return {
        "probabilities": nucleus.probabilities,
        "type": nucleus.type,
        "alternatives": nucleus.alternatives,
        "foreground": min(1.0, max(0.0, nucleus.foreground)),
    }


def typed_in_window(
    slide: SlideImage, outlines: Sequence[Points], model: Model, temperature: float
) -> list[TypedNucleus]:
    if slide.mpp is None:
        raise SlideWithoutScaleError("The typer needs the slide's microns per pixel")
    window = window_of([box_of(points) for points in outlines], slide)
    if window.empty:
        return [unknown() for _ in outlines]
    rgb = slide.reader.read(
        window.left, window.top, window.right - window.left, window.bottom - window.top
    )
    shapes = [outline_in(points, window) for points in outlines]
    return type_nuclei(rgb, shapes, model, slide.mpp, temperature=temperature)


async def answer_outline_types(
    call: Mapping[str, object], open_slide: SlideOpener, model: Model
) -> dict[str, object]:
    request = outline_types_call_of(call)
    slide = await open_slide(request.tenant_id, request.slide_id)
    nuclei: list[TypedNucleus | None] = [None] * len(request.outlines)
    for indices in grouped(request.outlines):
        chosen = [request.outlines[index] for index in indices]
        for index, nucleus in zip(
            indices, typed_in_window(slide, chosen, model, request.temperature), strict=True
        ):
            nuclei[index] = nucleus
    return {"outlines": [answered(nucleus or unknown()) for nucleus in nuclei]}
