from collections.abc import Iterator
from datetime import UTC, datetime, timedelta

import pytest
from db_support import ApiAs
from workspace_support import Workspace, make_workspace, owner

from parfocal_api.maintenance import CHECK_SECONDS, Maintenance, MaintenanceState, stays_open
from parfocal_api.principals import PlatformOperator
from parfocal_api.tables import Role

PLATFORM = "/api/platform/maintenance"
STATUS = "/api/status"
OPERATOR = PlatformOperator("maintenance-operator")
MESSAGE = "Database upgrade, back by 22:00"


@pytest.fixture
def ended(database: str) -> Iterator[None]:
    try:
        yield
    finally:
        owner(
            database,
            "UPDATE maintenance SET message = NULL, started_at = NULL, expected_end_at = NULL",
        )


def researcher(database: str) -> Workspace:
    return make_workspace(database, {"researcher": Role.RESEARCHER})


@pytest.mark.parametrize(
    ("path", "open_"),
    [
        ("/api/auth/sign-in", True),
        ("/api/auth/passkey-sign-in/finish", True),
        ("/api/auth/activity", True),
        ("/api/auth/sessions/end-others", True),
        ("/api/platform/maintenance", True),
        ("/api/auth/sign-up", False),
        ("/api/auth/sign-in-elsewhere", False),
        ("/api/projects", False),
    ],
)
def test_only_signing_in_and_out_and_the_switch_stay_open(path: str, open_: bool) -> None:
    assert stays_open(path) is open_


class Ticks:
    def __init__(self) -> None:
        self.now = 100.0

    def __call__(self) -> float:
        return self.now


async def test_the_gate_reads_the_switch_again_only_after_a_few_seconds() -> None:
    ticks = Ticks()
    on = Maintenance(message=MESSAGE, started_at=datetime.now(UTC), expected_end_at=None)
    state = MaintenanceState(engine=None, clock=ticks)  # type: ignore[arg-type]
    state.remember(on)
    ticks.now += CHECK_SECONDS - 0.1
    assert await state.read() == on
    state.remember(None)
    assert await state.read() is None


@pytest.mark.db
def test_the_status_is_ok_for_anyone_when_nothing_is_paused(api: ApiAs) -> None:
    api.principal = None
    response = api.client.get(STATUS)
    assert response.status_code == 200, response.text
    assert response.json() == {"status": "ok", "maintenance": None, "release": None}


@pytest.mark.db
def test_the_status_names_the_release_the_deploy_set(
    api: ApiAs, monkeypatch: pytest.MonkeyPatch
) -> None:
    api.principal = None
    monkeypatch.setenv("PARFOCAL_RELEASE", "v0.29.2")
    response = api.client.get(STATUS)
    assert response.status_code == 200, response.text
    assert response.json()["release"] == "v0.29.2"


@pytest.mark.db
def test_maintenance_blocks_writes_but_keeps_reads_until_it_ends(
    api: ApiAs, database: str, ended: None
) -> None:
    workspace = researcher(database)
    person = workspace.people["researcher"]
    expected_end = datetime.now(UTC) + timedelta(hours=2)
    started = api(OPERATOR).put(
        PLATFORM, json={"message": MESSAGE, "expected_end_at": expected_end.isoformat()}
    )
    assert started.status_code == 200, started.text
    assert started.json()["status"] == "maintenance"

    api.principal = None
    status = api.client.get(STATUS).json()
    assert status["status"] == "maintenance"
    assert status["maintenance"]["message"] == MESSAGE
    assert datetime.fromisoformat(status["maintenance"]["expected_end_at"]) == expected_end

    refused = api(person).post("/api/projects", json={"name": "Paused"})
    assert refused.status_code == 503, refused.text
    assert refused.json()["code"] == "maintenance"
    assert refused.json()["detail"] == MESSAGE
    assert refused.headers["retry-after"] == "60"
    assert refused.headers["content-type"] == "application/problem+json"
    assert api(person).get("/api/projects").status_code == 200

    finished = api(OPERATOR).delete(PLATFORM)
    assert finished.status_code == 200, finished.text
    assert finished.json() == {"status": "ok", "maintenance": None, "release": None}
    assert api(person).post("/api/projects", json={"name": "Resumed"}).status_code == 201

    actions = owner(
        database,
        "SELECT action FROM audit_events WHERE target_type = 'maintenance' ORDER BY seq",
    )
    assert [row[0] for row in actions][-2:] == ["maintenance.started", "maintenance.ended"]


@pytest.mark.db
def test_starting_again_keeps_the_start_and_changes_the_message(api: ApiAs, ended: None) -> None:
    first = api(OPERATOR).put(PLATFORM, json={"message": "First"}).json()
    second = api(OPERATOR).put(PLATFORM, json={"message": "Second"}).json()
    assert second["maintenance"]["message"] == "Second"
    assert second["maintenance"]["started_at"] == first["maintenance"]["started_at"]


@pytest.mark.db
def test_only_an_operator_switches_maintenance(api: ApiAs, database: str) -> None:
    person = researcher(database).people["researcher"]
    refused = api(person).put(PLATFORM, json={"message": MESSAGE})
    assert refused.status_code == 403, refused.text
    assert api(person).delete(PLATFORM).status_code == 403


@pytest.mark.db
def test_the_expected_end_must_be_ahead(api: ApiAs) -> None:
    past = (datetime.now(UTC) - timedelta(minutes=1)).isoformat()
    refused = api(OPERATOR).put(PLATFORM, json={"message": MESSAGE, "expected_end_at": past})
    assert refused.status_code == 400, refused.text
    assert refused.json()["code"] == "maintenance-end-in-the-past"
