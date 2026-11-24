from dataclasses import dataclass, field, replace
from decimal import ROUND_HALF_UP, Decimal

from study import round4
from study.load import SUS_ITEMS, Attempt, Export, Session


def fixed(value: float | None, places: int = 1) -> str:
    if value is None:
        return "n/a"
    step = Decimal(1).scaleb(-places)
    return str(Decimal(repr(value)).quantize(step, rounding=ROUND_HALF_UP))


def median(values: list[float]) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def silent_total(attempts: list[Attempt]) -> int | None:
    known = [a.silent_control_clicks for a in attempts if a.silent_control_clicks is not None]
    return sum(known) if known else None


def mean(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def sus_score(answers: list[int | None] | None) -> float | None:
    if answers is None or len(answers) != SUS_ITEMS or any(value is None for value in answers):
        return None
    total = sum(
        (value - 1) if index % 2 == 0 else (5 - value) for index, value in enumerate(answers)
    )
    return 2.5 * total


@dataclass
class TaskRow:
    task: str
    title: str
    round4_task: str | None
    attempts: int
    successes: int
    times: list[float]
    clicks: list[int]
    dead_clicks: list[int]
    seqs: list[int]
    blocked: int

    @property
    def gave_up(self) -> int:
        return self.attempts - self.successes


@dataclass
class SusRow:
    participant: str
    session: str
    score: float | None
    answered: int
    source: str


@dataclass
class Overall:
    participants: int
    attempts: int
    successes: int
    seqs: list[int]
    clicks: int
    dead_clicks: int
    attempts_without_dead_click: int
    silent_control_clicks: int | None
    first_action_ms: float | None
    first_input_ms: float | None
    tasks_per_participant: int


@dataclass
class Analysis:
    sessions: list[Session]
    excluded: list[str]
    without_tasks: list[str]
    tasks: list[TaskRow]
    sus: list[SusRow]
    overall: Overall
    success_source: str
    warnings: list[str] = field(default_factory=list)

    @property
    def mean_sus(self) -> float | None:
        return mean([row.score for row in self.sus if row.score is not None])


def included(
    export: Export, exclude: set[str], round_number: int | None
) -> tuple[list[Session], list[str]]:
    kept, excluded = [], []
    for session in export.sessions:
        code = session.participant.upper()
        if (
            session.dry
            or code in exclude
            or (round_number is not None and session.round != round_number)
        ):
            excluded.append(session.participant)
        else:
            kept.append(session)
    return kept, excluded


def scored_sessions(sessions: list[Session], scored: dict[tuple[str, str], bool]) -> list[Session]:
    return [
        replace(
            session,
            attempts=[
                replace(
                    attempt,
                    success=scored.get(
                        (session.participant.upper(), attempt.task), attempt.success
                    ),
                )
                for attempt in session.attempts
            ],
        )
        for session in sessions
    ]


def task_order(export: Export, attempts: list[Attempt]) -> list[tuple[str, str]]:
    order = [entry for entry in export.task_order if any(a.task == entry[0] for a in attempts)]
    known = {task for task, _ in order}
    extra: dict[str, tuple[int, str]] = {}
    for attempt in attempts:
        if attempt.task not in known and attempt.task not in extra:
            extra[attempt.task] = (attempt.idx, attempt.title)
    order += [
        (task, title) for task, (_, title) in sorted(extra.items(), key=lambda item: item[1][0])
    ]
    return order


def task_rows(order: list[tuple[str, str]], sessions: list[Session]) -> list[TaskRow]:
    rows = []
    for task, title in order:
        attempts = [a for session in sessions for a in session.attempts if a.task == task]
        done = [a for a in attempts if a.success]
        rows.append(
            TaskRow(
                task=task,
                title=title,
                round4_task=task if task in round4.BY_ID else None,
                attempts=len(attempts),
                successes=len(done),
                times=[a.duration_ms / 1000 for a in done],
                clicks=[a.clicks for a in attempts],
                dead_clicks=[a.dead_clicks for a in attempts],
                seqs=[a.seq for a in attempts if a.seq is not None],
                blocked=sum(a.blocked for a in attempts),
            )
        )
    return rows


def sus_rows(sessions: list[Session], warnings: list[str]) -> list[SusRow]:
    rows = []
    for session in sessions:
        answered = sum(value is not None for value in session.sus or [])
        computed = sus_score(session.sus)
        if computed is not None:
            if session.sus_score is not None and session.sus_score != computed:
                warnings.append(
                    f"{session.participant}: the export's susScore {session.sus_score} "
                    "differs from "
                    f"{computed} recomputed from the answers, the table uses the recomputed score"
                )
            rows.append(
                SusRow(
                    session.participant,
                    session.id,
                    computed,
                    answered,
                    "recomputed from the ten answers",
                )
            )
        elif session.sus_score is not None and session.sus is None:
            rows.append(
                SusRow(
                    session.participant,
                    session.id,
                    session.sus_score,
                    answered,
                    "susScore in the export",
                )
            )
        else:
            rows.append(
                SusRow(session.participant, session.id, None, answered, "incomplete, not scored")
            )
    return rows


def analyse(
    export: Export,
    exclude: set[str] | None = None,
    scored: dict[tuple[str, str], bool] | None = None,
    round_number: int | None = None,
) -> Analysis:
    sessions, excluded = included(export, {code.upper() for code in exclude or set()}, round_number)
    warnings: list[str] = []
    app_source = "as recorded by the app (an automatic check or the participant pressing I'm done)"
    if scored:
        keys = {(s.participant.upper(), a.task) for s in sessions for a in s.attempts}
        matched = sum(key in scored for key in keys)
        sessions = scored_sessions(sessions, scored)
        source = (
            f"moderator-scored against the success rules for {matched} of {len(keys)} attempts, "
            f"the rest {app_source}"
        )
        warnings += [
            f"The scored CSV row {participant}, {task} matches no included attempt"
            for participant, task in sorted(set(scored) - keys)
        ]
    else:
        source = app_source
    attempts = [a for session in sessions for a in session.attempts]
    order = task_order(export, attempts)
    overall = Overall(
        participants=len({session.participant.upper() for session in sessions}),
        attempts=len(attempts),
        successes=sum(a.success for a in attempts),
        seqs=[a.seq for a in attempts if a.seq is not None],
        clicks=sum(a.clicks for a in attempts),
        dead_clicks=sum(a.dead_clicks for a in attempts),
        attempts_without_dead_click=sum(a.dead_clicks == 0 for a in attempts),
        silent_control_clicks=silent_total(attempts),
        first_action_ms=median(
            [a.first_action_ms for a in attempts if a.first_action_ms is not None]
        ),
        first_input_ms=median([a.first_input_ms for a in attempts if a.first_input_ms is not None]),
        tasks_per_participant=len(order),
    )
    return Analysis(
        sessions=sessions,
        excluded=excluded,
        without_tasks=export.without_tasks,
        tasks=task_rows(order, sessions),
        sus=sus_rows(sessions, warnings),
        overall=overall,
        success_source=source,
        warnings=warnings,
    )
