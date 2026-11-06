from dataclasses import replace
from datetime import date

import pytest
from db_support import ApiAs
from test_disagreements import queued_review
from test_locales import REPORT
from workspace_support import owner

from parfocal_api.evaluation_exports import CHECKSUM_HEADER
from parfocal_api.report_template import ReportChange, render_report

REASON = {"reason": "Measured again on deeper levels of A1"}


@pytest.mark.db
def test_signing_makes_version_one_with_a_checksum_and_tells_the_reviewers(
    api: ApiAs, database: str
) -> None:
    r, task = queued_review(api, database)
    decide = f"{task}/disagreements/{r.slide}"
    blocked = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()
    assert (blocked["queue"]["total"], blocked["queue"]["resolved"]) == (2, 0)
    assert (blocked["signature"], blocked["version"]) == (None, 1)
    assert blocked["reviews"] == {
        "slides": 1,
        "submitted": 2,
        "total": 2,
        "opinion_forms": 0,
        "behind": [],
    }
    api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "agree"})
    api(r.people["owner"]).put(f"{decide}/T2/left-open", json={"note": "Ask Lenka"})
    hidden = api(r.people["first"]).get(f"{task}/sign-off-summary")
    assert (hidden.status_code, hidden.json()["code"]) == (403, "evaluation-hidden")
    refused = api(r.people["first"]).post(f"{task}/sign-off")
    assert refused.status_code == 403

    signed = api(r.people["owner"]).post(f"{task}/sign-off", json={"confirmed_with": "password"})
    assert signed.status_code == 200, signed.text

    summary = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()
    assert summary["version"] == 1
    assert [item["object"] for item in summary["queue"]["left_open"]] == ["T2"]
    assert (summary["queue"]["resolved"], summary["queue"]["by_researcher"]) == (2, 1)
    checksum = summary["signature"]["checksum"]
    assert summary["signature"]["by_user_id"] == str(r.people["owner"].user_id)
    assert checksum.startswith("sha256:")
    exported = api(r.people["owner"]).get(f"{task}/evaluation/exports/objects.csv")
    assert exported.headers[CHECKSUM_HEADER] == checksum
    assert exported.headers["content-disposition"].endswith('evaluation_v1_objects.csv"')
    stored = owner(
        database,
        "SELECT number, confirmed_with, jsonb_array_length(blocks) > 0, checksum "
        f"FROM evaluation_versions WHERE task_id = '{r.task}'",
    )
    assert stored == [(1, "password", True, checksum)]
    told = owner(
        database,
        "SELECT user_id FROM notifications "
        f"WHERE kind = 'task-signed-off' AND target_id = '{r.task}' ORDER BY user_id",
    )
    reviewers = sorted(str(r.people[who].user_id) for who in ("first", "second"))
    assert sorted(str(row[0]) for row in told) == reviewers
    notice = owner(
        database,
        "SELECT id FROM notifications WHERE kind = 'task-signed-off' "
        f"AND user_id = '{r.people['first'].user_id}'",
    )[0][0]
    opened = api(r.people["first"]).get(f"/api/me/notifications/{notice}/target")
    assert (opened.status_code, opened.json()["kind"]) == (200, "task"), opened.text
    again = api(r.people["owner"]).post(f"{task}/sign-off")
    assert (again.status_code, again.json()["code"]) == (409, "already-signed-off")


@pytest.mark.db
def test_the_owner_changes_a_decision_after_sign_off_and_the_change_is_logged(
    api: ApiAs, database: str
) -> None:
    r, task = queued_review(api, database)
    decide = f"{task}/disagreements/{r.slide}"
    api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "agree"})
    api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "disagree"})
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200

    reviewer = api(r.people["first"]).put(f"{r.base}/verdicts/T1", json={"value": "unsure"})
    assert (reviewer.status_code, reviewer.json()["code"]) == (409, "task-signed-off")
    bare = api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "agree"})
    assert (bare.status_code, bare.json()["code"]) == (409, "change-reason-needed")
    changed = api(r.people["owner"]).put(
        f"{decide}/T2", json={"answer": "agree", "reason": "Second look on level 3"}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["decision"]["value"] == "agree"

    summary = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()
    assert [
        (change["object"], change["text"], change["reason"], change["by_user_id"])
        for change in summary["changes"]
    ] == [("T2", "Decided agree", "Second look on level 3", str(r.people["owner"].user_id))]
    assert summary["signature"] is not None
    logged = owner(
        database,
        "SELECT details::jsonb->>'after_sign_off', details::jsonb->>'evaluation_version' "
        "FROM audit_events "
        f"WHERE target_id = '{r.task}' AND action = 'review.decision-set' ORDER BY seq",
    )
    assert logged[-1] == ("true", "1")
    assert all(row == (None, None) for row in logged[:-1])


@pytest.mark.db
def test_reopening_needs_a_reason_and_signing_again_makes_version_two(
    api: ApiAs, database: str
) -> None:
    r, task = queued_review(api, database)
    decide = f"{task}/disagreements/{r.slide}"
    api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "agree"})
    api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "disagree"})
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    first = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()["signature"]

    assert api(r.people["owner"]).post(f"{task}/evaluation-versions", json={}).status_code == 422
    short = api(r.people["owner"]).post(f"{task}/evaluation-versions", json={"reason": "Redo"})
    assert short.status_code == 422
    by_reviewer = api(r.people["first"]).post(f"{task}/evaluation-versions", json=REASON)
    assert by_reviewer.status_code == 403
    started = api(r.people["owner"]).post(f"{task}/evaluation-versions", json=REASON)
    assert started.status_code == 201, started.text
    assert (started.json()["version"], started.json()["reason"]) == (2, REASON["reason"])
    twice = api(r.people["owner"]).post(f"{task}/evaluation-versions", json=REASON)
    assert (twice.status_code, twice.json()["code"]) == (409, "not-signed-off")

    summary = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()
    assert summary["signature"] == first
    assert summary["next_version"]["version"] == 2
    states = api(r.people["owner"]).get(f"{task}/states").json()
    assert states["signed_off_at"] is None
    reopened = api(r.people["first"]).post(f"{r.base}/reopen")
    assert reopened.status_code == 200, reopened.text
    api(r.people["first"]).post(f"{r.base}/submit")
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200

    summary = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()
    assert (summary["version"], summary["next_version"]) == (2, None)
    exported = api(r.people["owner"]).get(f"{task}/evaluation/exports/annotations.json")
    assert exported.json()["evaluation"]["version"] == 2
    versions = owner(
        database,
        "SELECT number, reason IS NOT NULL, signed_at IS NOT NULL FROM evaluation_versions "
        f"WHERE task_id = '{r.task}' ORDER BY number",
    )
    assert versions == [(1, False, True), (2, True, True)]
    actions = owner(
        database,
        "SELECT action, details::jsonb->>'version' FROM audit_events "
        f"WHERE target_id = '{r.task}' "
        "AND action IN ('task.signed-off', 'task.reopened') ORDER BY seq",
    )
    assert actions == [
        ("task.signed-off", "1"),
        ("task.reopened", "2"),
        ("task.signed-off", "2"),
    ]
    no_reason = api(r.people["owner"]).post(f"{task}/reopen")
    assert no_reason.status_code == 422
    assert api(r.people["owner"]).post(f"{task}/reopen", json=REASON).status_code == 200


@pytest.mark.db
def test_changes_after_sign_off_are_listed_with_who_when_and_what(
    api: ApiAs, database: str
) -> None:
    r, task = queued_review(api, database)
    decide = f"{task}/disagreements/{r.slide}"
    api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "agree"})
    api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "disagree"})
    unsigned = api(r.people["owner"]).get(f"{task}/evaluation-changes").json()
    assert (unsigned["signed_version"], unsigned["changes"]) == (None, [])
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    reason = "Second look on level 3"
    changed = api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "agree", "reason": reason})
    assert changed.status_code == 200, changed.text

    listed = api(r.people["owner"]).get(f"{task}/evaluation-changes")
    assert listed.status_code == 200, listed.text
    body = listed.json()
    signature = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()["signature"]
    assert (body["signed_version"], body["checksum"]) == (1, signature["checksum"])
    assert [
        (item["version"], item["object"], item["text"], item["reason"], item["by_user_id"])
        for item in body["changes"]
    ] == [(1, "T2", "Decided agree", reason, str(r.people["owner"].user_id))]
    assert body["changes"][0]["slide_label"]
    assert body["changes"][0]["at"]
    hidden = api(r.people["first"]).get(f"{task}/evaluation-changes")
    assert (hidden.status_code, hidden.json()["code"]) == (403, "evaluation-hidden")

    exported = api(r.people["owner"]).get(f"{task}/evaluation/exports/annotations.json")
    assert exported.headers[CHECKSUM_HEADER] == signature["checksum"]
    assert exported.json()["evaluation"]["changes_after_sign_off"] == 1


def test_the_report_flags_and_lists_changes_after_sign_off() -> None:
    assert "Changed after sign-off" not in render_report(REPORT).source
    change = ReportChange(
        object_id="T2",
        slide="A1",
        change="Decided agree",
        reason="Second look on level 3",
        by="Jana Novak",
        on=date(2026, 11, 5),
    )
    source = render_report(replace(REPORT, changes=(change,))).source
    assert "Changed after sign-off. The checksum is of the evaluation as signed" in source
    assert "Changes after sign-off" in source
    for value in ("T2", "Decided agree", "Second look on level 3", "Jana Novak", "05/11/2026"):
        assert value in source
