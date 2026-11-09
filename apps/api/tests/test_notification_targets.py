import json
import uuid
from dataclasses import MISSING, fields
from typing import Any

import pytest
from db_support import ApiAs
from test_my_work import task
from test_review_tasks import Study, study
from test_reviewed_layer import Review, merge, review
from test_slide_moves import MOVE_REASON, cases_for, tenant_of
from workspace_support import owner

from parfocal_api.notification_catalogue import BREAKS_MUTES, CATALOGUE, Entry, TargetKind
from parfocal_api.notifications import MANDATORY
from parfocal_api.tables import NotificationKind


def test_every_kind_has_a_target_and_a_template_without_details() -> None:
    assert set(CATALOGUE) == set(NotificationKind)
    for entry in CATALOGUE.values():
        assert entry.subject
        assert entry.line.endswith(".")
        assert "{" not in entry.subject + entry.line
    assert {entry.target for entry in CATALOGUE.values()} == set(TargetKind)


def test_every_kind_declares_whether_it_breaks_through_a_mute() -> None:
    declared = next(item for item in fields(Entry) if item.name == "breaks_mute")
    assert (declared.default, declared.default_factory, declared.kw_only) == (
        MISSING,
        MISSING,
        True,
    )
    assert all(isinstance(entry.breaks_mute, bool) for entry in CATALOGUE.values())
    assert MANDATORY <= BREAKS_MUTES
    assert {
        NotificationKind.MENTION,
        NotificationKind.TASK_ASSIGNED,
        NotificationKind.TASK_DUE_SOON,
        NotificationKind.TASK_NUDGED,
        NotificationKind.TASK_REASSIGNED,
        NotificationKind.EMERGENCY_ACCESS,
        NotificationKind.ADJUDICATION_REQUESTED,
    } == BREAKS_MUTES


def notification(
    database: str,
    s: Study,
    who: str,
    kind: NotificationKind,
    target: uuid.UUID,
    payload: dict[str, Any] | None = None,
) -> str:
    return str(
        owner(
            database,
            "INSERT INTO notifications (tenant_id, user_id, kind, target_type, target_id, "
            f"payload, in_app, realtime, email_status) VALUES ('{s.tenant_id}', "
            f"'{s.people[who].user_id}', '{kind}', '{CATALOGUE[kind].target}', '{target}', "
            f"'{json.dumps(payload or {})}'::jsonb, true, true, 'none') RETURNING id",
        )[0][0]
    )


def target(api: ApiAs, s: Study, who: str, notification_id: str) -> Any:
    return api(s.people[who]).get(f"/api/me/notifications/{notification_id}/target")


@pytest.mark.db
def test_each_target_resolves_for_its_recipient(api: ApiAs, database: str) -> None:
    s = study(database)
    created = task(api, s, name="Round 1", case_ids=[], reviewer_ids=[s.user("first")])
    task_id = uuid.UUID(created["id"])
    job = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO jobs (tenant_id, project_id, kind) "
                f"VALUES ('{s.tenant_id}', '{s.project}', 'model-run') RETURNING id",
            )[0][0]
        )
    )
    cases = [
        ("first", NotificationKind.TASK_ASSIGNED, task_id, None, {"kind": "task"}),
        ("first", NotificationKind.TASK_DUE_SOON, task_id, None, {"kind": "task"}),
        ("owner", NotificationKind.DISAGREEMENTS_READY, task_id, None, {"kind": "task"}),
        ("owner", NotificationKind.TASK_SIGNED_OFF, task_id, None, {"kind": "evaluation"}),
        (
            "first",
            NotificationKind.RESULT_SET_ADDED,
            s.slides[0],
            {"task_id": created["id"], "object_id": "T3"},
            {"kind": "slide", "slide_id": str(s.slides[0]), "object_id": "T3"},
        ),
        (
            "owner",
            NotificationKind.MODEL_RUN_FINISHED,
            job,
            None,
            {"kind": "job", "job_id": str(job)},
        ),
        ("owner", NotificationKind.MODEL_RUN_PAUSED, job, None, {"kind": "job"}),
        ("owner", NotificationKind.UPLOAD_DONE, job, None, {"kind": "job"}),
        ("owner", NotificationKind.EMERGENCY_ACCESS, s.project, None, {"kind": "project"}),
    ]
    for who, kind, about, payload, expected in cases:
        found = target(api, s, who, notification(database, s, who, kind, about, payload))
        assert found.status_code == 200, (kind, found.text)
        body = found.json()
        assert body["project_id"] == str(s.project)
        assert {key: body[key] for key in expected} == expected, kind


@pytest.mark.db
def test_a_target_is_refused_to_others_and_when_it_is_out_of_reach(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    created = task(api, s, name="Round 1", case_ids=[], reviewer_ids=[s.user("first")])
    task_id = uuid.UUID(created["id"])
    mine = notification(database, s, "first", NotificationKind.TASK_ASSIGNED, task_id)
    stolen = target(api, s, "second", mine)
    assert (stolen.status_code, stolen.json()["code"]) == (404, "notification-not-found")
    evaluation = notification(database, s, "first", NotificationKind.TASK_SIGNED_OFF, task_id)
    hidden = target(api, s, "first", evaluation)
    assert (hidden.status_code, hidden.json()["kind"]) == (200, "task")
    loose = notification(database, s, "third", NotificationKind.RESULT_SET_ADDED, s.slides[0])
    assert target(api, s, "third", loose).json()["code"] == "target-gone"
    gone = notification(database, s, "owner", NotificationKind.EMERGENCY_ACCESS, uuid.uuid4())
    assert target(api, s, "owner", gone).json()["code"] == "target-gone"
    thread = notification(database, s, "first", NotificationKind.MENTION, uuid.uuid4())
    missing = target(api, s, "first", thread)
    assert (missing.status_code, missing.json()["code"]) == (404, "target-gone")


def told(database: str, r: Review, who: str, kind: NotificationKind, about: object) -> str:
    return str(
        owner(
            database,
            "INSERT INTO notifications (tenant_id, user_id, kind, target_type, target_id, "
            f"payload, in_app, realtime, email_status) VALUES ('{tenant_of(database, r)}', "
            f"'{r.people[who].user_id}', '{kind}', '{CATALOGUE[kind].target}', '{about}', "
            f"'{json.dumps(linked_object(r))}'::jsonb, true, true, 'none') RETURNING id",
        )[0][0]
    )


WITHOUT_A_SCREEN_TO_OPEN = {TargetKind.DELIVERY, TargetKind.ACCESS_REQUEST}


def linked_object(r: Review) -> dict[str, str]:
    return {"task_id": str(r.task), "object_id": "T2"}


def opened(api: ApiAs, r: Review, who: str, link: str) -> Any:
    found = api(r.people[who]).get(f"/api/me/notifications/{link}/target")
    assert found.status_code == 200, found.text
    return found.json()


@pytest.mark.db
def test_every_kind_carries_its_origin_as_ids_and_route_names(api: ApiAs, database: str) -> None:
    r = review(api, database)
    thread = api(r.people["owner"]).post(
        f"{r.base}/threads",
        json={
            "title": "Is this tumour?",
            "body": "Check this edge",
            "anchor": {"kind": "point", "geometry": {"type": "Point", "coordinates": [4, 2]}},
        },
    )
    assert thread.status_code == 201, thread.text
    job = owner(
        database,
        "INSERT INTO jobs (tenant_id, project_id, kind) "
        f"VALUES ('{tenant_of(database, r)}', '{r.project}', 'model-run') RETURNING id",
    )[0][0]
    project = {"route": "project", "project_id": str(r.project)}
    in_task = {"route": "task", "project_id": str(r.project), "task_id": str(r.task)}
    about: dict[TargetKind, tuple[object, dict[str, str]]] = {
        TargetKind.TASK: (r.task, project),
        TargetKind.EVALUATION: (r.task, project),
        TargetKind.JOB: (job, project),
        TargetKind.PROJECT: (r.project, {"route": "home"}),
        TargetKind.SLIDE: (r.slide, in_task),
        TargetKind.THREAD: (thread.json()["id"], in_task),
    }
    assert set(about) == set(TargetKind) - WITHOUT_A_SCREEN_TO_OPEN
    for kind, entry in CATALOGUE.items():
        if entry.target in WITHOUT_A_SCREEN_TO_OPEN:
            link = told(database, r, "owner", kind, r.project)
            found = api(r.people["owner"]).get(f"/api/me/notifications/{link}/target")
            assert (found.status_code, found.json()["code"]) == (409, "target-not-available"), kind
            continue
        target_id, expected = about[entry.target]
        origin = opened(api, r, "owner", told(database, r, "owner", kind, target_id))["origin"]
        assert set(origin) == {"route", "project_id", "case_id", "task_id", "slide_id"}
        assert {key: value for key, value in origin.items() if value is not None} == expected, kind
    assigned = told(database, r, "first", NotificationKind.TASK_ASSIGNED, r.task)
    assert opened(api, r, "first", assigned)["origin"] == {
        "route": "my-work",
        "project_id": None,
        "case_id": None,
        "task_id": None,
        "slide_id": None,
    }


@pytest.mark.db
def test_a_link_follows_a_moved_slide_and_a_merged_object(api: ApiAs, database: str) -> None:
    r = review(api, database)
    source, moved_to, mover = cases_for(database, r)
    link = told(database, r, "first", NotificationKind.RESULT_SET_ADDED, r.slide)
    before = opened(api, r, "first", link)
    assert (before["case_id"], before["object_id"], before["resolved_from"]) == (
        str(source),
        "T2",
        None,
    )

    moved = api(mover).post(
        f"/api/slides/{r.slide}/move", json={"case_id": str(moved_to), "reason": MOVE_REASON}
    )
    assert moved.status_code == 200, moved.text
    assert merge(api, r, "T2", "T1").status_code == 201

    after = opened(api, r, "first", link)
    assert (after["slide_id"], after["case_id"]) == (str(r.slide), str(moved_to))
    assert (after["object_id"], after["resolved_from"]) == ("T1", "T2")
    assert after["origin"]["route"] == "task"
    notice = owner(
        database,
        f"SELECT id FROM notifications WHERE kind = 'slide-moved' AND target_id = '{r.slide}'",
    )[0][0]
    shown = opened(api, r, "owner", str(notice))
    assert (shown["case_id"], shown["origin"]) == (
        str(moved_to),
        {
            "route": "case",
            "project_id": str(r.project),
            "case_id": str(moved_to),
            "task_id": None,
            "slide_id": None,
        },
    )
    hits = (
        api(r.people["first"])
        .get(
            "/api/search",
            params={
                "q": "T2",
                "scope": "objects",
                "task_id": str(r.task),
                "slide_id": str(r.slide),
            },
        )
        .json()["hits"]
    )
    assert [(hit["object_id"], hit["resolved_from"]) for hit in hits] == [("T1", "T2")]
    assert hits[0]["origin"] == {
        "route": "search",
        "project_id": None,
        "case_id": None,
        "task_id": str(r.task),
        "slide_id": str(r.slide),
    }
