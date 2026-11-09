from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import make_workspace, owner

from parfocal_api.settings_catalogue import BY_KEY
from parfocal_api.tables import Role

PEOPLE = {"admin": Role.RESEARCHER, "researcher": Role.RESEARCHER, "reviewer": Role.REVIEWER}
OTHERS = ("researcher", "reviewer")
LAYERS = "/api/me/setting-layers"
SETTINGS = "/api/tenant/settings"
RETENTION = "/api/tenant/retention"
SESSION_POLICY = "/api/tenant/session-policy"


def class_list(api: ApiAs, person: Any) -> Any:
    return api(person).get(LAYERS).json()["lab"]["values"].get("default_classes")


@pytest.mark.db
def test_the_class_list_of_new_projects_saves_for_admins_only(api: ApiAs, database: str) -> None:
    people = make_workspace(database, PEOPLE, admins={"admin"}).people
    body = {"values": {"default_classes": "sentinel-node"}}
    for name in OTHERS:
        assert api(people[name]).put(SETTINGS, json=body).status_code == 403
    assert class_list(api, people["admin"]) is None
    assert api(people["admin"]).put(SETTINGS, json=body).status_code == 200
    assert class_list(api, people["admin"]) == "sentinel-node"
    assert class_list(api, people["reviewer"]) == "sentinel-node"


@pytest.mark.db
def test_retention_saves_and_reads_back_for_admins_only(api: ApiAs, database: str) -> None:
    people = make_workspace(database, PEOPLE, admins={"admin"}).people
    body = {"deleted_after_days": 90, "audit_after_days": 730}
    for name in OTHERS:
        assert api(people[name]).put(RETENTION, json=body).status_code == 403
    assert api(people["admin"]).get(RETENTION).json() == {
        "deleted_after_days": None,
        "audit_after_days": None,
    }
    assert api(people["admin"]).put(RETENTION, json=body).status_code == 200
    assert api(people["admin"]).get(RETENTION).json() == body
    cleared = {"deleted_after_days": None, "audit_after_days": 730}
    assert api(people["admin"]).put(RETENTION, json=cleared).status_code == 200
    assert api(people["admin"]).get(RETENTION).json() == cleared


@pytest.mark.db
def test_the_session_lock_saves_and_reads_back_for_admins_only(api: ApiAs, database: str) -> None:
    people = make_workspace(database, PEOPLE, admins={"admin"}).people
    body = {"idle_lock_minutes": 5, "session_hours": 12}
    for name in OTHERS:
        assert api(people[name]).put(SESSION_POLICY, json=body).status_code == 403
    assert api(people["admin"]).get(SESSION_POLICY).json()["idle_lock_minutes"] == 15
    assert api(people["admin"]).put(SESSION_POLICY, json=body).status_code == 200
    assert api(people["admin"]).get(SESSION_POLICY).json()["idle_lock_minutes"] == 5
    assert api(people["reviewer"]).get(SESSION_POLICY).json()["idle_lock_minutes"] == 5


def lab_of(api: ApiAs, person: Any) -> Any:
    return api(person).get(LAYERS).json()["lab"]


@pytest.mark.db
def test_the_privacy_of_new_projects_saves_for_admins_only(api: ApiAs, database: str) -> None:
    people = make_workspace(database, PEOPLE, admins={"admin"}).people
    body = {"values": {"default_privacy_mode": "clinical"}}
    for name in OTHERS:
        assert api(people[name]).put(SETTINGS, json=body).status_code == 403
    assert "default_privacy_mode" not in lab_of(api, people["admin"])["values"]
    assert api(people["admin"]).put(SETTINGS, json=body).status_code == 200
    assert lab_of(api, people["reviewer"])["values"]["default_privacy_mode"] == "clinical"


@pytest.mark.db
def test_lock_after_minutes_is_gone_and_old_values_stay_hidden(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, PEOPLE, admins={"admin"})
    admin = workspace.people["admin"]
    assert "lock_after_minutes" not in BY_KEY
    refused = api(admin).put(SETTINGS, json={"values": {"lock_after_minutes": 20}})
    assert refused.status_code == 400
    assert refused.json()["code"] == "unknown-setting"
    owner(
        database,
        "INSERT INTO workspace_settings (tenant_id, values, locked) "
        f"VALUES ('{workspace.tenant_id}', "
        """'{"lock_after_minutes": 20, "decision_cutoff": 60}', """
        "ARRAY['lock_after_minutes', 'decision_cutoff'])",
    )
    assert lab_of(api, admin) == {"values": {"decision_cutoff": 60}, "locked": ["decision_cutoff"]}
    saved = api(admin).put(SETTINGS, json={"values": {"default_classes": "pannuke"}, "locked": []})
    assert saved.status_code == 200
    assert "lock_after_minutes" not in saved.json()["values"]
