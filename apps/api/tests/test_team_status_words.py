from datetime import UTC, date, datetime, timedelta

import pytest

from parfocal_api.team_workload import Pace, TeamReviewerStatus, minutes_left, reviewer_status

SENT = date(2026, 10, 9)
DUE = date(2026, 10, 23)
ASSIGNED = datetime(2026, 10, 9, 9, tzinfo=UTC)
MIDWAY = date(2026, 10, 16)


def pace(done: int, assigned: int = 12, last: datetime | None = None) -> Pace:
    return Pace(done, assigned, ASSIGNED, last)


@pytest.mark.parametrize(
    ("label", "done", "today", "away", "word"),
    [
        ("all submitted", 12, MIDWAY, False, TeamReviewerStatus.DONE),
        ("done even while away", 12, MIDWAY, True, TeamReviewerStatus.DONE),
        ("away with slides left", 4, MIDWAY, True, TeamReviewerStatus.AWAY),
        ("nothing done before the due day", 0, MIDWAY, False, TeamReviewerStatus.NOT_STARTED),
        ("nothing done on the due day", 0, DUE, False, TeamReviewerStatus.NOT_STARTED),
        ("ahead of the share due by today", 8, MIDWAY, False, TeamReviewerStatus.ON_TRACK),
        ("exactly the share due by today", 6, MIDWAY, False, TeamReviewerStatus.ON_TRACK),
        ("fewer than the share due by today", 4, MIDWAY, False, TeamReviewerStatus.BEHIND),
        ("overdue with slides left", 11, date(2026, 10, 24), False, TeamReviewerStatus.BEHIND),
        ("overdue and never started", 0, date(2026, 10, 24), False, TeamReviewerStatus.BEHIND),
        ("one slide on the sent day", 1, SENT, False, TeamReviewerStatus.ON_TRACK),
    ],
)
def test_each_status_word_follows_the_fake_clock(
    label: str, done: int, today: date, away: bool, word: TeamReviewerStatus
) -> None:
    assert reviewer_status(pace(done), today, SENT, DUE, away) is word, label


def test_a_task_due_the_day_it_was_sent_wants_every_slide_at_once() -> None:
    assert reviewer_status(pace(3), SENT, SENT, SENT, False) is TeamReviewerStatus.BEHIND
    assert reviewer_status(pace(12), SENT, SENT, SENT, False) is TeamReviewerStatus.DONE


def test_a_task_without_a_due_day_is_never_behind() -> None:
    late = date(2027, 1, 1)
    assert reviewer_status(pace(0), late, SENT, None, False) is TeamReviewerStatus.NOT_STARTED
    assert reviewer_status(pace(1), late, SENT, None, False) is TeamReviewerStatus.ON_TRACK
    assert reviewer_status(pace(1), late, SENT, None, True) is TeamReviewerStatus.AWAY


def test_the_time_left_comes_from_the_pace_so_far() -> None:
    assert minutes_left(pace(12)) == 0
    assert minutes_left(pace(0)) is None
    assert minutes_left(pace(4)) is None
    assert minutes_left(pace(4, last=ASSIGNED + timedelta(minutes=80))) == 160
