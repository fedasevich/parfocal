import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from test_annotations import make_class, make_slide
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}
ROLES = ("owner", "admin", "viewer", "first", "third")


@dataclass(frozen=True)
class Study:
    people: dict[str, MemberPrincipal]
    project: uuid.UUID
    slide: uuid.UUID
    result_set: uuid.UUID
    task: uuid.UUID
    hidden: bool
    added: uuid.UUID

    @property
    def base(self) -> str:
        return f"/api/review-tasks/{self.task}/slides/{self.slide}"

    def user(self, who: str) -> str:
        return str(self.people[who].user_id)


def ok(response: Any) -> Any:
    assert 200 <= response.status_code < 300, response.text
    return response


def make_result_set(database: str, tenant: uuid.UUID, project: uuid.UUID, slide: uuid.UUID) -> str:
    result_set = owner(
        database,
        "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source) "
        f"VALUES ('{tenant}', '{project}', '{slide}', 'HoVer-NeXt', 'import') RETURNING id",
    )[0][0]
    for number in (1, 2):
        owner(
            database,
            "INSERT INTO result_objects (tenant_id, result_set_id, kind, number, geometry, score) "
            f"VALUES ('{tenant}', '{result_set}', 'region', {number}, "
            f"ST_GeomFromText('POLYGON((0 0,{number}00 0,{number}00 50,0 50,0 0))', 0), 200)",
        )
    owner(
        database,
        "UPDATE result_sets SET status = 'ready', region_count = 2, cell_count = 5 "
        f"WHERE id = '{result_set}'",
    )
    return str(result_set)


def study(api: ApiAs, database: str, *, blinded: bool, hidden: bool) -> Study:
    workspace = make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "admin": Role.RESEARCHER,
            "viewer": Role.RESEARCHER,
            "first": Role.REVIEWER,
            "second": Role.REVIEWER,
            "third": Role.REVIEWER,
        },
        admins={"admin"},
    )
    people, tenant = workspace.people, workspace.tenant_id
    project = make_project(database, tenant, "de-identified")
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["viewer"], "viewer")
    for label in ("first", "second", "third"):
        join_project(database, project, people[label], "reviewer")
    slide = make_slide(database, tenant, project)
    make_class(database, tenant, project)
    result_set = make_result_set(database, tenant, project, slide)
    owner(
        database,
        "INSERT INTO slide_counters (tenant_id, slide_id, letter, last) "
        f"VALUES ('{tenant}', '{slide}', 'T', 2), ('{tenant}', '{slide}', 'C', 5)",
    )
    task = ok(
        api(people["owner"]).post(
            f"/api/projects/{project}/review-tasks",
            json={
                "name": "Blinding task",
                "slide_ids": [str(slide)],
                "result_sets": [{"slide_id": str(slide), "result_set_id": result_set}],
                "reviewer_ids": [str(people["first"].user_id), str(people["second"].user_id)],
                "split": "everyone",
                "scope": {"kind": "all-regions"},
                "blinded": blinded,
                "ai_hidden_first_read": hidden,
            },
        )
    ).json()["id"]
    base = f"/api/review-tasks/{task}/slides/{slide}"
    second = people["second"]
    ok(api(second).put(f"{base}/opinion", json={"answers": {"comment": "Second's view"}}))
    added = ok(api(second).post(f"{base}/added", json={"kind": "region", "geometry": SQUARE}))
    if hidden:
        ok(api(second).post(f"{base}/first-read"))
    ok(api(second).put(f"{base}/verdicts/T1", json={"value": "agree"}))
    ok(api(second).put(f"{base}/edits/T2", json={"deleted": True}))
    ok(api(second).post(f"{base}/submit"))
    return Study(
        people,
        project,
        slide,
        uuid.UUID(result_set),
        uuid.UUID(task),
        hidden,
        uuid.UUID(added.json()["id"]),
    )


def others_work(s: Study) -> dict[str, str]:
    reviewer = f"reviewer_id={s.user('second')}"
    routes = {
        "listVerdicts": f"{s.base}/verdicts?{reviewer}",
        "getReviewedLayer": f"{s.base}/layer?{reviewer}",
        "getOpinion": f"{s.base}/opinion?{reviewer}",
        "exportReviewedLayer": f"{s.base}/export?{reviewer}",
        "getAnnotation": f"/api/slides/{s.slide}/annotations/{s.added}",
        "listAnnotationHistory": f"/api/slides/{s.slide}/annotations/{s.added}/history",
    }
    if s.hidden:
        routes["getFirstRead"] = f"{s.base}/first-read?{reviewer}"
    return routes


BY_ID = {"getAnnotation", "listAnnotationHistory"}


def expected_for(seen: str, s: Study) -> dict[str, int]:
    match seen:
        case "visible":
            return dict.fromkeys(others_work(s), 200)
        case "blind":
            return {name: 404 if name in BY_ID else 403 for name in others_work(s)}
        case _:
            return dict.fromkeys(others_work(s), 404)


def what_they_see(api: ApiAs, s: Study, who: str) -> dict[str, int]:
    found: dict[str, int] = {}
    for name, path in others_work(s).items():
        response = api(s.people[who]).get(path)
        if response.status_code == 403:
            assert response.json()["code"] == "other-reviewer", (name, response.text)
        found[name] = response.status_code
    return found


FIXED = {"owner": "visible", "viewer": "visible", "admin": "absent", "third": "absent"}

BLINDING = {
    "blinded": (
        {"blinded": True, "hidden": False},
        {"before-submit": "blind", "after-submit": "visible"},
    ),
    "not-blinded": (
        {"blinded": False, "hidden": False},
        {"before-submit": "visible", "after-submit": "visible"},
    ),
    "blinded-first-read": (
        {"blinded": True, "hidden": True},
        {"before-first-read": "blind", "before-submit": "blind", "after-submit": "visible"},
    ),
    "not-blinded-first-read": (
        {"blinded": False, "hidden": True},
        {"before-first-read": "blind", "before-submit": "visible", "after-submit": "visible"},
    ),
}


def step_to(api: ApiAs, s: Study, phase: str) -> None:
    first = s.people["first"]
    if phase == "before-submit" and s.hidden:
        ok(api(first).post(f"{s.base}/first-read"))
    if phase == "after-submit":
        ok(api(first).post(f"{s.base}/submit"))


@pytest.mark.parametrize("kind", sorted(BLINDING))
def test_each_role_sees_other_reviewers_work_before_and_after_submit(
    api: ApiAs, database: str, kind: str
) -> None:
    settings, phases = BLINDING[kind]
    s = study(api, database, **settings)
    for phase, first_sees in phases.items():
        step_to(api, s, phase)
        for who in ROLES:
            seen = first_sees if who == "first" else FIXED[who]
            assert what_they_see(api, s, who) == expected_for(seen, s), (kind, phase, who)


def ai_view(api: ApiAs, s: Study, who: str) -> dict[str, object]:
    client = api(s.people[who])
    one = client.get(f"/api/result-sets/{s.result_set}")
    on_slide = client.get(f"/api/slides/{s.slide}/result-sets")
    in_project = client.get(f"/api/projects/{s.project}/result-sets")
    client = api(s.people[who])
    export = client.get(f"{s.base}/export")
    layer = client.get(f"{s.base}/layer")
    return {
        "getResultSet": one.json().get("code", one.status_code),
        "listSlideResultSets": len(on_slide.json())
        if on_slide.is_success
        else on_slide.status_code,
        "listProjectResultSets": (
            len(in_project.json()) if in_project.is_success else in_project.status_code
        ),
        "exportReviewedLayer": export.json().get("code", export.status_code),
        "getReviewedLayer": (
            layer.json()["summary"]["regions"] if layer.is_success else layer.status_code
        ),
    }


SHOWN = {
    "getResultSet": 200,
    "listSlideResultSets": 1,
    "listProjectResultSets": 1,
    "exportReviewedLayer": 200,
    "getReviewedLayer": 2,
}
HIDDEN = {
    "getResultSet": "ai-hidden",
    "listSlideResultSets": 0,
    "listProjectResultSets": 0,
    "exportReviewedLayer": "ai-hidden",
    "getReviewedLayer": None,
}
OUT_OF_PROJECT = {
    "getResultSet": "not-found",
    "listSlideResultSets": 404,
    "listProjectResultSets": 404,
    "exportReviewedLayer": "not-found",
    "getReviewedLayer": 404,
}
NOT_ASSIGNED = {**OUT_OF_PROJECT, "listProjectResultSets": 0}
AI_FOR_OTHERS = {
    "owner": SHOWN,
    "viewer": SHOWN,
    "admin": OUT_OF_PROJECT,
    "third": NOT_ASSIGNED,
}


@pytest.mark.parametrize("hidden", [True, False])
def test_the_ai_is_hidden_until_the_first_read_and_shown_after(
    api: ApiAs, database: str, hidden: bool
) -> None:
    s = study(api, database, blinded=True, hidden=hidden)
    phases = (("before-first-read", HIDDEN if hidden else SHOWN), ("before-submit", SHOWN))
    for phase, first_sees in phases:
        step_to(api, s, phase)
        assert ai_view(api, s, "first") == first_sees, phase
        assert ai_view(api, s, "second") == SHOWN, phase
        for who, sees in AI_FOR_OTHERS.items():
            assert ai_view(api, s, who) == sees, (phase, who)


def test_judging_the_ai_waits_for_the_first_read(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=True, hidden=True)
    first = s.people["first"]
    refused = [
        api(first).put(f"{s.base}/verdicts/T1", json={"value": "agree"}),
        api(first).delete(f"{s.base}/verdicts/T1"),
        api(first).put(f"{s.base}/edits/T1", json={"deleted": True}),
        api(first).delete(f"{s.base}/edits/T1"),
        api(first).put(f"{s.base}/verdicts/T9", json={"value": "agree"}),
    ]
    assert [(r.status_code, r.json()["code"]) for r in refused] == [(409, "first-read-open")] * 5
    early = api(first).post(f"{s.base}/submit")
    assert (early.status_code, early.json()["code"]) == (409, "first-read-needed")
    ok(api(first).post(f"{s.base}/added", json={"kind": "cell", "geometry": SQUARE}))
    ok(api(first).put(f"{s.base}/opinion", json={"answers": {"acceptable": 2}}))
    ok(api(first).post(f"{s.base}/first-read"))
    ok(api(first).put(f"{s.base}/verdicts/T1", json={"value": "disagree", "reason": "artefact"}))
    unknown = api(first).put(f"{s.base}/verdicts/T9", json={"value": "agree"})
    assert (unknown.status_code, unknown.json()["code"]) == (404, "unknown-object")
    ok(api(first).post(f"{s.base}/submit"))


def stored_first_read(database: str, s: Study, who: str) -> tuple[object, ...]:
    return owner(
        database,
        "SELECT first_read_at, first_read::text FROM review_assignments "
        f"WHERE task_id = '{s.task}' AND user_id = '{s.user(who)}'",
    )[0]


def test_the_blind_first_read_is_kept_after_the_ai_is_shown(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=True, hidden=True)
    first = s.people["first"]
    ok(api(first).put(f"{s.base}/opinion", json={"answers": {"acceptable": 2, "comment": "Blind"}}))
    drawn = ok(api(first).post(f"{s.base}/added", json={"kind": "region", "geometry": SQUARE}))
    recorded = ok(api(first).post(f"{s.base}/first-read")).json()
    assert (recorded["answers"], [item["code"] for item in recorded["added"]]) == (
        {"acceptable": 2, "comment": "Blind"},
        [drawn.json()["code"]],
    )
    kept = stored_first_read(database, s, "first")
    ok(api(first).put(f"{s.base}/opinion", json={"answers": {"acceptable": 5, "comment": None}}))
    gone = api(first).delete(
        f"/api/slides/{s.slide}/annotations/{drawn.json()['id']}", params={"version": 1}
    )
    assert gone.status_code == 204
    ok(api(first).put(f"{s.base}/verdicts/T1", json={"value": "agree"}))
    ok(api(first).post(f"{s.base}/submit"))
    ok(api(first).post(f"{s.base}/reopen"))
    ok(api(first).post(f"{s.base}/submit"))
    assert stored_first_read(database, s, "first") == kept
    later = ok(api(first).get(f"{s.base}/first-read")).json()
    assert later == recorded
    by_owner = ok(api(s.people["owner"]).get(f"{s.base}/first-read?reviewer_id={s.user('first')}"))
    assert by_owner.json() == recorded
    assert ok(api(first).get(f"{s.base}/opinion")).json()["answers"] == {"acceptable": 5}
    again = api(first).post(f"{s.base}/first-read")
    assert (again.status_code, again.json()["code"]) == (409, "first-read-recorded")
    with pytest.raises(Exception, match="kept as it was recorded"):
        owner(
            database,
            "UPDATE review_assignments SET first_read = '{}'::jsonb "
            f"WHERE task_id = '{s.task}' AND user_id = '{s.user('first')}'",
        )
    with pytest.raises(Exception, match="kept as it was recorded"):
        owner(
            database,
            "UPDATE review_assignments SET first_read_at = now() "
            f"WHERE task_id = '{s.task}' AND user_id = '{s.user('first')}'",
        )
    audit = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{s.task}' AND action = 'task.first-read-submitted' ORDER BY seq",
    )
    assert len(audit) == 2
    assert "Blind" not in str(audit)


def test_a_first_read_is_refused_where_it_does_not_apply(api: ApiAs, database: str) -> None:
    shown = study(api, database, blinded=True, hidden=False)
    plain = api(shown.people["first"]).post(f"{shown.base}/first-read")
    assert (plain.status_code, plain.json()["code"]) == (409, "no-first-read")
    s = study(api, database, blinded=True, hidden=True)
    for who, status, code in (
        ("third", 404, "not-found"),
        ("viewer", 403, "not-assigned"),
        ("owner", 403, "not-assigned"),
        ("admin", 404, "not-found"),
    ):
        refused = api(s.people[who]).post(f"{s.base}/first-read")
        assert (refused.status_code, refused.json()["code"]) == (status, code), who
    missing = api(s.people["owner"]).get(f"{s.base}/first-read?reviewer_id={s.user('first')}")
    assert (missing.status_code, missing.json()["code"]) == (404, "first-read-missing")


def test_the_first_read_switch_locks_once_reviewers_start(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=True, hidden=False)
    task = f"/api/review-tasks/{s.task}"
    locked = api(s.people["owner"]).patch(task, json={"ai_hidden_first_read": True})
    assert (locked.status_code, locked.json()["code"]) == (409, "task-started")
    renamed = ok(api(s.people["owner"]).patch(task, json={"name": "Renamed", "blinded": False}))
    assert (renamed.json()["blinded"], renamed.json()["ai_hidden_first_read"]) == (False, False)
    same = ok(api(s.people["owner"]).patch(task, json={"ai_hidden_first_read": False}))
    assert same.json()["ai_hidden_first_read"] is False


def test_a_fresh_task_can_switch_the_first_read_on(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=True, hidden=False)
    other = ok(
        api(s.people["owner"]).post(
            f"/api/projects/{s.project}/review-tasks",
            json={
                "name": "Second task",
                "slide_ids": [str(s.slide)],
                "result_sets": [{"slide_id": str(s.slide), "result_set_id": str(s.result_set)}],
                "reviewer_ids": [s.user("first")],
                "split": "everyone",
                "scope": {"kind": "all-regions"},
            },
        )
    ).json()
    switched = ok(
        api(s.people["owner"]).patch(
            f"/api/review-tasks/{other['id']}", json={"ai_hidden_first_read": True}
        )
    )
    assert switched.json()["ai_hidden_first_read"] is True
    first = s.people["first"]
    assert ai_view(api, s, "first") == HIDDEN
    held = api(first).put(f"{s.base}/verdicts/T1", json={"value": "agree"})
    assert (held.status_code, held.json()["code"]) == (409, "first-read-open")
    ok(api(first).post(f"/api/review-tasks/{other['id']}/slides/{s.slide}/first-read"))
    assert ai_view(api, s, "first") == SHOWN
    ok(api(first).put(f"{s.base}/verdicts/T1", json={"value": "agree"}))
