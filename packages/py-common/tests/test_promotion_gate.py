from parfocal_common.promotion_gate import (
    DETECTOR,
    INTERACTIVE,
    THRESHOLDS,
    TUMOR_MAP,
    TYPER,
    gate,
    gate_model,
    passed,
)


def test_the_reference_baseline_passes_its_own_gate_for_every_measured_task() -> None:
    for task in (TYPER, DETECTOR, INTERACTIVE):
        thresholds = THRESHOLDS[task]
        report = gate(thresholds.baseline, thresholds)
        assert report.passed, report.refused
        assert report.source.startswith("docs/results/")


def test_a_degraded_detector_is_refused_and_a_small_drop_is_allowed() -> None:
    thresholds = THRESHOLDS[DETECTOR]
    degraded = gate({"pq": 0.7692, "f1": 0.9291}, thresholds)
    assert not degraded.passed
    assert any(reason.startswith("pq 0.7692 is below") for reason in degraded.refused)
    assert gate({"pq": 0.8140, "f1": 0.9400}, thresholds).passed


def test_a_typer_over_the_ece_cap_or_below_its_reference_is_refused() -> None:
    thresholds = THRESHOLDS[TYPER]
    assert gate({"accuracy": 0.84, "ece": 0.06}, thresholds).refused == ("ece 0.06 is over 0.05",)
    below = gate({"accuracy": 0.80, "ece": 0.02}, thresholds, {"accuracy": 0.81}, "served")
    assert below.refused == ("accuracy 0.8 is below the served 0.81 less 0.0",)


def test_a_missing_metric_and_an_unmeasured_task_are_refused() -> None:
    assert gate({"pq": 0.83}, THRESHOLDS[DETECTOR]).refused == ("f1 was not measured",)
    assert not gate({}, THRESHOLDS[TUMOR_MAP]).passed


def test_a_model_passes_only_when_every_gated_task_passes() -> None:
    measured = {DETECTOR: dict(THRESHOLDS[DETECTOR].baseline)}
    assert passed(gate_model([DETECTOR, "decoder"], measured))
    assert not passed(gate_model([DETECTOR, TYPER], measured))
    assert not passed(gate_model(["decoder"], measured))
    report = gate_model([DETECTOR], measured)[0].as_json()
    assert report["passed"] is True
    assert report["allowed_drop"] == {"pq": 0.01, "f1": 0.01}
