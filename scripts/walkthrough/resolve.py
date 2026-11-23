import re
from dataclasses import dataclass, field
from typing import Any

TOKEN = re.compile(r"\{([a-z_]+)(?::([^}]*))?\}")


class UnresolvedError(LookupError):
    pass


@dataclass
class Seed:
    workspace: str = ""
    projects: dict[str, str] = field(default_factory=dict)
    tasks: dict[str, str] = field(default_factory=dict)
    task_projects: dict[str, str] = field(default_factory=dict)
    task_slides: dict[str, list[str]] = field(default_factory=dict)
    slides: dict[tuple[str, str], str] = field(default_factory=dict)
    cases: dict[str, str] = field(default_factory=dict)
    case_projects: dict[str, str] = field(default_factory=dict)
    singles: dict[str, str] = field(default_factory=dict)


def add_projects(seed: Seed, projects: list[dict[str, Any]]) -> None:
    for project in projects:
        seed.projects.setdefault(str(project["name"]), str(project["id"]))


def add_tasks(seed: Seed, project_id: str, tasks: list[dict[str, Any]]) -> None:
    for task in tasks:
        name = str(task["name"])
        if name in seed.tasks:
            continue
        seed.tasks[name] = str(task["id"])
        seed.task_projects[name] = str(task.get("project_id") or project_id)


def add_task_slides(seed: Seed, task_name: str, states: dict[str, Any]) -> None:
    seed.task_slides[task_name] = [str(row["slide_id"]) for row in states.get("slides", [])]


def add_slides(seed: Seed, project_name: str, slides: list[dict[str, Any]]) -> None:
    for slide in slides:
        seed.slides.setdefault((project_name, str(slide["label"])), str(slide["id"]))


def add_cases(seed: Seed, cases: list[dict[str, Any]]) -> None:
    for case in cases:
        label = str(case["label"])
        seed.cases.setdefault(label, str(case["id"]))
        seed.case_projects.setdefault(label, str(case["project_id"]))


def add_single(seed: Seed, key: str, value: object) -> None:
    if value:
        seed.singles.setdefault(key, str(value))


def lookup(table: dict[Any, str], key: Any, kind: str) -> str:
    if key not in table:
        raise UnresolvedError(f"no {kind} named {key}")
    return table[key]


def pair(argument: str, kind: str) -> tuple[str, str]:
    first, separator, second = argument.partition("|")
    if not separator:
        raise UnresolvedError(f"{kind} needs two parts split by |, got {argument}")
    return first, second


def value_of(seed: Seed, kind: str, argument: str) -> str:
    match kind:
        case "workspace":
            return seed.workspace or lookup({}, "workspace", "workspace")
        case "project":
            return lookup(seed.projects, argument, "project")
        case "task":
            return lookup(seed.tasks, argument, "task")
        case "task_project":
            return lookup(seed.task_projects, argument, "task")
        case "task_slide":
            name, position = pair(argument, kind)
            slides = seed.task_slides.get(name, [])
            index = int(position) - 1
            if not 0 <= index < len(slides):
                raise UnresolvedError(f"task {name} has no slide {position}")
            return slides[index]
        case "slide":
            return lookup(seed.slides, pair(argument, kind), "slide")
        case "case":
            return lookup(seed.cases, argument, "case")
        case "case_project":
            return lookup(seed.case_projects, argument, "case")
        case _:
            return lookup(seed.singles, kind if not argument else f"{kind}:{argument}", kind)


def fill(template: str, seed: Seed) -> str:
    return TOKEN.sub(lambda found: value_of(seed, found.group(1), found.group(2) or ""), template)


def unresolved(template: str, seed: Seed) -> str | None:
    try:
        fill(template, seed)
    except UnresolvedError as error:
        return str(error)
    return None
