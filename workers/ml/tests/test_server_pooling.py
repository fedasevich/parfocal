import asyncio
import uuid
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest
from nuclei_support import ArrayReader, disks
from numpy.typing import NDArray

from parfocal_ml.reviewed_features import FeatureStore, ReviewedNucleus
from parfocal_ml.sam_contract import EMBED_SIZE
from parfocal_ml.server_pooling import (
    TYPER_PROBABILITY_FLOOR,
    SlideSource,
    cell_coverage,
    nuclei_of,
    patch_at,
    pool_nucleus,
    pool_reviewed,
)

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
TYPER = "pathosam-hovernext"
BASE = "v1.2"
CLASSES = 4
CHANNELS = 8

BROWSER = {
    "triangle": (
        [5, 3, 41, 12, 17, 37],
        [6.861315727, 10.986362457, 9.254646301, 6.299540996, 3.759258985, 5.052223682],
    ),
    "edge": (
        [0, 0, 13, 0, 13, 11, 0, 11],
        [1.530106067, 8.724774360, 8.605795860, 4.274365901, 6.408995151, 6.512684822],
    ),
    "tiny": (
        [50.1, 50.1, 50.2, 50.1, 50.2, 50.2],
        [17.207170486, 25.116098403, 24.827606201, 16.240591049, 20.852151870, 20.690071105],
    ),
}


def browser_planes() -> NDArray[np.float32]:
    cells = np.arange(64, dtype=np.float64)
    rows = [np.sin(cells * 0.7 + channel) * 10 + cells * 0.3 for channel in range(3)]
    return np.asarray(rows, np.float32).reshape(3, 8, 8)


def ramp_planes(channels: int, grid: int) -> NDArray[np.float32]:
    return np.asarray(
        [[channel * 100 + cell for cell in range(grid * grid)] for channel in range(channels)],
        np.float32,
    ).reshape(channels, grid, grid)


def square(x0: float, y0: float, x1: float, y1: float) -> list[float]:
    return [x0, y0, x1, y0, x1, y1, x0, y1]


@pytest.mark.parametrize("name", sorted(BROWSER))
def test_pooling_matches_the_browser(name: str) -> None:
    ring, expected = BROWSER[name]
    found = pool_nucleus(browser_planes(), ring, 64)
    assert found == pytest.approx(expected, abs=1e-5)


def test_pooling_matches_the_browser_square_cases() -> None:
    assert cell_coverage(np.asarray(square(0, 0, 16, 8), np.float64), 64, 4)[[0, 1, 4]] == (
        pytest.approx([0.5, 0, 0])
    )
    feature = pool_nucleus(ramp_planes(2, 8), square(24, 24, 32, 32), 64)
    assert feature == pytest.approx([27, 127, 27, 127], abs=1e-4)
    assert pool_nucleus(ramp_planes(1, 8), square(9.1, 9.1, 9.2, 9.2), 64)[0] == 9


class FakeEncoder:
    def __init__(self) -> None:
        generator = np.random.default_rng(11)
        self.weights = generator.normal(0, 1, (CHANNELS, 3)).astype(np.float32)
        self.calls = 0

    def __call__(self, pixels: NDArray[np.float32]) -> NDArray[np.float32]:
        self.calls += 1
        size = pixels.shape[-1] // EMBED_SIZE
        cells = pixels[0].reshape(3, EMBED_SIZE, size, EMBED_SIZE, size).mean(axis=(2, 4))
        return np.einsum("kc,cyx->kyx", self.weights, cells)[None].astype(np.float32)


class Sources:
    def __init__(self, pixels: NDArray[np.uint8], mpp: float) -> None:
        self.reader = ArrayReader(pixels, mpp)
        self.asked: list[str] = []

    async def __call__(self, slide: str) -> SlideSource:
        self.asked.append(slide)
        height, width = self.reader.pixels.shape[:2]
        return SlideSource(self.reader, width, height)


def ring_around(x: float, y: float, radius: float, points: int = 16) -> tuple[float, ...]:
    angles = np.arange(points) / points * 2 * np.pi
    return tuple(
        float(value)
        for pair in zip(x + np.cos(angles) * radius, y + np.sin(angles) * radius, strict=True)
        for value in pair
    )


CENTRES = [(120.0, 140.0), (200.0, 180.0), (520.0, 400.0), (900.0, 820.0)]


def reviewed() -> list[ReviewedNucleus]:
    return [
        ReviewedNucleus(
            slide="slide-1",
            task="task-1",
            kind="cell",
            number=number,
            reviewer="a",
            final_class="tumor",
            outline=ring_around(x, y, 10),
            views=8,
            probabilities=(0.7, 0.2, 0.1, 0.0),
        )
        for number, (x, y) in enumerate(CENTRES, start=1)
    ]


def slide_pixels() -> NDArray[np.uint8]:
    image = disks(1024, 1024, CENTRES, 10)
    image[:, :, 0] = np.linspace(0, 255, 1024, dtype=np.uint8)[None, :]
    return image


def test_reviewed_nuclei_are_pooled_and_stored_with_typer_outputs(tmp_path: Path) -> None:
    store = FeatureStore(tmp_path)
    sources = Sources(slide_pixels(), 0.5)
    encoder = FakeEncoder()
    found = asyncio.run(
        pool_reviewed(store, TENANT, TYPER, BASE, reviewed(), sources, encoder, CLASSES)
    )
    assert (found.pooled, found.stored) == (4, 4)
    assert encoder.calls == 3
    stored = store.load(TENANT, TYPER, BASE, "slide-1")
    assert stored is not None
    assert stored.features.shape == (4, CHANNELS * 2)
    assert set(stored.starts) == {8}
    assert stored.starts[8][0] == pytest.approx(np.log([0.7, 0.2, 0.1, TYPER_PROBABILITY_FLOOR]))
    assert all(stored.shapes)
    again = asyncio.run(
        pool_reviewed(store, TENANT, TYPER, BASE, reviewed(), sources, encoder, CLASSES)
    )
    assert (again.pooled, again.stored, encoder.calls) == (0, 4, 3)


def test_a_reshaped_outline_is_pooled_again_in_place(tmp_path: Path) -> None:
    store = FeatureStore(tmp_path)
    sources = Sources(slide_pixels(), 0.5)
    encoder = FakeEncoder()
    nuclei = reviewed()
    asyncio.run(pool_reviewed(store, TENANT, TYPER, BASE, nuclei, sources, encoder, CLASSES))
    before = store.load(TENANT, TYPER, BASE, "slide-1")
    assert before is not None
    x, y = CENTRES[1]
    reshaped = replace(nuclei[1], reviewer="b", outline=ring_around(x + 6, y, 16), reshaped=True)
    found = asyncio.run(
        pool_reviewed(store, TENANT, TYPER, BASE, [*nuclei, reshaped], sources, encoder, CLASSES)
    )
    assert (found.pooled, found.stored) == (1, 4)
    after = store.load(TENANT, TYPER, BASE, "slide-1")
    assert after is not None
    assert after.keys == before.keys
    row = after.keys.index(nuclei[1].key)
    assert not np.allclose(after.features[row], before.features[row])
    others = [index for index in range(4) if index != row]
    assert np.array_equal(after.features[others], before.features[others])
    assert after.shapes[row] == reshaped.shape
    settled = asyncio.run(
        pool_reviewed(store, TENANT, TYPER, BASE, [reshaped, *nuclei], sources, encoder, CLASSES)
    )
    assert settled.pooled == 0


def test_outlines_that_fit_no_patch_or_are_missing_are_left_out(tmp_path: Path) -> None:
    store = FeatureStore(tmp_path)
    nuclei = reviewed()
    huge = replace(nuclei[0], number=9, outline=ring_around(512, 512, 400))
    bare = replace(nuclei[0], number=10, outline=())
    found = asyncio.run(
        pool_reviewed(
            store,
            TENANT,
            TYPER,
            BASE,
            [*nuclei, huge, bare],
            Sources(slide_pixels(), 0.5),
            FakeEncoder(),
            CLASSES,
        )
    )
    assert (found.pooled, found.stored) == (4, 4)


def test_patches_follow_the_nuclei_preset_and_stop_at_the_slide_edge() -> None:
    reader = ArrayReader(np.zeros((4000, 6000, 3), np.uint8), 0.25)
    source = SlideSource(reader, 6000, 4000, (1.0, 4.0, 16.0))
    patch = patch_at(source, 10, 3990)
    assert (patch.x, patch.y, patch.width, patch.height, patch.downsample) == (
        0,
        4000 - 512,
        512,
        512,
        1.0,
    )
    coarse = SlideSource(ArrayReader(reader.pixels, 1.0), 6000, 4000, (1.0, 4.0))
    assert patch_at(coarse, 3000, 2000).width == 128


def test_api_rows_become_reviewed_nuclei() -> None:
    (found,) = nuclei_of(
        [
            {
                "slide": "s",
                "task": "t",
                "kind": "cell",
                "number": 3,
                "reviewer": "r",
                "final_class": None,
                "rejected": True,
                "outline": [1, 2, 3, 4, 5, 6],
                "reshaped": False,
                "views": 1,
                "probabilities": None,
            }
        ]
    )
    assert found.key == "t:cell:3"
    assert found.outline == (1.0, 2.0, 3.0, 4.0, 5.0, 6.0)
    assert found.rejected
