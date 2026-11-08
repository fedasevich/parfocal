import json
import statistics
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date

from parfocal_api.evaluation import Evaluation
from parfocal_api.locales import DEFAULT_LOCALE, Locale, day, decimal, translated
from parfocal_common.report_blocks import (
    Comparison,
    ConfusionMatrix,
    DisagreementReasons,
    ExpertChanges,
    HeadlineNumbers,
    OpinionAnswers,
    RegionMetrics,
    ReportBlock,
    ReportFormat,
    ReviewerAgreement,
    SlideFigure,
    SlideTable,
    TextBlock,
    WorstObjects,
)
from parfocal_common.report_layout import ReportPage, report_pages

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
    "report.watermark": "DRAFT",
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
    "report.object": "Object",
    "report.slide": "Slide",
    "report.objects": "Objects",
    "report.disagreements": "Disagreements",
    "report.time": "Review time",
    "report.not_recorded": "Not recorded",
    "report.reviewer": "Reviewer",
    "report.decision": "Decision",
    "report.consensus": "Consensus",
    "report.this_task": "This task",
    "report.layers": "Layers",
    "report.layer.ai": "AI",
    "report.layer.reviewed": "Reviewed",
    "report.figure.image": "The slide image shows on the report page and is not drawn in the PDF.",
    "report.decisions": "Decisions",
    "report.decision.agree": "Agree",
    "report.decision.disagree": "Disagree",
    "report.decision.unsure": "Unsure",
    "report.signature": "Signature",
    "report.signed_by": "Signed by",
    "report.appendix.objects": "Appendix: objects",
    "report.appendix.decisions": "Appendix: decisions",
    "report.appendix.methods": "Appendix: methods",
    "report.methods.style": "Decision style",
    "report.methods.counts_as": "Counts as agree",
    "report.missing": "Not enough data",
    "report.empty.region-metrics": "This task has no regions to measure.",
    "report.empty.confusion-matrix": (
        "This task has no cells, so there are no cell types to compare."
    ),
    "report.empty.reviewer-agreement": (
        "Agreement needs two reviewers who answered the same objects."
    ),
    "report.empty.disagreement-reasons": "No reviewer gave a reason for disagreeing.",
    "report.empty.opinion-answers": "No reviewer answered the opinion form.",
    "report.empty.worst-objects": "No object has a decision yet.",
    "report.empty.slide-table": "No slide in this task has objects to review.",
    "report.empty.slide-figure": "Pick a slide for this figure.",
    "report.empty.text": "This text block is empty.",
    "report.empty.comparison": "Pick a review task to compare with.",
    "report.empty.ai-changes": "Only an annotate task counts how the experts changed the AI.",
    "report.empty.compared-missing": "The review task to compare with is not available.",
    "report.sample": "This report covers a sample of the slides.",
    "report.ai-changes.slide": "Slide",
    "report.ai-changes.ai_objects": "AI objects",
    "report.ai-changes.confirmed": "Confirmed",
    "report.ai-changes.edited": "Edited",
    "report.ai-changes.deleted": "Deleted",
    "report.ai-changes.unchecked": "Unchecked",
    "report.ai-changes.added": "Added",
    "report.ai-changes.by": "By",
    "report.ai-changes.all": "All",
    "report.changes": "Changes after sign-off",
    "report.changes.flag": (
        "Changed after sign-off. The checksum is of the evaluation as signed, "
        "and the numbers include the changes listed at the end."
    ),
    "report.changes.change": "Change",
    "report.changes.by": "Changed by",
    "report.changes.on": "Date",
}

LABELS: Mapping[str, Mapping[str, str]] = {
    "cs": {
        "report.title": "Zpráva o hodnocení",
        "report.project": "Projekt",
        "report.task": "Úloha",
        "report.version": "Verze hodnocení",
        "report.checksum": "Kontrolní součet",
        "report.signed_off": "Podepsáno",
        "report.draft": "Koncept, nepodepsáno",
        "report.watermark": "KONCEPT",
        "report.class": "Třída",
        "report.metric": "Míra",
        "report.value": "Hodnota",
        "report.metric.sensitivity": "Senzitivita",
        "report.metric.precision": "Přesnost",
        "report.metric.dice": "Dice",
        "report.metric.kappa": "Cohenova kappa",
        "report.metric.cell-agreement": "Shoda buněk s AI",
        "report.fleiss_kappa": "Fleissova kappa",
        "report.cell_agreement": "Shoda buněk mezi hodnotiteli",
        "report.reason": "Důvod",
        "report.count": "Počet",
        "report.question": "Otázka",
        "report.answers": "Odpovědi",
        "report.mean": "Průměr",
        "report.object": "Objekt",
        "report.slide": "Sklíčko",
        "report.objects": "Objekty",
        "report.disagreements": "Neshody",
        "report.time": "Doba hodnocení",
        "report.decisions": "Rozhodnutí",
        "report.decision.agree": "Souhlas",
        "report.decision.disagree": "Nesouhlas",
        "report.decision.unsure": "Nejisté",
        "report.signature": "Podpis",
        "report.signed_by": "Podepsal",
    },
    "de": {
        "report.title": "Auswertungsbericht",
        "report.project": "Projekt",
        "report.task": "Aufgabe",
        "report.version": "Version der Auswertung",
        "report.checksum": "Prüfsumme",
        "report.signed_off": "Abgezeichnet",
        "report.draft": "Entwurf, nicht abgezeichnet",
        "report.watermark": "ENTWURF",
        "report.class": "Klasse",
        "report.metric": "Maß",
        "report.value": "Wert",
        "report.metric.sensitivity": "Sensitivität",
        "report.metric.precision": "Präzision",
        "report.metric.dice": "Dice",
        "report.metric.kappa": "Cohens Kappa",
        "report.metric.cell-agreement": "Zellübereinstimmung mit der KI",
        "report.fleiss_kappa": "Fleiss Kappa",
        "report.cell_agreement": "Zellübereinstimmung der Begutachter",
        "report.reason": "Grund",
        "report.count": "Anzahl",
        "report.question": "Frage",
        "report.answers": "Antworten",
        "report.mean": "Mittelwert",
        "report.object": "Objekt",
        "report.slide": "Schnitt",
        "report.objects": "Objekte",
        "report.disagreements": "Abweichungen",
        "report.time": "Begutachtungszeit",
        "report.decisions": "Entscheidungen",
        "report.decision.agree": "Zustimmung",
        "report.decision.disagree": "Ablehnung",
        "report.decision.unsure": "Unsicher",
        "report.signature": "Unterschrift",
        "report.signed_by": "Unterschrieben von",
    },
}
COMMA_LANGUAGES = frozenset({"cs", "de"})
TEXT_SIZES: Mapping[str, str] = {"small": "8pt", "normal": "9pt", "large": "10.5pt"}
PAGE_NUMBERING: Mapping[str, str] = {"page": '"1"', "page-of": '"1 / 1"'}


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


@dataclass(frozen=True)
class ReportObject:
    object_id: str
    slide: str
    kind: str
    class_name: str
    agree: int
    disagree: int
    unsure: int
    consensus: str


@dataclass(frozen=True)
class ReportDecision:
    object_id: str
    reviewer: str
    decision: str


@dataclass(frozen=True)
class ReportChange:
    object_id: str
    slide: str
    change: str
    reason: str
    by: str
    on: date


@dataclass(frozen=True)
class ReportAiChange:
    name: str
    ai_objects: int
    confirmed: int
    edited: int
    deleted: int
    unchecked: int
    added: int
    by: str = ""


@dataclass(frozen=True)
class ReportAiChanges:
    classes: tuple[ReportAiChange, ...]
    slides: tuple[ReportAiChange, ...]
    total: ReportAiChange


@dataclass(frozen=True)
class ReportCompared:
    task_name: str
    headline: Mapping[str, float | None]


EVERY_BLOCK: tuple[ReportBlock, ...] = (
    HeadlineNumbers(kind="headline-numbers", title="Headline", metrics=list(METRICS)),
    RegionMetrics(kind="region-metrics", title="Regions", columns=["sensitivity", "precision"]),
    ConfusionMatrix(kind="confusion-matrix", title="Cells"),
    ReviewerAgreement(kind="reviewer-agreement", title="Agreement", parts=["regions", "cells"]),
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
    format: ReportFormat = field(default_factory=ReportFormat)
    objects: tuple[ReportObject, ...] = ()
    decision_rows: tuple[ReportDecision, ...] = ()
    compared: Mapping[str, ReportCompared] = field(default_factory=dict[str, ReportCompared])
    decision_style: str = ""
    counts_as: tuple[str, ...] = ()
    signed_by: str = ""
    changes: tuple[ReportChange, ...] = ()
    ai_changes: ReportAiChanges | None = None
    review: bool = True


@dataclass(frozen=True)
class RenderedReport:
    locale: Locale
    source: str
    inputs: dict[str, str]
    pages: tuple[ReportPage, ...] = ()


def headline_of(evaluation: Evaluation) -> dict[str, float | None]:
    regions = next((item for item in evaluation.overall if item.kind == "region"), None)
    dice = [found.value for found in evaluation.dice.values() if found.value is not None]
    return {
        "sensitivity": regions.sensitivity.value if regions else None,
        "precision": regions.precision.value if regions else None,
        "dice": statistics.fmean(dice) if dice else None,
        "kappa": evaluation.mean_kappa,
        "cell-agreement": evaluation.cell_agreement_with_ai.value,
    }


def report_data(
    evaluation: Evaluation,
    project_name: str,
    task_name: str,
    version: int,
    signed_off_on: date | None,
    checksum: str = "",
    blocks: tuple[ReportBlock, ...] = EVERY_BLOCK,
    report_format: ReportFormat | None = None,
) -> ReportData:
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
        headline=headline_of(evaluation),
        cell_agreement=evaluation.cell_agreement_between_reviewers.value,
        reasons=tuple(evaluation.reasons),
        opinions=tuple(
            ReportOpinion(key=found.key, count=found.count, mean=found.mean)
            for found in evaluation.opinions
        ),
        blocks=blocks,
        format=report_format or ReportFormat(),
        decision_style=str(evaluation.decisions.style),
        counts_as=tuple(str(value) for value in evaluation.decisions.counts_as),
    )


def typst_text(value: str) -> str:
    escaped = value.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return '#"' + escaped + '"'


def report_messages(data: ReportData, locale: Locale) -> Mapping[str, str]:
    if locale is not DEFAULT_LOCALE:
        return translated(REPORT_MESSAGES, locale)
    return {**REPORT_MESSAGES, **LABELS.get(data.format.label_language, {})}


def number_text(data: ReportData, locale: Locale) -> Callable[[float], str]:
    places = data.format.decimals

    def shown(value: float) -> str:
        text = decimal(value, places, locale)
        if locale is DEFAULT_LOCALE and data.format.label_language in COMMA_LANGUAGES:
            return text.replace(".", ",")
        return text

    return shown


def day_text(data: ReportData, value: date, locale: Locale) -> str:
    if locale is DEFAULT_LOCALE and data.format.label_language in COMMA_LANGUAGES:
        return f"{value.day:02d}.{value.month:02d}.{value.year}"
    return day(value, locale)


def worst_first(objects: Sequence[ReportObject]) -> list[ReportObject]:
    return sorted(objects, key=lambda found: (-found.disagree, -found.unsure, found.object_id))


def slide_counts(objects: Sequence[ReportObject]) -> dict[str, tuple[int, int]]:
    counts: dict[str, tuple[int, int]] = {}
    for found in objects:
        total, disagreeing = counts.get(found.slide, (0, 0))
        counts[found.slide] = (total + 1, disagreeing + (1 if found.disagree else 0))
    return counts


def page_setup(data: ReportData, messages: Mapping[str, str]) -> list[str]:
    shape = data.format
    numbering = PAGE_NUMBERING.get(shape.page_numbers, "none")
    header = (
        f"[#text(size: 7pt)[{typst_text(data.task_name)} #h(1fr) "
        f"{typst_text(messages['report.version'])} {typst_text(str(data.version))}]]"
        if shape.running_header
        else "none"
    )
    watermark = (
        "rotate(-30deg, text(size: 64pt, fill: luma(225))"
        f"[{typst_text(messages['report.watermark'])}])"
        if shape.draft_watermark and data.signed_off_on is None
        else "none"
    )
    return [
        f'#set page(paper: "{"us-letter" if shape.paper == "letter" else "a4"}", '
        f"flipped: {'true' if shape.orientation == 'landscape' else 'false'}, "
        f"margin: 2cm, numbering: {numbering}, header: {header}, background: {watermark})",
        f"#set text(size: {TEXT_SIZES[shape.text_size]})",
        "#set table(inset: 3pt)",
        "",
    ]


def render_report(data: ReportData, locale: Locale = DEFAULT_LOCALE) -> RenderedReport:
    messages = report_messages(data, locale)
    number = number_text(data, locale)

    def share(value: float | None) -> str:
        return messages["report.missing"] if value is None else number(value)

    def row(*cells: str) -> str:
        return "  " + ", ".join(f"[{typst_text(cell)}]" for cell in cells) + ","

    def said(key: str) -> list[str]:
        return [typst_text(messages[key])]

    def table(header: tuple[str, ...], rows: list[tuple[str, ...]], empty: str) -> list[str]:
        if not rows:
            return said(empty)
        return [f"#table(columns: {len(header)},", row(*header), *(row(*r) for r in rows), ")"]

    def classes(kind: str, columns: list[str], empty: str, keep: Sequence[str] | None) -> list[str]:
        wanted = {name.casefold() for name in keep} if keep else None
        found = [
            item
            for item in data.classes
            if item.kind == kind and (wanted is None or item.name.casefold() in wanted)
        ]
        return table(
            (messages["report.class"], *(messages[f"report.metric.{name}"] for name in columns)),
            [(item.name, *(share(getattr(item, name)) for name in columns)) for item in found],
            empty,
        )

    def headline(block: HeadlineNumbers) -> list[str]:
        return table(
            (messages["report.metric"], messages["report.value"]),
            [
                (messages[f"report.metric.{name}"], share(data.headline.get(name)))
                for name in block.metrics
            ],
            "report.missing",
        )

    def regions(block: RegionMetrics) -> list[str]:
        found = [item for item in data.classes if item.kind == "region"]
        ordered = sorted(found, key=lambda item: -(getattr(item, block.sort_by) or -1.0))
        shown = ordered[: block.rows] if block.rows else ordered
        return table(
            (
                messages["report.class"],
                *(messages[f"report.metric.{name}"] for name in block.columns),
            ),
            [
                (item.name, *(share(getattr(item, name)) for name in block.columns))
                for item in shown
            ],
            "report.empty.region-metrics",
        )

    def agreement(block: ReviewerAgreement) -> list[str]:
        values: list[tuple[str, float | None]] = []
        if "regions" in block.parts or "form" in block.parts:
            values += [
                (messages["report.fleiss_kappa"], data.fleiss_kappa),
                (messages["report.metric.kappa"], data.headline.get("kappa")),
            ]
        if "cells" in block.parts:
            values.append((messages["report.cell_agreement"], data.cell_agreement))
        if all(value is None for _, value in values):
            return said("report.empty.reviewer-agreement")
        return table(
            (messages["report.metric"], messages["report.value"]),
            [(name, share(value)) for name, value in values],
            "report.empty.reviewer-agreement",
        )

    def reasons(block: DisagreementReasons) -> list[str]:
        shown = data.reasons[: block.top] if block.top else data.reasons
        return table(
            (messages["report.reason"], messages["report.count"]),
            [(reason, str(count)) for reason, count in shown],
            "report.empty.disagreement-reasons",
        )

    def opinions(block: OpinionAnswers) -> list[str]:
        return table(
            (messages["report.question"], messages["report.answers"], messages["report.mean"]),
            [
                (found.key, str(found.count), share(found.mean))
                for found in data.opinions
                if block.questions is None or found.key in block.questions
            ],
            "report.empty.opinion-answers",
        )

    def object_cells(found: ReportObject, full: bool) -> tuple[str, ...]:
        name = found.object_id if full else found.object_id.rsplit("/", 1)[-1]
        return (
            name,
            found.class_name,
            str(found.agree),
            str(found.disagree),
            str(found.unsure),
            found.consensus,
        )

    object_header = (
        messages["report.object"],
        messages["report.class"],
        messages["report.decision.agree"],
        messages["report.decision.disagree"],
        messages["report.decision.unsure"],
        messages["report.consensus"],
    )

    def worst(block: WorstObjects) -> list[str]:
        decided = [found for found in data.objects if found.agree + found.disagree + found.unsure]
        return table(
            object_header,
            [object_cells(found, False) for found in worst_first(decided)[: block.rows]],
            "report.empty.worst-objects",
        )

    def slide_table(block: SlideTable) -> list[str]:
        counts = slide_counts(data.objects)
        sort_index = {"objects": 0, "disagreements": 1}.get(block.sort_by)
        labels = sorted(counts)
        if sort_index is not None:
            labels = sorted(labels, key=lambda label: -counts[label][sort_index])
        names = {
            "objects": messages["report.objects"],
            "disagreements": messages["report.disagreements"],
            "time": messages["report.time"],
        }

        def cell(label: str, column: str) -> str:
            if column == "time":
                return messages["report.not_recorded"]
            return str(counts[label][0 if column == "objects" else 1])

        return table(
            (messages["report.slide"], *(names[column] for column in block.columns)),
            [(label, *(cell(label, column) for column in block.columns)) for label in labels],
            "report.empty.slide-table",
        )

    def figure(block: SlideFigure) -> list[str]:
        if block.slide_id is None:
            return said("report.empty.slide-figure")
        layers = ", ".join(typst_text(messages[f"report.layer.{layer}"]) for layer in block.layers)
        target = f"{block.slide_id}" + (f" · {block.object_id}" if block.object_id else "")
        return [
            f"{typst_text(messages['report.slide'])}: {typst_text(target)} \\",
            f"{typst_text(messages['report.layers'])}: {layers} \\",
            *([f"{typst_text(block.caption)} \\"] if block.caption else []),
            *said("report.figure.image"),
        ]

    def text(block: TextBlock) -> list[str]:
        return [typst_text(block.body)] if block.body else said("report.empty.text")

    def comparison(block: Comparison) -> list[str]:
        if block.task_id is None:
            return said("report.empty.comparison")
        other = data.compared.get(str(block.task_id))
        if other is None:
            return said("report.empty.compared-missing")
        return table(
            (messages["report.metric"], messages["report.this_task"], other.task_name),
            [
                (
                    messages[f"report.metric.{name}"],
                    share(data.headline.get(name)),
                    share(other.headline.get(name)),
                )
                for name in block.metrics
            ],
            "report.missing",
        )

    def ai_changes(block: ExpertChanges) -> list[str]:
        found = data.ai_changes
        if found is None:
            return said("report.empty.ai-changes")
        columns = ("ai_objects", "confirmed", "edited", "deleted", "unchecked", "added")
        named = "report.ai-changes.slide" if block.group_by == "slide" else "report.class"
        header = (
            messages[named],
            *(messages[f"report.ai-changes.{column}"] for column in columns),
            *([messages["report.ai-changes.by"]] if block.people else []),
        )

        def cells(item: ReportAiChange, name: str) -> tuple[str, ...]:
            counted = tuple(str(getattr(item, column)) for column in columns)
            return (name, *counted, *([item.by] if block.people else []))

        rows = found.slides if block.group_by == "slide" else found.classes
        if not rows:
            return said("report.empty.ai-changes")
        return table(
            header,
            [
                *(cells(item, item.name) for item in rows),
                cells(found.total, messages["report.ai-changes.all"]),
            ],
            "report.empty.ai-changes",
        )

    def body_of(block: ReportBlock) -> list[str]:
        match block:
            case HeadlineNumbers():
                return headline(block)
            case RegionMetrics():
                return regions(block)
            case ConfusionMatrix():
                return classes(
                    "cell",
                    ["sensitivity", "precision"],
                    "report.empty.confusion-matrix",
                    block.classes,
                )
            case ReviewerAgreement():
                return agreement(block)
            case DisagreementReasons():
                return reasons(block)
            case OpinionAnswers():
                return opinions(block)
            case WorstObjects():
                return worst(block)
            case SlideTable():
                return slide_table(block)
            case SlideFigure():
                return figure(block)
            case TextBlock():
                return text(block)
            case Comparison():
                return comparison(block)
            case ExpertChanges():
                return ai_changes(block)

    def block_lines(block: ReportBlock) -> list[str]:
        title = [f"== {typst_text(block.title)}"] if block.show_title else []
        return [*title, *body_of(block), ""]

    def row_lines(indices: tuple[int, ...]) -> list[str]:
        if len(indices) == 1:
            return block_lines(data.blocks[indices[0]])
        cells = ["[\n" + "\n".join(block_lines(data.blocks[index])) + "\n]" for index in indices]
        return [f"#grid(columns: (1fr, 1fr), column-gutter: 14pt, {', '.join(cells)})", ""]

    def closing() -> list[str]:
        lines = (
            [
                f"== {typst_text(messages['report.decisions'])}",
                *table(
                    (messages["report.decisions"], messages["report.count"]),
                    [
                        (messages[f"report.decision.{key}"], str(data.decisions.get(key, 0)))
                        for key in DECISIONS
                    ],
                    "report.missing",
                ),
                "",
            ]
            if data.review
            else []
        )
        if data.changes:
            lines += [
                f"== {typst_text(messages['report.changes'])}",
                *table(
                    (
                        messages["report.object"],
                        messages["report.slide"],
                        messages["report.changes.change"],
                        messages["report.reason"],
                        messages["report.changes.by"],
                        messages["report.changes.on"],
                    ),
                    [
                        (
                            change.object_id,
                            change.slide,
                            change.change,
                            change.reason,
                            change.by,
                            day_text(data, change.on, locale),
                        )
                        for change in data.changes
                    ],
                    "report.missing",
                ),
                "",
            ]
        if data.format.signature:
            signer = data.signed_by or "_" * 24
            lines += [
                f"== {typst_text(messages['report.signature'])}",
                f"{typst_text(messages['report.signed_by'])}: {typst_text(signer)} \\",
                signed,
                "",
            ]
        return lines

    def appendix(name: str) -> list[str]:
        lines = [f"== {typst_text(messages[f'report.appendix.{name}'])}"]
        if name == "objects":
            lines += table(
                object_header,
                [object_cells(found, True) for found in data.objects],
                "report.empty.worst-objects",
            )
        elif name == "decisions":
            lines += table(
                (
                    messages["report.object"],
                    messages["report.reviewer"],
                    messages["report.decision"],
                ),
                [(item.object_id, item.reviewer, item.decision) for item in data.decision_rows],
                "report.empty.worst-objects",
            )
        else:
            lines += [
                f"{typst_text(messages['report.methods.style'])}: "
                f"{typst_text(data.decision_style or messages['report.not_recorded'])} \\",
                f"{typst_text(messages['report.methods.counts_as'])}: "
                f"{typst_text(', '.join(data.counts_as) or messages['report.not_recorded'])}",
            ]
        return [*lines, ""]

    def page_lines(page: ReportPage) -> list[str]:
        if page.appendix is not None:
            return appendix(page.appendix)
        lines = [line for indices in page.rows for line in row_lines(indices)]
        return [*lines, *(closing() if page.closing else [])]

    signed = (
        f"{typst_text(messages['report.signed_off'])}: "
        f"{typst_text(day_text(data, data.signed_off_on, locale))}"
        if data.signed_off_on
        else typst_text(messages["report.draft"])
    )
    title = (
        messages["report.title"] if data.format.title == ReportFormat().title else data.format.title
    )
    pages = tuple(report_pages(data.blocks, data.format))
    body: list[str] = []
    for at, page in enumerate(pages):
        if at:
            body += ["#pagebreak()", ""]
        body += page_lines(page)
    lines = [
        *page_setup(data, messages),
        f"= {typst_text(title)}",
        "",
        f"{typst_text(messages['report.project'])}: {typst_text(data.project_name)} \\",
        f"{typst_text(messages['report.task'])}: {typst_text(data.task_name)} \\",
        f"{typst_text(messages['report.version'])}: {typst_text(str(data.version))} \\",
        f"{typst_text(messages['report.checksum'])}: {typst_text(data.checksum)} \\",
        signed,
        *(["", typst_text(messages["report.changes.flag"])] if data.changes else []),
        *(["", typst_text(messages["report.sample"])] if data.sample else []),
        "",
        *body,
    ]
    return RenderedReport(
        locale=locale,
        source="\n".join(lines),
        inputs={"locale": str(locale), "messages": json.dumps(dict(messages), ensure_ascii=False)},
        pages=pages,
    )
