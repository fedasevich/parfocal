import asyncio
import uuid
from collections.abc import Mapping
from contextlib import AsyncExitStack

import numpy as np
import pytest
from test_tumor_map import ArraySlide
from tumor_map_support import opener

from parfocal_common.outline_types import (
    MAX_OUTLINE_SPAN,
    OutlineTypesCall,
    OutlineTypesCallError,
    outline_types_call_of,
    typed_outlines_in,
)
from parfocal_common.view_maps import seconds_in
from parfocal_ml.gpu_pool import POOLS, Family
from parfocal_ml.modal_pool import default_runners, pool_entry
from parfocal_ml.outline_typer import WINDOW, SlideWithoutScaleError, answer_outline_types
from parfocal_ml.outline_typer_worker import OutlineTyperService
from parfocal_ml.priority_gate import Kind, WrongLaneError
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.typer import CLASS_CHANNELS, Model

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
SLIDE = uuid.UUID("00000000-0000-4000-8000-000000000002")
EMBEDDER = next(pool for pool in POOLS if pool.family is Family.EMBEDDER)
NEOPLASTIC, CONNECTIVE = 1, 3
WIDTH, HEIGHT = 2048, 1536


def small_slide(mpp: float | None = 0.25) -> tuple[SlideImage, ArraySlide]:
    red = np.full((HEIGHT, WIDTH), 255, np.uint8)
    red[100:140, 100:140] = 20
    red[1300:1340, 1700:1740] = 20
    source = ArraySlide(red)
    slide = SlideImage(
        reader=source,
        thumbnail=source.rgb[::16, ::16].copy(),
        downsample=16.0,
        width=WIDTH,
        height=HEIGHT,
        mpp=mpp,
    )
    return slide, source


def dark_is_neoplastic(rgb: np.ndarray) -> np.ndarray:
    dark = rgb[..., 0] < 128
    class_map = np.zeros((CLASS_CHANNELS, *dark.shape), np.float32)
    class_map[0] = 0.1
    class_map[NEOPLASTIC] = np.where(dark, 0.8, 0.1)
    class_map[CONNECTIVE] = np.where(dark, 0.1, 0.8)
    return class_map


def square(x: float, y: float, size: float = 20.0) -> tuple[float, ...]:
    return (x, y, x + size, y, x + size, y + size, x, y + size)


def call_for(*outlines: tuple[float, ...], temperature: float = 1.0) -> dict[str, object]:
    return OutlineTypesCall(TENANT, SLIDE, outlines, temperature).call()


def typed(slide: SlideImage, call: Mapping[str, object], model: Model = dark_is_neoplastic):
    return asyncio.run(answer_outline_types(call, opener(slide), model))


def test_each_outline_gets_the_type_under_it_in_the_order_sent() -> None:
    slide, source = small_slide()
    call = call_for(square(1710, 1310), square(500, 500), square(110, 110))
    reply = typed(slide, call)
    outlines = typed_outlines_in(reply, 3)
    assert outlines is not None
    assert [outline["type"] for outline in outlines] == ["tumor", "stroma", "tumor"]
    for outline in outlines:
        probabilities = outline["probabilities"]
        assert isinstance(probabilities, dict)
        assert sum(probabilities.values()) == pytest.approx(1.0)
        assert outline["foreground"] == pytest.approx(0.9)
    assert len(source.reads) == 2
    for _, _, width, height in source.reads:
        assert width <= WINDOW + MAX_OUTLINE_SPAN
        assert height <= WINDOW + MAX_OUTLINE_SPAN


def tumor_share(slide: SlideImage, temperature: float) -> tuple[float, float, str]:
    call = call_for(square(110, 110), temperature=temperature)
    outlines = typed_outlines_in(typed(slide, call), 1)
    assert outlines is not None
    probabilities = outlines[0]["probabilities"]
    assert isinstance(probabilities, dict)
    shares = {str(name): float(share) for name, share in probabilities.items()}
    return shares["tumor"], sum(shares.values()), str(outlines[0]["type"])


def test_the_temperature_softens_the_answer() -> None:
    slide, _ = small_slide()
    sharp, _, _ = tumor_share(slide, 1.0)
    soft, total, kind = tumor_share(slide, 3.0)
    assert soft < sharp
    assert kind == "tumor"
    assert total == pytest.approx(1.0)


def test_a_coarser_slide_is_scaled_to_the_typer_resolution() -> None:
    slide, _ = small_slide(mpp=0.5)
    seen: list[tuple[int, ...]] = []

    def model(rgb: np.ndarray) -> np.ndarray:
        seen.append(rgb.shape)
        return dark_is_neoplastic(rgb)

    reply = typed_outlines_in(typed(slide, call_for(square(110, 110)), model), 1)
    assert reply is not None
    assert reply[0]["type"] == "tumor"
    assert seen == [(2 * (20 + 1 + 32), 2 * (20 + 1 + 32), 3)]


def test_a_slide_without_a_scale_is_refused() -> None:
    slide, _ = small_slide(mpp=None)
    with pytest.raises(SlideWithoutScaleError):
        typed(slide, call_for(square(110, 110)))


def test_the_call_refuses_rings_that_are_not_small_nuclei() -> None:
    for outlines in ([], [[0, 0, 1, 1]], [[0, 0, 1, 1, 2]], [list(square(0, 0, 600))]):
        with pytest.raises(OutlineTypesCallError):
            outline_types_call_of({**call_for(square(0, 0)), "outlines": outlines})
    with pytest.raises(OutlineTypesCallError):
        outline_types_call_of({**call_for(square(0, 0)), "temperature": 0})
    assert typed_outlines_in({"outlines": []}, 1) is None


def test_the_service_sets_up_once_and_times_each_answer() -> None:
    slide, _ = small_slide()
    setups: list[int] = []

    async def setup(stack: AsyncExitStack):
        setups.append(1)
        return opener(slide), dark_is_neoplastic

    service = OutlineTyperService(setup)
    try:
        first = service.answer(call_for(square(110, 110)))
        service.answer(call_for(square(500, 500)))
    finally:
        service.close()
    assert setups == [1]
    assert typed_outlines_in(first, 1) is not None
    assert seconds_in(first) is not None


def test_only_the_interactive_pool_types_outlines() -> None:
    families = {pool.family for pool in POOLS if Kind.OUTLINE_TYPES in default_runners(pool)}
    assert families == {Family.EMBEDDER}
    calls: list[Mapping[str, object]] = []

    def runner(call: Mapping[str, object]) -> Mapping[str, object]:
        calls.append(call)
        return {"outlines": []}

    reply = pool_entry(EMBEDDER, {Kind.OUTLINE_TYPES: runner})(call_for(square(0, 0)))
    assert reply["kind"] == Kind.OUTLINE_TYPES
    assert calls[0]["kind"] == "outline-types"
    job_pool = next(pool for pool in POOLS if pool.family is not Family.EMBEDDER)
    with pytest.raises(WrongLaneError):
        pool_entry(job_pool)(call_for(square(0, 0)))
