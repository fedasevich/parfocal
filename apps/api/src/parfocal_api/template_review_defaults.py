from enum import StrEnum
from typing import Annotated, Literal

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, Field

from parfocal_api.context import TenantConnection
from parfocal_api.decision_styles import DecisionSettings
from parfocal_api.display_settings import ButtonPlace, DisplaySettings, ObjectOrder
from parfocal_api.opinion_questions import (
    DEFAULT_QUESTIONS,
    OUTLINE_QUALITY_QUESTIONS,
    READER_STUDY_QUESTIONS,
    Question,
)
from parfocal_api.permissions import Permission, require
from parfocal_api.study_templates import StudyTemplate, joined, template_of
from parfocal_api.tables import (
    DecisionStyle,
    DecisionValue,
    TaskScope,
    study_template_versions,
    study_templates,
)

DEFAULT_CELLS = 50
DEFAULT_LOW_SCORE = 0.6


class ScopeKindKey(StrEnum):
    REGIONS = "regions"
    CELLS = "cells"
    LOW = "low"
    ROI = "roi"
    UNSURE = "unsure"


class DecisionKind(StrEnum):
    CERTAINTY5 = "certainty5"
    AGREE = "agree"
    YES_NO = "yesno"
    BLIND = "blind"


class ScopeOptions(BaseModel):
    cells: int
    low: float
    rois: list[str]
    unsure_zones: list[str]


class DecisionDefaults(BaseModel):
    kind: DecisionKind
    agree_from: Annotated[int, Field(ge=2, le=5)]
    disagree_to: Annotated[int, Field(ge=1, le=4)]


class OtherSetsShown(BaseModel):
    cam: bool
    sam: bool
    rev: bool


class DisplayDefaults(BaseModel):
    draw: Literal["outline", "fill", "dots"]
    width: Annotated[int, Field(ge=1, le=3)]
    opacity: Annotated[int, Field(ge=20, le=100)]
    model_config = ConfigDict(populate_by_name=True, serialize_by_alias=True)

    colour_by: Annotated[Literal["class", "score", "decision"], Field(alias="colorBy")]
    ids: bool
    conf: Literal["number", "word", "color", "hidden"]
    heat: Annotated[int, Field(ge=0, le=100)]
    cutoff: Annotated[float, Field(ge=0, le=1)]
    sets: OtherSetsShown
    order: Literal["ai", "size", "leastsure", "random"]
    zoom: Literal["fit", "tight", "context"]
    auto: bool
    buttons: Literal["right", "bottom"]


class TemplateReviewDefaults(BaseModel):
    template_id: str
    scope_kinds: list[ScopeKindKey]
    scope_options: ScopeOptions
    decision: DecisionDefaults
    display: DisplayDefaults
    opinion_form: str


class OpinionFormQuestion(BaseModel):
    label: str
    kind: Literal["scale", "choice", "yesno", "text"]
    required: bool


class OpinionFormChoice(BaseModel):
    key: str
    name: str
    questions: list[OpinionFormQuestion]


class StudyTemplateReviewDefaults(BaseModel):
    templates: list[TemplateReviewDefaults]
    opinion_forms: list[OpinionFormChoice]


SCOPE_KEYS = {
    TaskScope.ALL_REGIONS: ScopeKindKey.REGIONS,
    TaskScope.WHOLE_SLIDE: ScopeKindKey.REGIONS,
    TaskScope.RANDOM_CELLS: ScopeKindKey.CELLS,
    TaskScope.CELLS_BELOW_SCORE: ScopeKindKey.LOW,
    TaskScope.INSIDE_ROIS: ScopeKindKey.ROI,
    TaskScope.UNSURE_ZONES: ScopeKindKey.UNSURE,
}
DECISION_KINDS = {
    DecisionStyle.CERTAINTY: DecisionKind.CERTAINTY5,
    DecisionStyle.AGREE: DecisionKind.AGREE,
    DecisionStyle.YES_NO: DecisionKind.YES_NO,
    DecisionStyle.BLIND: DecisionKind.BLIND,
}
ORDERS: dict[ObjectOrder, Literal["ai", "size", "leastsure", "random"]] = {
    ObjectOrder.AI: "ai",
    ObjectOrder.LARGEST_FIRST: "size",
    ObjectOrder.LEAST_SURE_FIRST: "leastsure",
    ObjectOrder.RANDOM: "random",
}
BUILT_IN_FORMS: tuple[tuple[str, str, list[Question]], ...] = (
    ("default", "Default opinion form", DEFAULT_QUESTIONS),
    ("reader", "Reader study form", READER_STUDY_QUESTIONS),
    ("outline", "Outline quality form", OUTLINE_QUALITY_QUESTIONS),
)

router = APIRouter(prefix="/api/study-templates", tags=["study-templates"])


def decision_of(settings: DecisionSettings) -> DecisionDefaults:
    scores = list(enumerate(settings.counts_as, 1))
    agrees = [score for score, value in scores if value is DecisionValue.AGREE]
    disagrees = [score for score, value in scores if value is DecisionValue.DISAGREE]
    return DecisionDefaults(
        kind=DECISION_KINDS[settings.style],
        agree_from=min(max(min(agrees), 2), 5),
        disagree_to=min(max(max(disagrees), 1), 4),
    )


def display_of(settings: DisplaySettings) -> DisplayDefaults:
    return DisplayDefaults(
        draw=settings.draw_as.value,
        width=settings.width,
        opacity=settings.opacity,
        colour_by=settings.colour_by.value,
        ids=settings.id_labels,
        conf="color" if settings.confidence.value == "colour" else settings.confidence.value,
        heat=settings.heatmap,
        cutoff=settings.score_cutoff,
        sets=OtherSetsShown(
            cam=bool(settings.other_sets.result_set_ids),
            sam=False,
            rev=settings.other_sets.reviewed_layer,
        ),
        order=ORDERS[settings.order],
        zoom=settings.zoom.value,
        auto=settings.move_on,
        buttons="right" if settings.buttons is ButtonPlace.CARD else "bottom",
    )


def form_of(key: str, name: str, questions: list[Question]) -> OpinionFormChoice:
    return OpinionFormChoice(
        key=key,
        name=name,
        questions=[
            OpinionFormQuestion(
                label=question.label, kind=question.kind, required=question.required
            )
            for question in questions
        ],
    )


def form_key_of(template: StudyTemplate, forms: list[OpinionFormChoice]) -> str:
    chosen = template.presets.opinion_form
    if chosen is None:
        return "default"
    for key, _, questions in BUILT_IN_FORMS:
        if chosen.questions == questions:
            return key
    key = f"template-{template.id}"
    forms.append(form_of(key, template.name, chosen.questions))
    return key


def defaults_of(template: StudyTemplate, forms: list[OpinionFormChoice]) -> TemplateReviewDefaults:
    scope = template.presets.objects_to_check
    return TemplateReviewDefaults(
        template_id=str(template.id),
        scope_kinds=[SCOPE_KEYS[scope.kind]],
        scope_options=ScopeOptions(
            cells=scope.count or DEFAULT_CELLS,
            low=scope.score if scope.score is not None else DEFAULT_LOW_SCORE,
            rois=[],
            unsure_zones=[],
        ),
        decision=decision_of(template.presets.decision),
        display=display_of(template.presets.display),
        opinion_form=form_key_of(template, forms),
    )


@router.get(
    "/review-defaults",
    operation_id="listStudyTemplateReviewDefaults",
    **require(Permission.REPORT_TEMPLATES),
)
async def list_study_template_review_defaults(
    connection: TenantConnection,
) -> StudyTemplateReviewDefaults:
    rows = await connection.execute(
        joined()
        .where(study_template_versions.c.version == study_templates.c.version)
        .order_by(
            study_templates.c.built_in.is_(None),
            study_templates.c.created_at,
            study_template_versions.c.name,
        )
    )
    forms = [form_of(key, name, questions) for key, name, questions in BUILT_IN_FORMS]
    templates = [defaults_of(template_of(row), forms) for row in rows]
    return StudyTemplateReviewDefaults(templates=templates, opinion_forms=forms)
