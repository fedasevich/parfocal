import hashlib
import uuid
from collections.abc import Sequence
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from parfocal_ml.reviewed_features import (
    FeatureStore,
    Pooled,
    ReviewedNucleus,
    assemble,
    collect,
)
from parfocal_ml.training_rounds import FolderStore, run_round

TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
OTHER = uuid.UUID("00000000-0000-4000-8000-000000000002")
TYPER = "pathosam-hovernext"
BASE = "v1.2"
SLIDES = 60
PER_SLIDE = 60
CLASSES = ("tumor", "stroma", "immune", "other")
INDEX = {name: index for index, name in enumerate(CLASSES)}
VIEWS = (1, 8)


def held_out(slide: str) -> bool:
    return int(slide.split("-")[1]) % 2 == 0


def truth_of(slide: str, number: int) -> int:
    digest = hashlib.sha256(f"{slide}:{number}".encode()).digest()
    return digest[0] % len(CLASSES)


class FakePooler:
    def __init__(self) -> None:
        self.calls: list[tuple[str, int]] = []

    def __call__(self, slide: str, nuclei: Sequence[ReviewedNucleus]) -> Pooled:
        self.calls.append((slide, len(nuclei)))
        truth = np.array([truth_of(slide, nucleus.number) for nucleus in nuclei])
        seed = int.from_bytes(hashlib.sha256(slide.encode()).digest()[:4], "big")
        generator = np.random.default_rng([seed, *(nucleus.number for nucleus in nuclei)])
        typer = generator.normal(0, 1, (len(nuclei), len(CLASSES)))
        typer[np.arange(len(nuclei)), truth] += 0.8
        features = generator.normal(0, 1, (len(nuclei), 6))
        features[:, : len(CLASSES)] += 1.5 * np.eye(len(CLASSES))[truth]
        start = typer - np.log(np.exp(typer).sum(axis=1, keepdims=True))
        return Pooled(features, {1: start, 8: start * 1.1})


def nucleus(slide: int, number: int, reviewer: str = "a", **changes: object) -> ReviewedNucleus:
    name = f"slide-{slide}"
    found = ReviewedNucleus(
        slide=name,
        task="task-1",
        kind="cell",
        number=number,
        reviewer=reviewer,
        final_class=CLASSES[truth_of(name, number)],
    )
    return replace(found, **changes)


def reviewed(slides: int = SLIDES, per_slide: int = PER_SLIDE) -> list[ReviewedNucleus]:
    return [nucleus(slide, number) for slide in range(slides) for number in range(per_slide)]


def test_collected_features_feed_a_promoted_round(tmp_path: Path) -> None:
    features = FeatureStore(tmp_path)
    nuclei = reviewed()
    collected = collect(features, TENANT, TYPER, BASE, nuclei, FakePooler())
    assert collected.pooled == SLIDES * PER_SLIDE
    assert collected.stored == SLIDES * PER_SLIDE
    found = assemble(features, TENANT, TYPER, BASE, nuclei, INDEX, VIEWS)
    assert found.rows.features.shape == (SLIDES * PER_SLIDE, 6)
    assert set(found.rows.starts) == set(VIEWS)
    assert found.conflicted == 0
    assert found.unpooled == 0
    first = found.keys.index(("slide-3", "task-1:cell:7"))
    assert found.rows.labels[first] == truth_of("slide-3", 7)
    assert found.rows.slides[first] == "slide-3"
    stored = (tmp_path / "tenants" / str(TENANT) / "typer-features" / TYPER / BASE).iterdir()
    assert sorted(path.name for path in stored)[:2] == ["slide-0.npz", "slide-1.npz"]
    trained = run_round(FolderStore(tmp_path), TENANT, TYPER, BASE, found.rows, held_out, VIEWS)
    assert trained.promoted, trained.report.refused
    assert trained.report.round_accuracy > trained.report.served_accuracy


def test_a_second_collect_pools_only_new_nuclei(tmp_path: Path) -> None:
    features = FeatureStore(tmp_path)
    collect(features, TENANT, TYPER, BASE, reviewed(3, 10), FakePooler())
    pooler = FakePooler()
    later = [*reviewed(3, 10), nucleus(1, 10), nucleus(1, 11), nucleus(4, 0)]
    collected = collect(features, TENANT, TYPER, BASE, later, pooler)
    assert pooler.calls == [("slide-1", 2), ("slide-4", 1)]
    assert collected.pooled == 3
    assert collected.stored == 33
    again = FakePooler()
    collect(features, TENANT, TYPER, BASE, later, again)
    assert again.calls == []


def test_a_changed_decision_relabels_without_pooling_again(tmp_path: Path) -> None:
    features = FeatureStore(tmp_path)
    nuclei = reviewed(2, 5)
    collect(features, TENANT, TYPER, BASE, nuclei, FakePooler())
    before = assemble(features, TENANT, TYPER, BASE, nuclei, INDEX, [1])
    target = before.keys.index(("slide-0", "task-1:cell:2"))
    flipped = CLASSES[(truth_of("slide-0", 2) + 1) % len(CLASSES)]
    changed = [
        replace(item, final_class=flipped) if (item.slide, item.number) == ("slide-0", 2) else item
        for item in nuclei
    ]
    pooler = FakePooler()
    collect(features, TENANT, TYPER, BASE, changed, pooler)
    assert pooler.calls == []
    after = assemble(features, TENANT, TYPER, BASE, changed, INDEX, [1])
    assert after.rows.labels[target] == INDEX[flipped]
    assert np.array_equal(after.rows.features, before.rows.features)


def test_rejected_conflicting_and_unknown_nuclei_are_left_out(tmp_path: Path) -> None:
    features = FeatureStore(tmp_path)
    nuclei = [
        *reviewed(1, 4),
        nucleus(0, 0, reviewer="b"),
        nucleus(0, 1, reviewer="b", final_class=CLASSES[(truth_of("slide-0", 1) + 1) % 4]),
        nucleus(0, 4, rejected=True, final_class=None),
        nucleus(0, 5, final_class="necrosis"),
    ]
    pooler = FakePooler()
    collect(features, TENANT, TYPER, BASE, nuclei, pooler)
    assert pooler.calls == [("slide-0", 5)]
    found = assemble(features, TENANT, TYPER, BASE, nuclei, INDEX, [1])
    assert [key for _, key in found.keys] == ["task-1:cell:0", "task-1:cell:2", "task-1:cell:3"]
    assert found.conflicted == 1
    late = [*nuclei, nucleus(0, 9)]
    assert assemble(features, TENANT, TYPER, BASE, late, INDEX, [1]).unpooled == 1


def test_tenants_and_typer_versions_keep_their_own_features(tmp_path: Path) -> None:
    features = FeatureStore(tmp_path)
    collect(features, TENANT, TYPER, BASE, reviewed(2, 3), FakePooler())
    assert features.slides(OTHER, TYPER, BASE) == []
    assert features.slides(TENANT, TYPER, "v1.3") == []
    with pytest.raises(ValueError, match="no reviewed nucleus"):
        assemble(features, OTHER, TYPER, BASE, reviewed(2, 3), INDEX, [1])
    pooler = FakePooler()
    collect(features, OTHER, TYPER, BASE, reviewed(2, 3), pooler)
    assert len(pooler.calls) == 2


def test_bad_names_and_missing_views_are_refused(tmp_path: Path) -> None:
    features = FeatureStore(tmp_path)
    with pytest.raises(ValueError, match="not a typer"):
        collect(features, TENANT, "../escape", BASE, reviewed(1, 2), FakePooler())
    escaping = replace(nucleus(0, 0), slide="../x")
    pooler = FakePooler()
    with pytest.raises(ValueError, match="not a typer"):
        collect(features, TENANT, TYPER, BASE, [escaping], pooler)
    assert pooler.calls == []
    collect(features, TENANT, TYPER, BASE, reviewed(1, 2), FakePooler())
    with pytest.raises(ValueError, match="no typer output"):
        assemble(features, TENANT, TYPER, BASE, reviewed(1, 2), INDEX, [4])


def test_a_pooler_that_breaks_the_row_contract_is_refused(tmp_path: Path) -> None:
    features = FeatureStore(tmp_path)

    def short(slide: str, nuclei: Sequence[ReviewedNucleus]) -> Pooled:
        return Pooled(np.zeros((len(nuclei) - 1, 6)), {1: np.zeros((len(nuclei), 4))})

    with pytest.raises(ValueError, match="one row per nucleus"):
        collect(features, TENANT, TYPER, BASE, reviewed(1, 3), short)
    assert features.slides(TENANT, TYPER, BASE) == []
