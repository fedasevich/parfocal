from html import escape
from pathlib import Path
from typing import Any

from walkthrough.model import ACCOUNTS, GROUPS, ROLE_NAMES
from walkthrough.page_script import SCRIPT

HERE = Path(__file__).resolve().parent
FONTS = (
    "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500"
    "&family=IBM+Plex+Sans:wght@400;500;600;700&display=swap"
)
ROLE_WORK = {
    "owner": "Owner of every project and workspace admin. Has the seeded co-sign request, "
    "two showcase review tasks and one object to adjudicate.",
    "researcher": "Project owner. Uploads, runs models, sends tasks, decides disagreements, "
    "signs off and exports.",
    "reviewer-a": "Reviewer on Role account review, the first of two reviewers.",
    "reviewer-b": "Reviewer on Role account review, the second reviewer.",
    "adjudicator": "Reviewer who was sent one open object of the disagreement queue to decide.",
    "viewer": "Project viewer. Can look at everything and change nothing.",
    "annotator": "Expert on Role account annotation, who draws and checks objects.",
    "signed-out": "No account. Use a private window to see what a stranger sees.",
}
SIGN_IN = {
    "owner": "the password in ~/.config/parfocal/agent-account.env",
    "signed-out": "",
}


def e(text: object) -> str:
    return escape(str(text), quote=True)


def how_to_sign_in(role: str, origin: str) -> str:
    if role == "signed-out":
        return "Open a private window, or sign out from the avatar menu, and stay signed out."
    secret = SIGN_IN.get(role, "the password in ~/.config/parfocal/role-accounts.env")
    return (
        f"Sign in at {origin}/sign-in as <code>{e(ACCOUNTS[role])}</code> with {e(secret)}. "
        "If another account is signed in, sign out from the avatar menu first, or keep one "
        "browser profile or private window per account."
    )


def counts_of(chapters: list[dict[str, Any]]) -> dict[str, int]:
    counts = {"working": 0, "broken": 0, "not checked": 0}
    for chapter in chapters:
        for item in chapter["steps"]:
            counts[item["status"]] = counts.get(item["status"], 0) + 1
    return counts


def chapter_bar(chapters: list[dict[str, Any]]) -> str:
    rows = []
    for key, name in GROUPS.items():
        pills = "".join(
            f'<a class="step {key}" href="#ch-{c["number"]}">'
            f"<b>{c['number']}</b>{e(c['title'])}</a>"
            for c in chapters
            if c["group"] == key
        )
        if pills:
            rows.append(
                f'<div class="step-row"><span class="step-glabel {key}">{e(name)}</span>'
                f"{pills}</div>"
            )
    roles = "".join(
        f'<button type="button" data-role="{role}">{e(ROLE_NAMES[role])}</button>'
        for role in ACCOUNTS
    )
    return (
        '<nav class="bar" aria-label="Chapters"><div class="bar-in">'
        + "".join(rows)
        + '<div class="step-row"><span class="step-glabel">Show the steps of</span>'
        f'<div class="roles"><button type="button" data-role="all">All accounts</button>{roles}'
        '</div><span class="progress" id="progress"></span></div></div></nav>'
    )


def broken_zone(chapters: list[dict[str, Any]]) -> str:
    broken = [item for c in chapters for item in c["steps"] if item["status"] == "broken"]
    if not broken:
        return (
            '<section class="zone"><h2>Broken steps</h2>'
            "<p>The last run found no broken step.</p></section>"
        )
    items = "".join(
        f'<li><a href="#s-{e(item["number"])}">{e(item["number"])} {e(item["title"])}</a>, '
        f"as {e(item['role_name'])}. {e(item['reason'])}</li>"
        for item in broken
    )
    return (
        f'<section class="zone broken"><h2>{len(broken)} broken step'
        f"{'' if len(broken) == 1 else 's'}</h2>"
        "<p>Each one answered differently from what the step expects when the script last ran. "
        f"Start with these if you want to see what is wrong.</p><ul>{items}</ul></section>"
    )


def accounts_zone(origin: str) -> str:
    rows = "".join(
        f"<tr><td>{e(ROLE_NAMES[role])}</td><td><code>{e(ACCOUNTS[role])}</code></td>"
        f"<td>{e(ROLE_WORK[role])}</td></tr>"
        for role in ACCOUNTS
    )
    return (
        '<section class="zone"><h2>The accounts</h2>'
        f"<p>Every step names the account to sign in as. Role accounts sign in at {e(origin)} "
        "with the address below and the password kept in "
        "<code>~/.config/parfocal/role-accounts.env</code>. The owner and admin account "
        "<code>agent-walk</code> keeps its password in "
        "<code>~/.config/parfocal/agent-account.env</code>. You can also use your own owner "
        "account for its steps. After signing in, pick the workspace "
        "<b>ČVUT · Biomedical Engineering</b> in the workspace switcher, because every link "
        "below points into it.</p>"
        f"<table><tr><th>Role</th><th>Account</th><th>What it has</th></tr>{rows}</table>"
        "</section>"
    )


def lanes_zone(chapters: list[dict[str, Any]]) -> str:
    lanes = []
    for role in ACCOUNTS:
        links = []
        last = None
        for chapter in chapters:
            for item in chapter["steps"]:
                if item["role"] != role:
                    continue
                classes = ["broken"] if item["status"] == "broken" else []
                if last is not None and last != chapter["number"]:
                    classes.append("gap")
                last = chapter["number"]
                links.append(
                    f'<a class="{" ".join(classes)}" href="#s-{e(item["number"])}" '
                    f'title="{e(item["title"])}">{e(item["number"])}</a>'
                )
        if links:
            lanes.append(
                f'<div class="lane"><h3>{e(ROLE_NAMES[role])}<small>{e(ACCOUNTS[role])}</small>'
                f'</h3><div class="lane-steps">{"".join(links)}</div></div>'
            )
    return (
        '<section class="zone"><h2>Who does what</h2>'
        "<p>One lane per account, in the order the steps come. Each number opens its step. "
        "A gap in a lane means the next step is in another chapter.</p>"
        f'<div class="lanes">{"".join(lanes)}</div></section>'
    )


def switch_note(chapter: dict[str, Any], origin: str) -> str:
    roles = list(dict.fromkeys(item["role"] for item in chapter["steps"]))
    parts = "".join(
        f'<li><span class="who-name">{e(ROLE_NAMES[role])}</span>, steps '
        f"{e(', '.join(i['number'] for i in chapter['steps'] if i['role'] == role))}. "
        f"{how_to_sign_in(role, origin)}</li>"
        for role in roles
    )
    return f'<div class="switch">Switch account for this chapter.<ul>{parts}</ul></div>'


def step_card(item: dict[str, Any], origin: str) -> str:
    chips = [f'<span class="chip {item["status"].replace(" ", "-")}">{e(item["status"])}</span>']
    if item["gpu"]:
        chips.append('<span class="chip gpu">GPU, costs money, may wait for a cold start</span>')
    if item["state"]:
        chips.append(f'<span class="chip state">{e(item["state"])}</span>')
    link = origin + item["link"] if item["link"].startswith("/") else item["link"]
    reason = ""
    if item["reason"]:
        quiet = "" if item["status"] == "broken" else " quiet"
        reason = f'<div class="reason{quiet}">{e(item["reason"])}</div>'
    calls = "".join(
        f'<li class="call">{e(call["got"])} for {e(call["path"])}, '
        f"expected {e(call['expected'])}</li>"
        for call in item["calls"]
    )
    details = f"<details><summary>What the script checked</summary><ul>{calls}</ul></details>"
    return (
        f'<article class="step" id="s-{e(item["number"])}" data-step="{e(item["number"])}" '
        f'data-who="{e(item["role"])}"><div class="n">{e(item["number"])}</div><div>'
        f"<h3>{e(item['title'])}{''.join(chips)}</h3>"
        f'<div class="who">As {e(item["role_name"])}, <code>{e(item["account"])}</code></div>'
        f"<dl><dt>Where to click</dt><dd>{e(item['click'])}</dd>"
        f"<dt>What should happen</dt><dd>{e(item['expect'])}</dd>"
        f"<dt>Why it matters</dt><dd>{e(item['why'])}</dd></dl>"
        f'<a class="go" href="{e(link)}" target="_blank" rel="noopener">Open {e(item["link"])}</a>'
        f'<label class="tick"><input type="checkbox"> I tried this</label>'
        f"{reason}{details if calls else ''}</div></article>"
    )


def chapter_section(chapter: dict[str, Any], origin: str) -> str:
    ribbon = '<span class="ribbon">Research output</span>' if chapter["group"] == "research" else ""
    cards = "".join(step_card(item, origin) for item in chapter["steps"])
    return (
        f'<section class="chapter" id="ch-{chapter["number"]}"><h2><span class="num">'
        f"{chapter['number']}</span>{e(chapter['title'])}{ribbon}</h2>"
        f"<p>{e(chapter['intro'])}</p>{switch_note(chapter, origin)}{cards}</section>"
    )


def render(document: dict[str, Any]) -> str:
    chapters = document["chapters"]
    origin = document["origin"]
    counts = counts_of(chapters)
    total = sum(counts.values())
    style = (HERE / "style.css").read_text()
    meta = "".join(
        f"<span>{e(text)}</span>"
        for text in (
            f"{len(chapters)} chapters, {total} steps",
            f"{counts['working']} working",
            f"{counts['broken']} broken",
            f"{counts['not checked']} not checked",
            f"checked {document['checked_at']}",
            f"release {document.get('release') or 'unknown'}",
            f"workspace {document['workspace']}",
        )
    )
    problems = "".join(f"<li>{e(text)}</li>" for text in document.get("sign_in_problems", []))
    problem_zone = (
        f'<section class="zone broken"><h2>Accounts the run could not use</h2><ul>{problems}</ul>'
        "</section>"
        if problems
        else ""
    )
    return (
        '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width, initial-scale=1">'
        "<title>Parfocal walkthrough of the whole app</title>"
        '<link rel="preconnect" href="https://fonts.googleapis.com">'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        f'<link rel="stylesheet" href="{FONTS}"><style>{style}</style></head><body>'
        '<header class="top"><h1>Walk through the whole app, one account at a time</h1>'
        '<p class="lead">Every screen of the deployed app at '
        f"{e(origin)}, in the order a user meets it, with the account to sign in as, where to "
        "click, what should happen and why it matters. The links point at the seeded examples "
        "of the last run of the walkthrough script, so they change after every reseed. Tick a "
        "step when you have tried it. The ticks stay in this browser.</p>"
        f'<div class="meta">{meta}</div></header>'
        f"{chapter_bar(chapters)}<main>{problem_zone}{broken_zone(chapters)}"
        f"{accounts_zone(origin)}{lanes_zone(chapters)}"
        f"{''.join(chapter_section(chapter, origin) for chapter in chapters)}</main>"
        "<footer>Made by scripts/walkthrough from docs/results/2026-11-23-walkthrough-steps.json. "
        "Run <code>python3 scripts/walkthrough</code> after a reseed to resolve the links "
        f"again and check every step.</footer><script>{SCRIPT}</script></body></html>\n"
    )
