from array import array
from dataclasses import dataclass
from typing import Any

import numpy as np
from numpy.typing import NDArray
from scipy.spatial import KDTree

CELL_MICRONS = 4.0
CELL_PIXELS_WITHOUT_SCALE = 16.0
PAIR_SLICE = 100_000


def cell_distance(mpp: float | None, microns: float = CELL_MICRONS) -> float:
    return microns / mpp if mpp else CELL_PIXELS_WITHOUT_SCALE


def reading_order(xy: NDArray[np.float64]) -> NDArray[np.int64]:
    if not len(xy):
        return np.zeros(0, dtype=np.int64)
    return np.lexsort((np.arange(len(xy)), xy[:, 0], xy[:, 1]))


@dataclass(frozen=True)
class CentreMatching:
    assigned: NDArray[np.int64]
    new: NDArray[np.int64]

    @property
    def inherited(self) -> int:
        return len(self.assigned) - len(self.new)

    def numbers(self, first_new: int) -> NDArray[np.int64]:
        found = self.assigned.copy()
        found[self.new] = first_new + np.arange(len(self.new), dtype=np.int64)
        return found


def greedy_pairs(
    known: NDArray[np.int64], incoming: NDArray[np.int64], known_count: int, incoming_count: int
) -> tuple[NDArray[np.int64], NDArray[np.int64]]:
    used = bytearray(known_count)
    got = bytearray(incoming_count)
    chosen_known = array("q")
    chosen_incoming = array("q")
    for start in range(0, len(known), PAIR_SLICE):
        end = start + PAIR_SLICE
        for known_index, incoming_index in zip(
            known[start:end].tolist(), incoming[start:end].tolist(), strict=True
        ):
            if used[known_index] or got[incoming_index]:
                continue
            used[known_index] = 1
            got[incoming_index] = 1
            chosen_known.append(known_index)
            chosen_incoming.append(incoming_index)
    return np.frombuffer(chosen_known, dtype=np.int64), np.frombuffer(
        chosen_incoming, dtype=np.int64
    )


def pair_centres(
    known_numbers: NDArray[np.integer[Any]],
    known_xy: NDArray[np.float64],
    incoming_xy: NDArray[np.float64],
    distance: float,
) -> CentreMatching:
    assigned = np.zeros(len(incoming_xy), dtype=np.int64)
    if len(known_numbers) and len(incoming_xy):
        pairs = KDTree(known_xy).sparse_distance_matrix(
            KDTree(incoming_xy), distance, output_type="ndarray"
        )
        order = np.lexsort((pairs["j"], pairs["i"], pairs["v"]))
        known, incoming = greedy_pairs(
            pairs["i"][order].astype(np.int64),
            pairs["j"][order].astype(np.int64),
            len(known_numbers),
            len(incoming_xy),
        )
        assigned[incoming] = np.asarray(known_numbers, dtype=np.int64)[known]
    reading = np.asarray(reading_order(incoming_xy), dtype=np.int64)
    return CentreMatching(assigned, reading[assigned[reading] == 0])


def latest_per_number(
    numbers: NDArray[np.int64], centres: NDArray[np.float64]
) -> tuple[NDArray[np.int64], NDArray[np.float64]]:
    if not len(numbers):
        return numbers, centres
    _, last = np.unique(numbers[::-1], return_index=True)
    picked = len(numbers) - 1 - last
    return numbers[picked], centres[picked]
