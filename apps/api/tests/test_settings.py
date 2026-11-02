from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import make_workspace, owner

from parfocal_api.settings_catalogue import TS_PATH, render
from parfocal_api.tables import Role

ME = "/api/me/setting-layers"
WORKSPACE = "/api/tenant/settings"
PEOPLE = {"admin": Role.RESEARCHER, "researcher": Role.RESEARCHER, "reviewer": Role.REVIEWER}


def problem(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def test_the_typescript_catalogue_is_current() -> None:
    assert Path(TS_PATH).read_text() == render()


@pytest.mark.db
def test_personal_settings_are_kept_per_person_and_cleared_with_null(
    api: ApiAs, database: str
) -> None:
    people = make_workspace(database, PEOPLE, admins={"admin"}).people
    reviewer = api(people["reviewer"])
    assert reviewer.get(ME).json() == {"lab": {"values": {}, "locked": []}, "personal": {}}
    saved = reviewer.put(ME, json={"values": {"density": "compact", "notify_replies": False}})
    assert saved.status_code == 200, saved.text
    assert saved.json()["personal"] == {"density": "compact", "notify_replies": False}
    cleared = reviewer.put(ME, json={"values": {"density": None}}).json()
    assert cleared["personal"] == {"notify_replies": False}
    assert api(people["researcher"]).get(ME).json()["personal"] == {}


@pytest.mark.db
@pytest.mark.parametrize(
    ("values", "code"),
    [
        ({"theme": "dark"}, "unknown-setting"),
        ({"decision_cutoff": 10}, "unknown-setting"),
        ({"nonsense": 1}, "unknown-setting"),
        ({"density": "huge"}, "invalid-setting"),
        ({"side_panel_width": 9000}, "invalid-setting"),
        ({"slide_strip": "yes"}, "invalid-setting"),
    ],
)
def test_device_lab_unknown_and_mistyped_personal_values_are_refused(
    api: ApiAs, database: str, values: dict[str, object], code: str
) -> None:
    people = make_workspace(database, PEOPLE).people
    assert problem(api(people["researcher"]).put(ME, json={"values": values})) == (400, code)


@pytest.mark.db
def test_a_locked_workspace_value_refuses_a_personal_one_and_is_audited(
    api: ApiAs, database: str
) -> None:
    workspace = make_workspace(database, PEOPLE, admins={"admin"})
    people = workspace.people
    body = {
        "values": {"patient_names": "initials", "decision_cutoff": 70},
        "locked": ["patient_names"],
    }
    assert api(people["researcher"]).put(WORKSPACE, json=body).status_code == 403
    saved = api(people["admin"]).put(WORKSPACE, json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json() == {
        "values": {"patient_names": "initials", "decision_cutoff": 70},
        "locked": ["patient_names"],
    }
    refused = api(people["reviewer"]).put(ME, json={"values": {"patient_names": "full"}})
    assert problem(refused) == (409, "setting-locked")
    assert api(people["reviewer"]).get(ME).json()["lab"]["locked"] == ["patient_names"]
    unknown_lock = api(people["admin"]).put(WORKSPACE, json={"values": {}, "locked": ["theme"]})
    assert problem(unknown_lock) == (400, "unknown-setting")
    personal_only = api(people["admin"]).put(WORKSPACE, json={"values": {"density": "compact"}})
    assert problem(personal_only) == (400, "unknown-setting")
    audited = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE tenant_id = '{workspace.tenant_id}' AND action = 'tenant.settings-changed'",
    )
    assert len(audited) == 1


@pytest.mark.db
def test_another_workspace_sees_none_of_the_settings(api: ApiAs, database: str) -> None:
    first = make_workspace(database, PEOPLE, admins={"admin"}).people
    second = make_workspace(database, PEOPLE, admins={"admin"}).people
    api(first["admin"]).put(WORKSPACE, json={"values": {"lock_after_minutes": 5}})
    api(first["researcher"]).put(ME, json={"values": {"tools": "dock"}})
    assert api(second["researcher"]).get(ME).json() == {
        "lab": {"values": {}, "locked": []},
        "personal": {},
    }
