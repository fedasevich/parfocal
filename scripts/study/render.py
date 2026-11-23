import csv
import io

from study import round4
from study.analysis import Analysis, TaskRow, fixed, mean, median
from study.load import FINAL_KEYS, NOTE_KEYS

ROUND5_SOURCE = "Computed by scripts/study from the round 5 export"
SEQ_TOP = (6, 7)

NOTE_LABELS = {
    "like": "What did you like in this task?",
    "dislike": "What did you dislike?",
    "recommend": "What would you recommend?",
}
GIVE_UP_REASONS = {
    "where-to-look": "I did not know where to look",
    "found-nothing": "I looked in several places and found nothing",
    "unclear-task": "I was not sure what the task asked for",
    "did-not-work": "Something did not work as I expected",
    "other": "Another reason",
}
FINAL_LABELS = {
    "like": "What did you like?",
    "dislike": "What did you dislike?",
    "missing": "Was there anything you expected to find but could not?",
    "recommend": "What would you recommend?",
}


def span(values: list[float], places: int = 1) -> str:
    if not values:
        return "n/a"
    low, high = min(values), max(values)
    if low == high:
        return fixed(low, places)
    return f"{fixed(low, places)} to {fixed(high, places)}"


def of(part: int, whole: int) -> str:
    return f"{part} of {whole}"


def cell(value: object) -> str:
    return str(value).replace("|", "\\|").replace("\n", " ")


def markdown_table(header: list[str], rows: list[list[object]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(cell(value) for value in row) + " |" for row in rows]
    return "\n".join(lines) + "\n"


def csv_text(header: list[str], rows: list[list[object]]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow(header)
    writer.writerows(rows)
    return buffer.getvalue()


def round4_name(row: TaskRow) -> str:
    if row.round4_task is None:
        return "new in round 5"
    return round4.BY_ID[row.round4_task].name


def seq_top(seqs: list[int]) -> str:
    return of(sum(value in SEQ_TOP for value in seqs), len(seqs))


TASK_HEADER = [
    "#",
    "Task",
    "Round 4 task",
    "Success",
    "Gave up",
    "Median time (s)",
    "Time range (s)",
    "Median clicks",
    "Clicks range",
    "Dead clicks",
    "Median dead clicks",
    "SEQ mean",
    "SEQ median",
    "SEQ range",
    "SEQ 6 or 7",
    "Blocked",
]


def task_table(analysis: Analysis) -> list[list[object]]:
    return [
        [
            index,
            f"{row.title} ({row.task})",
            round4_name(row),
            of(row.successes, row.attempts),
            row.gave_up,
            fixed(median(row.times)),
            span(row.times),
            fixed(median(row.clicks)),
            span(row.clicks, 0),
            sum(row.dead_clicks),
            fixed(median(row.dead_clicks)),
            fixed(mean(row.seqs)),
            fixed(median(row.seqs)),
            span(row.seqs, 0),
            seq_top(row.seqs),
            row.blocked,
        ]
        for index, row in enumerate(analysis.tasks, start=1)
    ]


TASK_CSV_HEADER = [
    "task",
    "title",
    "round4_task",
    "attempts",
    "successes",
    "gave_up",
    "median_time_s",
    "min_time_s",
    "max_time_s",
    "median_clicks",
    "min_clicks",
    "max_clicks",
    "dead_clicks",
    "median_dead_clicks",
    "seq_answers",
    "seq_mean",
    "seq_median",
    "seq_min",
    "seq_max",
    "seq_6_or_7",
    "blocked",
]


def raw(value: float | None) -> object:
    return "" if value is None else round(value, 3)


def task_csv(analysis: Analysis) -> list[list[object]]:
    return [
        [
            row.task,
            row.title,
            row.round4_task or "",
            row.attempts,
            row.successes,
            row.gave_up,
            raw(median(row.times)),
            raw(min(row.times, default=None)),
            raw(max(row.times, default=None)),
            raw(median(row.clicks)),
            raw(min(row.clicks, default=None)),
            raw(max(row.clicks, default=None)),
            sum(row.dead_clicks),
            raw(median(row.dead_clicks)),
            len(row.seqs),
            raw(mean(row.seqs)),
            raw(median(row.seqs)),
            raw(min(row.seqs, default=None)),
            raw(max(row.seqs, default=None)),
            sum(value in SEQ_TOP for value in row.seqs),
            row.blocked,
        ]
        for row in analysis.tasks
    ]


SUS_HEADER = ["Participant", "Session", "SUS", "Items answered", "Score source"]


def sus_table(analysis: Analysis) -> list[list[object]]:
    return [
        [row.participant, row.session, fixed(row.score), f"{row.answered} of 10", row.source]
        for row in analysis.sus
    ]


def sus_csv(analysis: Analysis) -> list[list[object]]:
    return [
        [row.participant, row.session, raw(row.score), row.answered, row.source]
        for row in analysis.sus
    ]


def percent(part: int, whole: int) -> str:
    if whole == 0:
        return "n/a"
    return f"{fixed(100 * part / whole, 0)}%"


COMPARISON_HEADER = ["Measure", "Round 4", "Round 4 source", "Round 5", "Round 5 source", "Note"]


def comparison_table(analysis: Analysis) -> list[list[object]]:
    overall = analysis.overall
    scored = [row for row in analysis.sus if row.score is not None]
    five = f"{ROUND5_SOURCE}, {overall.participants} participants"
    round4_sus = ", ".join(
        f"{code} {fixed(score, 0)}" for code, score in round4.SUS_PER_PARTICIPANT
    )
    round5_sus = ", ".join(f"{row.participant} {fixed(row.score)}" for row in scored) or "n/a"
    shared = sum(row.round4_task is not None for row in analysis.tasks)
    return [
        [
            "Participants",
            round4.PARTICIPANTS,
            round4.METHOD,
            overall.participants,
            five,
            "Round 4 was unmoderated on a clickable prototype, "
            "round 5 is moderated on the application",
        ],
        [
            "Tasks per participant",
            round4.TASKS,
            round4.METHOD,
            overall.tasks_per_participant,
            five,
            f"{shared} task ids are shared with round 4, see the per-task table",
        ],
        [
            "Tasks completed",
            of(*round4.COMPLETED),
            round4.RESULTS,
            of(overall.successes, overall.attempts),
            five,
            f"Round 5 success is {analysis.success_source}. Round 4 had no give-up button",
        ],
        [
            "Mean SEQ (1 to 7)",
            round4.MEAN_SEQ,
            round4.RESULTS,
            fixed(mean(overall.seqs)),
            five,
            "Same question and scale in both rounds",
        ],
        [
            "Tasks rated 6 or 7",
            of(*round4.SEQ_SIX_OR_SEVEN),
            round4.RESULTS,
            seq_top(overall.seqs),
            five,
            "Round 5 counts answered SEQ only",
        ],
        [
            "Dead clicks, share of task clicks",
            f"{round4.DEAD_CLICK_SHARE} ({of(*round4.DEAD_CLICKS)})",
            round4.MOVEMENT,
            f"{percent(overall.dead_clicks, overall.clicks)} "
            f"({of(overall.dead_clicks, overall.clicks)})",
            five,
            "Not the same measure. Round 4 counted a click on nothing clickable, "
            "round 5 counts a click on a control after which the page did not change "
            "within 800 ms",
        ],
        [
            "Tasks with no dead click",
            of(*round4.TASKS_WITHOUT_DEAD_CLICK),
            round4.MOVEMENT,
            of(overall.attempts_without_dead_click, overall.attempts),
            five,
            "Same caveat as the dead click share",
        ],
        [
            "Median time from reading a task to the first action",
            f"{round4.FIRST_ACTION_SECONDS} s",
            round4.MOVEMENT,
            "not recorded in the export",
            "Round 5 task records hold no first action time",
            "Only the session replay could give it",
        ],
        [
            "Mean SUS",
            round4.MEAN_SUS,
            round4.RESULTS,
            fixed(analysis.mean_sus),
            f"{ROUND5_SOURCE}, {len(scored)} scored participants",
            "Same ten items, wording and scoring",
        ],
        [
            "SUS per participant",
            round4_sus,
            round4.RESULTS,
            round5_sus,
            five,
            "Codes are per round and do not name the same people",
        ],
        [
            "SUS in round 1",
            fixed(round4.ROUND1_SUS),
            round4.BEFORE_AFTER,
            "",
            "",
            "Round 1 had one participant, quoted for the chart across rounds",
        ],
    ]


PER_TASK_HEADER = [
    "Task",
    "Round 4 median time (s)",
    "Round 4 SEQ",
    "Round 4 source",
    "Round 5 median time (s)",
    "Round 5 SEQ mean",
    "Round 5 source",
    "Comparability",
]


def per_task_table(analysis: Analysis) -> list[list[object]]:
    rows = []
    by_task = {row.task: row for row in analysis.tasks}
    for task in round4.TASK_FIGURES:
        row = by_task.get(task.id)
        rows.append(
            [
                f"{task.name} ({task.id})",
                task.median_seconds,
                task.seq,
                round4.PER_TASK,
                "no round 5 data" if row is None else fixed(median(row.times)),
                "no round 5 data" if row is None else fixed(mean(row.seqs)),
                "" if row is None else ROUND5_SOURCE,
                round4.COMPARABILITY[task.id],
            ]
        )
    for row in analysis.tasks:
        if row.round4_task is None:
            rows.append(
                [
                    f"{row.title} ({row.task})",
                    "new in round 5",
                    "new in round 5",
                    "",
                    fixed(median(row.times)),
                    fixed(mean(row.seqs)),
                    ROUND5_SOURCE,
                    "New task, nothing to compare",
                ]
            )
    return rows


def notes_markdown(analysis: Analysis) -> str:
    lines = [
        "# Notes grouped by task",
        "",
        "Quoted word for word from the export. Empty answers are left out.",
        "",
    ]
    for row in analysis.tasks:
        lines += [f"## {row.title} ({row.task})", ""]
        found = False
        for session in analysis.sessions:
            for attempt in session.attempts:
                if attempt.task != row.task:
                    continue
                for key in NOTE_KEYS:
                    if key in attempt.notes:
                        lines.append(
                            f'- {session.participant}, {NOTE_LABELS[key]} "{attempt.notes[key]}"'
                        )
                        found = True
                if not attempt.success and attempt.reason:
                    reason = GIVE_UP_REASONS.get(attempt.reason, attempt.reason)
                    lines.append(f'- {session.participant} gave up, reason: "{reason}"')
                    found = True
        if not found:
            lines.append("- No notes.")
        lines.append("")
    lines += ["## The questions at the end", ""]
    for key in FINAL_KEYS:
        lines += [f"### {FINAL_LABELS[key]}", ""]
        answers = [
            f'- {s.participant}: "{s.open[key]}"' for s in analysis.sessions if key in s.open
        ]
        lines += (answers or ["- No answers."]) + [""]
    return "\n".join(lines)


ATTEMPT_HEADER = [
    "participant",
    "session",
    "round",
    "id",
    "idx",
    "title",
    "success",
    "durationMs",
    "clicks",
    "deadClicks",
    "blocked",
    "keys",
    "wheels",
    "seq",
    "like",
    "dislike",
    "recommend",
    "reason",
]


def attempt_csv(analysis: Analysis) -> list[list[object]]:
    return [
        [
            session.participant,
            session.id,
            session.round,
            a.task,
            a.idx,
            a.title,
            "true" if a.success else "false",
            int(a.duration_ms),
            a.clicks,
            a.dead_clicks,
            a.blocked,
            a.keys,
            a.wheels,
            "" if a.seq is None else a.seq,
            a.notes.get("like", ""),
            a.notes.get("dislike", ""),
            a.notes.get("recommend", ""),
            a.reason or "",
        ]
        for session in analysis.sessions
        for a in session.attempts
    ]
