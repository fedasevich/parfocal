# 0334. The evaluation dashboard is a static page built in Python from the committed result files through a series file

- Date: 2026-11-15
- Status: Accepted
- Deciders: Yurii Fedas (to confirm)
- Backlog: MLEVAL-009 (evaluation dashboard)

## Context

MLEVAL-009 asks that results from on-demand evaluation runs are published as a static report with trends. [ADR 0011](0011-hosted-ci-only.md) (hosted CI only) makes every ML evaluation an occasional run on Modal or the owner's Mac, recorded as a result file in `docs/results`. Those files are Markdown written for people. Their tables differ from run to run, and the same metric sits under different row and column names in different files. Only some evaluation commands, such as `parfocal_ml.ais_region` and `parfocal_ml.interactive`, also write a JSON summary, and none of those summaries are committed. [ADR 0144](0144-charts-hand-made-svg-with-visx.md) (charts) named Observable Plot as the natural choice for this offline report. No project data is read, so the sample project filter of [ADR 0139](0139-sample-project-flag-and-soft-delete.md) does not apply.

## Options considered

1. Guess trends by matching every table cell with the same row and column name across files. No upkeep, but almost no metric repeats under the same names, and a guessed match can pair two different measurements.
2. Ask every evaluation command to write a JSON record into the repository and chart only those. Clean data, but none exists yet, so the first report would be empty.
3. A small series file, `docs/evaluation/series.toml`, names each trend and, for each point, the result file, the row and the column it reads, or a JSON output and its key. A Python command reads the cells from the committed files and writes `docs/evaluation/dashboard.html` with hand-made SVG charts and `docs/evaluation/dashboard.md` with the same numbers as tables.

## Decision

Option 3. The generator is `python -m parfocal_ml.dashboard` (`pnpm --filter @parfocal/ml dashboard`) in `workers/ml`, standard library only. A point whose cell is missing, ambiguous or holds more than one number without a `part` stops the build, so no number is typed by hand or guessed. Charts are plain SVG with `role="img"` and a stated reading, and every chart is followed by its numbers as a table, as ADR 0144 asks. Plot is not used because it needs a browser or Node build step for three small charts. The page lists every result whose kind is "ML evaluation", so a new run shows up even before a series reads it.

## Consequences

- A new evaluation result needs a few lines in `series.toml` to join a trend, and the dashboard is rebuilt by hand after it. A test checks that the committed series still resolve against the committed results.
- An evaluation command that writes JSON can feed a series directly once its output is committed next to the series file.
- TODO: rebuild the dashboard when MLEVAL-005 (tumor map evaluation) records its first result.
