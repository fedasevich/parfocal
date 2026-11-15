import uuid
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.round_calibration import NotEnoughHeldOutError, fits_temperature
from parfocal_ml.training_rounds import (
    FolderStore,
    NoTrainingExamplesError,
    ReviewedRows,
    RoundGate,
    UnknownRoundError,
    roll_back,
    run_round,
    serving,
)

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
OTHER = uuid.UUID("00000000-0000-4000-8000-000000000002")
TYPER = "pathosam-hovernext"
BASE = "v1.2"
SLIDES = 60
PER_SLIDE = 60
CLASSES = 4


def held_out(slide: str) -> bool:
    return int(slide.split("-")[1]) % 2 == 0


def reviewed(seed: int = 5, shuffled: bool = False) -> ReviewedRows:
    generator = np.random.default_rng(seed)
    count = SLIDES * PER_SLIDE
    truth = generator.integers(0, CLASSES, count)
    typer = generator.normal(0, 1, (count, CLASSES))
    typer[np.arange(count), truth] += 0.8
    features = generator.normal(0, 1, (count, 6))
    features[:, :CLASSES] += 1.5 * np.eye(CLASSES)[truth]
    slides = [f"slide-{index // PER_SLIDE}" for index in range(count)]
    labels = truth.copy()
    if shuffled:
        training = np.array([not held_out(slide) for slide in slides])
        labels[training] = generator.permutation(labels[training])
    start = typer - np.log(np.exp(typer).sum(axis=1, keepdims=True))
    return ReviewedRows(features, {1: start, 8: start * 1.1}, labels, slides)


def test_the_seeded_slides_fill_both_halves_of_the_held_out_side() -> None:
    held = [f"slide-{index}" for index in range(SLIDES) if held_out(f"slide-{index}")]
    fit = [slide for slide in held if fits_temperature(slide)]
    assert len(fit) >= 5
    assert len(held) - len(fit) >= 5
    assert min(len(fit), len(held) - len(fit)) * PER_SLIDE >= 500


def test_a_round_on_seeded_data_is_promoted_and_served(tmp_path: Path) -> None:
    store = FolderStore(tmp_path)
    found = run_round(store, TENANT, TYPER, BASE, reviewed(), held_out, [1, 8])
    assert found.version == "v1.2-round-1"
    assert found.promoted, found.report.refused
    assert found.report.round_accuracy > found.report.served_accuracy
    assert found.report.served_version == BASE
    assert found.report.trained_slides == SLIDES // 2
    assert [row["test_time_views"] for row in found.report.calibrations] == [1, 8]
    bands = [row["bands"] for row in found.report.calibrations]
    assert all(isinstance(band, list) and len(band) == 4 for band in bands)
    served = serving(store, TENANT, TYPER)
    assert served is not None
    assert served.version == found.version
    rows = reviewed()
    again = served.head(rows.features, rows.starts[1])
    assert np.allclose(again, found.head(rows.features, rows.starts[1]))


def test_a_degraded_round_is_stored_but_never_served(tmp_path: Path) -> None:
    store = FolderStore(tmp_path)
    good = run_round(store, TENANT, TYPER, BASE, reviewed(), held_out, [1])
    bad = run_round(store, TENANT, TYPER, BASE, reviewed(shuffled=True), held_out, [1])
    assert not bad.promoted
    assert bad.report.served_version == good.version
    assert any("below the served" in reason for reason in bad.report.refused)
    assert store.pointer(TENANT, TYPER).latest == good.version
    with pytest.raises(UnknownRoundError):
        roll_back(store, TENANT, TYPER, bad.version)


def test_rolling_back_moves_only_the_pointer(tmp_path: Path) -> None:
    store = FolderStore(tmp_path)
    first = run_round(store, TENANT, TYPER, BASE, reviewed(), held_out, [1])
    second = run_round(store, TENANT, TYPER, BASE, reviewed(seed=6), held_out, [1], gate_free())
    assert second.promoted
    assert second.version == "v1.2-round-2"
    assert roll_back(store, TENANT, TYPER) == first.version
    assert store.numbers(TENANT, TYPER) == [1, 2]
    assert roll_back(store, TENANT, TYPER) is None
    assert serving(store, TENANT, TYPER) is None
    with pytest.raises(UnknownRoundError):
        roll_back(store, TENANT, TYPER)
    assert roll_back(store, TENANT, TYPER, second.version) == second.version
    third = run_round(store, TENANT, TYPER, BASE, reviewed(seed=7), held_out, [1], gate_free())
    assert third.version == "v1.2-round-3"


def test_tenants_keep_their_own_rounds_and_pointers(tmp_path: Path) -> None:
    store = FolderStore(tmp_path)
    run_round(store, TENANT, TYPER, BASE, reviewed(), held_out, [1])
    assert store.numbers(OTHER, TYPER) == []
    assert serving(store, OTHER, TYPER) is None
    with pytest.raises(UnknownRoundError):
        roll_back(store, OTHER, TYPER, "v1.2-round-1")
    own = run_round(store, OTHER, TYPER, BASE, reviewed(seed=8), held_out, [1])
    assert own.version == "v1.2-round-1"
    assert own.report.served_version == BASE


def test_a_round_needs_training_and_enough_held_out_slides(tmp_path: Path) -> None:
    store = FolderStore(tmp_path)
    with pytest.raises(NoTrainingExamplesError):
        run_round(store, TENANT, TYPER, BASE, reviewed(), lambda _: True, [1])
    with pytest.raises(NotEnoughHeldOutError):
        run_round(store, TENANT, TYPER, BASE, reviewed(), lambda slide: slide == "slide-0", [1])
    with pytest.raises(ValueError, match="no typer output"):
        run_round(store, TENANT, TYPER, BASE, reviewed(), held_out, [4])
    with pytest.raises(ValueError, match="not a typer"):
        run_round(store, TENANT, "../escape", BASE, reviewed(), held_out, [1])
    assert store.numbers(TENANT, TYPER) == []


def gate_free() -> RoundGate:
    return RoundGate(max_ece=1.0, min_gain=-1.0)
