import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date

from parfocal_api.evaluation import Evaluation
from parfocal_api.locales import DEFAULT_LOCALE, Locale, day, decimal, translated

DECISIONS = ("agree", "disagree", "unsure")

REPORT_MESSAGES: Mapping[str, str] = {
    "report.title": "Evaluation report",
    "report.project": "Project",
    "report.task": "Task",
    "report.version": "Evaluation version",
    "report.signed_off": "Signed off",
    "report.classes": "Results by class",
    "report.class": "Class",
    "report.sensitivity": "Sensitivity",
    "report.precision": "Precision",
    "report.agreement": "Agreement between reviewers",
    "report.fleiss_kappa": "Fleiss kappa",
    "report.decisions": "Decisions",
    "report.decision.agree": "Agree",
    "report.decision.disagree": "Disagree",
    "report.decision.unsure": "Unsure",
    "report.missing": "Not enough data",
    "report.sample": "This report covers a sample of the slides.",
}


@dataclass(frozen=True)
class ReportClass:
    name: str
    sensitivity: float | None
    precision: float | None


@dataclass(frozen=True)
class ReportData:
    project_name: str
    task_name: str
    version: int
    signed_off_on: date
    sample: bool
    classes: tuple[ReportClass, ...]
    fleiss_kappa: float | None
    decisions: Mapping[str, int]


@dataclass(frozen=True)
class RenderedReport:
    locale: Locale
    source: str
    inputs: dict[str, str]


def report_data(
    evaluation: Evaluation, project_name: str, task_name: str, version: int, signed_off_on: date
) -> ReportData:
    return ReportData(
        project_name=project_name,
        task_name=task_name,
        version=version,
        signed_off_on=signed_off_on,
        sample=evaluation.sample,
        classes=tuple(
            ReportClass(
                name=found.class_name,
                sensitivity=found.sensitivity.value,
                precision=found.precision.value,
            )
            for found in evaluation.classes
        ),
        fleiss_kappa=evaluation.fleiss_kappa,
        decisions={str(key): count for key, count in evaluation.decisions.counted.items()},
    )


def typst_text(value: str) -> str:
    return '#"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render_report(data: ReportData, locale: Locale = DEFAULT_LOCALE) -> RenderedReport:
    messages = translated(REPORT_MESSAGES, locale)

    def share(value: float | None) -> str:
        return messages["report.missing"] if value is None else decimal(value, 2, locale)

    def row(*cells: str) -> str:
        return "  " + ", ".join(f"[{typst_text(cell)}]" for cell in cells) + ","

    lines = [
        f"= {typst_text(messages['report.title'])}",
        "",
        f"{typst_text(messages['report.project'])}: {typst_text(data.project_name)} \\",
        f"{typst_text(messages['report.task'])}: {typst_text(data.task_name)} \\",
        f"{typst_text(messages['report.version'])}: {typst_text(str(data.version))} \\",
        f"{typst_text(messages['report.signed_off'])}: "
        f"{typst_text(day(data.signed_off_on, locale))}",
        *(["", typst_text(messages["report.sample"])] if data.sample else []),
        "",
        f"== {typst_text(messages['report.classes'])}",
        "#table(columns: 3,",
        row(messages["report.class"], messages["report.sensitivity"], messages["report.precision"]),
        *(
            row(found.name, share(found.sensitivity), share(found.precision))
            for found in data.classes
        ),
        ")",
        "",
        f"== {typst_text(messages['report.agreement'])}",
        f"{typst_text(messages['report.fleiss_kappa'])}: {typst_text(share(data.fleiss_kappa))}",
        "",
        f"== {typst_text(messages['report.decisions'])}",
        "#table(columns: 2,",
        *(
            row(messages[f"report.decision.{key}"], str(data.decisions.get(key, 0)))
            for key in DECISIONS
        ),
        ")",
        "",
    ]
    return RenderedReport(
        locale=locale,
        source="\n".join(lines),
        inputs={"locale": str(locale), "messages": json.dumps(dict(messages), ensure_ascii=False)},
    )
