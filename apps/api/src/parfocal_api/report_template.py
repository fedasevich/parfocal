import json
import statistics
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import date

from parfocal_api.evaluation import Evaluation
from parfocal_api.locales import DEFAULT_LOCALE, Locale, day, decimal, translated
from parfocal_common.report_blocks import (
    Comparison,
    ConfusionMatrix,
    DisagreementReasons,
    HeadlineNumbers,
    OpinionAnswers,
    RegionMetrics,
    ReportBlock,
    ReviewerAgreement,
    SlideFigure,
    SlideTable,
    TextBlock,
    WorstObjects,
)

DECISIONS = ("agree", "disagree", "unsure")
METRICS = ("sensitivity", "precision", "dice", "kappa", "cell-agreement")

REPORT_MESSAGES: Mapping[str, str] = {
    "report.title": "Evaluation report",
    "report.project": "Project",
    "report.task": "Task",
    "report.version": "Evaluation version",
    "report.checksum": "Checksum",
    "report.signed_off": "Signed off",
    "report.draft": "Draft, not signed off",
    "report.class": "Class",
    "report.metric": "Measure",
    "report.value": "Value",
    "report.metric.sensitivity": "Sensitivity",
    "report.metric.precision": "Precision",
    "report.metric.dice": "Dice",
    "report.metric.kappa": "Cohen kappa",
    "report.metric.cell-agreement": "Cell agreement with the AI",
    "report.fleiss_kappa": "Fleiss kappa",
    "report.cell_agreement": "Cell agreement between reviewers",
    "report.reason": "Reason",
    "report.count": "Count",
    "report.question": "Question",
    "report.answers": "Answers",
    "report.mean": "Mean",
    "report.decisions": "Decisions",
    "report.decision.agree": "Agree",
    "report.decision.disagree": "Disagree",
    "report.decision.unsure": "Unsure",
    "report.missing": "Not enough data",
    "report.empty": "Nothing to show in this task.",
    "report.web_only": "This block shows on the report page and is not in the PDF yet.",
    "report.sample": "This report covers a sample of the slides.",
}


@dataclass(frozen=True)
class ReportClass:
    kind: str
    name: str
    sensitivity: float | None
    precision: float | None
    dice: float | None = None


@dataclass(frozen=True)
class ReportOpinion:
    key: str
    count: int
    mean: float | None


EVERY_BLOCK: tuple[ReportBlock, ...] = (
    HeadlineNumbers(kind="headline-numbers", title="Headline", metrics=list(METRICS)),
    RegionMetrics(kind="region-metrics", title="Regions", columns=["sensitivity", "precision"]),
    ConfusionMatrix(kind="confusion-matrix", title="Cells"),
    ReviewerAgreement(kind="reviewer-agreement", title="Agreement", parts=["regions"]),
    DisagreementReasons(kind="disagreement-reasons", title="Reasons"),
    OpinionAnswers(kind="opinion-answers", title="Opinions"),
    WorstObjects(kind="worst-objects", title="Worst"),
    SlideTable(kind="slide-table", title="Slides", columns=["objects"]),
    SlideFigure(kind="slide-figure", title="Figure"),
    TextBlock(kind="text", title="Methods", body="METHODS-SENTINEL"),
    Comparison(kind="comparison", title="Comparison", metrics=["sensitivity"]),
)


@dataclass(frozen=True)
class ReportData:
    project_name: str
    task_name: str
    version: int
    checksum: str
    signed_off_on: date | None
    sample: bool
    classes: tuple[ReportClass, ...]
    fleiss_kappa: float | None
    decisions: Mapping[str, int]
    headline: Mapping[str, float | None] = field(default_factory=dict[str, float | None])
    cell_agreement: float | None = None
    reasons: tuple[tuple[str, int], ...] = ()
    opinions: tuple[ReportOpinion, ...] = ()
    blocks: tuple[ReportBlock, ...] = EVERY_BLOCK


@dataclass(frozen=True)
class RenderedReport:
    locale: Locale
    source: str
    inputs: dict[str, str]


def report_data(
    evaluation: Evaluation,
    project_name: str,
    task_name: str,
    version: int,
    signed_off_on: date | None,
    checksum: str = "",
    blocks: tuple[ReportBlock, ...] = EVERY_BLOCK,
) -> ReportData:
    regions = next((item for item in evaluation.overall if item.kind == "region"), None)
    dice = [found.value for found in evaluation.dice.values() if found.value is not None]
    return ReportData(
        project_name=project_name,
        task_name=task_name,
        version=version,
        checksum=checksum,
        signed_off_on=signed_off_on,
        sample=evaluation.sample,
        classes=tuple(
            ReportClass(
                kind=found.kind,
                name=found.class_name,
                sensitivity=found.sensitivity.value,
                precision=found.precision.value,
                dice=evaluation.dice[found.class_name].value
                if found.kind == "region" and found.class_name in evaluation.dice
                else None,
            )
            for found in evaluation.classes
        ),
        fleiss_kappa=evaluation.fleiss_kappa,
        decisions={str(key): count for key, count in evaluation.decisions.counted.items()},
        headline={
            "sensitivity": regions.sensitivity.value if regions else None,
            "precision": regions.precision.value if regions else None,
            "dice": statistics.fmean(dice) if dice else None,
            "kappa": evaluation.mean_kappa,
            "cell-agreement": evaluation.cell_agreement_with_ai.value,
        },
        cell_agreement=evaluation.cell_agreement_between_reviewers.value,
        reasons=tuple(evaluation.reasons),
        opinions=tuple(
            ReportOpinion(key=found.key, count=found.count, mean=found.mean)
            for found in evaluation.opinions
        ),
        blocks=blocks,
    )


def typst_text(value: str) -> str:
    return '#"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_report(data: ReportData, locale: Locale = DEFAULT_LOCALE) -> RenderedReport:
    messages = translated(REPORT_MESSAGES, locale)

    def share(value: float | None) -> str:
        return messages["report.missing"] if value is None else decimal(value, 2, locale)

    def row(*cells: str) -> str:
        return "  " + ", ".join(f"[{typst_text(cell)}]" for cell in cells) + ","

    def table(header: tuple[str, ...], rows: list[tuple[str, ...]]) -> list[str]:
        if not rows:
            return [typst_text(messages["report.empty"])]
        return [f"#table(columns: {len(header)},", row(*header), *(row(*r) for r in rows), ")"]

    def classes(kind: str, columns: list[str]) -> list[str]:
        return table(
            (messages["report.class"], *(messages[f"report.metric.{name}"] for name in columns)),
            [
                (found.name, *(share(getattr(found, name)) for name in columns))
                for found in data.classes
                if found.kind == kind
            ],
        )

    def headline(block: HeadlineNumbers) -> list[str]:
        return table(
            (messages["report.metric"], messages["report.value"]),
            [
                (messages[f"report.metric.{name}"], share(data.headline.get(name)))
                for name in block.metrics
            ],
        )

    def agreement(_: ReviewerAgreement) -> list[str]:
        return table(
            (messages["report.metric"], messages["report.value"]),
            [
                (messages["report.fleiss_kappa"], share(data.fleiss_kappa)),
                (messages["report.metric.kappa"], share(data.headline.get("kappa"))),
                (messages["report.cell_agreement"], share(data.cell_agreement)),
            ],
        )

    def reasons(block: DisagreementReasons) -> list[str]:
        shown = data.reasons[: block.top] if block.top else data.reasons
        return table(
            (messages["report.reason"], messages["report.count"]),
            [(reason, str(count)) for reason, count in shown],
        )

    def opinions(block: OpinionAnswers) -> list[str]:
        return table(
            (messages["report.question"], messages["report.answers"], messages["report.mean"]),
            [
                (found.key, str(found.count), share(found.mean))
                for found in data.opinions
                if block.questions is None or found.key in block.questions
            ],
        )

    def text(block: TextBlock) -> list[str]:
        return [typst_text(block.body)] if block.body else [typst_text(messages["report.empty"])]

    def block_lines(block: ReportBlock) -> list[str]:
        title = [f"== {typst_text(block.title)}"] if block.show_title else []
        match block:
            case HeadlineNumbers():
                body = headline(block)
            case RegionMetrics():
                body = classes("region", list(block.columns))
            case ConfusionMatrix():
                body = classes("cell", ["sensitivity", "precision"])
            case ReviewerAgreement():
                body = agreement(block)
            case DisagreementReasons():
                body = reasons(block)
            case OpinionAnswers():
                body = opinions(block)
            case TextBlock():
                body = text(block)
            case _:
                body = [typst_text(messages["report.web_only"])]
        return [*title, *body, ""]

    signed = (
        f"{typst_text(messages['report.signed_off'])}: "
        f"{typst_text(day(data.signed_off_on, locale))}"
        if data.signed_off_on
        else typst_text(messages["report.draft"])
    )
    lines = [
        f"= {typst_text(messages['report.title'])}",
        "",
        f"{typst_text(messages['report.project'])}: {typst_text(data.project_name)} \\",
        f"{typst_text(messages['report.task'])}: {typst_text(data.task_name)} \\",
        f"{typst_text(messages['report.version'])}: {typst_text(str(data.version))} \\",
        f"{typst_text(messages['report.checksum'])}: {typst_text(data.checksum)} \\",
        signed,
        *(["", typst_text(messages["report.sample"])] if data.sample else []),
        "",
        *(line for block in data.blocks for line in block_lines(block)),
        f"== {typst_text(messages['report.decisions'])}",
        *table(
            (messages["report.decisions"], messages["report.count"]),
            [
                (messages[f"report.decision.{key}"], str(data.decisions.get(key, 0)))
                for key in DECISIONS
            ],
        ),
        "",
    ]
    return RenderedReport(
        locale=locale,
        source="\n".join(lines),
        inputs={"locale": str(locale), "messages": json.dumps(dict(messages), ensure_ascii=False)},
    )
