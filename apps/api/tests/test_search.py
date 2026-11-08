import asyncio
import os
import statistics
import time
import uuid
from typing import Any

import pytest
from case_support import seed_case
from db_support import APP_URL, ApiAs, with_database
from test_my_work import task
from test_review_tasks import Study, study
from test_reviewed_layer import LEFT, RIGHT, Review, merge, review, split
from workspace_support import join_project, make_project, owner

from parfocal_common.db import DatabaseScope, async_database_url, create_engine, scoped_transaction

pytestmark = pytest.mark.db

SEEDED_CASES = 100_000


def found(api: ApiAs, s: Study, who: str, q: str, **params: str) -> list[tuple[str, str]]:
    response = api(s.people[who]).get("/api/search", params={"q": q, **params})
    assert response.status_code == 200, response.text
    return [(hit["kind"], hit["label"]) for hit in response.json()["hits"]]


def case_label(database: str, s: Study) -> str:
    return str(owner(database, f"SELECT label FROM cases WHERE id = '{s.case}'")[0][0])


def test_parts_of_names_find_projects_cases_slides_and_people(api: ApiAs, database: str) -> None:
    s = study(database)
    label = case_label(database, s)
    assert found(api, s, "owner", label[4:9], scope="cases") == [("case", label)]
    assert found(api, s, "owner", "oose", scope="slides") == [
        ("slide", "loose-0"),
        ("slide", "loose-1"),
    ]
    project = str(owner(database, f"SELECT name FROM projects WHERE id = '{s.project}'")[0][0])
    assert ("project", project) in found(api, s, "owner", project[-6:])
    assert found(api, s, "owner", "secon", scope="people") == [("person", "second")]
    assert found(api, s, "outsider", "oose") == []
    assert found(api, s, "first", "oose", scope="slides") == []
    task(api, s, name="Round 1", case_ids=[], reviewer_ids=[s.user("first")])
    assert found(api, s, "first", "oose", scope="slides") == [
        ("slide", "loose-0"),
        ("slide", "loose-1"),
    ]
    assert found(api, s, "owner", "100%_x") == []


def test_any_part_of_an_object_path_opens_the_slide_at_the_object(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    label = case_label(database, s)
    full = found(api, s, "owner", f"P01/{label}/A1/T3")
    assert full == [("object", "A1 T3")]
    assert found(api, s, "owner", f"{label}/A2/C12+") == [("object", "A2 C12+")]
    assert found(api, s, "owner", "~/loose-1/T1") == [("object", "loose-1 T1")]
    assert found(api, s, "owner", "loose-0/T1", scope="objects") == [("object", "loose-0 T1")]
    assert found(api, s, "owner", "P02/~/loose-1/T1", scope="objects") == []
    assert found(api, s, "owner", "loose-1/not-an-id", scope="objects") == []
    response = api(s.people["owner"]).get(
        "/api/search", params={"q": f"{label}/A1/T3", "scope": "objects"}
    )
    [hit] = response.json()["hits"]
    assert (hit["object_id"], hit["slide_id"], hit["case_label"]) == ("T3", str(s.slides[2]), label)


def objects(api: ApiAs, who: Any, q: str, **params: str) -> list[tuple[str, str | None]]:
    response = api(who).get("/api/search", params={"q": q, "scope": "objects", **params})
    assert response.status_code == 200, response.text
    return [(hit["label"], hit["resolved_from"]) for hit in response.json()["hits"]]


def test_every_form_of_an_object_id_resolves_in_its_context(api: ApiAs, database: str) -> None:
    s = study(database)
    label = case_label(database, s)
    who = s.people["owner"]
    assert objects(api, who, f"p01/{label}/A1/t3") == [("A1 T3", None)]
    assert objects(api, who, f"{label}/A1/T2·C12") == [("A1 T2.C12", None)]
    assert objects(api, who, f"{label}/A1/T2.C12⁺") == [("A1 T2.C12+", None)]
    assert objects(api, who, "A1/C12") == [("A1 C12", None)]
    assert objects(api, who, "A1/T3", project_id=str(s.project)) == [("A1 T3", None)]
    assert objects(api, who, "A1/T3", project_id=str(uuid.uuid4())) == []
    assert objects(api, who, "T3") == []
    assert objects(api, who, "T3", slide_id=str(s.slides[2])) == [("A1 T3", None)]
    assert objects(api, who, "R1", slide_id=str(s.slides[0])) == [("loose-0 R1", None)]
    assert objects(api, who, "A1//T3") == []
    slashed = owner(
        database,
        "INSERT INTO cases (tenant_id, project_id, label, source) "
        f"VALUES ('{s.tenant_id}', '{s.project}', 'S26/0481 2', 'manual') RETURNING id",
    )[0][0]
    owner(
        database,
        "INSERT INTO slides (tenant_id, project_id, case_id, label) "
        f"VALUES ('{s.tenant_id}', '{s.project}', '{slashed}', 'B/1')",
    )
    assert objects(api, who, "P01/S26%2F0481%202/B%2F1/T1%2B") == [("B/1 T1+", None)]
    assert objects(api, who, "S26/0481 2/B/1/T1") == []
    assert objects(api, s.people["outsider"], "T3", slide_id=str(s.slides[2])) == []


def slide_label(database: str, r: Review) -> str:
    return str(owner(database, f"SELECT label FROM slides WHERE id = '{r.slide}'")[0][0])


def test_an_id_merged_away_resolves_to_its_keeper_in_the_reviewers_own_layer(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    slide = slide_label(database, r)
    assert merge(api, r, "T2", "T1").status_code == 201
    response = api(r.people["first"]).get(
        "/api/search", params={"q": f"{slide}/T2", "scope": "objects"}
    )
    [hit] = response.json()["hits"]
    assert (hit["object_id"], hit["resolved_from"], hit["task_id"]) == ("T1", "T2", str(r.task))
    assert hit["label"] == f"{slide} T1 (T2)"
    assert objects(api, r.people["first"], "T2", slide_id=str(r.slide)) == [
        (f"{slide} T1 (T2)", "T2")
    ]
    assert objects(api, r.people["first"], f"{slide}/T1") == [(f"{slide} T1", None)]
    assert objects(api, r.people["second"], f"{slide}/T2") == [(f"{slide} T2", None)]
    assert objects(api, r.people["owner"], f"{slide}/T2") == [(f"{slide} T2", None)]
    split(api, r, "T1", LEFT, RIGHT)
    assert objects(api, r.people["first"], f"{slide}/T2") == [
        (f"{slide} T1a (T2)", "T2"),
        (f"{slide} T1b (T2)", "T2"),
    ]
    other = str(uuid.uuid4())
    assert objects(api, r.people["first"], f"{slide}/T2", task_id=other) == [(f"{slide} T2", None)]


def test_ai_ids_stay_hidden_until_the_first_read(api: ApiAs, database: str) -> None:
    r = review(api, database)
    slide = slide_label(database, r)
    owner(database, f"UPDATE review_tasks SET ai_hidden_first_read = true WHERE id = '{r.task}'")
    assert objects(api, r.people["first"], f"{slide}/T1") == []
    assert objects(api, r.people["first"], f"{slide}/C3") == []
    assert objects(api, r.people["first"], f"{slide}/T7+") == [(f"{slide} T7+", None)]
    assert objects(api, r.people["first"], f"{slide}/R1") == [(f"{slide} R1", None)]
    assert objects(api, r.people["owner"], f"{slide}/T1") == [(f"{slide} T1", None)]


def seeded_patient(database: str, s: Study) -> tuple[uuid.UUID, str]:
    async def go() -> tuple[uuid.UUID, str]:
        engine = create_engine(async_database_url(with_database(APP_URL, database)))
        try:
            async with scoped_transaction(engine, DatabaseScope(tenant_id=s.tenant_id)) as c:
                case = await seed_case(c, s.tenant_id)
                return case.project_id, case.label
        finally:
            await engine.dispose()

    return asyncio.run(go())


def test_patients_are_found_by_whole_words_and_never_named_in_the_answer(
    api: ApiAs, database: str
) -> None:
    s = study(database)
    clinical, label = seeded_patient(database, s)
    join_project(database, clinical, s.people["owner"], "owner")
    response = api(s.people["owner"]).get(
        "/api/search", params={"q": "Testová", "scope": "patients"}
    )
    assert [(hit["kind"], hit["label"]) for hit in response.json()["hits"]] == [
        ("patient-case", label)
    ]
    assert "Eva" not in response.text
    assert found(api, s, "owner", "Testo", scope="patients") == []
    assert found(api, s, "viewer", "Testová", scope="patients") == []


@pytest.mark.skipif(
    not os.environ.get("PARFOCAL_PERF"), reason="latency runs on demand, see the search spike"
)
def test_search_meets_the_latency_budget_on_100_000_cases(api: ApiAs, database: str) -> None:
    s = study(database)
    project = make_project(database, s.tenant_id, "de-identified")
    join_project(database, project, s.people["owner"], "owner")
    owner(
        database,
        "INSERT INTO cases (tenant_id, project_id, label, source) "
        f"SELECT '{s.tenant_id}', '{project}', 'BULK-' || lpad(g::text, 6, '0'), 'manual' "
        f"FROM generate_series(1, {SEEDED_CASES}) g",
    )
    owner(database, "ANALYZE cases")
    try:
        timings: list[float] = []
        results: list[Any] = []
        for number in range(1, 400, 20):
            started = time.perf_counter()
            results.append(found(api, s, "owner", f"{number:06d}", scope="cases"))
            timings.append((time.perf_counter() - started) * 1000)
        timings.sort()
        assert all(result for result in results)
        assert timings[int(0.95 * len(timings)) - 1] < 100, statistics.median(timings)
    finally:
        owner(database, f"DELETE FROM cases WHERE project_id = '{project}'")
