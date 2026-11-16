import argparse
import html
import json
import re
import tomllib
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

NUMBER = re.compile(r"[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?|[-+]?\d+(?:\.\d+)?")
HEADER = re.compile(r"^- (\w[\w ]*):\s*(.*)$")
EVALUATION_KIND = "ML evaluation"
COLOURS = ("#1f5fa8", "#b5481c", "#2e7d32", "#7b3fa0", "#8a6d00", "#00707a")


class DashboardError(ValueError):
    pass


@dataclass(frozen=True)
class Table:
    caption: str
    headers: tuple[str, ...]
    rows: tuple[tuple[str, ...], ...]


@dataclass(frozen=True)
class ResultFile:
    name: str
    title: str
    date: str
    backlog: str
    kind: str
    tables: tuple[Table, ...]


@dataclass(frozen=True)
class Point:
    date: str
    variant: str
    value: float
    source: str
    note: str = ""


@dataclass(frozen=True)
class Series:
    id: str
    title: str
    unit: str
    better: str
    points: tuple[Point, ...]
    reference: Point | None = None
    description: str = ""
    variants: tuple[str, ...] = field(default=())


def clean(text: str) -> str:
    return re.sub(r"[`*_]", "", text).strip()


def split_row(line: str) -> tuple[str, ...]:
    inner = line.strip().removeprefix("|").removesuffix("|")
    return tuple(clean(cell) for cell in inner.split("|"))


def is_separator(cells: Sequence[str]) -> bool:
    return all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def results_section(lines: Sequence[str]) -> list[str]:
    found: list[str] = []
    inside = False
    for line in lines:
        if line.startswith("## "):
            inside = line.strip() == "## Results"
            continue
        if inside:
            found.append(line)
    return found


def parse_tables(lines: Sequence[str]) -> tuple[Table, ...]:
    tables: list[Table] = []
    caption = ""
    index = 0
    while index < len(lines):
        line = lines[index].strip()
        if line.startswith("|") and index + 1 < len(lines):
            separator = split_row(lines[index + 1])
            if is_separator(separator):
                headers = split_row(line)
                rows: list[tuple[str, ...]] = []
                index += 2
                while index < len(lines) and lines[index].strip().startswith("|"):
                    rows.append(split_row(lines[index]))
                    index += 1
                tables.append(Table(caption, headers, tuple(rows)))
                caption = ""
                continue
        if line:
            caption = line
        index += 1
    return tuple(tables)


def parse_result(path: Path) -> ResultFile:
    lines = path.read_text(encoding="utf-8").splitlines()
    title = lines[0].removeprefix("# ").removeprefix("Result: ").strip() if lines else path.stem
    meta: dict[str, str] = {}
    for line in lines[1:20]:
        match = HEADER.match(line)
        if match:
            meta.setdefault(match.group(1).lower(), match.group(2).strip())
    return ResultFile(
        name=path.name,
        title=title,
        date=meta.get("date", ""),
        backlog=meta.get("backlog", ""),
        kind=meta.get("kind", ""),
        tables=parse_tables(results_section(lines)),
    )


def load_results(folder: Path) -> dict[str, ResultFile]:
    return {
        path.name: parse_result(path)
        for path in sorted(folder.glob("*.md"))
        if re.match(r"\d{4}-\d{2}-\d{2}-", path.name)
    }


def numbers_in(cell: str) -> list[float]:
    return [float(found.replace(",", "")) for found in NUMBER.findall(cell)]


def row_matches(table: Table, row: tuple[str, ...], wanted: str | Mapping[str, str]) -> bool:
    if isinstance(wanted, str):
        return bool(row) and row[0] == wanted
    for column, value in wanted.items():
        if column not in table.headers:
            return False
        position = table.headers.index(column)
        if position >= len(row) or row[position] != value:
            return False
    return True


def find_cell(result: ResultFile, spec: Mapping[str, Any]) -> str:
    column = str(spec["column"])
    wanted = spec["row"]
    tables = result.tables
    if "table" in spec:
        position = int(spec["table"])
        if position >= len(tables):
            raise DashboardError(f"{result.name} has no table {position} in its Results")
        tables = (tables[position],)
    cells: list[str] = []
    for table in tables:
        if column not in table.headers:
            continue
        place = table.headers.index(column)
        for row in table.rows:
            if row_matches(table, row, wanted) and place < len(row):
                cells.append(row[place])
    if not cells:
        raise DashboardError(f"{result.name} has no cell for row {wanted!r} and column {column!r}")
    if len(cells) > 1:
        raise DashboardError(
            f"{result.name} has {len(cells)} cells for row {wanted!r} and column {column!r}"
        )
    return cells[0]


def json_value(document: Any, key: str, source: str) -> float:
    found = document
    for part in key.split("."):
        if isinstance(found, list) and part.isdigit() and int(part) < len(found):
            found = found[int(part)]
        elif isinstance(found, dict) and part in found:
            found = found[part]
        else:
            raise DashboardError(f"{source} has no value at {key!r}")
    if isinstance(found, bool) or not isinstance(found, int | float):
        raise DashboardError(f"{source} value at {key!r} is not a number")
    return float(found)


def resolve_point(spec: Mapping[str, Any], results: Mapping[str, ResultFile], base: Path) -> Point:
    variant = str(spec.get("variant", ""))
    note = str(spec.get("note", ""))
    if "json" in spec:
        source = str(spec["json"])
        path = base / source
        if not path.is_file():
            raise DashboardError(f"{source} does not exist")
        if "date" not in spec:
            raise DashboardError(f"{source} needs a date in the series file")
        value = json_value(json.loads(path.read_text(encoding="utf-8")), str(spec["key"]), source)
        return Point(str(spec["date"]), variant, value, source, note)
    name = str(spec["result"])
    if name not in results:
        raise DashboardError(f"{name} is not a result file")
    result = results[name]
    cell = find_cell(result, spec)
    found = numbers_in(cell)
    if "part" in spec:
        part = int(spec["part"])
        if part >= len(found):
            raise DashboardError(f"{name} cell {cell!r} has no number {part}")
        value = found[part]
    elif len(found) == 1:
        value = found[0]
    else:
        raise DashboardError(f"{name} cell {cell!r} holds {len(found)} numbers, give a part")
    return Point(str(spec.get("date", result.date)), variant, value, name, note)


def load_series(path: Path, results: Mapping[str, ResultFile]) -> tuple[Series, ...]:
    document = tomllib.loads(path.read_text(encoding="utf-8"))
    base = path.parent
    found: list[Series] = []
    for entry in document.get("series", []):
        points = tuple(
            sorted(
                (resolve_point(spec, results, base) for spec in entry.get("points", [])),
                key=lambda point: point.date,
            )
        )
        if not points:
            raise DashboardError(f"series {entry['id']} has no points")
        reference = (
            resolve_point(entry["reference"], results, base) if "reference" in entry else None
        )
        variants = tuple(dict.fromkeys(point.variant for point in points))
        better = str(entry.get("better", "higher"))
        if better not in ("higher", "lower"):
            raise DashboardError(f"series {entry['id']} better must be higher or lower")
        found.append(
            Series(
                id=str(entry["id"]),
                title=str(entry["title"]),
                unit=str(entry.get("unit", "")),
                better=better,
                points=points,
                reference=reference,
                description=str(entry.get("description", "")),
                variants=variants,
            )
        )
    return tuple(found)


def changes(series: Series) -> list[float | None]:
    last: dict[str, float] = {}
    found: list[float | None] = []
    for point in series.points:
        found.append(point.value - last[point.variant] if point.variant in last else None)
        last[point.variant] = point.value
    return found


def figure(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return text if text not in ("-0", "") else "0"


def signed(value: float | None) -> str:
    if value is None:
        return "first"
    if abs(value) < 1e-12:
        return "0"
    return f"+{figure(value)}" if value > 0 else figure(value)


def reading(series: Series) -> str:
    dates = sorted({point.date for point in series.points})
    low = min(point.value for point in series.points)
    high = max(point.value for point in series.points)
    unit = f" {series.unit}" if series.unit else ""
    span = f"from {dates[0]} to {dates[-1]}" if len(dates) > 1 else f"on {dates[0]}"
    return (
        f"{series.title}: {len(series.points)} values in {len(series.variants)} variants {span}, "
        f"between {figure(low)} and {figure(high)}{unit}, {series.better} is better"
    )


def chart(series: Series) -> str:
    width, height, left, right, top, bottom = 760, 240, 64, 240, 16, 40
    dates = sorted({point.date for point in series.points})
    values = [point.value for point in series.points]
    if series.reference is not None:
        values.append(series.reference.value)
    low, high = min(values), max(values)
    pad = (high - low) * 0.1 or abs(high) * 0.05 or 1.0
    low, high = low - pad, high + pad
    inner_width = width - left - right
    inner_height = height - top - bottom

    def x_of(date: str) -> float:
        if len(dates) == 1:
            return left + inner_width / 2
        return left + inner_width * dates.index(date) / (len(dates) - 1)

    def y_of(value: float) -> float:
        return top + inner_height * (high - value) / (high - low)

    parts = [
        f'<svg viewBox="0 0 {width} {height}" width="{width}" height="{height}" role="img" '
        f'aria-label="{html.escape(reading(series))}">',
        '<g aria-hidden="true" font-size="11" fill="#555">',
    ]
    for step in range(5):
        value = low + (high - low) * step / 4
        y = y_of(value)
        parts.append(
            f'<line x1="{left}" x2="{width - right}" y1="{y:.1f}" y2="{y:.1f}" stroke="#ddd"/>'
            f'<text x="{left - 6}" y="{y + 4:.1f}" text-anchor="end">{figure(value)}</text>'
        )
    for date in dates:
        parts.append(
            f'<text x="{x_of(date):.1f}" y="{height - bottom + 18}" '
            f'text-anchor="middle">{date}</text>'
        )
    if series.reference is not None:
        y = y_of(series.reference.value)
        label = html.escape(series.reference.variant or "reference")
        parts.append(
            f'<line x1="{left}" x2="{width - right}" y1="{y:.1f}" y2="{y:.1f}" '
            f'stroke="#222" stroke-dasharray="4 3"/>'
            f'<text x="{left + 4}" y="{y - 4:.1f}">{label}</text>'
        )
    parts.append("</g>")
    for index, variant in enumerate(series.variants):
        colour = COLOURS[index % len(COLOURS)]
        mine = [point for point in series.points if point.variant == variant]
        coordinates = [(x_of(point.date), y_of(point.value)) for point in mine]
        parts.append(f'<g aria-hidden="true" fill="{colour}" stroke="{colour}">')
        if len(coordinates) > 1:
            path = " ".join(f"{x:.1f},{y:.1f}" for x, y in coordinates)
            parts.append(f'<polyline points="{path}" fill="none" stroke-width="2"/>')
        for x, y in coordinates:
            parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="4"/>')
        legend_y = top + 14 * index + 8
        parts.append(
            f'<circle cx="{width - right + 10}" cy="{legend_y}" r="4"/>'
            f'<text x="{width - right + 20}" y="{legend_y + 4}" stroke="none" font-size="11">'
            f"{html.escape(variant or series.title)}</text>"
        )
        parts.append("</g>")
    parts.append("</svg>")
    return "".join(parts)


def run_rows(results: Mapping[str, ResultFile]) -> list[ResultFile]:
    return sorted(
        (result for result in results.values() if result.kind == EVALUATION_KIND),
        key=lambda result: (result.date, result.name),
    )


def link(source: str) -> str:
    return source if source.endswith(".json") else f"../results/{source}"


def series_table_html(series: Series) -> str:
    rows = []
    for point, change in zip(series.points, changes(series), strict=True):
        rows.append(
            "<tr>"
            f'<th scope="row">{html.escape(point.date)}</th>'
            f"<td>{html.escape(point.variant)}</td>"
            f"<td>{figure(point.value)}</td>"
            f"<td>{signed(change)}</td>"
            f'<td><a href="{html.escape(link(point.source))}">'
            f"{html.escape(point.source)}</a>{html.escape(' ' + point.note if point.note else '')}"
            "</td></tr>"
        )
    return (
        "<table><thead><tr>"
        '<th scope="col">Date</th><th scope="col">Variant</th>'
        f'<th scope="col">Value{html.escape(" (" + series.unit + ")" if series.unit else "")}</th>'
        '<th scope="col">Change</th><th scope="col">Source</th>'
        "</tr></thead><tbody>" + "".join(rows) + "</tbody></table>"
    )


STYLE = (
    "body{font:14px/1.5 system-ui,sans-serif;color:#1a1a1a;background:#fff;max-width:960px;"
    "margin:2rem auto;padding:0 1rem}table{border-collapse:collapse;margin:.5rem 0 1.5rem}"
    "th,td{border:1px solid #ccc;padding:.25rem .5rem;text-align:left}"
    "td:nth-child(3),td:nth-child(4){font-variant-numeric:tabular-nums}"
    "figure{margin:1.5rem 0}figcaption{font-weight:600}.note{color:#555}"
)


def render_html(series: Sequence[Series], results: Mapping[str, ResultFile]) -> str:
    runs = run_rows(results)
    sections = []
    for entry in series:
        reference = (
            f'<p class="note">Reference: {html.escape(entry.reference.variant)} '
            f"{figure(entry.reference.value)} from "
            f'<a href="{html.escape(link(entry.reference.source))}">'
            f"{html.escape(entry.reference.source)}</a>.</p>"
            if entry.reference is not None
            else ""
        )
        sections.append(
            f'<section id="{html.escape(entry.id)}"><figure>'
            f"<figcaption>{html.escape(entry.title)}</figcaption>"
            f"{chart(entry)}</figure>"
            f'<p class="note">{html.escape(entry.description)}</p>{reference}'
            f"{series_table_html(entry)}</section>"
        )
    run_table = "".join(
        f'<tr><th scope="row">{html.escape(result.date)}</th>'
        f'<td><a href="../results/{html.escape(result.name)}">{html.escape(result.title)}</a></td>'
        f"<td>{html.escape(result.backlog)}</td></tr>"
        for result in runs
    )
    return (
        '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>Parfocal evaluation dashboard</title><style>{STYLE}</style></head><body>"
        "<h1>Evaluation dashboard</h1>"
        f'<p class="note">Built by <code>python -m parfocal_ml.dashboard</code> from '
        f"{len(runs)} ML evaluation result files in docs/results. Every value is read from a "
        "committed result file or a stored evaluation output.</p>"
        + "".join(sections)
        + '<h2>Evaluation runs</h2><table><thead><tr><th scope="col">Date</th>'
        '<th scope="col">Result</th><th scope="col">Backlog</th></tr></thead><tbody>'
        + run_table
        + "</tbody></table></body></html>\n"
    )


def markdown_cell(text: str) -> str:
    return text.replace("|", "\\|")


def render_markdown(series: Sequence[Series], results: Mapping[str, ResultFile]) -> str:
    runs = run_rows(results)
    lines = [
        "# Evaluation dashboard",
        "",
        "Built by `python -m parfocal_ml.dashboard` from "
        f"{len(runs)} ML evaluation result files in [docs/results](../results/README.md). "
        "Every value is read from a committed result file or a stored evaluation output. "
        "The charts are in [dashboard.html](dashboard.html).",
        "",
    ]
    for entry in series:
        lines += [f"## {entry.title}", "", reading(entry) + ".", ""]
        if entry.description:
            lines += [entry.description, ""]
        if entry.reference is not None:
            lines += [
                f"Reference: {entry.reference.variant} {figure(entry.reference.value)} from "
                f"[{entry.reference.source}]({link(entry.reference.source)}).",
                "",
            ]
        unit = f" ({entry.unit})" if entry.unit else ""
        lines += [f"| Date | Variant | Value{unit} | Change | Source |", "|---|---|---|---|---|"]
        for point, change in zip(entry.points, changes(entry), strict=True):
            note = f" {point.note}" if point.note else ""
            source = f"[{point.source}]({link(point.source)}){note}"
            lines.append(
                f"| {point.date} | {markdown_cell(point.variant)} | {figure(point.value)} | "
                f"{signed(change)} | {markdown_cell(source)} |"
            )
        lines.append("")
    lines += ["## Evaluation runs", "", "| Date | Result | Backlog |", "|---|---|---|"]
    for result in runs:
        lines.append(
            f"| {result.date} | [{markdown_cell(result.title)}](../results/{result.name}) | "
            f"{markdown_cell(result.backlog)} |"
        )
    return "\n".join(lines) + "\n"


def build(results_folder: Path, series_file: Path, out: Path) -> tuple[Path, Path]:
    results = load_results(results_folder)
    series = load_series(series_file, results)
    out.mkdir(parents=True, exist_ok=True)
    page = out / "dashboard.html"
    summary = out / "dashboard.md"
    page.write_text(render_html(series, results), encoding="utf-8")
    summary.write_text(render_markdown(series, results), encoding="utf-8")
    return page, summary


def main(arguments: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="python -m parfocal_ml.dashboard")
    parser.add_argument("--results", type=Path, default=Path("docs/results"))
    parser.add_argument("--series", type=Path, default=Path("docs/evaluation/series.toml"))
    parser.add_argument("--out", type=Path, default=Path("docs/evaluation"))
    options = parser.parse_args(arguments)
    for path in build(options.results, options.series, options.out):
        print(path)


if __name__ == "__main__":
    main()
