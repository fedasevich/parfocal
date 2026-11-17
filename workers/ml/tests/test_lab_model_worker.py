import uuid
from typing import Any

import numpy as np
import pytest

from parfocal_common.jobs import StepFailedError
from parfocal_common.model_runs import run_prefix
from parfocal_ml.lab_model_worker import ScaledReader, stored_slide_of
from parfocal_ml.tumor_map_job import SlideImage
from parfocal_ml.whole_slide import Window


class LevelZero:
    def __init__(self) -> None:
        self.reads: list[tuple[int, int, int, int]] = []

    def read(self, x: int, y: int, width: int, height: int) -> np.ndarray:
        self.reads.append((x, y, width, height))
        return np.full((height, width, 3), 90, dtype=np.uint8)


class Slides:
    def __init__(self, mpp: float | None) -> None:
        self.mpp = mpp
        self.source = LevelZero()

    async def open(self, tenant_id: uuid.UUID, slide_id: uuid.UUID) -> SlideImage:
        thumbnail = np.zeros((1, 1, 3), dtype=np.uint8)
        return SlideImage(self.source, thumbnail, 1.0, 2000, 1000, self.mpp)


class Step:
    def __init__(self, slide_id: uuid.UUID) -> None:
        self.job_id = uuid.uuid4()
        self.tenant_id = uuid.uuid4()
        self.input = {"slide_id": str(slide_id)}


async def test_a_window_is_read_at_level_zero_and_scaled_to_the_tile() -> None:
    source = LevelZero()
    reader = ScaledReader(source, 0.25)
    rgb = await reader.read(Window(100, 50, 1024, 512), 512, 256)
    assert source.reads == [(100, 50, 1024, 512)]
    assert rgb.shape == (256, 512, 3)
    assert rgb.dtype == np.uint8
    same = await reader.read(Window(0, 0, 64, 32), 64, 32)
    assert same.shape == (32, 64, 3)


async def test_a_stored_slide_opens_with_its_scale_bounds_and_run_prefix() -> None:
    slide_id = uuid.uuid4()
    step: Any = Step(slide_id)
    slide = await stored_slide_of(Slides(0.5))(step)
    assert slide.bounds == Window(0, 0, 2000, 1000)
    assert slide.reader.mpp == 0.5
    assert slide.prefix == run_prefix(step.tenant_id, slide_id, step.job_id)


async def test_a_slide_without_a_scale_fails_the_stage() -> None:
    step: Any = Step(uuid.uuid4())
    with pytest.raises(StepFailedError) as failed:
        await stored_slide_of(Slides(None))(step)
    assert failed.value.code == "lab-model-no-scale"
