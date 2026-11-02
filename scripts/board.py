import argparse
import contextlib
import json
import re
import sys
import webbrowser
from dataclasses import asdict, dataclass, field
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent.parent
TEMPLATE = Path(__file__).resolve().parent / "board.html"
ACTIVE_DIR = Path("docs/board/active")

TASK_ID = re.compile(r"\b([A-Z][A-Z0-9]*-\d{3})\b")
EPIC_HEADING = re.compile(r"^## (\d+) ([A-Z][A-Z0-9]*) · (.+)$")
EPIC_ROW = re.compile(r"^\| (\d+) \| ([A-Z][A-Z0-9]*) \| (.+?) \| (.+?) \|$")
MILESTONE_ROW = re.compile(r"^\| (M\d) ([^|]+?) \| ([^|]+?) \| ([^|]+?) \|$")
TASK_LINE = re.compile(r"^- \[( |x)\] ([A-Z][A-Z0-9]*-\d{3}) · (.+)$")
DEPENDS = re.compile(r"Depends on (.+?)(?:\.(?=\s|$)|$)")
DEP_FILLER = re.compile(r"^[\s,]*(?:and[\s,]*)*$")
LOG_DATE = re.compile(r"^## (\d{4}-\d{2}-\d{2})$")
DOC_TITLE = re.compile(r"^# (.+)$", re.MULTILINE)
ADR_STATUS = re.compile(r"^- Status: (.+)$", re.MULTILINE)
ADR_DATE = re.compile(r"^- Date: (.+)$", re.MULTILINE)
ACTIVE_FIELD = re.compile(r"^([a-z]+): ?(.*)$")
PARKED = re.compile(r"\((?:moved|dropped)\)$")
MARKER = re.compile(r"^(Size|Needs): (.+?)\.?$")
DONE_WHEN = re.compile(r"Done when (.+?)(?:\.(?=\s|$)|$)")
CHECK_KINDS = (
    re.compile(r"\btests?\b|pytest|node:test|test_\w+", re.IGNORECASE),
    re.compile(r"Playwright|\bE2E\b|end-to-end", re.IGNORECASE),
    re.compile(r"Storybook|\bstor(?:y|ies)\b", re.IGNORECASE),
    re.compile(r"\bADR\b"),
    re.compile(r"measure|benchmark|result file|\bp95\b|\bfps\b", re.IGNORECASE),
    re.compile(r"staging|production|deploy|\bCI\b"),
    re.compile(r"golden", re.IGNORECASE),
    re.compile(r"\bspike\b", re.IGNORECASE),
)
LARGE_WORDS = re.compile(
    r"OpenTofu|\btofu\b|realtime|WebSocket|presence|residency|Kubernetes|cluster", re.IGNORECASE
)

ACTIVE_STATUSES = ("in-progress", "review", "blocked", "on-hold")
ACTIVE_FIELDS = ("status", "by", "branch", "since", "note")
README_SECTIONS = ("In progress", "Where we are now", "Next up")
SIZES = ("S", "M", "L")
NEEDS = ("owner",)


@dataclass
class Active:
    status: str
    by: str = ""
    branch: str = ""
    since: str = ""
    note: str = ""
    details: str = ""


@dataclass
class Task:
    id: str
    epic: str
    group: str
    title: str
    done: bool
    body: str
    line: int
    deps: list[str] = field(default_factory=list[str])
    dep_note: str = ""
    dependents: list[str] = field(default_factory=list[str])
    docs: list[str] = field(default_factory=list[str])
    active: Active | None = None
    status: str = "ready"
    size: str = ""
    size_source: str = ""
    needs: list[str] = field(default_factory=list[str])
    bad_markers: list[str] = field(default_factory=list[str])
    unblocks_total: int = 0


@dataclass
class Epic:
    id: str
    number: str
    name: str
    milestone: str


@dataclass
class Doc:
    path: str
    title: str
    kind: str
    ids: list[str]
    status: str = ""
    date: str = ""


@dataclass
class LogEntry:
    date: str
    text: str
    ids: list[str]


@dataclass
class Board:
    tasks: dict[str, Task]
    epics: list[Epic]
    milestones: list[dict[str, str]]
    docs: list[Doc]
    log: list[LogEntry]
    overview: dict[str, str]


def unique(items: list[str]) -> list[str]:
    return list(dict.fromkeys(items))


def parse_depends(body: str) -> tuple[list[str], str]:
    deps: list[str] = []
    notes: list[str] = []
    for sentence in DEPENDS.findall(" ".join(body.split())):
        ids = TASK_ID.findall(sentence)
        deps.extend(ids)
        if not DEP_FILLER.match(TASK_ID.sub("", sentence)):
            notes.append(f"Depends on {sentence}.")
    return unique(deps), " ".join(notes)


def guess_size(body: str) -> str:
    flat = " ".join(body.split())
    done_when = " ".join(DONE_WHEN.findall(flat))
    kinds = sum(1 for kind in CHECK_KINDS if kind.search(done_when))
    if len(flat) > 1000 or kinds >= 3 or LARGE_WORDS.search(flat):
        return "L"
    if len(flat) > 600 or kinds == 2:
        return "M"
    return "S"


def apply_markers(task: Task) -> None:
    for line in task.body.splitlines():
        match = MARKER.match(line.strip())
        if not match:
            continue
        name, value = match.groups()
        values = [part.strip() for part in re.split(r",| and ", value) if part.strip()]
        allowed = SIZES if name == "Size" else NEEDS
        unknown = [v for v in values if v not in allowed]
        if unknown or (name == "Size" and len(values) != 1):
            task.bad_markers.append(line.strip())
        elif name == "Size":
            task.size, task.size_source = values[0], "written"
        else:
            task.needs = unique(task.needs + values)
    if not task.size:
        task.size, task.size_source = guess_size(task.body), "guess"


def open_downstream(task_id: str, tasks: dict[str, Task]) -> int:
    seen: set[str] = set()
    stack = [task_id]
    while stack:
        for child in tasks[stack.pop()].dependents:
            if child not in seen and not tasks[child].done:
                seen.add(child)
                stack.append(child)
    return len(seen)


def parse_backlog(text: str) -> tuple[list[Task], list[Epic], list[dict[str, str]]]:
    milestones_by_epic: dict[str, tuple[str, str]] = {}
    milestones: list[dict[str, str]] = []
    tasks: list[Task] = []
    epics: list[Epic] = []
    epic = ""
    group = ""
    current: Task | None = None
    body: list[str] = []

    def finish() -> None:
        if current is not None:
            current.body = "\n".join(body).strip()
            current.deps, current.dep_note = parse_depends(current.body)
            apply_markers(current)
            tasks.append(current)

    for number, raw in enumerate(text.splitlines(), start=1):
        line = raw.rstrip()
        if match := EPIC_ROW.match(line):
            milestones_by_epic[match.group(2)] = (match.group(3), match.group(4))
            continue
        if match := MILESTONE_ROW.match(line):
            milestones.append(
                {
                    "id": match.group(1),
                    "name": match.group(2),
                    "meaning": match.group(3),
                    "gate": match.group(4),
                }
            )
            continue
        if line.startswith("#"):
            finish()
            current = None
            if match := EPIC_HEADING.match(line):
                epic = match.group(2)
                group = ""
                milestone = milestones_by_epic.get(epic, ("", ""))[1]
                epics.append(Epic(epic, match.group(1), match.group(3), milestone))
            elif line.startswith("### ") and epic:
                group = line[4:]
            elif line.startswith("## "):
                epic = ""
            continue
        if epic and (match := TASK_LINE.match(line)):
            finish()
            current = Task(
                id=match.group(2),
                epic=epic,
                group=group,
                title=match.group(3),
                done=match.group(1) == "x",
                body="",
                line=number,
            )
            body = []
            continue
        if current is not None:
            if line.startswith("  ") or not line:
                body.append(line[2:])
            else:
                finish()
                current = None
    finish()
    return tasks, epics, milestones


def parse_active(text: str) -> Active:
    head, _, details = text.strip().partition("\n\n")
    fields = {
        match.group(1): match.group(2).strip()
        for line in head.splitlines()
        if (match := ACTIVE_FIELD.match(line))
    }
    return Active(
        status=fields.get("status", ""),
        by=fields.get("by", ""),
        branch=fields.get("branch", ""),
        since=fields.get("since", ""),
        note=fields.get("note", ""),
        details=details.strip(),
    )


def write_active(root: Path, task_id: str, active: Active) -> Path:
    path = root / ACTIVE_DIR / f"{task_id}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    head = [f"{key}: {getattr(active, key)}" for key in ACTIVE_FIELDS if getattr(active, key)]
    tail = ["", active.details] if active.details else []
    path.write_text("\n".join([*head, *tail]) + "\n")
    return path


def read_active(root: Path) -> dict[str, Active]:
    folder = root / ACTIVE_DIR
    if not folder.is_dir():
        return {}
    return {path.stem: parse_active(path.read_text()) for path in sorted(folder.glob("*.md"))}


def parse_log(text: str) -> list[LogEntry]:
    entries: list[LogEntry] = []
    day = ""
    for line in text.splitlines():
        if match := LOG_DATE.match(line):
            day = match.group(1)
        elif day and line.startswith("- "):
            entries.append(LogEntry(day, line[2:], unique(TASK_ID.findall(line))))
    return entries


def add_log_entry(text: str, day: str, entry: str) -> str:
    lines = text.splitlines()
    bullet = f"- {entry.strip()}"
    first = next((i for i, line in enumerate(lines) if LOG_DATE.match(line)), len(lines))
    if first < len(lines) and lines[first] == f"## {day}":
        blank_after_heading = lines[first + 1 : first + 2] == [""]
        lines.insert(first + 2 if blank_after_heading else first + 1, bullet)
    else:
        lines[first:first] = [f"## {day}", "", bullet, ""]
    return "\n".join(lines) + "\n"


def tick_backlog(text: str, task_id: str) -> str | None:
    pattern = re.compile(rf"^- \[ \] {re.escape(task_id)} · ", re.MULTILINE)
    if not pattern.search(text):
        return None
    return pattern.sub(f"- [x] {task_id} · ", text, count=1)


def find_tasks(tasks: dict[str, Task], query: str) -> list[Task]:
    words = query.lower().split()
    return [
        task
        for task in tasks.values()
        if all(word in f"{task.id} {task.title}".lower() for word in words)
    ]


def doc_kind(relative: Path) -> str:
    parts = relative.parts
    return parts[1] if len(parts) > 2 else "docs"


def parse_docs(root: Path) -> list[Doc]:
    docs: list[Doc] = []
    skip = {"docs/BACKLOG.md", "docs/log.md"}
    for path in sorted((root / "docs").rglob("*.md")):
        relative = path.relative_to(root)
        key = relative.as_posix()
        if key in skip or key.startswith(ACTIVE_DIR.as_posix()):
            continue
        text = path.read_text()
        title = DOC_TITLE.search(text)
        status = ADR_STATUS.search(text)
        when = ADR_DATE.search(text)
        docs.append(
            Doc(
                path=key,
                title=title.group(1).strip() if title else path.stem,
                kind=doc_kind(relative),
                ids=unique(TASK_ID.findall(text)),
                status=status.group(1).strip() if status else "",
                date=when.group(1).strip() if when else "",
            )
        )
    return docs


def readme_sections(text: str) -> dict[str, str]:
    sections: dict[str, str] = {}
    name = ""
    lines: list[str] = []
    for line in [*text.splitlines(), "## "]:
        if line.startswith("## "):
            if name in README_SECTIONS:
                sections[name] = "\n".join(lines).strip()
            name = line[3:].strip()
            lines = []
        else:
            lines.append(line)
    return sections


def resolve_status(task: Task, tasks: dict[str, Task]) -> str:
    if task.done:
        return "done"
    if task.active is not None and task.active.status in ACTIVE_STATUSES:
        return task.active.status
    if "(on hold)" in task.title:
        return "on-hold"
    if any(dep in tasks and not tasks[dep].done for dep in task.deps):
        return "waiting"
    return "ready"


def load(root: Path = ROOT) -> Board:
    docs_dir = root / "docs"
    task_list, epics, milestones = parse_backlog((docs_dir / "BACKLOG.md").read_text())
    tasks = {task.id: task for task in task_list}
    for task_id, active in read_active(root).items():
        if task_id in tasks:
            tasks[task_id].active = active
    for task in task_list:
        for dep in task.deps:
            if dep in tasks:
                tasks[dep].dependents.append(task.id)
    docs = parse_docs(root)
    for doc in docs:
        for task_id in doc.ids:
            if task_id in tasks:
                tasks[task_id].docs.append(doc.path)
    for task in task_list:
        task.status = resolve_status(task, tasks)
        task.unblocks_total = 0 if task.done else open_downstream(task.id, tasks)
    readme = docs_dir / "README.md"
    return Board(
        tasks=tasks,
        epics=epics,
        milestones=milestones,
        docs=docs,
        log=parse_log((docs_dir / "log.md").read_text()),
        overview=readme_sections(readme.read_text()) if readme.exists() else {},
    )


def to_json(board: Board) -> dict[str, Any]:
    return {
        "generated": date.today().isoformat(),
        "tasks": [asdict(task) for task in board.tasks.values()],
        "epics": [asdict(epic) for epic in board.epics],
        "milestones": board.milestones,
        "docs": [asdict(doc) for doc in board.docs],
        "log": [asdict(entry) for entry in board.log],
        "overview": board.overview,
    }


def check(root: Path = ROOT) -> list[str]:
    board = load(root)
    tasks = board.tasks
    problems: list[str] = []
    for task in tasks.values():
        problems.extend(
            f"{task.id}: depends on unknown task {dep}" for dep in task.deps if dep not in tasks
        )
        if task.id in task.deps:
            problems.append(f"{task.id}: depends on itself")
        problems.extend(f"{task.id}: unknown marker '{line}'" for line in task.bad_markers)
    for task_id, active in read_active(root).items():
        name = f"{ACTIVE_DIR.as_posix()}/{task_id}.md"
        if task_id not in tasks:
            problems.append(f"{name}: no task {task_id} in the backlog")
        elif tasks[task_id].done:
            problems.append(f"{name}: {task_id} is ticked, delete its board file")
        if active.status not in ACTIVE_STATUSES:
            problems.append(f"{name}: unknown status '{active.status}'")
    problems.extend(cycle_problems(tasks))
    return problems


def cycle_problems(tasks: dict[str, Task]) -> list[str]:
    state: dict[str, int] = {}
    problems: list[str] = []

    def visit(task_id: str, trail: list[str]) -> None:
        state[task_id] = 1
        for dep in tasks[task_id].deps:
            if dep not in tasks:
                continue
            if state.get(dep) == 1:
                cycle = [*trail[trail.index(dep) :], dep] if dep in trail else [task_id, dep]
                problems.append("dependency cycle: " + " -> ".join(cycle))
            elif dep not in state:
                visit(dep, [*trail, dep])
        state[task_id] = 2

    for task_id in tasks:
        if task_id not in state:
            visit(task_id, [task_id])
    return problems


def tree_lines(
    tasks: dict[str, Task], task_id: str, down: bool, depth: int = 0, seen: set[str] | None = None
) -> list[str]:
    seen = set() if seen is None else seen
    task = tasks[task_id]
    repeat = task_id in seen
    mark = " (see above)" if repeat and depth else ""
    lines = [f"{'  ' * depth}{task_id} [{task.status}] {task.title}{mark}"]
    if repeat:
        return lines
    seen.add(task_id)
    for child in task.dependents if down else task.deps:
        if child in tasks:
            lines.extend(tree_lines(tasks, child, down, depth + 1, seen))
    return lines


def render_static(board: Board, root: Path) -> str:
    contents = {
        doc.path: (root / doc.path).read_text()
        for doc in [*board.docs, Doc("docs/BACKLOG.md", "", "", []), Doc("docs/log.md", "", "", [])]
    }
    payload = json.dumps({"board": to_json(board), "files": contents}).replace("</", "<\\/")
    return TEMPLATE.read_text().replace("/*__STATIC__*/null", payload)


def readable_path(root: Path, requested: str) -> Path | None:
    target = (root / requested).resolve()
    docs_root = (root / "docs").resolve()
    allowed = target.is_relative_to(docs_root) or target in {
        (root / name).resolve() for name in ("README.md", "AGENTS.md")
    }
    if allowed and target.suffix == ".md" and target.is_file():
        return target
    return None


def make_handler(root: Path) -> type[BaseHTTPRequestHandler]:
    class Handler(BaseHTTPRequestHandler):
        def send(self, status: int, kind: str, body: str) -> None:
            data = body.encode()
            self.send_response(status)
            self.send_header("Content-Type", f"{kind}; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self) -> None:
            url = urlparse(self.path)
            if url.path in {"/", "/index.html"}:
                self.send(200, "text/html", TEMPLATE.read_text())
            elif url.path == "/api/board":
                self.send(200, "application/json", json.dumps(to_json(load(root))))
            elif url.path == "/api/file":
                requested = parse_qs(url.query).get("path", [""])[0]
                target = readable_path(root, requested)
                if target is None:
                    self.send(404, "text/plain", "not found")
                else:
                    self.send(200, "text/markdown", target.read_text())
            else:
                self.send(404, "text/plain", "not found")

        def log_message(self, format: str, *args: Any) -> None:
            return

    return Handler


def command_serve(args: argparse.Namespace) -> int:
    server = ThreadingHTTPServer(("127.0.0.1", args.port), make_handler(ROOT))
    url = f"http://127.0.0.1:{args.port}/"
    print(f"Board on {url} (Ctrl+C to stop)")
    if args.open:
        webbrowser.open(url)
    with contextlib.suppress(KeyboardInterrupt):
        server.serve_forever()
    return 0


def command_build(args: argparse.Namespace) -> int:
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(render_static(load(ROOT), ROOT))
    print(f"Wrote {out}")
    return 0


def command_ready(args: argparse.Namespace) -> int:
    board = load(ROOT)
    epics = {epic.id: epic for epic in board.epics}
    picked: list[Task] = []
    for task in board.tasks.values():
        milestone = epics[task.epic].milestone if task.epic in epics else ""
        if task.status != "ready":
            continue
        if args.epic and task.epic != args.epic.upper():
            continue
        if args.milestone and args.milestone.upper() not in milestone:
            continue
        if args.size and task.size != args.size.upper():
            continue
        if args.agent_only and (
            task.needs or task.title.startswith("Idea:") or PARKED.search(task.title)
        ):
            continue
        picked.append(task)
    if args.size or args.agent_only:
        picked.sort(key=lambda task: -task.unblocks_total)
    for task in picked:
        needs = f"  needs {', '.join(task.needs)}" if task.needs else ""
        print(f"{task.id}  {task.size}  unblocks {task.unblocks_total}  {task.title}{needs}")
    return 0


def command_show(args: argparse.Namespace) -> int:
    board = load(ROOT)
    task = board.tasks.get(args.id.upper())
    if task is None:
        print(f"No task {args.id}", file=sys.stderr)
        return 1
    print(f"{task.id} · {task.title}")
    print(f"Status: {task.status}   Epic: {task.epic}   docs/BACKLOG.md:{task.line}")
    if task.active is not None:
        active = task.active
        print(f"Board file: by {active.by or '?'} since {active.since or '?'} {active.note}")
    print()
    print(task.body)
    print("\nNeeds (upstream):")
    print("\n".join(tree_lines(board.tasks, task.id, down=False)[1:]) or "  nothing")
    print("\nUnblocks (downstream):")
    print("\n".join(tree_lines(board.tasks, task.id, down=True)[1:]) or "  nothing")
    if task.docs:
        print("\nDocs:")
        print("\n".join(f"  {path}" for path in task.docs))
    entries = [entry for entry in board.log if task.id in entry.ids]
    if entries:
        print("\nLog:")
        print("\n".join(f"  {entry.date} {entry.text[:160]}" for entry in entries))
    return 0


def command_claim(args: argparse.Namespace) -> int:
    board = load(ROOT)
    task = board.tasks.get(args.id.upper())
    if task is None:
        print(f"No task {args.id}", file=sys.stderr)
        return 1
    if task.done:
        print(f"{task.id} is already done", file=sys.stderr)
        return 1
    if task.active is not None and task.active.status in {"in-progress", "review"}:
        print(f"{task.id} is already taken by {task.active.by or 'someone'}", file=sys.stderr)
        return 1
    if task.status == "waiting" and not args.force:
        open_deps = [dep for dep in task.deps if dep in board.tasks and not board.tasks[dep].done]
        print(f"{task.id} waits on {', '.join(open_deps)} (use --force)", file=sys.stderr)
        return 1
    active = Active("in-progress", args.by, args.branch, date.today().isoformat(), args.note)
    print(f"Claimed {task.id} in {write_active(ROOT, task.id, active).relative_to(ROOT)}")
    return 0


def command_move(args: argparse.Namespace) -> int:
    task_id = args.id.upper()
    board = load(ROOT)
    task = board.tasks.get(task_id)
    if task is None:
        print(f"No task {args.id}", file=sys.stderr)
        return 1
    active = task.active or Active(args.status, since=date.today().isoformat())
    active.status = args.status
    if args.note is not None:
        active.note = args.note
    if args.by:
        active.by = args.by
    print(f"Moved {task_id} to {args.status}")
    write_active(ROOT, task_id, active)
    return 0


def command_release(args: argparse.Namespace) -> int:
    path = ROOT / ACTIVE_DIR / f"{args.id.upper()}.md"
    if not path.exists():
        print(f"No board file for {args.id}", file=sys.stderr)
        return 1
    path.unlink()
    print(f"Released {args.id.upper()}")
    return 0


def command_tree(args: argparse.Namespace) -> int:
    board = load(ROOT)
    task_id = args.id.upper()
    if task_id not in board.tasks:
        print(f"No task {args.id}", file=sys.stderr)
        return 1
    print("\n".join(tree_lines(board.tasks, task_id, down=args.down)))
    return 0


def command_check(_: argparse.Namespace) -> int:
    problems = check(ROOT)
    for problem in problems:
        print(problem, file=sys.stderr)
    return 1 if problems else 0


def command_find(args: argparse.Namespace) -> int:
    board = load(ROOT)
    found = find_tasks(board.tasks, " ".join(args.words))
    for task in found[: args.limit]:
        print(f"{task.id}  [{task.status}]  {task.title}")
    return 0 if found else 1


def command_recent(args: argparse.Namespace) -> int:
    for entry in load(ROOT).log[: args.count]:
        print(f"{entry.date} {entry.text[: args.width]}")
    return 0


def command_brief(_: argparse.Namespace) -> int:
    board = load(ROOT)
    print(board.overview.get("In progress", "") or "Nothing in progress.")
    active = [task for task in board.tasks.values() if task.active is not None]
    if active:
        print("\nBoard:")
        for task in active:
            print(f"  {task.id}  {task.active.status if task.active else ''}  {task.title}")
    ready = sum(task.status == "ready" for task in board.tasks.values())
    print(f"\n{ready} tasks are ready. Run board.py ready to list them.")
    return 0


def command_note(args: argparse.Namespace) -> int:
    path = ROOT / "docs/log.md"
    entry = " ".join(args.text)
    path.write_text(add_log_entry(path.read_text(), args.date or date.today().isoformat(), entry))
    print(f"Logged under {args.date or date.today().isoformat()}")
    return 0


def command_tick(args: argparse.Namespace) -> int:
    task_id = args.id.upper()
    path = ROOT / "docs/BACKLOG.md"
    ticked = tick_backlog(path.read_text(), task_id)
    if ticked is None:
        print(f"{task_id} is not an open task", file=sys.stderr)
        return 1
    path.write_text(ticked)
    claim = ROOT / ACTIVE_DIR / f"{task_id}.md"
    if claim.exists():
        claim.unlink()
    print(f"Ticked {task_id} and released its claim")
    return 0


def command_json(_: argparse.Namespace) -> int:
    print(json.dumps(to_json(load(ROOT)), indent=2))
    return 0


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(prog="board", description="Task board over docs/BACKLOG.md")
    commands = root.add_subparsers(dest="command", required=True)

    serve = commands.add_parser("serve", help="serve the live board page")
    serve.add_argument("--port", type=int, default=4310)
    serve.add_argument("--open", action="store_true", help="open it in the browser")
    serve.set_defaults(run=command_serve)

    build = commands.add_parser("build", help="write a self-contained board page")
    build.add_argument("--out", default="tmp/board.html")
    build.set_defaults(run=command_build)

    ready = commands.add_parser("ready", help="list tasks whose dependencies are done")
    ready.add_argument("--epic")
    ready.add_argument("--milestone")
    ready.add_argument("--size", choices=[*SIZES, *(s.lower() for s in SIZES)])
    ready.add_argument("--agent-only", action="store_true", help="skip Needs and Idea tasks")
    ready.set_defaults(run=command_ready)

    show = commands.add_parser("show", help="print a task with its trees, docs and log")
    show.add_argument("id")
    show.set_defaults(run=command_show)

    tree = commands.add_parser("tree", help="print the dependency tree of a task")
    tree.add_argument("id")
    tree.add_argument("--down", action="store_true", help="show what it unblocks instead")
    tree.set_defaults(run=command_tree)

    claim = commands.add_parser("claim", help="mark a task in progress")
    claim.add_argument("id")
    claim.add_argument("--by", required=True)
    claim.add_argument("--branch", default="")
    claim.add_argument("--note", default="")
    claim.add_argument("--force", action="store_true", help="claim even if dependencies are open")
    claim.set_defaults(run=command_claim)

    move = commands.add_parser("move", help="change the board status of a task")
    move.add_argument("id")
    move.add_argument("status", choices=ACTIVE_STATUSES)
    move.add_argument("--note")
    move.add_argument("--by")
    move.set_defaults(run=command_move)

    release = commands.add_parser("release", help="delete the board file of a task")
    release.add_argument("id")
    release.set_defaults(run=command_release)

    find = commands.add_parser("find", help="list tasks whose ID or title has every word")
    find.add_argument("words", nargs="+")
    find.add_argument("--limit", type=int, default=20)
    find.set_defaults(run=command_find)

    recent = commands.add_parser("recent", help="print the newest log entries, shortened")
    recent.add_argument("count", type=int, nargs="?", default=8)
    recent.add_argument("--width", type=int, default=200)
    recent.set_defaults(run=command_recent)

    commands.add_parser("brief", help="print what is in progress and on the board").set_defaults(
        run=command_brief
    )

    note = commands.add_parser(
        "note",
        help="add a dated entry to the top of docs/log.md, naming the task ID when there is one",
    )
    note.add_argument("text", nargs="+")
    note.add_argument("--date")
    note.set_defaults(run=command_note)

    tick = commands.add_parser("tick", help="tick a task in the backlog and release its claim")
    tick.add_argument("id")
    tick.set_defaults(run=command_tick)

    commands.add_parser("check", help="validate the board files").set_defaults(run=command_check)
    commands.add_parser("json", help="print the board as JSON").set_defaults(run=command_json)
    return root


def main() -> int:
    args = parser().parse_args()
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
