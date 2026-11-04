import secrets
from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Annotated, Any

from pydantic import BaseModel, Field, model_validator

from parfocal_common.scope import Scope as SamplingScope
from parfocal_common.scope import ScopeKind

SCORE_STEPS = 255
MAX_CHECK_PARTS = 4
SAMPLE_SIZE = 200


def stored_score(score: float) -> int:
    return round(score * SCORE_STEPS)


def shown_score(stored: int | None) -> float | None:
    return None if stored is None else round(stored / SCORE_STEPS, 3)


class CheckKind(StrEnum):
    ALL_OBJECTS = "all-objects"
    RANDOM_CELLS = "random-cells"
    CELLS_BELOW_SCORE = "cells-below-score"
    INSIDE_ROIS = "inside-rois"
    UNSURE_ZONES = "unsure-zones"


class CheckOrder(StrEnum):
    LEAST_SURE_FIRST = "least-sure-first"
    POSITION = "position"


class SignOffRule(StrEnum):
    ALL_CHECKED = "all-checked"
    WARN = "warn"


class UncheckedExport(StrEnum):
    LEAVE_OUT = "leave-out"
    INCLUDE = "include"


class CheckPreset(StrEnum):
    BY_HAND = "annotate-by-hand"
    WHOLE_SLIDE_RUN = "check-whole-slide-run"
    SAMPLE = "check-sample"
    SELECTED_AREAS = "fix-ai-on-selected-areas"
    MIXED = "mixed"


class CheckPart(BaseModel):
    kind: CheckKind
    count: Annotated[int, Field(ge=1, le=10_000)] | None = None
    score: Annotated[float, Field(ge=0, le=1)] | None = None

    @model_validator(mode="after")
    def parameters_fit(self) -> CheckPart:
        if (self.kind is CheckKind.RANDOM_CELLS) != (self.count is not None):
            raise ValueError("A random sample of cells needs a count, and only it has one")
        if (self.kind is CheckKind.CELLS_BELOW_SCORE) != (self.score is not None):
            raise ValueError("Cells below a score need a score, and only they have one")
        return self


type CheckScope = Annotated[list[CheckPart], Field(max_length=MAX_CHECK_PARTS)]


def distinct_parts(parts: Sequence[CheckPart]) -> None:
    kinds = [part.kind for part in parts]
    if len(set(kinds)) != len(kinds):
        raise ValueError("Each part of the check scope is a different kind")


class CheckChange(BaseModel):
    scope: CheckScope | None = None
    order: CheckOrder | None = None
    sign_off: SignOffRule | None = None
    unchecked_export: UncheckedExport | None = None

    @model_validator(mode="after")
    def distinct(self) -> CheckChange:
        distinct_parts(self.scope or [])
        return self


class CheckOptions(BaseModel):
    preset: CheckPreset | None
    scope: list[CheckPart]
    order: CheckOrder
    sign_off: SignOffRule
    unchecked_export: UncheckedExport


def preset_options(
    preset: CheckPreset, parts: Sequence[CheckPart], order: CheckOrder, sign_off: SignOffRule
) -> CheckOptions:
    return CheckOptions(
        preset=preset,
        scope=list(parts),
        order=order,
        sign_off=sign_off,
        unchecked_export=UncheckedExport.LEAVE_OUT,
    )


PRESETS: Mapping[CheckPreset, CheckOptions] = {
    CheckPreset.BY_HAND: preset_options(
        CheckPreset.BY_HAND, [], CheckOrder.LEAST_SURE_FIRST, SignOffRule.WARN
    ),
    CheckPreset.WHOLE_SLIDE_RUN: preset_options(
        CheckPreset.WHOLE_SLIDE_RUN,
        [CheckPart(kind=CheckKind.ALL_OBJECTS)],
        CheckOrder.LEAST_SURE_FIRST,
        SignOffRule.ALL_CHECKED,
    ),
    CheckPreset.SAMPLE: preset_options(
        CheckPreset.SAMPLE,
        [CheckPart(kind=CheckKind.RANDOM_CELLS, count=SAMPLE_SIZE)],
        CheckOrder.LEAST_SURE_FIRST,
        SignOffRule.ALL_CHECKED,
    ),
    CheckPreset.SELECTED_AREAS: preset_options(
        CheckPreset.SELECTED_AREAS,
        [CheckPart(kind=CheckKind.INSIDE_ROIS)],
        CheckOrder.POSITION,
        SignOffRule.ALL_CHECKED,
    ),
    CheckPreset.MIXED: preset_options(
        CheckPreset.MIXED,
        [CheckPart(kind=CheckKind.ALL_OBJECTS)],
        CheckOrder.LEAST_SURE_FIRST,
        SignOffRule.WARN,
    ),
}


def overlaid(base: CheckOptions, change: CheckChange | None) -> CheckOptions:
    if change is None:
        return base
    picked = {field: getattr(change, field) for field in change.model_fields_set}
    return base.model_copy(
        update={key: value for key, value in picked.items() if value is not None}
    )


def resolved(preset: CheckPreset | None, change: CheckChange | None) -> CheckOptions:
    return overlaid(PRESETS[preset or CheckPreset.BY_HAND], change)


def stored_check(options: CheckOptions, kept: Mapping[str, Any] | None) -> dict[str, Any]:
    seeds = {part["kind"]: part.get("seed") for part in (kept or {}).get("scope", [])}
    return {
        "preset": None if options.preset is None else options.preset.value,
        "scope": [
            {
                "kind": part.kind.value,
                "count": part.count,
                "seed": (seeds.get(part.kind.value) or secrets.randbits(62))
                if part.kind is CheckKind.RANDOM_CELLS
                else None,
                "score": None if part.score is None else stored_score(part.score),
            }
            for part in options.scope
        ],
        "order": options.order.value,
        "sign_off": options.sign_off.value,
        "unchecked_export": options.unchecked_export.value,
    }


def check_of(stored: Mapping[str, Any] | None) -> CheckOptions:
    if stored is None:
        return PRESETS[CheckPreset.BY_HAND]
    return CheckOptions(
        preset=stored.get("preset"),
        scope=[
            CheckPart(
                kind=CheckKind(part["kind"]),
                count=part.get("count"),
                score=shown_score(part.get("score")),
            )
            for part in stored["scope"]
        ],
        order=CheckOrder(stored["order"]),
        sign_off=SignOffRule(stored["sign_off"]),
        unchecked_export=UncheckedExport(stored["unchecked_export"]),
    )


def check_scopes(stored: Mapping[str, Any] | None) -> list[SamplingScope]:
    scopes: list[SamplingScope] = []
    for part in (stored or {}).get("scope", []):
        kind = CheckKind(part["kind"])
        if kind is CheckKind.ALL_OBJECTS:
            scopes += [SamplingScope(ScopeKind.ALL_REGIONS), SamplingScope(ScopeKind.ALL_CELLS)]
            continue
        scopes.append(
            SamplingScope(
                ScopeKind(kind.value),
                count=part.get("count"),
                seed=part.get("seed"),
                score=part.get("score"),
            )
        )
    return scopes


def least_sure(stored: Mapping[str, Any] | None) -> bool:
    return (stored or {}).get("order", CheckOrder.LEAST_SURE_FIRST) == CheckOrder.LEAST_SURE_FIRST


def requires_all_checked(stored: Mapping[str, Any] | None) -> bool:
    return bool(stored and stored["scope"] and stored["sign_off"] == SignOffRule.ALL_CHECKED)
