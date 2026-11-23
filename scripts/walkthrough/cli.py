import argparse
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

import agent_session

from walkthrough.check import walk
from walkthrough.client import Client, SessionError, client_for, use_workspace
from walkthrough.content import CHAPTERS
from walkthrough.gather import gather
from walkthrough.model import ACCOUNTS
from walkthrough.render import render

RESULTS = agent_session.REPOSITORY / "docs/results"
STEPS_FILE = RESULTS / "2026-11-23-walkthrough-steps.json"
PAGE_FILE = RESULTS / "2026-11-23-walkthrough.html"
WORKSPACE = "cvut-biomedical"


def sign_in_all(origin: str, fresh: bool) -> tuple[dict[str, Client], list[str]]:
    clients: dict[str, Client] = {"signed-out": Client(origin, None)}
    problems: list[str] = []
    for role in ACCOUNTS:
        if role == "signed-out":
            continue
        try:
            client = client_for(origin, role, fresh)
            use_workspace(client, WORKSPACE)
            clients[role] = client
        except SessionError as error:
            problems.append(str(error))
    return clients, problems


def run(origin: str, steps_file: Path, page_file: Path, checking: bool, fresh: bool) -> str:
    clients, problems = sign_in_all(origin, fresh)
    owner = clients.get("owner")
    if owner is None:
        raise SessionError("; ".join(problems) or "the owner account could not sign in")
    seed = gather(owner, clients, use_workspace(owner, WORKSPACE))
    chapters = walk(list(CHAPTERS), seed, clients, checking)
    release = owner.send("/api/status")
    document = {
        "origin": origin,
        "workspace": WORKSPACE,
        "checked_at": datetime.now(UTC).strftime("%Y-%m-%d %H:%M UTC"),
        "release": release.json().get("release") if release.status == 200 else None,
        "sign_in_problems": problems,
        "chapters": chapters,
    }
    steps_file.write_text(json.dumps(document, indent=2, ensure_ascii=False) + "\n")
    page_file.write_text(render(document))
    counts: dict[str, int] = {}
    for chapter in chapters:
        for item in chapter["steps"]:
            counts[item["status"]] = counts.get(item["status"], 0) + 1
    summary = ", ".join(f"{count} {status}" for status, count in sorted(counts.items()))
    return f"{len(chapters)} chapters, {sum(counts.values())} steps: {summary}"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="walkthrough",
        description="Resolve the seeded names on the dev app, check every walkthrough step "
        "as its account and write the steps file and the walkthrough page",
    )
    parser.add_argument("--url", default="https://app.parfocal.eu")
    parser.add_argument("--steps", type=Path, default=STEPS_FILE)
    parser.add_argument("--page", type=Path, default=PAGE_FILE)
    parser.add_argument(
        "--no-check", action="store_true", help="resolve only, mark every step not checked"
    )
    parser.add_argument("--fresh", action="store_true", help="sign every account in again")
    parser.add_argument(
        "--render-only", action="store_true", help="rebuild the page from the steps file"
    )
    args = parser.parse_args(argv)
    try:
        if args.render_only:
            args.page.write_text(render(json.loads(args.steps.read_text())))
            print(f"wrote {args.page}")
            return 0
        environments = json.loads(agent_session.ENVIRONMENTS.read_text())
        origin = agent_session.development_origin(args.url, environments)
        print(run(origin, args.steps, args.page, not args.no_check, args.fresh))
    except (SessionError, agent_session.RefusedError) as error:
        print(f"walkthrough refused: {error}", file=sys.stderr)
        return 2
    return 0
