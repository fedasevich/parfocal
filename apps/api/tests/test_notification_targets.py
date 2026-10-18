import json
import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_my_work import task
from test_review_tasks import Study, study
from workspace_support import owner

from parfocal_api.notifications import CATALOGUE, TargetKind
from parfocal_api.tables import NotificationKind


def test_every_kind_has_a_target_and_a_template_without_details() -> None:
    assert set(CATALOGUE) == set(NotificationKind)
    for entry in CATALOGUE.values():
        assert entry.subject
        assert entry.line.endswith(".")
        assert "{" not in entry.subject + entry.line
    assert {entry.target for entry in CATALOGUE.values()} == set(TargetKind)


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
    assert (hidden.status_code, hidden.json()["code"]) == (404, "target-gone")
    loose = notification(database, s, "third", NotificationKind.RESULT_SET_ADDED, s.slides[0])
    assert target(api, s, "third", loose).json()["code"] == "target-gone"
    gone = notification(database, s, "owner", NotificationKind.EMERGENCY_ACCESS, uuid.uuid4())
    assert target(api, s, "owner", gone).json()["code"] == "target-gone"
    thread = notification(database, s, "first", NotificationKind.MENTION, uuid.uuid4())
    later = target(api, s, "first", thread)
    assert (later.status_code, later.json()["code"]) == (409, "target-not-available")
