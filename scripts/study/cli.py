import argparse
import sys
from pathlib import Path

from study import charts, render
from study.analysis import Analysis, analyse
from study.load import ExportError, read_exports, read_scored

PLACES = {
    "tasks.md": "Chapter 4, usability test of the application, results per task. "
    "Full table in appendix D",
    "sus.md": "Chapter 4, usability test of the application, SUS. "
    "Appendix D keeps every participant's row",
    "comparison.md": "Section 3.3 closing the rounds, and chapter 4 against round 4",
    "per-task-comparison.md": "Appendix D, with a short summary in chapter 4",
    "notes.md": "Appendix D, quoted in chapter 4 where a finding rests on them",
    "seq-per-task.svg": "Chapter 4, figure of SEQ per task",
    "sus-by-round.svg": "Section 3.3 or chapter 4, figure of SUS across rounds",
    "attempts.csv": "Appendix D, raw data, one row per task attempt",
}


def summary(analysis: Analysis, inputs: list[Path]) -> str:
    lines = [
        "# Round 5 study tables",
        "",
        "Written by `python3 scripts/study`. The protocol is docs/project/study-round-5.md. "
        "Descriptive only, with no significance tests.",
        "",
        f"- Inputs: {', '.join(path.name for path in inputs)}",
        f"- Participants included: {analysis.overall.participants}, "
        f"task attempts {analysis.overall.attempts}",
        f"- Excluded as dry runs or by --exclude: {', '.join(analysis.excluded) or 'none'}",
        f"- Sessions without task records, left out: {', '.join(analysis.without_tasks) or 'none'}",
        f"- Success column: {analysis.success_source}",
        "- Times are for successful attempts only. "
        "Clicks, dead clicks and SEQ cover every attempt.",
        "",
    ]
    if analysis.warnings:
        lines += ["## Warnings", ""] + [f"- {warning}" for warning in analysis.warnings] + [""]
    lines += ["## Where each file goes in the thesis", ""]
    lines += [f"- `{name}`: {place}." for name, place in PLACES.items()]
    return "\n".join(lines) + "\n"


def outputs(analysis: Analysis, inputs: list[Path]) -> dict[str, str]:
    files = {
        "README.md": summary(analysis, inputs),
        "tasks.md": "# Results per task\n\n"
        + f"Success: {analysis.success_source}.\n\n"
        + render.markdown_table(render.TASK_HEADER, render.task_table(analysis)),
        "tasks.csv": render.csv_text(render.TASK_CSV_HEADER, render.task_csv(analysis)),
        "sus.md": "# SUS per participant\n\n"
        + render.markdown_table(render.SUS_HEADER, render.sus_table(analysis))
        + f"\nMean SUS: {render.fixed(analysis.mean_sus)} over "
        + f"{sum(row.score is not None for row in analysis.sus)} scored participants.\n",
        "sus.csv": render.csv_text(
            ["participant", "session", "sus", "items_answered", "source"], render.sus_csv(analysis)
        ),
        "comparison.md": "# Round 4 against round 5\n\n"
        + "Round 4 figures are quoted from the round 4 deck and never recomputed.\n\n"
        + render.markdown_table(render.COMPARISON_HEADER, render.comparison_table(analysis)),
        "comparison.csv": render.csv_text(
            render.COMPARISON_HEADER, render.comparison_table(analysis)
        ),
        "per-task-comparison.md": "# Round 4 against round 5 per task\n\n"
        + render.markdown_table(render.PER_TASK_HEADER, render.per_task_table(analysis)),
        "per-task-comparison.csv": render.csv_text(
            render.PER_TASK_HEADER, render.per_task_table(analysis)
        ),
        "notes.md": render.notes_markdown(analysis),
        "attempts.csv": render.csv_text(render.ATTEMPT_HEADER, render.attempt_csv(analysis)),
        "seq-per-task.svg": charts.seq_chart(analysis),
        "sus-by-round.svg": charts.sus_chart(analysis),
    }
    return files


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="scripts/study", description="Turn a round 5 study export into thesis tables"
    )
    parser.add_argument(
        "exports",
        nargs="+",
        type=Path,
        help="JSON from the console's Download results, or a CSV with the same field names",
    )
    parser.add_argument("--out", required=True, type=Path, help="Folder for the tables and figures")
    parser.add_argument(
        "--exclude",
        action="append",
        default=[],
        metavar="CODE",
        help="A dry run or pilot participant code to leave out",
    )
    parser.add_argument(
        "--scored", type=Path, help="CSV of participant, task, success scored by the moderator"
    )
    parser.add_argument(
        "--round", type=int, dest="round_number", help="Keep only sessions of this console round"
    )
    arguments = parser.parse_args(argv)
    try:
        export = read_exports(arguments.exports)
        scored = read_scored(arguments.scored) if arguments.scored else None
    except (ExportError, OSError, ValueError) as error:
        sys.stderr.write(f"study: {error}\n")
        return 1
    analysis = analyse(export, set(arguments.exclude), scored, arguments.round_number)
    arguments.out.mkdir(parents=True, exist_ok=True)
    for name, content in outputs(analysis, arguments.exports).items():
        (arguments.out / name).write_text(content, encoding="utf-8")
    sys.stdout.write(
        f"study: {analysis.overall.participants} participants, "
        f"{analysis.overall.attempts} attempts, "
        f"{len(analysis.excluded)} excluded, written to {arguments.out}\n"
    )
    return 0
