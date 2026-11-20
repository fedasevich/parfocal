import asyncio
from typing import Any

import pytest
from db_support import ApiAs
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError
from test_audit import in_scope
from test_reviewed_layer import BOTH, LEFT, POINT, RIGHT, SQUARE, Review, edit, merge, review, split
from workspace_support import owner

from parfocal_common.db import DatabaseScope

pytestmark = pytest.mark.db


def history(api: ApiAs, r: Review, object_id: str, who: str = "first") -> Any:
    response = api(r.people[who]).get(f"{r.base}/edits/{object_id}/history")
    assert response.status_code == 200, response.text
    return response.json()


def steps(entries: list[dict[str, Any]]) -> list[tuple[str, str]]:
    return [(entry["object"], entry["change"]) for entry in entries]


def versions(database: str, r: Review) -> list[tuple[object, ...]]:
    return owner(
        database,
        "SELECT kind, number, split, change FROM review_edit_versions "
        f"WHERE task_id = '{r.task}' ORDER BY sequence",
    )


def test_every_save_and_clear_keeps_a_version_after_the_ai_original(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    assert edit(api, r, "first", "T1", {"class_id": str(r.tumor)}).status_code == 200
    assert edit(api, r, "first", "T1", {"geometry": SQUARE}).status_code == 200
    assert api(r.people["first"]).delete(f"{r.base}/edits/T1").status_code == 204
    assert api(r.people["first"]).delete(f"{r.base}/edits/T1").status_code == 204
    found = history(api, r, "T1")
    assert steps(found) == [
        ("T1", "ai-original"),
        ("T1", "edited"),
        ("T1", "edited"),
        ("T1", "cleared"),
    ]
    original, retyped, reshaped, cleared = found
    assert original["geometry"]["type"] == "Polygon"
    assert original["changed_at"] is None
    assert (retyped["class_id"], retyped["geometry"]) == (str(r.tumor), None)
    assert reshaped["geometry"] == SQUARE
    assert reshaped["reviewer_id"] == str(r.people["first"].user_id)
    assert (cleared["class_id"], cleared["geometry"], cleared["related"]) == (None, None, ["T1"])
    assert len(versions(database, r)) == 3


def test_a_cell_history_starts_with_its_ai_outline(api: ApiAs, database: str) -> None:
    r = review(api, database)
    edit(api, r, "first", "C3", {"geometry": POINT})
    original, moved = history(api, r, "C3")
    assert original["change"] == "ai-original"
    assert original["geometry"]["type"] == "Polygon"
    assert (moved["change"], moved["geometry"]) == ("edited", POINT)


def test_a_split_and_a_merge_write_a_row_for_every_object_they_change(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    assert split(api, r, "T1", LEFT, RIGHT).status_code == 201
    part = history(api, r, "T1a")
    assert steps(part) == [("T1", "ai-original"), ("T1", "split"), ("T1a", "part")]
    assert part[1]["related"] == ["T1a", "T1b"]
    assert (part[2]["geometry"], part[2]["related"]) == (LEFT, ["T1"])
    assert api(r.people["first"]).delete(f"{r.base}/edits/T1").status_code == 204
    assert merge(api, r, "T1", "T2").status_code == 201
    kept = history(api, r, "T1")
    assert steps(kept)[-1] == ("T1", "merged")
    assert (kept[-1]["geometry"], kept[-1]["related"]) == (BOTH, ["T2"])
    alias = history(api, r, "T2")
    assert steps(alias) == [("T2", "ai-original"), ("T2", "merged-into")]
    assert alias[-1]["related"] == ["T1"]
    assert versions(database, r) == [
        ("region", 1, "", "split"),
        ("region", 1, "a", "part"),
        ("region", 1, "b", "part"),
        ("region", 1, "a", "cleared"),
        ("region", 1, "b", "cleared"),
        ("region", 1, "", "cleared"),
        ("region", 1, "", "merged"),
        ("region", 2, "", "merged-into"),
    ]


def test_each_reviewer_sees_only_the_history_they_may_see(api: ApiAs, database: str) -> None:
    r = review(api, database)
    edit(api, r, "first", "T1", {"deleted": True})
    assert steps(history(api, r, "T1", "second")) == [("T1", "ai-original")]
    unknown = api(r.people["first"]).get(f"{r.base}/edits/T9/history")
    assert (unknown.status_code, unknown.json()["code"]) == (404, "unknown-object")


def test_an_owner_reads_a_reviewers_history(api: ApiAs, database: str) -> None:
    r = review(api, database)
    edit(api, r, "first", "T1", {"deleted": True})
    reviewer = r.people["first"].user_id
    response = api(r.people["owner"]).get(
        f"{r.base}/edits/T1/history", params={"reviewer_id": str(reviewer)}
    )
    assert response.status_code == 200, response.text
    assert steps(response.json()) == [("T1", "ai-original"), ("T1", "edited")]


def test_an_undone_edit_keeps_the_slide_started_so_its_history_stays(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    edit(api, r, "first", "T1", {"deleted": True})
    assert api(r.people["first"]).delete(f"{r.base}/edits/T1").status_code == 204
    moved = api(r.people["owner"]).post(
        f"/api/review-tasks/{r.task}/reassignments",
        json={
            "from_user_id": str(r.people["first"].user_id),
            "to_user_id": str(r.people["third"].user_id),
            "what": "all",
        },
    )
    assert moved.status_code == 201, moved.text
    assert moved.json()["kept_slide_ids"] == [str(r.slide)]
    assert versions(database, r) == [("region", 1, "", "edited"), ("region", 1, "", "cleared")]


def test_the_app_role_cannot_change_or_remove_versions(api: ApiAs, database: str) -> None:
    r = review(api, database)
    edit(api, r, "first", "T1", {"deleted": True})
    scope = DatabaseScope(tenant_id=r.people["first"].tenant_id)
    for statement in (
        "UPDATE review_edit_versions SET deleted = false",
        "DELETE FROM review_edit_versions",
        "TRUNCATE review_edit_versions",
    ):
        with pytest.raises(DBAPIError, match="permission denied"):
            asyncio.run(in_scope(database, scope, lambda c, s=statement: c.execute(text(s))))
    assert versions(database, r) == [("region", 1, "", "edited")]
