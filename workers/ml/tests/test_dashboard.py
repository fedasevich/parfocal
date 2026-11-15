from pathlib import Path

import pytest

from parfocal_ml.dashboard import (
    DashboardError,
    build,
    changes,
    load_results,
    load_series,
    main,
    numbers_in,
    parse_result,
    render_markdown,
)

FIXTURES = Path(__file__).parent / "fixtures" / "dashboard"
REPOSITORY = Path(__file__).resolve().parents[3]


def fixture_series(text: str, tmp_path: Path):
    path = tmp_path / "series.toml"
    path.write_text(text)
    return load_series(path, load_results(FIXTURES / "results"))


def test_a_result_file_gives_its_header_and_only_its_results_tables() -> None:
    result = parse_result(FIXTURES / "results" / "2026-01-02-first-run.md")
    assert (result.title, result.date, result.kind) == (
        "first fixture run",
        "2026-01-02",
        "ML evaluation",
    )
    assert result.backlog.startswith("MLEVAL-009")
    assert len(result.tables) == 2
    assert result.tables[0].caption == "Scores per method:"
    assert result.tables[0].rows[0] == ("alpha", "0.8000", "0.0300, 0.0200")
    assert result.tables[1].headers == ("Encoder", "Decoder", "Count")


def test_numbers_keep_thousands_and_split_lists() -> None:
    assert numbers_in("1,451") == [1451.0]
    assert numbers_in("0.0323, 0.0223") == [0.0323, 0.0223]
    assert numbers_in("1.85, ECE 0.0152") == [1.85, 0.0152]
    assert numbers_in("+0.0015") == [0.0015]
    assert numbers_in("99.30%") == [99.30]
    assert numbers_in("not given") == []


def test_series_read_every_value_from_its_source_in_date_order() -> None:
    series = load_series(FIXTURES / "series.toml", load_results(FIXTURES / "results"))
    pq, ece = series
    assert [(p.date, p.variant, p.value) for p in pq.points] == [
        ("2026-01-02", "alpha", 0.8),
        ("2026-01-02", "beta", 0.7),
        ("2026-02-03", "alpha", 0.825),
        ("2026-03-01", "alpha", 0.8312),
    ]
    assert pq.points[-1].source == "summary.json"
    assert pq.reference is not None
    assert pq.reference.value == 0.7
    assert pq.variants == ("alpha", "beta")
    assert [p.value for p in ece.points] == [0.03, 1451.0]


def test_changes_compare_each_point_with_the_last_of_its_variant() -> None:
    pq = load_series(FIXTURES / "series.toml", load_results(FIXTURES / "results"))[0]
    found = changes(pq)
    assert found[0] is None
    assert found[1] is None
    assert found[2] == pytest.approx(0.025)
    assert found[3] == pytest.approx(0.0062)


@pytest.mark.parametrize(
    ("point", "message"),
    [
        ('result = "missing.md"\nrow = "alpha"\ncolumn = "PQ"', "not a result file"),
        ('result = "2026-01-02-first-run.md"\nrow = "gamma"\ncolumn = "PQ"', "no cell"),
        ('result = "2026-01-02-first-run.md"\nrow = "alpha"\ncolumn = "SQ"', "no cell"),
        (
            'result = "2026-01-02-first-run.md"\nrow = "alpha"\ncolumn = "ECE before, after"',
            "give a part",
        ),
        (
            'result = "2026-01-02-first-run.md"\nrow = "alpha"\ncolumn = "PQ"\ntable = 5',
            "no table 5",
        ),
        (
            'result = "2026-01-02-first-run.md"\nrow = { "Encoder" = "uint8" }\ncolumn = "Count"',
            "2 cells",
        ),
        ('json = "summary.json"\nkey = "summary.pq"', "needs a date"),
        ('json = "summary.json"\nkey = "summary.sq"\ndate = "2026-01-01"', "no value"),
        ('json = "summary.json"\nkey = "dataset"\ndate = "2026-01-01"', "not a number"),
        ('json = "summary.json"\nkey = "within_tolerance"\ndate = "2026-01-01"', "not a number"),
    ],
)
def test_a_value_that_is_not_in_the_sources_stops_the_build(
    point: str, message: str, tmp_path: Path
) -> None:
    (tmp_path / "summary.json").write_text((FIXTURES / "summary.json").read_text())
    with pytest.raises(DashboardError, match=message):
        fixture_series(
            f'[[series]]\nid = "x"\ntitle = "X"\n\n[[series.points]]\n{point}\n', tmp_path
        )


def test_a_json_list_index_reads_a_nested_value(tmp_path: Path) -> None:
    (tmp_path / "summary.json").write_text((FIXTURES / "summary.json").read_text())
    series = fixture_series(
        '[[series]]\nid = "x"\ntitle = "X"\n\n[[series.points]]\n'
        'json = "summary.json"\nkey = "summary.groups.0.pq"\ndate = "2026-01-01"\n',
        tmp_path,
    )
    assert series[0].points[0].value == 0.5


def test_the_report_lists_only_evaluation_runs_and_draws_one_chart_per_series(
    tmp_path: Path,
) -> None:
    page, summary = build(FIXTURES / "results", FIXTURES / "series.toml", tmp_path / "out")
    text = page.read_text()
    assert text.startswith("<!DOCTYPE html>")
    assert text.count('role="img"') == 2
    assert "PQ on the fixture: 4 values in 2 variants from 2026-01-02 to 2026-03-01" in text
    assert "first fixture run" in text
    assert "second fixture run" in text
    assert "a spike that is not an evaluation" not in text
    markdown = summary.read_text()
    assert "| 2026-02-03 | alpha | 0.825 | +0.025 | [2026-02-03-second-run.md]" in markdown
    assert (
        "| 2026-03-01 | alpha | 0.8312 | +0.0062 | [summary.json](summary.json) (stored output) |"
        in markdown
    )
    assert "Reference: baseline 0.7" in markdown
    assert "from 2 ML evaluation result files" in markdown


def test_the_report_is_the_same_on_every_build(tmp_path: Path) -> None:
    first = build(FIXTURES / "results", FIXTURES / "series.toml", tmp_path / "a")
    second = build(FIXTURES / "results", FIXTURES / "series.toml", tmp_path / "b")
    assert [p.read_text() for p in first] == [p.read_text() for p in second]


def test_the_command_writes_both_files(tmp_path: Path, capsys: pytest.CaptureFixture[str]) -> None:
    main(
        [
            "--results",
            str(FIXTURES / "results"),
            "--series",
            str(FIXTURES / "series.toml"),
            "--out",
            str(tmp_path),
        ]
    )
    assert capsys.readouterr().out.split() == [
        str(tmp_path / "dashboard.html"),
        str(tmp_path / "dashboard.md"),
    ]


def test_the_committed_series_resolve_against_the_committed_results() -> None:
    results = load_results(REPOSITORY / "docs" / "results")
    series = load_series(REPOSITORY / "docs" / "evaluation" / "series.toml", results)
    assert len(series) >= 3
    assert all(len({point.date for point in entry.points}) >= 2 for entry in series)
    assert "## Evaluation runs" in render_markdown(series, results)
