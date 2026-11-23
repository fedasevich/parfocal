from dataclasses import dataclass, field

ACCOUNTS = {
    "owner": "agent-walk@parfocal.eu",
    "researcher": "role-researcher@parfocal.eu",
    "reviewer-a": "role-reviewer-a@parfocal.eu",
    "reviewer-b": "role-reviewer-b@parfocal.eu",
    "adjudicator": "role-adjudicator@parfocal.eu",
    "viewer": "role-viewer@parfocal.eu",
    "annotator": "role-annotator@parfocal.eu",
    "signed-out": "no account, a private window",
}
ROLE_NAMES = {
    "owner": "Owner and admin",
    "researcher": "Researcher",
    "reviewer-a": "Reviewer A",
    "reviewer-b": "Reviewer B",
    "adjudicator": "Adjudicator",
    "viewer": "Viewer",
    "annotator": "Annotate expert",
    "signed-out": "Signed out",
}
GROUPS = {
    "core": "Core flow",
    "viewer": "Viewer",
    "setup": "Setup and admin",
    "research": "Research outputs",
}


@dataclass(frozen=True)
class Step:
    role: str
    title: str
    url: str
    click: str
    expect: str
    why: str
    api: tuple[str, ...] = ()
    gpu: bool = False
    state: str = ""


@dataclass(frozen=True)
class Chapter:
    title: str
    group: str
    intro: str
    steps: tuple[Step, ...] = field(default_factory=tuple)


def step(
    role: str,
    title: str,
    url: str,
    click: str,
    expect: str,
    why: str,
    *api: str,
    gpu: bool = False,
    state: str = "",
) -> Step:
    if role not in ACCOUNTS:
        raise ValueError(f"{role} is not a walkthrough account")
    return Step(role, title, url, click, expect, why, tuple(api), gpu, state)
