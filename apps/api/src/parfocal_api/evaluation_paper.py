from __future__ import annotations

import json
import math
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING, Literal, cast
from zoneinfo import ZoneInfo

from parfocal_api.decision_styles import CountsAsChange, DecisionSettings
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

if TYPE_CHECKING:
    from parfocal_api.disagreement_queue import QueueRow
    from parfocal_api.evaluation import ClassMetrics, Evaluation
    from parfocal_api.evaluation_report import EvaluationReport
    from parfocal_api.evaluation_versions import EvaluationChange

StyleKind = Literal["agree", "yesno", "certainty", "blind"]
HEADLINE_METRICS = ("sensitivity", "precision", "dice", "kappa", "cell-agreement")
PERSON_METRICS = ("kappa",)
METRIC_NAMES = {"sensitivity": "Sensitivity", "precision": "Precision", "dice": "Dice"}
REASON_LABELS = {
    "wrong_class": "Wrong cell type",
    "boundary_off": "Boundary is off",
    "not_class": "Not tumor",
    "artefact": "Artefact or fold",
    "two_regions": "Two regions, not one",
    "not_a_cell": "Not a cell",
}
SCORE_LABELS = {"1": "1 · unusable", "5": "5 · sign as is"}
STYLE_NAMES = {
    "certainty": "5-point certainty",
    "agree": "Agree with the AI",
    "yesno": "Yes or no",
    "blind": "Pick the class blind",
}
KIND_OF_API: Mapping[str, StyleKind] = {
    "certainty": "certainty",
    "agree": "agree",
    "yes-no": "yesno",
    "blind": "blind",
}
ANSWER_NAMES = {
    "unsure": "Not sure",
    "agree": "Agree",
    "disagree": "Disagree",
    "yes": "Yes",
    "no": "No",
    "class": "A class picked",
}
COUNT_WORDS = {"agree": "agree", "disagree": "disagree", "unsure": "not sure"}
ANSWER_WORDS = {"agree": "Agree", "disagree": "Disagree", "unsure": "Not sure"}
CERTAINTY_LABELS = ("Certainly not", "Probably not", "Can't tell", "Probably", "Certainly")
FIXED_RULES = {
    "ai": {
        "agree": "Each answer counts as it reads. Not sure stays not sure.",
        "yesno": "An answer that matches the AI's claim counts as agree, the other as disagree. "
        "Not sure stays not sure.",
        "blind": "The same class as the AI's counts as agree, another class as disagree. "
        "Not sure stays not sure.",
    },
    "drawn": {
        "agree": "Each answer counts as it reads. Not sure stays not sure.",
        "yesno": "An answer that matches the drawn outline's type counts as agree, the other "
        "as disagree. Not sure stays not sure.",
        "blind": "The same class as the drawn outline's counts as agree, another class as "
        "disagree. Not sure stays not sure.",
    },
}
AGREE_WITH = {"ai": "agree with the AI", "drawn": "agree with the drawn outline"}
DRAWN_EMPTY = "This task reviews drawn outlines, so no AI result is scored."


@dataclass(frozen=True)
class ReviewStyle:
    kind: StyleKind = "agree"
    agree_from: int = 4
    disagree_to: int = 2


@dataclass(frozen=True)
class Tiles:
    tiles: tuple[tuple[str, str], ...]


@dataclass(frozen=True)
class Table:
    head: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]
    mono_first: bool = False


@dataclass(frozen=True)
class ObjectsTable:
    people: tuple[str, ...]
    rows: tuple[tuple[str, str, tuple[str, ...]], ...]


@dataclass(frozen=True)
class Matrix:
    classes: tuple[str, ...]
    counts: tuple[tuple[int, ...], ...]
    caption: str


@dataclass(frozen=True)
class Bars:
    heading: str | None
    rows: tuple[tuple[str, int], ...]


@dataclass(frozen=True)
class Lines:
    lines: tuple[str, ...]
    gap: int = 0


@dataclass(frozen=True)
class Note:
    text: str


@dataclass(frozen=True)
class Empty:
    text: str


@dataclass(frozen=True)
class Figure:
    caption: str


@dataclass(frozen=True)
class ChangeRows:
    rows: tuple[tuple[str, str, str, str], ...]


Part = Tiles | Table | ObjectsTable | Matrix | Bars | Lines | Note | Empty | Figure | ChangeRows


@dataclass(frozen=True)
class Section:
    title: str | None
    parts: tuple[Part, ...]
    half: bool = False


@dataclass(frozen=True)
class Letterhead:
    lab_name: str
    lab_short: str
    kind: str
    title: str
    lines: tuple[str, ...]


@dataclass(frozen=True)
class Sheet:
    footer: str
    numbering: str | None
    header: str | None
    watermark: str | None
    letterhead: Letterhead | None
    facts: tuple[tuple[str, str], ...]
    sections: tuple[Section, ...]


@dataclass(frozen=True)
class Paper:
    sheets: tuple[Sheet, ...]
    letter: bool
    landscape: bool
    checksum: str


@dataclass(frozen=True)
class Compared:
    report: EvaluationReport
    evaluation: Evaluation


@dataclass(frozen=True)
class PaperInputs:
    report: EvaluationReport
    evaluation: Evaluation | None
    queue: Sequence[QueueRow]
    changes: Sequence[EvaluationChange]
    blocks: Sequence[ReportBlock]
    format: ReportFormat
    template_version: int
    names: Mapping[str, str]
    style: ReviewStyle = field(default_factory=ReviewStyle)
    counts_as_changes: Sequence[CountsAsChange] = ()
    compared: Mapping[str, Compared] = field(default_factory=dict[str, Compared])
    checksum: str = ""
    zone: ZoneInfo | None = None


def fixed(value: float | int | None, decimals: int = 2) -> str:
    if value is None:
        return "n/a"
    step = Decimal(1).scaleb(-decimals)
    return str(Decimal(value).quantize(step, rounding=ROUND_HALF_UP))


def rounded(value: float) -> int:
    return math.floor(value + 0.5)


def percent(value: float | None) -> str:
    return "n/a" if value is None else f"{rounded(value * 100)}%"


def counted(count: int, one: str, other: str) -> str:
    return f"{count} {one if count == 1 else other}"


def style_of(settings: DecisionSettings | None) -> ReviewStyle:
    if settings is None:
        return ReviewStyle()
    mapping = [str(value) for value in settings.counts_as]
    agree = mapping.index("agree") + 1 if "agree" in mapping else 4
    disagree = len(mapping) - mapping[::-1].index("disagree") if "disagree" in mapping else 2
    kind = KIND_OF_API[str(settings.style)]
    return ReviewStyle(kind=kind, agree_from=agree, disagree_to=disagree)


def counts_as(style: ReviewStyle, raw: str, ai_class: str) -> str:
    if raw == "unsure":
        return "unsure"
    if style.kind == "agree":
        return "disagree" if raw == "disagree" else "agree"
    if style.kind == "yesno":
        return "agree" if raw == "yes" else "disagree"
    if style.kind == "blind":
        return "agree" if raw == ai_class else "disagree"
    value = int(raw) if raw.isdigit() else 0
    if value >= style.agree_from:
        return "agree"
    if value <= style.disagree_to:
        return "disagree"
    return "unsure"


def styled_word(style: ReviewStyle, raw: str, ai_class: str) -> str:
    if style.kind == "certainty" and raw in {"1", "2", "3", "4", "5"}:
        return f"{raw} · {CERTAINTY_LABELS[int(raw) - 1]}"
    if style.kind == "agree" and raw in ANSWER_WORDS:
        return ANSWER_WORDS[raw]
    if style.kind == "yesno" and raw in {"yes", "no", "unsure"}:
        return {"yes": "Yes", "no": "No", "unsure": "Not sure"}[raw]
    if style.kind == "blind" and raw == "unsure":
        return "Not sure"
    return ANSWER_WORDS[counts_as(style, raw, ai_class)]


def number_list(values: list[int]) -> str:
    if len(values) == 1:
        return str(values[0])
    if len(values) == 2:
        return f"{values[0]} and {values[1]}"
    return f"{values[0]} to {values[-1]}"


def counts_as_rule(style: ReviewStyle, source: str) -> str:
    if style.kind != "certainty":
        return FIXED_RULES[source][style.kind]
    agree = list(range(style.agree_from, 6))
    unsure = list(range(style.disagree_to + 1, style.agree_from))
    disagree = list(range(1, style.disagree_to + 1))
    middle = f"{number_list(unsure)} as not sure, and " if unsure else "and "
    tail = "" if unsure else " No answer counts as not sure."
    verb = "counts" if len(agree) == 1 else "count"
    return (
        f"{number_list(agree)} {verb} as {AGREE_WITH[source]}, {middle}"
        f"{number_list(disagree)} as disagree.{tail}"
    )


def headline_tiles(
    evaluation: Evaluation, metrics: Sequence[str], decimals: int
) -> tuple[tuple[str, str], ...]:
    region = next((row for row in evaluation.overall if row.kind == "region"), None) or (
        evaluation.overall[0] if evaluation.overall else None
    )
    dice = next(iter(evaluation.dice.values()), None)
    tiles = {
        "sensitivity": (
            fixed(region.sensitivity.value if region else None, decimals),
            "Sensitivity, regions",
        ),
        "precision": (
            fixed(region.precision.value if region else None, decimals),
            "Precision, regions",
        ),
        "dice": (fixed(dice.value if dice else None, decimals), "Dice, regions"),
        "kappa": (fixed(evaluation.mean_kappa, decimals), "Cohen's κ, reviewers"),
        "cell-agreement": (percent(evaluation.cell_agreement_with_ai.value), "Cells agreed"),
    }
    return tuple(tiles[metric] for metric in metrics if metric in tiles)


def reason_rows(evaluation: Evaluation) -> list[tuple[str, int]]:
    rows = [(REASON_LABELS.get(code, code), count) for code, count in evaluation.reasons]
    return sorted(rows, key=lambda row: (-row[1], row[0]))


def opinion_rows(evaluation: Evaluation) -> list[tuple[str, int]]:
    counts = evaluation.opinions[0].counts if evaluation.opinions else {}
    return [
        (SCORE_LABELS.get(score, score), counts.get(score, 0))
        for score in sorted(counts, key=lambda score: float(score) if score.isdigit() else 0)
    ]


def answer_spread(evaluation: Evaluation) -> str:
    return ", ".join(
        f"{ANSWER_NAMES.get(answer, answer)} {count}"
        for answer, count in sorted(evaluation.decisions.answers.items())
    )


@dataclass(frozen=True)
class Clock:
    zone: ZoneInfo | None

    def local(self, at: datetime) -> datetime:
        aware = at if at.tzinfo else at.replace(tzinfo=UTC)
        return aware.astimezone(self.zone or UTC)

    def day_month(self, at: datetime) -> str:
        local = self.local(at)
        return f"{local.day} {local.strftime('%b')} {local.year}"

    def long_day(self, at: datetime) -> str:
        local = self.local(at)
        return f"{local.day} {local.strftime('%B')} {local.year}"

    def time(self, at: datetime) -> str:
        return self.local(at).strftime("%H:%M")


def methods_lines(inputs: PaperInputs, evaluation: Evaluation, clock: Clock) -> tuple[str, ...]:
    decisions = evaluation.decisions
    style = style_of(DecisionSettings(style=decisions.style, counts_as=decisions.counts_as))
    drawn = evaluation.ai_result is False
    name = "Agree with the outline" if drawn and style.kind == "agree" else STYLE_NAMES[style.kind]
    source = "drawn" if drawn else "ai"
    lines = [f"Reviewers answered in the {name} style. {counts_as_rule(style, source)}"]
    tally = ", ".join(
        f"{count} {COUNT_WORDS.get(str(value), str(value))}"
        for value, count in decisions.counted.items()
    )
    if tally:
        spread = answer_spread(evaluation)
        lines.append(f"The decisions count as {tally}. The answers as given were {spread}.")
    for change in inputs.counts_as_changes:
        who = (
            inputs.names.get(str(change.changed_by_user_id), "")
            if change.changed_by_user_id
            else "A researcher"
        )
        lines.append(
            f"{who} changed Counts as on {clock.long_day(change.changed_at)}. Every stored "
            f"decision was counted again from the raw answers ({change.recounted} recounted)."
        )
    return tuple(lines)


def signed_change(left: float | None, right: float | None, decimals: int) -> str:
    if left is None or right is None:
        return "n/a"
    text = fixed(abs(right - left), decimals)
    if float(text) == 0:
        return "same"
    return f"{'+' if right - left > 0 else '-'}{text}"


def points(left: float | None, right: float | None) -> str:
    if left is None or right is None:
        return "n/a"
    diff = rounded((right - left) * 100)
    return "same" if diff == 0 else f"{'+' if diff > 0 else '-'}{abs(diff)} points"


def comparison_rows(left: Evaluation, right: Evaluation, decimals: int) -> list[tuple[str, ...]]:
    def region(evaluation: Evaluation) -> tuple[float | None, float | None]:
        found = next((row for row in evaluation.overall if row.kind == "region"), None) or (
            evaluation.overall[0] if evaluation.overall else None
        )
        return (found.sensitivity.value, found.precision.value) if found else (None, None)

    def dice(evaluation: Evaluation) -> float | None:
        found = next(iter(evaluation.dice.values()), None)
        return found.value if found else None

    numeric = [
        ("Sensitivity, regions", region(left)[0], region(right)[0]),
        ("Precision, regions", region(left)[1], region(right)[1]),
        ("Dice, regions", dice(left), dice(right)),
        ("Cohen's κ, reviewers", left.mean_kappa, right.mean_kappa),
    ]
    rows: list[tuple[str, ...]] = [
        (label, fixed(a, decimals), fixed(b, decimals), signed_change(a, b, decimals))
        for label, a, b in numeric
    ]
    cells = (left.cell_agreement_with_ai.value, right.cell_agreement_with_ai.value)
    rows.append(("Cells agreed", percent(cells[0]), percent(cells[1]), points(*cells)))
    disagreed = [
        sum(count for value, count in evaluation.decisions.counted.items() if value == "disagree")
        for evaluation in (left, right)
    ]
    rows.append(
        (
            "Counted as disagree",
            str(disagreed[0]),
            str(disagreed[1]),
            signed_change(disagreed[0], disagreed[1], 0),
        )
    )
    return rows


def slide_rows(queue: Sequence[QueueRow]) -> list[tuple[str, int, int]]:
    counts: dict[str, list[int]] = {}
    for row in queue:
        found = counts.setdefault(row.slide_label, [0, 0])
        found[0] += 1
        if any(answer.raw == "disagree" for answer in row.answers):
            found[1] += 1
    return [(label, total, disagreeing) for label, (total, disagreeing) in counts.items()]


class Builder:
    def __init__(self, inputs: PaperInputs) -> None:
        self.inputs = inputs
        self.report = inputs.report
        self.clock = Clock(inputs.zone)
        self.decimals = inputs.format.decimals

    def name_of(self, user_id: object) -> str:
        return self.inputs.names.get(str(user_id), "")

    def status(self) -> str:
        signed = self.report.signed_at
        return f" · signed {self.clock.day_month(signed)}" if signed else " · draft"

    def body(self, block: ReportBlock) -> tuple[Part, ...]:
        evaluation = self.inputs.evaluation
        drawn = evaluation is not None and evaluation.ai_result is False

        def scored(metrics: Sequence[str]) -> list[str]:
            return [metric for metric in metrics if not drawn or metric in PERSON_METRICS]

        match block:
            case HeadlineNumbers():
                return self.headline(block, scored)
            case RegionMetrics():
                return self.regions(block, drawn)
            case ConfusionMatrix():
                return self.matrix(drawn)
            case ReviewerAgreement():
                return self.agreement()
            case DisagreementReasons():
                return self.reasons(block)
            case OpinionAnswers():
                return self.opinions()
            case WorstObjects():
                return self.worst(block)
            case SlideTable():
                return self.slides(block)
            case SlideFigure():
                return self.figure(block)
            case TextBlock():
                return self.text(block)
            case Comparison():
                return self.comparison(block, drawn)
            case ExpertChanges():
                return (Empty("Only an annotate task counts how the experts changed the AI."),)

    def headline(
        self, block: HeadlineNumbers, scored: Callable[[Sequence[str]], list[str]]
    ) -> tuple[Part, ...]:
        evaluation = self.inputs.evaluation
        metrics = scored(block.metrics or list(HEADLINE_METRICS))
        if evaluation is not None and evaluation.ai_result is False and not metrics:
            return (Empty(DRAWN_EMPTY),)
        tiles = headline_tiles(evaluation, metrics, self.decimals) if evaluation else ()
        return (Tiles(tiles),)

    def regions(self, block: RegionMetrics, drawn: bool) -> tuple[Part, ...]:
        if drawn:
            return (Empty(DRAWN_EMPTY),)
        evaluation = self.inputs.evaluation
        found = [row for row in (evaluation.classes if evaluation else []) if row.kind == "region"]
        if not found:
            return (Empty("This task has no regions to measure."),)

        def value(row: ClassMetrics, column: str) -> str:
            if column == "dice":
                rate = evaluation.dice.get(row.class_name) if evaluation else None
                return fixed(rate.value if rate else None, self.decimals)
            found = row.sensitivity if column == "sensitivity" else row.precision
            return fixed(found.value, self.decimals)

        shown = found[: block.rows] if block.rows else found
        return (
            Table(
                ("Class", *(METRIC_NAMES.get(column, column) for column in block.columns)),
                tuple(
                    (row.class_name, *(value(row, column) for column in block.columns))
                    for row in shown
                ),
            ),
        )

    def matrix(self, drawn: bool) -> tuple[Part, ...]:
        if drawn:
            return (Empty(DRAWN_EMPTY),)
        confusion = self.report.confusion
        if not confusion.classes:
            return (Empty("This task has no cells, so there are no cell types to compare."),)
        return (
            Matrix(
                tuple(confusion.classes),
                tuple(tuple(row) for row in confusion.counts),
                "The diagonal is agreement between the AI and the consensus.",
            ),
        )

    def agreement(self) -> tuple[Part, ...]:
        evaluation = self.inputs.evaluation
        values = [
            ("Fleiss kappa", evaluation.fleiss_kappa if evaluation else None),
            ("Cohen kappa", evaluation.mean_kappa if evaluation else None),
            (
                "Cell agreement between reviewers",
                evaluation.cell_agreement_between_reviewers.value if evaluation else None,
            ),
        ]
        if all(value is None for _, value in values):
            return (Empty("Agreement needs two reviewers who answered the same objects."),)
        return (
            Table(
                ("Measure", "Value"),
                tuple((name, fixed(value, self.decimals)) for name, value in values),
            ),
        )

    def reasons(self, block: DisagreementReasons) -> tuple[Part, ...]:
        evaluation = self.inputs.evaluation
        rows = reason_rows(evaluation) if evaluation else []
        if not rows:
            return (Empty("No reviewer gave a reason for disagreeing."),)
        return (Bars(None, tuple(rows[: block.top] if block.top else rows)),)

    def opinions(self) -> tuple[Part, ...]:
        evaluation = self.inputs.evaluation
        rows = opinion_rows(evaluation) if evaluation else []
        if not rows:
            return (Empty("No reviewer answered the opinion form."),)
        return (Bars(self.report.opinion_question or None, tuple(rows)),)

    def worst(self, block: WorstObjects) -> tuple[Part, ...]:
        if not self.report.worst:
            return (Empty("No object has a decision yet."),)
        rows = self.report.worst[: block.rows]
        people = tuple(
            self.name_of(user_id) or f"Reviewer {chr(65 + index)}"
            for index, user_id in enumerate(self.report.reviewer_ids)
        )
        return (
            ObjectsTable(
                people,
                tuple(
                    (row.object, row.what, tuple(str(answer.raw) for answer in row.answers))
                    for row in rows
                ),
            ),
            Note(
                f"{len(rows)} of {self.report.objects} objects. "
                "Every object is in the CSV with its full ID."
            ),
        )

    def slides(self, block: SlideTable) -> tuple[Part, ...]:
        rows = slide_rows(self.inputs.queue)
        if not rows:
            return (Empty("No slide in this task has objects to review."),)
        names = {"objects": "Objects", "disagreements": "Disagreements", "time": "Review time"}

        def cell(total: int, disagreeing: int, column: str) -> str:
            if column == "time":
                return "Not recorded"
            return str(total if column == "objects" else disagreeing)

        return (
            Table(
                ("Slide", *(names.get(column, column) for column in block.columns)),
                tuple(
                    (label, *(cell(total, disagreeing, column) for column in block.columns))
                    for label, total, disagreeing in rows
                ),
            ),
        )

    def figure(self, block: SlideFigure) -> tuple[Part, ...]:
        if block.slide_id is None:
            return (Empty("Pick a slide for this figure."),)
        prefix = f"{block.object_id} · " if block.object_id else ""
        return (Figure(f"{prefix}{block.caption}"),)

    def text(self, block: TextBlock) -> tuple[Part, ...]:
        evaluation = self.inputs.evaluation
        if block.title == "Methods" and not block.body and evaluation is not None:
            return (Lines(methods_lines(self.inputs, evaluation, self.clock), gap=4),)
        if not block.body:
            return (Empty("This text block is empty."),)
        return (Lines(tuple(block.body.split("\n"))),)

    def comparison(self, block: Comparison, drawn: bool) -> tuple[Part, ...]:
        if drawn:
            return (Empty(DRAWN_EMPTY),)
        if block.task_id is None:
            return (Empty("Pick a review task to compare with."),)
        other = self.inputs.compared.get(str(block.task_id))
        evaluation = self.inputs.evaluation
        if other is None or evaluation is None:
            return (Empty("The review task to compare with is not available."),)
        left, right = self.report, other.report
        rows = comparison_rows(evaluation, other.evaluation, self.decimals)
        if left.slides == right.slides:
            note = (
                f"Change is {right.task_code} minus {left.task_code}. "
                f"Both tasks have {left.slides} slides."
            )
        else:
            note = (
                f"Change is {right.task_code} minus {left.task_code}. {left.task_code} has "
                f"{left.slides} slides and {right.task_code} has {right.slides}, so the slide "
                "sets differ."
            )
        return (
            Table(
                (
                    "Measure",
                    f"{left.task_code}, {left.model}",
                    f"{right.task_code}, {right.model}",
                    "Change",
                ),
                tuple(rows),
            ),
            Note(note),
        )

    def closing(self) -> tuple[Section, ...]:
        changes = self.inputs.changes
        changed: Part = (
            ChangeRows(
                tuple(
                    (
                        f"{change.object} on {change.slide_label}",
                        f'{change.text} · "{change.reason}"',
                        self.name_of(change.by_user_id) if change.by_user_id else "",
                        f"{self.clock.day_month(change.at)}, {self.clock.time(change.at)}",
                    )
                    for change in changes
                )
            )
            if changes
            else Lines(("Nothing changed after sign-off.",))
        )
        left_open = [row for row in self.inputs.queue if str(row.state) == "left-open"]
        sections = [
            Section("Changes after sign-off", (changed,)),
            Section(
                "Left open on purpose",
                (
                    Lines(
                        (
                            ", ".join(f"{row.object} on {row.slide_label}" for row in left_open)
                            if left_open
                            else "Every queued object was decided.",
                        )
                    ),
                ),
            ),
        ]
        if self.inputs.format.signature:
            signed = self.report.signed_at
            by = self.report.signed_by_user_id
            line = (
                f"Signed by {self.name_of(by)} on {self.clock.day_month(signed)} at "
                f"{self.clock.time(signed)}. Changes after sign-off are logged with a reason."
                if signed and by
                else "Not signed yet."
            )
            sections.append(Section("Signature", (Lines((line,)),)))
        return tuple(sections)

    def appendix(self, name: str) -> Section:
        evaluation = self.inputs.evaluation
        style = self.inputs.style
        if name == "methods":
            lines = methods_lines(self.inputs, evaluation, self.clock) if evaluation else ()
            return Section("Appendix: methods", (Lines(lines, gap=4),))
        queue = self.inputs.queue
        if name == "decisions":
            return Section(
                "Appendix: decisions",
                (
                    Table(
                        ("ID", "Slide", "Reviewer", "Decision"),
                        tuple(
                            (
                                row.object,
                                row.slide_label,
                                self.name_of(answer.user_id),
                                styled_word(style, answer.raw, row.ai.class_name),
                            )
                            for row in queue
                            for answer in row.answers
                        ),
                    ),
                ),
            )
        ids = [str(user_id) for user_id in self.report.reviewer_ids]

        def cells(row: QueueRow) -> tuple[str, ...]:
            given = {str(answer.user_id): answer.raw for answer in row.answers}
            words = tuple(
                styled_word(style, given[user_id], row.ai.class_name) if user_id in given else ""
                for user_id in ids
            )
            if row.decision:
                decided = styled_word(style, row.decision.raw, row.ai.class_name)
            else:
                decided = "Left open" if str(row.state) == "left-open" else "Open"
            return (row.object, row.slide_label, *words, decided)

        return Section(
            "Appendix: objects",
            (
                Table(
                    ("ID", "Slide", *(self.name_of(user_id) for user_id in ids), "Decision"),
                    tuple(cells(row) for row in queue),
                    mono_first=True,
                ),
            ),
        )

    def sheet(self, number: int, plan: ReportPage, pages: int) -> Sheet:
        report = self.report
        shape = self.inputs.format
        letterhead = None
        facts: tuple[tuple[str, str], ...] = ()
        if number == 1:
            changes = self.inputs.changes
            lines = [
                f"{report.task_code} · {report.model}",
                f"Evaluation v{report.version}{self.status()}",
            ]
            if changes:
                count = len(changes)
                lines.append(
                    f"Changed after sign-off · {count} change{'' if count == 1 else 's'} listed "
                    f"at the end · the checksum is of v{changes[0].version} as signed"
                )
            letterhead = Letterhead(
                report.lab.name,
                report.lab.short,
                "Parfocal · research output",
                "Evaluation report",
                tuple(lines),
            )
            facts = (
                ("Project", f"{report.project.name} ({report.project.code})"),
                ("Task", f"{report.task_code} · {report.round_name}"),
                ("Model", report.model),
                (
                    "Slides",
                    f"{counted(report.slides, 'slide', 'slides')} · "
                    f"{counted(report.objects, 'object', 'objects')}",
                ),
                (
                    "Reviewers",
                    f"{counted(len(report.reviewer_ids), 'blind reviewer', 'blind reviewers')}, "
                    f"{counted(report.adjudicators, 'adjudicator', 'adjudicators')}",
                ),
                ("Template", f"{report.template.name} v{self.inputs.template_version}"),
            )
        sections = [
            Section(
                block.title if block.show_title else None,
                self.body(block),
                half=block.width == "half",
            )
            for indices in plan.rows
            for index in indices
            if index < len(self.inputs.blocks)
            for block in (self.inputs.blocks[index],)
        ]
        if plan.closing:
            sections += self.closing()
        if plan.appendix:
            sections.append(self.appendix(plan.appendix))
        numbering = {"page": f"Page {number}", "page-of": f"Page {number} of {pages}"}
        return Sheet(
            footer=f"{report.task_code} · Evaluation v{report.version}{self.status()}",
            numbering=numbering.get(shape.page_numbers),
            header=f"{report.task_code} · Evaluation report v{report.version}"
            if shape.running_header and number > 1
            else None,
            watermark="DRAFT" if shape.draft_watermark and not report.signed_at else None,
            letterhead=letterhead,
            facts=facts,
            sections=tuple(sections),
        )


def paper_of(inputs: PaperInputs) -> Paper:
    builder = Builder(inputs)
    plans = report_pages(tuple(inputs.blocks), inputs.format)
    return Paper(
        sheets=tuple(
            builder.sheet(number, plan, len(plans)) for number, plan in enumerate(plans, start=1)
        ),
        letter=inputs.format.paper == "letter",
        landscape=inputs.format.orientation == "landscape",
        checksum=inputs.checksum,
    )


PART_KINDS: Mapping[type, str] = {
    Tiles: "tiles",
    Table: "table",
    ObjectsTable: "objects",
    Matrix: "matrix",
    Bars: "bars",
    Lines: "lines",
    Note: "note",
    Empty: "empty",
    Figure: "figure",
    ChangeRows: "changes",
}


def plain(value: object) -> object:
    if isinstance(value, tuple | list):
        items = cast("Sequence[object]", value)
        return [plain(item) for item in items]
    fields = getattr(value, "__dataclass_fields__", None)
    if fields is not None:
        found = {name: plain(getattr(value, name)) for name in fields}
        kind = PART_KINDS.get(type(value))
        return {**found, "kind": kind} if kind else found
    return value


def paper_json(paper: Paper) -> str:
    return json.dumps(plain(paper), ensure_ascii=False)


def part_texts(part: Part) -> list[str]:
    match part:
        case Tiles():
            return [text for tile in part.tiles for text in tile]
        case Table():
            return [*part.head, *(cell for row in part.rows for cell in row)]
        case ObjectsTable():
            return [
                "ID",
                "Object",
                *part.people,
                *(text for row in part.rows for text in (row[0], row[1], *row[2])),
            ]
        case Matrix():
            return [
                "Consensus of the reviewers",
                *part.classes,
                *(
                    text
                    for name, counts in zip(part.classes, part.counts, strict=True)
                    for text in (name, *map(str, counts))
                ),
                part.caption,
            ]
        case Bars():
            heading = [part.heading] if part.heading else []
            return [*heading, *(text for label, count in part.rows for text in (label, str(count)))]
        case Lines():
            return list(part.lines)
        case Note() | Empty():
            return [part.text]
        case Figure():
            return [part.caption] if part.caption else []
        case ChangeRows():
            return [cell for row in part.rows for cell in row]


def text_of(paper: Paper) -> list[list[str]]:
    pages: list[list[str]] = []
    for sheet in paper.sheets:
        texts = [sheet.header] if sheet.header else []
        if sheet.letterhead:
            head = sheet.letterhead
            texts += [head.lab_short, head.lab_name, head.kind, head.title, *head.lines]
            texts += [text for pair in sheet.facts for text in pair]
        for section in sheet.sections:
            texts += [section.title] if section.title else []
            texts += [text for part in section.parts for text in part_texts(part)]
        texts += [sheet.footer, *([sheet.numbering] if sheet.numbering else [])]
        pages.append(texts)
    return pages
