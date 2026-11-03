import json
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import make_workspace, owner

from parfocal_api.settings_catalogue import BY_KEY, TS_PATH, Layer, render
from parfocal_api.tables import Role

ME = "/api/me/setting-layers"
WORKSPACE = "/api/tenant/settings"
PEOPLE = {"admin": Role.RESEARCHER, "researcher": Role.RESEARCHER, "reviewer": Role.REVIEWER}


def problem(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


def test_the_typescript_catalogue_is_current() -> None:
    assert Path(TS_PATH).read_text() == render()


def test_the_tumor_share_result_is_a_lab_setting_off_for_sentinel_nodes() -> None:
    for key in (
        "tumor_share_cutoff",
        "tumor_share_result_sentinel_node",
        "tumor_share_result_pannuke",
    ):
        assert BY_KEY[key].layers == {Layer.LAB}
    assert BY_KEY["tumor_share_result_sentinel_node"].default is False
    assert BY_KEY["tumor_share_result_pannuke"].default is True
    assert BY_KEY["tumor_share_cutoff"].default == 20
    assert BY_KEY["tumor_share_cutoff"].problem(0) is not None
    assert BY_KEY["tumor_share_cutoff"].problem(30) is None


def test_the_home_layout_is_personal_and_follows_the_role_by_default() -> None:
    setting = BY_KEY["home_layout"]
    assert setting.layers == {Layer.PERSONAL}
    assert setting.default == "role"
    assert setting.problem("research") is None
    assert setting.problem("anything") is not None


def test_the_minimap_is_personal_and_shows_when_useful_by_default() -> None:
    setting = BY_KEY["minimap"]
    assert setting.layers == {Layer.PERSONAL}
    assert setting.default == "useful"
    for mode in ("useful", "always", "never"):
        assert setting.problem(mode) is None
    for stale in ("corner", "hidden"):
        assert setting.problem(stale) is not None


def test_confidence_wording_offers_frequency_and_keeps_words_by_default() -> None:
    setting = BY_KEY["confidence_wording"]
    assert setting.layers == {Layer.PERSONAL}
    assert setting.default == "words"
    for mode in ("words", "numbers", "frequency", "colour", "hidden"):
        assert setting.problem(mode) is None
    assert setting.problem("percent") is not None


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


@pytest.mark.db
def test_only_researchers_with_admin_rights_save_workspace_defaults(
    api: ApiAs, database: str
) -> None:
    people = make_workspace(database, PEOPLE, admins={"admin"}).people
    body = {"values": {"default_privacy_mode": "clinical", "default_classes": "pannuke"}}
    assert api(people["researcher"]).put(WORKSPACE, json=body).status_code == 403
    assert api(people["reviewer"]).put(WORKSPACE, json=body).status_code == 403
    assert api(people["admin"]).get(ME).json()["lab"]["values"] == {}
    saved = api(people["admin"]).put(WORKSPACE, json=body)
    assert saved.status_code == 200, saved.text
    assert saved.json()["values"] == body["values"]
    assert api(people["reviewer"]).get(ME).json()["lab"]["values"] == body["values"]


@pytest.mark.db
def test_the_default_study_template_must_be_the_workspaces_and_changes_are_audited(
    api: ApiAs, database: str
) -> None:
    workspace = make_workspace(database, PEOPLE, admins={"admin"})
    admin = api(workspace.people["admin"])
    template = admin.get("/api/study-templates").json()[0]["id"]
    nowhere = "00000000-0000-4000-8000-000000000000"
    unknown = admin.put(WORKSPACE, json={"values": {"default_study_template": nowhere}})
    assert problem(unknown) == (400, "unknown-study-template")
    malformed = admin.put(WORKSPACE, json={"values": {"default_study_template": "latest"}})
    assert problem(malformed) == (400, "invalid-setting")
    unknown_mode = admin.put(WORKSPACE, json={"values": {"default_privacy_mode": "open"}})
    assert problem(unknown_mode) == (400, "invalid-setting")
    saved = admin.put(
        WORKSPACE,
        json={"values": {"default_study_template": template, "default_classes": "none"}},
    )
    assert saved.status_code == 200, saved.text
    assert saved.json()["values"]["default_study_template"] == template
    cleared = admin.put(WORKSPACE, json={"values": {"default_study_template": None}})
    assert "default_study_template" not in cleared.json()["values"]
    audited = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE tenant_id = '{workspace.tenant_id}' AND action = 'tenant.settings-changed' "
        "ORDER BY seq",
    )
    assert len(audited) == 2
    assert json.loads(str(audited[0][0]))["keys"] == ["default_classes", "default_study_template"]


@pytest.mark.db
def test_every_console_write_needs_admin_rights_and_is_audited(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, PEOPLE, admins={"admin"})
    people = workspace.people
    writes = [
        ("put", "/api/tenant/session-policy", {"idle_lock_minutes": 30, "session_hours": 8}),
        ("put", "/api/tenant/model-tiers/tumor/good", {"name": "camelyon-tumor"}),
        ("post", "/api/announcements", {"kind": "change", "text": "Rounds move to 09:00"}),
    ]
    for method, path, body in writes:
        for who in ("researcher", "reviewer"):
            refused = getattr(api(people[who]), method)(path, json=body)
            assert refused.status_code == 403, (path, who)
        allowed = getattr(api(people["admin"]), method)(path, json=body)
        assert allowed.status_code in (200, 201), (path, allowed.text)
    actions = owner(
        database,
        f"SELECT action FROM audit_events WHERE tenant_id = '{workspace.tenant_id}' ORDER BY seq",
    )
    assert {row[0] for row in actions} >= {
        "tenant.session-policy-changed",
        "model-tier.set",
        "announcement.posted",
    }
