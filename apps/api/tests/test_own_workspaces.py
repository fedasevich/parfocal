import pytest
from idp_support import Browser

pytestmark = pytest.mark.db


def test_the_creator_of_a_workspace_is_a_researcher_with_admin_rights(browser: Browser) -> None:
    browser.login()
    created = browser.client.post(
        "/api/me/workspaces", json={"name": "Sentinel lab", "default_privacy_mode": "clinical"}
    )
    assert created.status_code == 201
    workspace = created.json()
    assert (workspace["name"], workspace["role"], workspace["admin_rights"]) == (
        "Sentinel lab",
        "researcher",
        True,
    )
    me = browser.client.get("/api/me").json()
    assert me["active_tenant_id"] == workspace["tenant_id"]
    assert [(item["role"], item["admin_rights"]) for item in me["workspaces"]] == [
        ("researcher", True)
    ]
    members = browser.client.get("/api/tenant/members").json()
    assert [(item["role"], item["admin_rights"]) for item in members] == [("researcher", True)]
    layers = browser.client.get("/api/me/setting-layers").json()
    assert layers["lab"]["values"] == {"default_privacy_mode": "clinical"}


def test_a_workspace_name_is_required(browser: Browser) -> None:
    browser.login()
    assert browser.client.post("/api/me/workspaces", json={"name": "  "}).status_code == 422
