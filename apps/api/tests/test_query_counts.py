import re

import pytest
from db_support import ApiAs
from test_home import judge
from test_my_work import submit, task
from test_review_tasks import Study, study
from workspace_support import join_project, make_project

pytestmark = pytest.mark.db

ROUTES = ("/api/me/home", "/api/me/review-tasks", "/api/me/notification-preferences")
HANDFUL = 14


def queries(api: ApiAs, s: Study, who: str, route: str) -> int:
    response = api(s.people[who]).get(route)
    assert response.status_code == 200, response.text
    found = re.search(r'queries;desc="(\d+)"', response.headers["server-timing"])
    assert found is not None
    return int(found.group(1))


def counts(api: ApiAs, s: Study) -> dict[tuple[str, str], int]:
    return {
        (who, route): queries(api, s, who, route) for who in ("owner", "first") for route in ROUTES
    }


def disputed_round(api: ApiAs, database: str, s: Study, name: str) -> None:
    both = [s.user("first"), s.user("second")]
    created = task(api, s, name=name, case_ids=[], reviewer_ids=both)
    judge(database, s, created["id"], "first", s.slides[0], 1, "agree")
    judge(database, s, created["id"], "second", s.slides[0], 1, "disagree")
    submit(api, s, "first", created["id"], s.slides[0])
    submit(api, s, "second", created["id"], s.slides[0])


def another_project(database: str, s: Study) -> None:
    project = make_project(database, s.tenant_id, "de-identified")
    join_project(database, project, s.people["owner"], "owner")
    join_project(database, project, s.people["first"], "reviewer")


def test_home_and_my_lists_read_a_handful_of_queries_however_much_work_there_is(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    disputed_round(api, database, s, "Round 1")
    small = counts(api, s)
    for name in ("Round 2", "Round 3", "Round 4"):
        disputed_round(api, database, s, name)
    for _ in range(3):
        another_project(database, s)
    large = counts(api, s)
    assert large == small
    assert max(large.values()) <= HANDFUL
