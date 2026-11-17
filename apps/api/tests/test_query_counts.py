import re
import uuid

import pytest
from db_support import ApiAs
from test_home import judge
from test_my_work import submit, task
from test_review_tasks import MODEL, Study, add_set, insert_id, study
from workspace_support import join_project, make_project

pytestmark = pytest.mark.db

ROUTES = ("/api/me/home", "/api/me/review-tasks", "/api/me/notification-preferences")
LIMITS = {"/api/me/home": 9, "/api/me/review-tasks": 4, "/api/me/notification-preferences": 3}
SLIDES_PAGE = 12


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
    task(api, s, name="Mine", case_ids=[], reviewer_ids=[s.user("owner")])
    disputed_round(api, database, s, "Round 1")
    small = counts(api, s)
    for name in ("Round 2", "Round 3", "Round 4"):
        disputed_round(api, database, s, name)
    for _ in range(3):
        another_project(database, s)
    large = counts(api, s)
    assert large == small
    assert all(found <= LIMITS[route] for (_, route), found in large.items()), large


def many_slides(database: str, s: Study, count: int) -> list[uuid.UUID]:
    made = [
        insert_id(
            database,
            "INSERT INTO slides (tenant_id, project_id, label) "
            f"VALUES ('{s.tenant_id}', '{s.project}', 'bulk-{index}') RETURNING id",
        )
        for index in range(count)
    ]
    for slide in made:
        add_set(database, s.tenant_id, s.project, slide, MODEL, "ready")
    return made


def test_my_slides_reads_a_handful_of_queries_however_many_tasks_the_page_touches(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    bulk = [str(slide) for slide in many_slides(database, s, 46)]
    pair = [s.user("first"), s.user("second")]
    for name in ("One", "Two", "Three"):
        task(api, s, name=name, slide_ids=bulk[:10], case_ids=[], reviewer_ids=pair)
    few = queries(api, s, "owner", "/api/me/slides?limit=50")
    for index in range(5):
        chosen = bulk[10 + index * 5 : 15 + index * 5]
        task(api, s, name=f"More {index}", slide_ids=chosen, case_ids=[], reviewer_ids=pair)
    many = queries(api, s, "owner", "/api/me/slides?limit=50")
    rows = api(s.people["owner"]).get("/api/me/slides", params={"limit": 50}).json()["slides"]
    assert len(rows) == 50
    assert many == few
    assert many <= SLIDES_PAGE


PROJECTS_PAGE = 6
NEIGHBOURS = 5


def test_project_list_reads_a_fixed_number_of_queries_however_many_projects_there_are(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    few = queries(api, s, "owner", "/api/projects")
    for _ in range(5):
        another_project(database, s)
    many = queries(api, s, "owner", "/api/projects")
    assert len(api(s.people["owner"]).get("/api/projects").json()) >= 6
    assert many == few
    assert many <= PROJECTS_PAGE


def test_one_project_reads_no_more_queries_than_the_list(api: ApiAs, database: str) -> None:
    s = study(database)
    one = queries(api, s, "owner", f"/api/projects/{s.project}")
    assert one <= PROJECTS_PAGE


def test_neighbours_of_all_slides_reads_a_fixed_number_of_queries_however_many_slides(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    route = f"/api/slides/{s.slides[0]}/neighbours?from=all-slides"
    few = queries(api, s, "owner", route)
    many_slides(database, s, 30)
    many = queries(api, s, "owner", route)
    assert many == few
    assert many <= NEIGHBOURS
