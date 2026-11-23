import tomllib
from pathlib import Path
from typing import Any

from walkthrough.model import GROUPS, Chapter, step

FOLDER = Path(__file__).resolve().parent / "chapters"


class ContentError(ValueError):
    pass


def chapter_of(raw: dict[str, Any], source: str) -> Chapter:
    if raw.get("group") not in GROUPS:
        raise ContentError(f"{source}: chapter {raw.get('title')} has no known group")
    steps = []
    for entry in raw.get("step", []):
        api = entry.get("api", [])
        if not api:
            raise ContentError(f"{source}: step {entry.get('title')} checks no API call")
        steps.append(
            step(
                entry["role"],
                entry["title"],
                entry["url"],
                entry["click"],
                entry["expect"],
                entry["why"],
                *api,
                gpu=bool(entry.get("gpu", False)),
                state=str(entry.get("state", "")),
            )
        )
    return Chapter(str(raw["title"]), str(raw["group"]), str(raw["intro"]), tuple(steps))


def load(folder: Path = FOLDER) -> tuple[Chapter, ...]:
    chapters: list[Chapter] = []
    for path in sorted(folder.glob("*.toml")):
        data = tomllib.loads(path.read_text())
        chapters.extend(chapter_of(raw, path.name) for raw in data.get("chapter", []))
    return tuple(chapters)


CHAPTERS = load()
