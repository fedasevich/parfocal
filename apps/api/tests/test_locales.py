import re
import uuid
from dataclasses import replace
from datetime import date

import pytest

from parfocal_api.email_templates import MESSAGES, TEMPLATES, fields_of, render
from parfocal_api.evaluation import ClassMetrics, DecisionCounts, Evaluation, RateOut
from parfocal_api.locales import (
    Locale,
    UnsupportedLocaleError,
    decimal,
    locale_of,
    pseudo,
    pseudo_catalogue,
)
from parfocal_api.report_template import (
    EVERY_BLOCK,
    REPORT_MESSAGES,
    ReportClass,
    ReportCompared,
    ReportData,
    ReportDecision,
    ReportObject,
    ReportOpinion,
    render_report,
    report_data,
)
from parfocal_api.tables import DecisionStyle
from parfocal_common.report_blocks import (
    Comparison,
    ReportFormat,
    SlideFigure,
    SlideTable,
    TextBlock,
)

SENTINELS = {
    "recipient_name": "RECIPIENT-SENTINEL",
    "workspace_name": "WORKSPACE-SENTINEL",
    "link": "https://parfocal.test/go/00000000-0000-0000-0000-000000000001",
    "inviter_name": "INVITER-SENTINEL",
    "project_name": "PROJECT-SENTINEL",
    "task_name": "TASK-SENTINEL",
    "slide_count": "SLIDES-SENTINEL",
    "due_on": "DUE-SENTINEL",
}
LETTERS = re.compile(r"[A-Za-z]")
TAG = re.compile(r"<[^>]*>")
LITERAL = re.compile(r'#"((?:[^"\\]|\\.)*)"')

REPORT = ReportData(
    project_name="PROJECT-SENTINEL",
    task_name="TASK-SENTINEL",
    version=3,
    checksum="sha256:0123abcd",
    signed_off_on=date(2026, 11, 3),
    sample=True,
    classes=(
        ReportClass(kind="region", name="CLASS-SENTINEL", sensitivity=0.8333, precision=None),
        ReportClass(kind="cell", name="OTHER-SENTINEL", sensitivity=1.0, precision=0.5),
    ),
    fleiss_kappa=0.41,
    decisions={"agree": 7, "disagree": 2, "unsure": 1},
    reasons=(("REASON-SENTINEL", 2),),
    opinions=(ReportOpinion(key="QUESTION-SENTINEL", count=2, mean=3.0),),
)
SLIDE_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
OTHER_TASK = uuid.UUID("00000000-0000-4000-8000-000000000002")
MISSING_TASK = uuid.UUID("00000000-0000-4000-8000-000000000003")
FULL_BLOCKS = (
    *EVERY_BLOCK[:7],
    SlideTable(kind="slide-table", title="Slides", columns=["objects", "disagreements", "time"]),
    SlideFigure(
        kind="slide-figure",
        title="Figure",
        slide_id=SLIDE_ID,
        object_id="T1",
        caption="CAPTION-SENTINEL",
    ),
    EVERY_BLOCK[9],
    Comparison(kind="comparison", title="Comparison", task_id=OTHER_TASK, metrics=["dice"]),
)
FULL_REPORT = replace(
    REPORT,
    headline={"dice": 0.6, "kappa": 0.5},
    cell_agreement=0.75,
    blocks=FULL_BLOCKS,
    format=ReportFormat(appendices=["objects", "decisions", "methods"]),
    objects=(
        ReportObject(
            object_id="P1/C1/SLIDE-SENTINEL/T1",
            slide="SLIDE-SENTINEL",
            kind="region",
            class_name="CLASS-SENTINEL",
            agree=1,
            disagree=1,
            unsure=0,
            consensus="CONSENSUS-SENTINEL",
        ),
    ),
    decision_rows=(
        ReportDecision(
            object_id="P1/C1/SLIDE-SENTINEL/T1",
            reviewer="REVIEWER-SENTINEL",
            decision="DECISION-SENTINEL",
        ),
    ),
    compared={str(OTHER_TASK): ReportCompared("COMPARED-SENTINEL", {"dice": 0.4})},
)
EMPTY_REPORT = ReportData(
    project_name="PROJECT-SENTINEL",
    task_name="TASK-SENTINEL",
    version=1,
    checksum="sha256:0123abcd",
    signed_off_on=None,
    sample=False,
    classes=(),
    fleiss_kappa=None,
    decisions={},
    blocks=(
        *EVERY_BLOCK[:9],
        TextBlock(kind="text", title="Methods"),
        Comparison(kind="comparison", title="Comparison", metrics=["dice"]),
        Comparison(kind="comparison", title="Gone", task_id=MISSING_TASK, metrics=["dice"]),
    ),
)
REPORT_VALUES = (
    "PROJECT-SENTINEL",
    "SLIDE-SENTINEL",
    "CONSENSUS-SENTINEL",
    "REVIEWER-SENTINEL",
    "DECISION-SENTINEL",
    "COMPARED-SENTINEL",
    "CAPTION-SENTINEL",
    "P1/C1/",
    "T1",
    "Gone",
    "TASK-SENTINEL",
    "CLASS-SENTINEL",
    "OTHER-SENTINEL",
    "REASON-SENTINEL",
    "QUESTION-SENTINEL",
    "METHODS-SENTINEL",
    "sha256:0123abcd",
    *(block.title for block in FULL_BLOCKS),
)
TYPST_WORDS = re.compile(
    r"(?<![A-Za-z])(?:set|page|paper|a4|flipped|false|true|margin|cm|numbering|header|background|none|"
    r"text|size|pt|rotate|deg|fill|luma|h|fr|table|columns|grid|column|gutter|pagebreak|inset)\b"
)


def without(text: str, values: tuple[str, ...]) -> str:
    for value in sorted(values, key=len, reverse=True):
        text = text.replace(value, "")
    return text


def test_pseudo_text_keeps_its_fields_and_drops_every_plain_letter() -> None:
    text = pseudo("Hello {recipient_name}, welcome to {workspace_name}.")
    assert "{recipient_name}" in text
    assert "{workspace_name}" in text
    assert not LETTERS.search(re.sub(r"\{[a-z_]+\}", "", text))


@pytest.mark.parametrize("name", sorted(TEMPLATES))
def test_every_email_renders_with_every_string_translated_in_the_pseudo_locale(name: str) -> None:
    needed = fields_of(TEMPLATES[name])
    values = {key: SENTINELS[key] for key in needed}
    email = render(name, values, Locale.PSEUDO)
    parts = (email.subject, email.text, TAG.sub("", email.html))
    for part in parts:
        left = without(part, tuple(values.values()))
        assert not LETTERS.search(left), (name, left)
    assert "⟦" in email.subject
    assert f'href="{SENTINELS["link"]}"' in email.html
    assert all(value in email.subject + email.text for value in values.values())


def test_english_stays_the_default_and_matches_the_source_text() -> None:
    values = {"workspace_name": "Lab", "link": SENTINELS["link"]}
    assert render("invitation", values) == render("invitation", values, Locale.ENGLISH)
    assert render("invitation", values).subject == "You have been invited to Lab on Parfocal"


def test_every_message_has_a_pseudo_translation() -> None:
    for catalogue in (MESSAGES, REPORT_MESSAGES):
        translated = pseudo_catalogue(catalogue)
        assert translated.keys() == catalogue.keys()
        assert all(translated[key] != catalogue[key] for key in catalogue)


def test_the_report_renders_with_every_string_translated_in_the_pseudo_locale() -> None:
    report = render_report(FULL_REPORT, Locale.PSEUDO)
    literals: list[str] = []
    for data in (FULL_REPORT, EMPTY_REPORT, replace(REPORT, signed_off_on=None, reasons=())):
        source = render_report(data, Locale.PSEUDO).source
        found = [
            literal.replace('\\"', '"').replace("\\\\", "\\") for literal in LITERAL.findall(source)
        ]
        shown = [without(literal, REPORT_VALUES) for literal in found]
        assert not any(LETTERS.search(text) for text in shown), shown
        outside = TYPST_WORDS.sub("", LITERAL.sub("", source))
        assert set(LETTERS.findall(outside)) == set(), outside
        literals += found
    for message in pseudo_catalogue(REPORT_MESSAGES).values():
        assert message in literals, message
    assert "0.83" in literals
    assert "03/11/2026" in literals
    assert report.inputs["locale"] == "en-XA"


def test_the_english_report_names_every_section_and_value() -> None:
    report = render_report(REPORT)
    for text in (
        "Evaluation report",
        "PROJECT-SENTINEL",
        "TASK-SENTINEL",
        "Not enough data",
        "Fleiss kappa",
        "0.41",
        "Disagree",
    ):
        assert text in report.source, text
    assert report.inputs["locale"] == "en"


def test_report_values_cannot_break_out_of_their_text() -> None:
    data = ReportData(
        project_name='a"] #panic("x") \\',
        task_name="t",
        version=1,
        checksum="",
        signed_off_on=date(2026, 1, 2),
        sample=False,
        classes=(),
        fleiss_kappa=None,
        decisions={},
    )
    source = render_report(data).source
    assert '#"a\\"] #panic(\\"x\\") \\\\"' in source
    assert "#panic" not in LITERAL.sub("", source)


def test_report_data_comes_from_the_evaluation() -> None:
    rate = RateOut(value=0.75, numerator=3, denominator=4)
    evaluation = Evaluation.model_construct(
        task_id=uuid.uuid4(),
        sample=False,
        decisions=DecisionCounts.model_construct(
            style=DecisionStyle.AGREE,
            counts_as=[],
            counted={"agree": 4, "unsure": 1},
            answers={},
        ),
        classes=[
            ClassMetrics(
                kind="cell",
                class_name="tumour",
                true_positives=3,
                false_positives=1,
                false_negatives=1,
                unsure=0,
                undecided=0,
                precision=rate,
                sensitivity=RateOut(value=None, numerator=0, denominator=0),
            )
        ],
        fleiss_kappa=None,
        overall=[],
        dice={},
        mean_kappa=None,
        cell_agreement_with_ai=rate,
        cell_agreement_between_reviewers=rate,
        reasons=[("not_a_cell", 2)],
        opinions=[],
    )
    data = report_data(evaluation, "P", "T", 2, date(2026, 11, 3))
    assert data.classes == (
        ReportClass(kind="cell", name="tumour", sensitivity=None, precision=0.75),
    )
    assert data.decisions == {"agree": 4, "unsure": 1}


def test_an_unknown_locale_is_refused_and_none_means_english() -> None:
    assert locale_of(None) is Locale.ENGLISH
    assert locale_of("en-XA") is Locale.PSEUDO
    with pytest.raises(UnsupportedLocaleError):
        locale_of("xx")
    assert decimal(0.5, 2, Locale.ENGLISH) == "0.50"
