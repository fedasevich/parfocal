import json
from pathlib import Path

import pytest

from parfocal_common.results_schema import Code, main, schema_text, template_text, validate

ROOT = Path(__file__).resolve().parents[3]
LONG = "x" * 121
BROKEN = (
    "{\n"
    '  "format": "something-else",\n'
    '  "version": 2,\n'
    '  "model": {"version": "1"},\n'
    '  "colour": "red",\n'
    '  "classes": [{"name": "Tumor", "color": "red"}],\n'
    '  "objects": [\n'
    '    {"kind": "nucleus", "geometry": {"type": "Point", "coordinates": [1, 2]}},\n'
    '    {"kind": "cell", "score": 1.5, "geometry": {"type": "Point", "coordinates": [1, 2]}},\n'
    '    {"kind": "cell", "geometry": "here"},\n'
    f'    {{"kind": "region", "class": "{LONG}", '
    '"geometry": {"type": "Point", "coordinates": [0, 0]}}\n'
    "  ]\n"
    "}\n"
)


def test_the_template_is_valid_and_matches_the_published_copy() -> None:
    assert validate(template_text()) == []
    reference = ROOT / "docs" / "reference"
    assert (reference / "parfocal-results-v1.template.json").read_text() == template_text()
    assert (reference / "parfocal-results-v1.schema.json").read_text() == schema_text()


def test_every_documented_error_names_its_line() -> None:
    found = [(problem.line, problem.code, problem.path) for problem in validate(BROKEN)]
    assert found == [
        (2, Code.WRONG_FORMAT, "format"),
        (3, Code.WRONG_VERSION, "version"),
        (4, Code.MISSING_FIELD, "model"),
        (5, Code.UNKNOWN_FIELD, "colour"),
        (6, Code.BAD_PATTERN, "classes[0].color"),
        (8, Code.NOT_ALLOWED, "objects[0].kind"),
        (9, Code.OUT_OF_RANGE, "objects[1].score"),
        (10, Code.WRONG_TYPE, "objects[2].geometry"),
        (11, Code.BAD_LENGTH, "objects[3].class"),
    ]
    messages = {problem.code: problem.message for problem in validate(BROKEN)}
    assert messages[Code.MISSING_FIELD] == "model.name is required"
    assert messages[Code.UNKNOWN_FIELD] == "colour is not a known field"


def test_a_file_that_is_not_json_names_the_line() -> None:
    (problem,) = validate('{\n  "format": "parfocal-results",\n  "version": 1,\n}\n')
    assert (problem.line, problem.code) == (3, Code.NOT_JSON)


def test_a_missing_top_level_field_points_at_the_document() -> None:
    problems = validate(
        json.dumps({"format": "parfocal-results", "version": 1, "model": {"name": "x"}})
    )
    assert [(p.line, p.code, p.message) for p in problems] == [
        (1, Code.MISSING_FIELD, "objects is required")
    ]


def test_the_command_line_reports_problems_and_exits_non_zero(
    tmp_path: Path, capsys: pytest.CaptureFixture[str]
) -> None:
    good, bad = tmp_path / "good.json", tmp_path / "bad.json"
    good.write_text(template_text())
    bad.write_text(BROKEN)
    assert main([str(good)]) == 0
    assert "valid Parfocal results file" in capsys.readouterr().out
    assert main([str(bad)]) == 1
    output = capsys.readouterr().out
    assert "line 2: format must be" in output
    assert "[bad-length]" in output
    assert main([]) == 2
