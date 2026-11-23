import base64
import gzip
import json
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import make_workspace

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

SESSION = "s1-1763900000000"
ANSWERS: dict[str, Any] = {
    "id": SESSION,
    "participant": "P-ABCD",
    "round": 1,
    "tasks": [{"id": "open-case", "success": True, "durationMs": 4200, "seq": 6}],
    "final": {"sus": [5, 1, 5, 1, 5, 1, 5, 1, 5, 1], "susScore": 100},
}
EVENTS: list[dict[str, Any]] = [
    {"t": 1, "k": "task", "taskId": "open-case", "edge": "start"},
    {"t": 2, "k": "camera", "slide": "s", "x": 10, "y": 20, "zoom": -3, "w": 100, "h": 80},
]


def packed(value: object) -> str:
    return base64.b64encode(gzip.compress(json.dumps(value).encode())).decode()


def unpacked(encoded: str) -> Any:
    return json.loads(gzip.decompress(base64.b64decode(encoded)))


@pytest.fixture
def people(database: str) -> dict[str, MemberPrincipal]:
    return make_workspace(
        database, {"moderator": Role.RESEARCHER, "seat": Role.RESEARCHER, "reader": Role.REVIEWER}
    ).people


def save(api: ApiAs, person: MemberPrincipal, answers: dict[str, Any]) -> Any:
    return api(person).put(
        f"/api/me/study-sessions/{SESSION}",
        json={"participant": "P-ABCD", "round": 1, "answers_gz": packed(answers)},
    )


def save_part(api: ApiAs, person: MemberPrincipal, seq: int, events: object) -> Any:
    return api(person).put(
        f"/api/me/study-sessions/{SESSION}/trace/{seq}", json={"events_gz": packed(events)}
    )


def test_a_session_and_its_trace_are_stored_and_read_back(
    api: ApiAs, people: dict[str, MemberPrincipal]
) -> None:
    seat, moderator = people["seat"], people["moderator"]
    assert save(api, seat, {**ANSWERS, "tasks": []}).status_code == 200
    assert save(api, seat, ANSWERS).status_code == 200
    late = 1763900000000
    assert save_part(api, seat, late + 1, EVENTS[1:]).status_code == 200
    assert save_part(api, seat, late, EVENTS[:1]).status_code == 200
    assert save_part(api, seat, late, [{"t": 9, "k": "mutation"}]).status_code == 200

    listed = api(moderator).get("/api/tenant/study-sessions")
    assert listed.status_code == 200, listed.text
    [row] = listed.json()["sessions"]
    assert row.pop("updated_at")
    assert row == {
        "session_key": SESSION,
        "participant": "P-ABCD",
        "round": 1,
        "dry_run": False,
        "answers": ANSWERS,
        "trace_parts": 2,
    }

    trace = api(moderator).get(f"/api/tenant/study-sessions/{SESSION}/trace")
    assert trace.status_code == 200, trace.text
    parts = trace.json()["parts"]
    assert [part["seq"] for part in parts] == [late, late + 1]
    assert [event for part in parts for event in unpacked(part["events_gz"])] == EVENTS


def test_a_dry_run_mark_is_kept_and_an_unknown_session_is_not_found(
    api: ApiAs, people: dict[str, MemberPrincipal]
) -> None:
    moderator = people["moderator"]
    assert save(api, people["seat"], ANSWERS).status_code == 200
    marked = api(moderator).put(
        f"/api/tenant/study-sessions/{SESSION}/dry-run", json={"dry_run": True}
    )
    assert (marked.status_code, marked.json()) == (200, {"dry_run": True})
    assert save(api, people["seat"], ANSWERS).status_code == 200
    [row] = api(moderator).get("/api/tenant/study-sessions").json()["sessions"]
    assert row["dry_run"] is True
    missing = api(moderator).put(
        "/api/tenant/study-sessions/never-sent/dry-run", json={"dry_run": True}
    )
    assert missing.status_code == 404


def test_a_reviewer_uploads_but_cannot_read_results(
    api: ApiAs, people: dict[str, MemberPrincipal]
) -> None:
    reader = people["reader"]
    assert save(api, reader, ANSWERS).status_code == 200
    assert api(reader).get("/api/tenant/study-sessions").status_code == 403
    assert api(reader).get(f"/api/tenant/study-sessions/{SESSION}/trace").status_code == 403


@pytest.mark.parametrize(
    "answers_gz",
    [
        base64.b64encode(json.dumps(ANSWERS).encode()).decode(),
        "not base64!",
        base64.b64encode(gzip.compress(b"[1, 2]")).decode(),
        base64.b64encode(gzip.compress(b"{not json")).decode(),
        base64.b64encode(gzip.compress(b" " * (1024 * 1024 + 1))).decode(),
    ],
)
def test_an_upload_that_is_not_gzipped_json_within_its_limit_is_refused(
    api: ApiAs, people: dict[str, MemberPrincipal], answers_gz: str
) -> None:
    response = api(people["seat"]).put(
        f"/api/me/study-sessions/{SESSION}",
        json={"participant": "P-ABCD", "round": 1, "answers_gz": answers_gz},
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "study-upload-not-gzip"
