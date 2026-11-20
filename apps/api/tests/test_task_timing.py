from typing import Any

import pytest
from db_support import ApiAs
from test_model_runs import Lab, make_lab

pytestmark = pytest.mark.db

EVENTS: list[dict[str, Any]] = [
    {"name": "task_finished", "task_kind": "review", "duration_ms": 540_000},
    {"name": "area_time_recorded", "area": "viewer", "duration_ms": 120_000},
    {"name": "cell_review_timed", "duration_ms": 4_200},
    {"name": "chrome_coverage_measured", "area": "viewer", "coverage_permille": 280},
    {
        "name": "reading_time_compared",
        "task_kind": "review",
        "estimated_ms": 600_000,
        "duration_ms": 540_000,
    },
]


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database, admins=("owner",))


def record(api: ApiAs, lab: Lab, person: str, events: list[dict[str, Any]]) -> Any:
    return api(lab.people[person]).post("/api/me/timing-events", json={"events": events})


def timing(api: ApiAs, lab: Lab) -> Any:
    return api(lab.people["owner"]).get("/api/tenant/task-timing")


def test_recorded_timing_events_come_back_on_the_timing_page(api: ApiAs, lab: Lab) -> None:
    assert timing(api, lab).json() == {"events": []}
    response = record(api, lab, "colleague", EVENTS)
    assert (response.status_code, response.json()) == (200, {"recorded": 5})
    body = timing(api, lab)
    assert body.status_code == 200, body.text
    returned: list[dict[str, Any]] = body.json()["events"]
    assert all(event.pop("recorded_at") for event in returned)
    empty = dict.fromkeys(("task_kind", "area", "duration_ms", "estimated_ms", "coverage_permille"))
    by_name = {str(event["name"]): event for event in returned}
    assert by_name == {str(event["name"]): {**empty, **event} for event in EVENTS}


def test_an_opted_out_person_records_nothing(api: ApiAs, lab: Lab) -> None:
    opted = api(lab.people["colleague"]).put(
        "/api/me/setting-layers", json={"values": {"analytics_opt_out": True}}
    )
    assert opted.status_code == 200, opted.text
    assert record(api, lab, "colleague", EVENTS[:1]).json() == {"recorded": 0}
    assert timing(api, lab).json() == {"events": []}


def test_a_workspace_with_analytics_off_records_nothing(api: ApiAs, lab: Lab) -> None:
    off = api(lab.people["owner"]).put(
        "/api/tenant/settings", json={"values": {"analytics_policy": "off"}}
    )
    assert off.status_code == 200, off.text
    assert record(api, lab, "colleague", EVENTS[:1]).json() == {"recorded": 0}
    assert timing(api, lab).json() == {"events": []}


@pytest.mark.parametrize(
    "event",
    [
        {"name": "task_finished", "duration_ms": 10},
        {"name": "cell_review_timed", "duration_ms": 10, "area": "viewer"},
        {"name": "task_finished", "task_kind": "chat", "duration_ms": 10},
        {"name": "chrome_coverage_measured", "area": "viewer", "coverage_permille": 1001},
        {"name": "task_started", "task_kind": "review"},
    ],
)
def test_an_event_that_does_not_fit_its_name_is_refused(
    api: ApiAs, lab: Lab, event: dict[str, Any]
) -> None:
    assert record(api, lab, "colleague", [event]).status_code == 422
