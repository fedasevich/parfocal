import json
import uuid

import pytest
from db_support import ApiAs
from test_disagreements import queued_review
from test_reviewed_layer import Review
from test_sign_off import REASON
from workspace_support import join_project, make_project, owner, person

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

MOVE_REASON = "Barcode read against the wrong accession"


def add_case(database: str, r: Review, tenant: uuid.UUID, label: str) -> uuid.UUID:
    return uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO cases (tenant_id, project_id, label, source) "
                f"VALUES ('{tenant}', '{r.project}', '{label}', 'manual') RETURNING id",
            )[0][0]
        )
    )


def tenant_of(database: str, r: Review) -> uuid.UUID:
    found = owner(database, f"SELECT tenant_id FROM projects WHERE id = '{r.project}'")
    return uuid.UUID(str(found[0][0]))


def cases_for(database: str, r: Review) -> tuple[uuid.UUID, uuid.UUID, MemberPrincipal]:
    tenant = tenant_of(database, r)
    source = add_case(database, r, tenant, "Move source")
    target = add_case(database, r, tenant, "Move target")
    owner(database, f"UPDATE slides SET case_id = '{source}' WHERE id = '{r.slide}'")
    mover = person(database, tenant, f"mover-{uuid.uuid4().hex[:6]}", Role.RESEARCHER)
    join_project(database, r.project, mover, "owner")
    return source, target, mover


def moves_logged(database: str, case_id: uuid.UUID) -> list[dict[str, object]]:
    rows = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{case_id}' AND action = 'case.slide-moved' ORDER BY seq",
    )
    return [json.loads(str(row[0])) for row in rows]


def test_a_slide_moves_with_its_result_sets_decisions_and_threads(
    api: ApiAs, database: str
) -> None:
    r, task = queued_review(api, database)
    source, target, mover = cases_for(database, r)
    thread = api(r.people["owner"]).post(
        f"{r.base}/threads",
        json={
            "title": "Is this tumour?",
            "body": "Check this edge",
            "anchor": {"kind": "point", "geometry": {"type": "Point", "coordinates": [40, 20]}},
        },
    )
    assert thread.status_code == 201, thread.text
    before_sets = api(mover).get(f"/api/slides/{r.slide}/result-sets").json()
    decisions = owner(database, f"SELECT count(*) FROM verdicts WHERE slide_id = '{r.slide}'")

    moved = api(mover).post(
        f"/api/slides/{r.slide}/move", json={"case_id": str(target), "reason": MOVE_REASON}
    )
    assert moved.status_code == 200, moved.text
    body = moved.json()
    assert (body["from_case_id"], body["to_case_id"]) == (str(source), str(target))
    assert body["result_set_ids"] == [str(r.result_set)]
    assert body["task_ids"] == [str(r.task)]

    assert api(mover).get(f"/api/cases/{source}").json()["slides"] == []
    landed = api(mover).get(f"/api/cases/{target}").json()["slides"]
    assert [slide["id"] for slide in landed] == [str(r.slide)]
    assert api(mover).get(f"/api/slides/{r.slide}/result-sets").json() == before_sets
    assert (
        owner(database, f"SELECT count(*) FROM verdicts WHERE slide_id = '{r.slide}'") == decisions
    )
    threads = api(r.people["owner"]).get(f"{r.base}/threads").json()
    assert [item["id"] for item in threads] == [thread.json()["id"]]
    states = api(r.people["owner"]).get(f"{task}/states").json()["slides"]
    assert [slide["slide_id"] for slide in states] == [str(r.slide)]

    out, into = moves_logged(database, source), moves_logged(database, target)
    assert [entry["direction"] for entry in out] == ["out"]
    assert [entry["direction"] for entry in into] == ["in"]
    for entry in (*out, *into):
        assert entry["slide_id"] == str(r.slide)
        assert (entry["from_case_id"], entry["to_case_id"]) == (str(source), str(target))
        assert (entry["reason"], entry["result_sets"], entry["tasks"]) == (MOVE_REASON, 1, 1)
    told = owner(
        database,
        f"SELECT user_id FROM notifications WHERE kind = 'slide-moved' AND target_id = '{r.slide}'",
    )
    assert [str(row[0]) for row in told] == [str(r.people["owner"].user_id)]


def test_a_move_waits_while_a_task_holding_the_slide_is_signed_off(
    api: ApiAs, database: str
) -> None:
    r, task = queued_review(api, database)
    source, target, mover = cases_for(database, r)
    decide = f"{task}/disagreements/{r.slide}"
    api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "agree"})
    api(r.people["owner"]).put(f"{decide}/T2", json={"answer": "disagree"})
    assert api(r.people["owner"]).post(f"{task}/sign-off").status_code == 200
    move = {"case_id": str(target), "reason": MOVE_REASON}

    refused = api(mover).post(f"/api/slides/{r.slide}/move", json=move)
    assert (refused.status_code, refused.json()["code"]) == (409, "task-signed-off")
    assert owner(database, f"SELECT case_id FROM slides WHERE id = '{r.slide}'") == [(source,)]
    assert moves_logged(database, source) == []

    reopened = api(r.people["owner"]).post(f"{task}/evaluation-versions", json=REASON)
    assert reopened.status_code == 201, reopened.text
    moved = api(mover).post(f"/api/slides/{r.slide}/move", json=move)
    assert moved.status_code == 200, moved.text
    assert [len(moves_logged(database, case)) for case in (source, target)] == [1, 1]


def test_a_move_needs_a_reason_an_owner_and_another_case_of_the_project(
    api: ApiAs, database: str
) -> None:
    r, _ = queued_review(api, database)
    source, target, mover = cases_for(database, r)
    path = f"/api/slides/{r.slide}/move"
    assert api(mover).post(path, json={"case_id": str(target)}).status_code == 422
    short = api(mover).post(path, json={"case_id": str(target), "reason": "Wrong"})
    assert short.status_code == 422
    same = api(mover).post(path, json={"case_id": str(source), "reason": MOVE_REASON})
    assert (same.status_code, same.json()["code"]) == (400, "slide-already-in-case")
    missing = api(mover).post(path, json={"case_id": str(uuid.uuid4()), "reason": MOVE_REASON})
    assert missing.status_code == 404
    reviewer = api(r.people["first"]).post(
        path, json={"case_id": str(target), "reason": MOVE_REASON}
    )
    assert reviewer.status_code == 403
    viewer = api(r.people["viewer"]).post(
        path, json={"case_id": str(target), "reason": MOVE_REASON}
    )
    assert viewer.status_code == 403
    tenant = tenant_of(database, r)
    elsewhere = make_project(database, tenant, "de-identified")
    foreign = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO cases (tenant_id, project_id, label, source) "
                f"VALUES ('{tenant}', '{elsewhere}', 'Other case', 'manual') RETURNING id",
            )[0][0]
        )
    )
    across = api(mover).post(path, json={"case_id": str(foreign), "reason": MOVE_REASON})
    assert (across.status_code, across.json()["code"]) == (400, "case-outside-project")
    owner(
        database,
        "INSERT INTO slides (tenant_id, project_id, case_id, label) "
        f"VALUES ('{tenant}', '{r.project}', '{target}', "
        f"(SELECT label FROM slides WHERE id = '{r.slide}'))",
    )
    taken = api(mover).post(path, json={"case_id": str(target), "reason": MOVE_REASON})
    assert (taken.status_code, taken.json()["code"]) == (409, "slide-label-taken")
    assert moves_logged(database, source) == []
