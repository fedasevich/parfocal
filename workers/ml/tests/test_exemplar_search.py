import numpy as np
import pytest

from parfocal_ml.exemplar_search import (
    auroc,
    peaks,
    pooled,
    prototype,
    ring_of,
    seed_hits,
    similarity_map,
    token_coverage,
)
from parfocal_ml.sam_contract import EMBED_DIM, EMBED_SIZE

SIDE = 512
CELL = SIDE // EMBED_SIZE


def planted() -> tuple[np.ndarray, np.ndarray, list[tuple[int, int]]]:
    rng = np.random.default_rng(7)
    embedding = rng.normal(size=(1, EMBED_DIM, EMBED_SIZE, EMBED_SIZE)).astype(np.float32)
    target = rng.normal(size=EMBED_DIM).astype(np.float32)
    cells = [(10, 10), (20, 40), (50, 30), (40, 55)]
    labels = np.zeros((SIDE, SIDE), np.int32)
    for label, (row, col) in enumerate(cells, start=1):
        embedding[0, :, row, col] = target * 4 + rng.normal(size=EMBED_DIM) * 0.1
        labels[row * CELL : (row + 1) * CELL, col * CELL : (col + 1) * CELL] = label
    return embedding, labels, cells


def test_token_coverage_averages_each_cell() -> None:
    mask = np.zeros((SIDE, SIDE), bool)
    mask[:CELL, : CELL // 2] = True
    coverage = token_coverage(mask)
    assert coverage.shape == (EMBED_SIZE, EMBED_SIZE)
    assert coverage[0, 0] == pytest.approx(0.5)
    assert coverage.sum() == pytest.approx(0.5)


def test_exemplars_find_the_planted_cells_and_nothing_else() -> None:
    embedding, labels, cells = planted()
    exemplars = [pooled(embedding, token_coverage(labels == label)) for label in (1, 2)]
    found = peaks(similarity_map(embedding, prototype(exemplars)), 0.8)
    assert sorted(found) == sorted(cells)
    assert seed_hits(labels, found, {1, 2}) == (2, 0, 0)


def test_auroc_handles_order_and_ties() -> None:
    assert auroc([3.0, 4.0], [1.0, 2.0]) == 1.0
    assert auroc([1.0], [2.0]) == 0.0
    assert auroc([1.0], [1.0]) == 0.5


def test_ring_of_traces_the_largest_component() -> None:
    mask = np.zeros((64, 64), bool)
    mask[10:30, 10:30] = True
    mask[50, 50] = True
    ring = ring_of(mask)
    assert ring is not None
    xs, ys = np.asarray(ring[0::2]), np.asarray(ring[1::2])
    assert xs.min() >= 9
    assert xs.max() <= 30
    assert ys.min() >= 9
    assert ys.max() <= 30
