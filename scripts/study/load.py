import csv
import json
from dataclasses import dataclass, field
from pathlib import Path

NOTE_KEYS = ("like", "dislike", "recommend")
FINAL_KEYS = ("like", "dislike", "missing", "recommend")
SUS_ITEMS = 10
COUNT_FIELDS = ("clicks", "deadClicks", "blocked", "keys", "wheels")
TRUE_WORDS = {"true", "yes", "y", "1", "done", "success"}
FALSE_WORDS = {"false", "no", "n", "0", "gave-up", "failed", "fail"}


class ExportError(ValueError):
    pass


@dataclass
class Attempt:
    task: str
    idx: int
    title: str
    success: bool
    duration_ms: float
    clicks: int
    dead_clicks: int
    blocked: int
    keys: int
    wheels: int
    seq: int | None
    notes: dict[str, str]
    reason: str | None
    silent_control_clicks: int | None = None
    first_action_ms: float | None = None
    first_input_ms: float | None = None


@dataclass
class Session:
    id: str
    participant: str
    round: int
    dry: bool
    attempts: list[Attempt] = field(default_factory=list)
    sus: list[int | None] | None = None
    sus_score: float | None = None
    open: dict[str, str] = field(default_factory=dict)
    finished: bool = False


@dataclass
class Export:
    sessions: list[Session]
    task_order: list[tuple[str, str]]
    without_tasks: list[str]


def flag(value: object) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    text = str(value).strip().lower()
    if text in TRUE_WORDS:
        return True
    if text in FALSE_WORDS:
        return False
    return None


def number(value: object) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except TypeError, ValueError:
        raise ExportError(f"{value!r} is not a number") from None


def integer(value: object, default: int = 0) -> int:
    parsed = number(value)
    return default if parsed is None else int(parsed)


def optional_integer(value: object) -> int | None:
    parsed = number(value)
    return None if parsed is None else int(parsed)


def text(value: object) -> str | None:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def attempt_of(record: dict, notes: dict) -> Attempt:
    task = text(record.get("id")) or text(record.get("taskId")) or text(record.get("task"))
    if task is None:
        raise ExportError("A task record has no id")
    success = flag(record.get("success"))
    if success is None:
        raise ExportError(f"Task {task} has no success value")
    duration = number(record.get("durationMs"))
    if duration is None:
        raise ExportError(f"Task {task} has no durationMs")
    kept = {key: value for key in NOTE_KEYS if (value := text(notes.get(key))) is not None}
    return Attempt(
        task=task,
        idx=integer(record.get("idx"), -1),
        title=text(record.get("title")) or task,
        success=success,
        duration_ms=duration,
        clicks=integer(record.get("clicks")),
        dead_clicks=integer(record.get("deadClicks")),
        blocked=integer(record.get("blocked")),
        keys=integer(record.get("keys")),
        wheels=integer(record.get("wheels")),
        seq=optional_integer(record.get("seq")),
        notes=kept,
        reason=text(record.get("reason")),
        silent_control_clicks=optional_integer(record.get("silentControlClicks")),
        first_action_ms=number(record.get("timeToFirstActionMs")),
        first_input_ms=number(record.get("timeToFirstInputMs")),
    )


def is_dry(raw: dict) -> bool:
    return any(flag(raw.get(key)) for key in ("dryRun", "dry", "pilot"))


def session_from_json(raw: dict) -> Session | None:
    records = raw.get("tasks")
    if not records:
        return None
    final = raw.get("final") or {}
    sus = final.get("sus")
    return Session(
        id=str(raw.get("id") or raw.get("participant")),
        participant=str(raw.get("participant", "")).strip(),
        round=integer(raw.get("round"), 1),
        dry=is_dry(raw),
        attempts=[attempt_of(record, record.get("notes") or {}) for record in records],
        sus=None if sus is None else [optional_integer(value) for value in sus],
        sus_score=number(final.get("susScore")),
        open={
            key: value for key in FINAL_KEYS if (value := text((final.get("open") or {}).get(key)))
        },
        finished=final.get("finishedAt") is not None,
    )


def read_json(path: Path) -> tuple[list[Session], list[tuple[str, str]], list[str]]:
    data = json.loads(path.read_text(encoding="utf-8"))
    order: list[tuple[str, str]] = []
    if isinstance(data, dict) and "sessions" in data:
        rounds = data.get("rounds") or []
        if rounds:
            order = [(task["id"], task.get("title", task["id"])) for task in rounds[-1]["tasks"]]
        raws = data["sessions"]
    elif isinstance(data, list):
        raws = data
    elif isinstance(data, dict):
        raws = [data]
    else:
        raise ExportError(f"{path} is not a study export")
    sessions, skipped = [], []
    for raw in raws:
        session = session_from_json(raw)
        if session is None:
            skipped.append(str(raw.get("participant", raw.get("id", "?"))))
        else:
            sessions.append(session)
    return sessions, order, skipped


def column(row: dict, *names: str) -> str | None:
    for name in names:
        value = text(row.get(name))
        if value is not None:
            return value
    return None


def read_csv(path: Path) -> list[Session]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    sessions: dict[str, Session] = {}
    for row in rows:
        participant = column(row, "participant")
        if participant is None:
            raise ExportError(f"{path} has a row without a participant")
        key = column(row, "session", "sessionId") or participant
        session = sessions.get(key)
        if session is None:
            session = Session(
                id=key,
                participant=participant,
                round=integer(column(row, "round"), 1),
                dry=is_dry(row),
            )
            sessions[key] = session
        notes = {name: column(row, name, f"notes.{name}") for name in NOTE_KEYS}
        session.attempts.append(attempt_of(row, notes))
        answers = [
            column(row, f"sus{index}", f"final.sus{index}") for index in range(1, SUS_ITEMS + 1)
        ]
        if session.sus is None and any(answer is not None for answer in answers):
            session.sus = [optional_integer(answer) for answer in answers]
        score = column(row, "susScore", "final.susScore")
        if session.sus_score is None and score is not None:
            session.sus_score = number(score)
        for name in FINAL_KEYS:
            value = column(row, f"final.{name}")
            if value is not None and name not in session.open:
                session.open[name] = value
        if flag(column(row, "finished", "final.finished")):
            session.finished = True
    return list(sessions.values())


def completeness(session: Session) -> tuple[bool, int, int]:
    answered = sum(value is not None for value in session.sus or [])
    return session.finished, len(session.attempts), answered


def read_exports(paths: list[Path]) -> Export:
    merged: dict[str, Session] = {}
    order: list[tuple[str, str]] = []
    skipped: list[str] = []
    for path in paths:
        if path.suffix.lower() == ".csv":
            sessions, found = read_csv(path), []
        else:
            sessions, found, missing = read_json(path)
            skipped.extend(missing)
        order = order or found
        for session in sessions:
            known = merged.get(session.id)
            if known is None or completeness(session) > completeness(known):
                merged[session.id] = session
    return Export(sessions=list(merged.values()), task_order=order, without_tasks=skipped)


def read_scored(path: Path) -> dict[tuple[str, str], bool]:
    with path.open(newline="", encoding="utf-8-sig") as handle:
        rows = list(csv.DictReader(handle))
    scored = {}
    for row in rows:
        participant = column(row, "participant")
        task = column(row, "task", "id")
        success = flag(column(row, "success"))
        if participant is None or task is None or success is None:
            raise ExportError(f"{path} needs participant, task and success on every row")
        scored[(participant.upper(), task)] = success
    return scored
