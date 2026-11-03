import re
import uuid
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
    REPORT_MESSAGES,
    ReportClass,
    ReportData,
    render_report,
    report_data,
)
from parfocal_api.tables import DecisionStyle

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
    signed_off_on=date(2026, 11, 3),
    sample=True,
    classes=(
        ReportClass(name="CLASS-SENTINEL", sensitivity=0.8333, precision=None),
        ReportClass(name="OTHER-SENTINEL", sensitivity=1.0, precision=0.5),
    ),
    fleiss_kappa=0.41,
    decisions={"agree": 7, "disagree": 2, "unsure": 1},
)
REPORT_VALUES = ("PROJECT-SENTINEL", "TASK-SENTINEL", "CLASS-SENTINEL", "OTHER-SENTINEL")


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
    report = render_report(REPORT, Locale.PSEUDO)
    literals = [
        literal.replace('\\"', '"').replace("\\\\", "\\")
        for literal in LITERAL.findall(report.source)
    ]
    shown = [without(literal, REPORT_VALUES) for literal in literals]
    assert not any(LETTERS.search(text) for text in shown), shown
    outside = LITERAL.sub("", report.source)
    assert set(LETTERS.findall(outside.replace("table", "").replace("columns", ""))) == set()
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
    )
    data = report_data(evaluation, "P", "T", 2, date(2026, 11, 3))
    assert data.classes == (ReportClass(name="tumour", sensitivity=None, precision=0.75),)
    assert data.decisions == {"agree": 4, "unsure": 1}


def test_an_unknown_locale_is_refused_and_none_means_english() -> None:
    assert locale_of(None) is Locale.ENGLISH
    assert locale_of("en-XA") is Locale.PSEUDO
    with pytest.raises(UnsupportedLocaleError):
        locale_of("xx")
    assert decimal(0.5, 2, Locale.ENGLISH) == "0.50"
