import uuid

import pytest
from db_support import ApiAs
from test_reviewed_layer import Review, review
from workspace_support import owner

from parfocal_api.review_states import (
    Actor,
    Move,
    MoveFacts,
    Refused,
    ReviewerFacts,
    SlideFacts,
    State,
    check_move,
    slide_state,
)
from parfocal_api.tables import ResultSource, ResultStatus

ASSIGNED, OWNER, OTHER = Actor.ASSIGNED_REVIEWER, Actor.OWNER, Actor.OTHER

MOVES = [
    (Move.SUBMIT, MoveFacts(ASSIGNED, signed_off=False), None),
    (Move.SUBMIT, MoveFacts(ASSIGNED, signed_off=False, submitted=True), Refused.ALREADY_SUBMITTED),
    (Move.SUBMIT, MoveFacts(ASSIGNED, signed_off=True), Refused.TASK_SIGNED_OFF),
    (
        Move.SUBMIT,
        MoveFacts(ASSIGNED, signed_off=False, first_read_open=True),
        Refused.FIRST_READ_NEEDED,
    ),
    (Move.SUBMIT, MoveFacts(OWNER, signed_off=False), Refused.NOT_ASSIGNED),
    (Move.SUBMIT, MoveFacts(OTHER, signed_off=False), Refused.NOT_ASSIGNED),
    (Move.REOPEN_REVIEW, MoveFacts(ASSIGNED, signed_off=False, submitted=True), None),
    (Move.REOPEN_REVIEW, MoveFacts(ASSIGNED, signed_off=False), Refused.NOT_SUBMITTED),
    (
        Move.REOPEN_REVIEW,
        MoveFacts(ASSIGNED, signed_off=True, submitted=True),
        Refused.TASK_SIGNED_OFF,
    ),
    (Move.REOPEN_REVIEW, MoveFacts(OWNER, signed_off=False, submitted=True), Refused.NOT_ASSIGNED),
    (Move.REOPEN_REVIEW, MoveFacts(OTHER, signed_off=False, submitted=True), Refused.NOT_ASSIGNED),
    (Move.SIGN_OFF, MoveFacts(OWNER, signed_off=False, all_submitted=True), None),
    (Move.SIGN_OFF, MoveFacts(OWNER, signed_off=False), Refused.SLIDES_UNSUBMITTED),
    (
        Move.SIGN_OFF,
        MoveFacts(OWNER, signed_off=False, all_submitted=True, open_disagreements=2),
        Refused.DISAGREEMENTS_OPEN,
    ),
    (
        Move.SIGN_OFF,
        MoveFacts(OWNER, signed_off=True, all_submitted=True),
        Refused.ALREADY_SIGNED_OFF,
    ),
    (Move.SIGN_OFF, MoveFacts(ASSIGNED, signed_off=False, all_submitted=True), Refused.OWNERS_ONLY),
    (Move.SIGN_OFF, MoveFacts(OTHER, signed_off=False, all_submitted=True), Refused.OWNERS_ONLY),
    (Move.REOPEN_TASK, MoveFacts(OWNER, signed_off=True), None),
    (Move.REOPEN_TASK, MoveFacts(OWNER, signed_off=False), Refused.NOT_SIGNED_OFF),
    (Move.REOPEN_TASK, MoveFacts(ASSIGNED, signed_off=True), Refused.OWNERS_ONLY),
    (Move.REOPEN_TASK, MoveFacts(OTHER, signed_off=True), Refused.OWNERS_ONLY),
]


@pytest.mark.parametrize(("move", "facts", "expected"), MOVES)
def test_every_move_is_allowed_or_refused_for_its_actor(
    move: Move, facts: MoveFacts, expected: Refused | None
) -> None:
    assert check_move(move, facts) == expected


def test_the_table_covers_every_move_and_actor() -> None:
    assert {(move, facts.actor) for move, facts, _ in MOVES} == {
        (move, actor) for move in Move for actor in Actor
    }


FIRST, SECOND = uuid.uuid4(), uuid.uuid4()
WAITING = ReviewerFacts(submitted=False, has_work=False)
WORKING = ReviewerFacts(submitted=False, has_work=True)
DONE = ReviewerFacts(submitted=True, has_work=True)


def facts(
    *reviewers: ReviewerFacts,
    status: ResultStatus = ResultStatus.READY,
    source: ResultSource = ResultSource.IMPORT,
    open_disagreements: int = 0,
    signed_off: bool = False,
    exported: bool = False,
) -> SlideFacts:
    people = dict(zip((FIRST, SECOND), reviewers, strict=False))
    return SlideFacts(status, source, people, open_disagreements, signed_off, exported)


@pytest.mark.parametrize(
    ("slide", "state"),
    [
        (facts(status=ResultStatus.IMPORTING), State.UPLOADED),
        (facts(status=ResultStatus.IMPORTING, source=ResultSource.RUN), State.AI_RUNNING),
        (facts(status=ResultStatus.FAILED), State.UPLOADED),
        (facts(), State.READY),
        (facts(WAITING, WORKING), State.ASSIGNED),
        (facts(WORKING, DONE), State.IN_REVIEW),
        (facts(DONE, DONE), State.SUBMITTED),
        (facts(DONE, DONE, open_disagreements=3), State.DISAGREEMENT_QUEUE),
        (facts(DONE, DONE, signed_off=True), State.SIGNED_OFF),
        (facts(DONE, DONE, signed_off=True, exported=True), State.EXPORTED),
        (facts(WAITING, DONE, signed_off=True), State.SIGNED_OFF),
    ],
)
def test_the_slide_state_is_derived_from_stored_facts(slide: SlideFacts, state: State) -> None:
    assert slide_state(slide) == state


def states(api: ApiAs, r: Review, who: str) -> list[tuple[str, dict[str, str]]]:
    response = api(r.people[who]).get(f"/api/review-tasks/{r.task}/states")
    assert response.status_code == 200, response.text
    names = {str(person.user_id): label for label, person in r.people.items()}
    return [
        (slide["state"], {names[item["user_id"]]: item["state"] for item in slide["reviewers"]})
        for slide in response.json()["slides"]
    ]


def pair(first: str, second: str) -> dict[str, str]:
    return {"first": first, "second": second}


@pytest.mark.db
def test_reviewers_submit_and_the_owner_signs_off_and_reopens(api: ApiAs, database: str) -> None:
    r = review(api, database)
    task = f"/api/review-tasks/{r.task}"
    slide = f"{task}/slides/{r.slide}"
    assert states(api, r, "owner") == [("assigned", pair("assigned", "assigned"))]
    api(r.people["first"]).put(f"{slide}/edits/T1", json={"deleted": True})
    assert states(api, r, "owner") == [("assigned", pair("in-review", "assigned"))]
    early = api(r.people["owner"]).post(f"{task}/sign-off")
    assert (early.status_code, early.json()["code"]) == (409, "slides-unsubmitted")
    assert api(r.people["first"]).post(f"{slide}/submit").status_code == 200
    again = api(r.people["first"]).post(f"{slide}/submit")
    assert (again.status_code, again.json()["code"]) == (409, "already-submitted")
    viewer = api(r.people["viewer"]).post(f"{slide}/submit")
    assert (viewer.status_code, viewer.json()["code"]) == (403, "not-assigned")
    assert states(api, r, "owner") == [("assigned", pair("submitted", "assigned"))]
    assert api(r.people["second"]).post(f"{slide}/submit").status_code == 200
    assert states(api, r, "owner") == [("submitted", pair("submitted", "submitted"))]
    by_reviewer = api(r.people["first"]).post(f"{task}/sign-off")
    assert by_reviewer.status_code == 403
    signed = api(r.people["owner"]).post(f"{task}/sign-off")
    assert signed.status_code == 200, signed.text
    assert signed.json()["signed_off_at"] is not None
    assert states(api, r, "owner") == [("signed-off", pair("submitted", "submitted"))]
    locked = api(r.people["first"]).post(f"{slide}/reopen")
    assert (locked.status_code, locked.json()["code"]) == (409, "task-signed-off")
    edit = api(r.people["first"]).put(f"{slide}/edits/T2", json={"deleted": True})
    assert (edit.status_code, edit.json()["code"]) == (409, "task-signed-off")
    assert api(r.people["owner"]).post(f"{task}/reopen").status_code == 200
    reopened = api(r.people["first"]).post(f"{slide}/reopen")
    assert reopened.status_code == 200, reopened.text
    assert states(api, r, "owner") == [("in-review", pair("in-review", "submitted"))]
    actions = owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{r.task}' ORDER BY seq"
    )
    assert [row[0] for row in actions] == [
        "task.created",
        "review.object-edited",
        "task.review-submitted",
        "task.review-submitted",
        "task.signed-off",
        "task.reopened",
        "task.review-reopened",
    ]


@pytest.mark.db
def test_a_reviewer_sees_only_their_slides_states(api: ApiAs, database: str) -> None:
    r = review(api, database)
    assert states(api, r, "first") == [("assigned", pair("assigned", "assigned"))]
    assert api(r.people["third"]).get(f"/api/review-tasks/{r.task}/states").status_code == 404
