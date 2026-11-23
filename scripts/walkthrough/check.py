from concurrent.futures import ThreadPoolExecutor
from typing import Any

from walkthrough.client import Client
from walkthrough.model import ACCOUNTS, GROUPS, ROLE_NAMES, Chapter, Step
from walkthrough.resolve import Seed, UnresolvedError, fill

WORKING = "working"
BROKEN = "broken"
NOT_CHECKED = "not checked"
WORKERS = 4


def expected_of(entry: str) -> tuple[str, int]:
    path, separator, status = entry.rpartition(" =")
    return (path, int(status)) if separator else (entry, 200)


def check_step(
    item: Step, link: str, calls: list[tuple[str, int]], client: Client | None
) -> dict[str, Any]:
    if client is None:
        return {"status": NOT_CHECKED, "reason": f"no session for {item.role}", "calls": []}
    results = []
    page = client.send(link)
    results.append({"path": link, "expected": 200, "got": page.status})
    results.extend(
        {"path": path, "expected": status, "got": client.send(path).status}
        for path, status in calls
    )
    failed = [row for row in results if row["got"] != row["expected"]]
    return {
        "status": BROKEN if failed else WORKING,
        "reason": "; ".join(
            f"{row['path']} answered {row['got']}, not {row['expected']}" for row in failed
        ),
        "calls": results,
    }


def outcome(item: Step, seed: Seed, clients: dict[str, Client], checking: bool) -> dict[str, Any]:
    try:
        link = fill(item.url, seed)
        calls = [(fill(path, seed), status) for path, status in map(expected_of, item.api)]
    except UnresolvedError as error:
        return {"link": item.url, "status": NOT_CHECKED, "reason": str(error), "calls": []}
    if not checking:
        return {"link": link, "status": NOT_CHECKED, "reason": "the run did not check", "calls": []}
    return {"link": link, **check_step(item, link, calls, clients.get(item.role))}


def walk(
    chapters: list[Chapter], seed: Seed, clients: dict[str, Client], checking: bool
) -> list[dict[str, Any]]:
    flat = [
        (c, s, item)
        for c, chapter in enumerate(chapters, 1)
        for s, item in enumerate(chapter.steps, 1)
    ]
    with ThreadPoolExecutor(WORKERS) as pool:
        results = list(pool.map(lambda row: outcome(row[2], seed, clients, checking), flat))
    found: list[dict[str, Any]] = []
    for number, chapter in enumerate(chapters, 1):
        steps = []
        for (c, s, item), result in zip(flat, results, strict=True):
            if c != number:
                continue
            steps.append(
                {
                    "number": f"{c}.{s}",
                    "role": item.role,
                    "role_name": ROLE_NAMES[item.role],
                    "account": ACCOUNTS[item.role],
                    "title": item.title,
                    "click": item.click,
                    "expect": item.expect,
                    "why": item.why,
                    "gpu": item.gpu,
                    "state": item.state,
                    **result,
                }
            )
        found.append(
            {
                "number": number,
                "title": chapter.title,
                "group": chapter.group,
                "group_name": GROUPS[chapter.group],
                "intro": chapter.intro,
                "steps": steps,
            }
        )
    return found
