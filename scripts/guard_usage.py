import json
import os
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import cast

USAGE_DIR = Path(os.environ.get("CLAUDE_CONFIG_DIR", Path.home() / ".claude")) / "usage"
LATEST = USAGE_DIR / "latest.json"
WARNED = USAGE_DIR / "parfocal-warned.json"
PROJECT_DIR = Path(os.environ.get("CLAUDE_PROJECT_DIR", Path(__file__).resolve().parent.parent))
OVERRIDE = PROJECT_DIR / ".claude" / "usage-override.json"
BANDS = (80, 90, 95)
STALE_SECONDS = 15 * 60
DEFAULT_OVERRIDE_HOURS = 5.0
WINDOWS = {"five_hour": "5-hour session", "seven_day": "weekly"}

Reading = tuple[str, float, float | None]


def load(path: Path) -> dict[str, object]:
    try:
        return cast("dict[str, object]", json.loads(path.read_text()))
    except OSError, ValueError:
        return {}


def epoch(value: object) -> float | None:
    if value in (None, ""):
        return None
    try:
        stamp = float(cast("float", value))
        return stamp / 1000 if stamp > 1e12 else stamp
    except TypeError, ValueError:
        try:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00")).timestamp()
        except ValueError:
            return None


def clock(stamp: float | None) -> str:
    return datetime.fromtimestamp(stamp).strftime("%a %H:%M") if stamp else "unknown"


def readings(latest: dict[str, object]) -> list[Reading]:
    limits = cast("dict[str, dict[str, object]]", latest.get("rate_limits") or {})
    rows: list[Reading] = []
    for key, label in WINDOWS.items():
        window = limits.get(key) or {}
        percent = window.get("used_percentage")
        if percent is not None:
            rows.append((label, float(cast("float", percent)), epoch(window.get("resets_at"))))
    return rows


def summary(rows: list[Reading], age: float) -> str:
    text = "; ".join(
        f"{label} {percent:.0f}% used, resets {clock(reset)}" for label, percent, reset in rows
    )
    return text + (f" (reading is {age / 60:.0f} min old)" if age > STALE_SECONDS else "")


def override_until(override: dict[str, object], now: float) -> float | None:
    until = override.get("until")
    return (
        float(cast("float", until))
        if until is not None and float(cast("float", until)) > now
        else None
    )


def instruction(band: int) -> str:
    if band >= 95:
        return (
            "Stop now. Start no new work and spawn no agents. Leave the repo clean, record "
            "where you stopped and the exact next step with scripts/board.py note, commit and "
            "push only work that passes checks, tell the owner and end the turn. The owner can "
            "allow running to 100% with `python3 scripts/guard_usage.py override`."
        )
    if band >= 90:
        return (
            "Wrap up. Finish only the current small step, start nothing new, spawn no agents, "
            "then record progress and the next step so a later session can resume."
        )
    return (
        "Usage is getting high. Prefer cheap actions, avoid new subagents and plan a clean "
        "stopping point."
    )


def warning(
    event: dict[str, object],
    latest: dict[str, object],
    override: dict[str, object],
    warned: dict[str, int],
    now: float,
) -> str | None:
    rows = readings(latest)
    age = now - float(cast("float", latest.get("recorded_at", 0)))
    if not rows or age > STALE_SECONDS or override_until(override, now):
        return None
    worst = max(percent for _, percent, _ in rows)
    band = max((b for b in BANDS if worst >= b), default=0)
    reader = str(event.get("agent_id") or event.get("session_id") or "unknown")
    if not band or (band < 95 and warned.get(reader, 0) >= band):
        return None
    warned[reader] = band
    return f"Claude plan usage: {summary(rows, age)}. {instruction(band)}"


def hook() -> int:
    event = cast("dict[str, object]", json.load(sys.stdin))
    warned = cast("dict[str, int]", load(WARNED))
    message = warning(event, load(LATEST), load(OVERRIDE), warned, time.time())
    if message is None:
        return 0
    USAGE_DIR.mkdir(parents=True, exist_ok=True)
    WARNED.write_text(json.dumps(dict(list(warned.items())[-50:])))
    output = {
        "hookEventName": event.get("hook_event_name", "PostToolUse"),
        "additionalContext": message,
    }
    print(json.dumps({"hookSpecificOutput": output}))
    return 0


def status() -> int:
    latest = load(LATEST)
    rows = readings(latest)
    now = time.time()
    if not rows:
        print("No usage reading yet. The status line records one on its next refresh.")
    else:
        print(summary(rows, now - float(cast("float", latest.get("recorded_at", 0)))))
    until = override_until(load(OVERRIDE), now)
    print(
        f"Owner override active until {clock(until)}."
        if until
        else "No override. Wrap up at 90%, stop at 95%."
    )
    return 0


def override(args: list[str]) -> int:
    now = time.time()
    if args:
        until = now + float(args[0]) * 3600
    else:
        resets = [
            reset
            for label, _, reset in readings(load(LATEST))
            if label == WINDOWS["five_hour"] and reset
        ]
        until = resets[0] if resets and resets[0] > now else now + DEFAULT_OVERRIDE_HOURS * 3600
    OVERRIDE.parent.mkdir(parents=True, exist_ok=True)
    OVERRIDE.write_text(json.dumps({"until": until}))
    print(f"Override on until {clock(until)}. Agents may run to 100%.")
    return 0


def off() -> int:
    OVERRIDE.unlink(missing_ok=True)
    print("Override off. Wrap up at 90%, stop at 95%.")
    return 0


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "status"
    if command == "hook":
        return hook()
    if command == "override":
        return override(argv[1:])
    if command == "off":
        return off()
    return status()


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
