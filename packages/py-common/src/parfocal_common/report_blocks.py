import uuid
from enum import StrEnum
from typing import Annotated, Any, Literal

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    StrictBool,
    StrictInt,
    StringConstraints,
    TypeAdapter,
    model_validator,
)

MAX_BLOCKS = 40


class BlockKind(StrEnum):
    HEADLINE_NUMBERS = "headline-numbers"
    REGION_METRICS = "region-metrics"
    CONFUSION_MATRIX = "confusion-matrix"
    REVIEWER_AGREEMENT = "reviewer-agreement"
    DISAGREEMENT_REASONS = "disagreement-reasons"
    OPINION_ANSWERS = "opinion-answers"
    WORST_OBJECTS = "worst-objects"
    SLIDE_TABLE = "slide-table"
    SLIDE_FIGURE = "slide-figure"
    TEXT = "text"
    COMPARISON = "comparison"


type Metric = Literal["sensitivity", "precision", "dice", "kappa", "cell-agreement"]
type RegionColumn = Literal["sensitivity", "precision", "dice"]
type AgreementPart = Literal["regions", "cells", "form"]
type SlideColumn = Literal["objects", "disagreements", "time"]
type ChartStyle = Literal["bars", "table"]
type Layer = Literal["ai", "reviewed"]
type Download = Literal["pdf", "docx", "html", "decisions", "objects", "geojson", "json"]
type Appendix = Literal["objects", "decisions", "methods"]

type BlockTitle = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
type BlockClassName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
]
type QuestionKey = Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9_]{0,39}$")]
type ObjectId = Annotated[
    str, StringConstraints(pattern=r"^(?:T[1-9][0-9]{0,8}\.)?[TCRZM][1-9][0-9]{0,8}[a-z]{0,3}\+?$")
]
type Rows = Annotated[StrictInt, Field(ge=1, le=500)]


def distinct[T](values: list[T] | None) -> list[T] | None:
    if values is not None and len(set(values)) != len(values):
        raise ValueError("Each value may appear only once")
    return values


class Block(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: BlockTitle
    show_title: StrictBool = True
    width: Literal["full", "half"] = "full"
    page_break: StrictBool = False


class HeadlineNumbers(Block):
    kind: Literal["headline-numbers"]
    metrics: Annotated[list[Metric], Field(min_length=1, max_length=5)]
    confidence_intervals: StrictBool = False

    @model_validator(mode="after")
    def unique(self) -> HeadlineNumbers:
        distinct(self.metrics)
        return self


class RegionMetrics(Block):
    kind: Literal["region-metrics"]
    columns: Annotated[list[RegionColumn], Field(min_length=1, max_length=3)]
    sort_by: RegionColumn = "dice"
    rows: Rows | None = None

    @model_validator(mode="after")
    def unique(self) -> RegionMetrics:
        distinct(self.columns)
        return self


class ConfusionMatrix(Block):
    kind: Literal["confusion-matrix"]
    classes: Annotated[list[BlockClassName], Field(min_length=1, max_length=32)] | None = None
    values: Literal["count", "share"] = "count"

    @model_validator(mode="after")
    def unique(self) -> ConfusionMatrix:
        distinct([name.casefold() for name in self.classes or []])
        return self


class ReviewerAgreement(Block):
    kind: Literal["reviewer-agreement"]
    parts: Annotated[list[AgreementPart], Field(min_length=1, max_length=3)]

    @model_validator(mode="after")
    def unique(self) -> ReviewerAgreement:
        distinct(self.parts)
        return self


class DisagreementReasons(Block):
    kind: Literal["disagreement-reasons"]
    top: Annotated[StrictInt, Field(ge=1, le=50)] | None = None
    style: ChartStyle = "bars"


class OpinionAnswers(Block):
    kind: Literal["opinion-answers"]
    questions: Annotated[list[QuestionKey], Field(min_length=1, max_length=12)] | None = None
    style: ChartStyle = "bars"

    @model_validator(mode="after")
    def unique(self) -> OpinionAnswers:
        distinct(self.questions)
        return self


class WorstObjects(Block):
    kind: Literal["worst-objects"]
    rows: Annotated[StrictInt, Field(ge=1, le=100)] = 10
    thumbnails: StrictBool = True


class SlideTable(Block):
    kind: Literal["slide-table"]
    columns: Annotated[list[SlideColumn], Field(min_length=1, max_length=3)]
    sort_by: SlideColumn = "disagreements"

    @model_validator(mode="after")
    def unique(self) -> SlideTable:
        distinct(self.columns)
        return self


class SlideFigure(Block):
    kind: Literal["slide-figure"]
    slide_id: uuid.UUID | None = None
    object_id: ObjectId | None = None
    layers: Annotated[list[Layer], Field(min_length=1, max_length=2)] = ["ai", "reviewed"]
    caption: Annotated[str, StringConstraints(strip_whitespace=True, max_length=500)] = ""

    @model_validator(mode="after")
    def unique(self) -> SlideFigure:
        distinct(self.layers)
        return self


class TextBlock(Block):
    kind: Literal["text"]
    body: Annotated[str, StringConstraints(strip_whitespace=True, max_length=5000)] = ""


class Comparison(Block):
    kind: Literal["comparison"]
    task_id: uuid.UUID | None = None
    metrics: Annotated[list[Metric], Field(min_length=1, max_length=5)]

    @model_validator(mode="after")
    def unique(self) -> Comparison:
        distinct(self.metrics)
        return self


type ReportBlock = Annotated[
    HeadlineNumbers
    | RegionMetrics
    | ConfusionMatrix
    | ReviewerAgreement
    | DisagreementReasons
    | OpinionAnswers
    | WorstObjects
    | SlideTable
    | SlideFigure
    | TextBlock
    | Comparison,
    Field(discriminator="kind"),
]
type ReportBlocks = Annotated[list[ReportBlock], Field(max_length=MAX_BLOCKS)]
BLOCKS = TypeAdapter(list[ReportBlock])


class ReportFormat(BaseModel):
    model_config = ConfigDict(extra="forbid")

    paper: Literal["a4", "letter"] = "a4"
    orientation: Literal["portrait", "landscape"] = "portrait"
    text_size: Literal["small", "normal", "large"] = "normal"
    logo: StrictBool = True
    title: BlockTitle = "Evaluation report"
    subtitle: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] = (
        "{task} · {model} {version}"
    )
    running_header: StrictBool = True
    page_numbers: Literal["none", "page", "page-of"] = "page-of"
    draft_watermark: StrictBool = True
    signature: StrictBool = True
    label_language: Literal["en", "cs", "de"] = "en"
    decimals: Annotated[StrictInt, Field(ge=0, le=4)] = 2
    appendices: Annotated[list[Appendix], Field(max_length=3)] = ["objects"]
    downloads: Annotated[list[Download], Field(min_length=1, max_length=7)] = [
        "pdf",
        "docx",
        "decisions",
        "objects",
        "geojson",
    ]

    @model_validator(mode="after")
    def unique(self) -> ReportFormat:
        distinct(self.appendices)
        distinct(self.downloads)
        return self


def dumped_blocks(blocks: list[ReportBlock]) -> list[dict[str, Any]]:
    return [block.model_dump(mode="json") for block in blocks]
