import pytest
from idp_support import Browser

from parfocal_api import own_workspaces

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


def count(browser: Browser, table: str) -> int:
    return int(str(browser.sql(f"SELECT count(*) FROM {table}")[0][0]))


def test_a_person_who_already_has_admin_rights_cannot_create_another_workspace(
    browser: Browser,
) -> None:
    browser.login()
    assert browser.client.post("/api/me/workspaces", json={"name": "First"}).status_code == 201
    tenants_before = count(browser, "tenants")
    refused = browser.client.post("/api/me/workspaces", json={"name": "Second"})
    assert (refused.status_code, refused.json()["code"]) == (409, "already-an-admin")
    assert count(browser, "tenants") == tenants_before


def test_a_failure_part_way_leaves_no_tenant_behind(
    browser: Browser, monkeypatch: pytest.MonkeyPatch
) -> None:
    browser.login()

    async def broken(*_: object, **__: object) -> None:
        raise RuntimeError("seeding failed")

    monkeypatch.setattr(own_workspaces, "seed_built_ins", broken)
    before = (count(browser, "tenants"), count(browser, "organisations"))
    with pytest.raises(RuntimeError):
        browser.client.post("/api/me/workspaces", json={"name": "Broken"})
    assert (count(browser, "tenants"), count(browser, "organisations")) == before
