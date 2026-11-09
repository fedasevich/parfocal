import secrets
from collections.abc import Iterator

import pytest
from idp_support import Browser, signed_in_browser

from parfocal_api import workspace_access
from parfocal_api.workspace_access import email_domain_of

pytestmark = pytest.mark.db


@pytest.fixture
def domain() -> str:
    return f"lab-{secrets.token_hex(4)}.test"


@pytest.fixture
def colleague(database: str) -> Iterator[Browser]:
    with signed_in_browser(database) as signed_in:
        yield signed_in


def sign_in(browser: Browser, email: str) -> None:
    browser.idp.claim_overrides = {"email": email, "email_verified": True}
    browser.login()


def create_workspace(browser: Browser, domain: str, **extra: str) -> str:
    sign_in(browser, f"admin@{domain}")
    created = browser.client.post("/api/me/workspaces", json={"name": "Sentinel lab", **extra})
    assert created.status_code == 201
    return str(created.json()["tenant_id"])


def test_a_colleague_with_the_same_email_domain_joins_at_once(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    sign_in(colleague, f"reader@{domain}")
    joinable = colleague.client.get("/api/me/joinable-workspaces").json()
    assert [(item["id"], item["how"], item["members"], item["domain"]) for item in joinable] == [
        (tenant_id, "join", 1, domain)
    ]
    joined = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/membership")
    assert joined.status_code == 201
    assert (joined.json()["role"], joined.json()["admin_rights"]) == ("reviewer", False)
    me = colleague.client.get("/api/me").json()
    assert me["active_tenant_id"] == tenant_id
    assert colleague.client.get("/api/me/joinable-workspaces").json() == []
    again = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/membership")
    assert (again.status_code, again.json()["code"]) == (409, "already-in-workspace")


def test_a_person_from_another_domain_cannot_join_or_ask(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    sign_in(colleague, f"reader@other-{domain}")
    assert colleague.client.get("/api/me/joinable-workspaces").json() == []
    for path in ("membership", "access-requests"):
        refused = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/{path}")
        assert (refused.status_code, refused.json()["code"]) == (404, "workspace-not-joinable")


def test_a_workspace_made_from_a_public_email_is_not_joinable(browser: Browser) -> None:
    sign_in(browser, f"someone-{secrets.token_hex(4)}@gmail.com")
    tenant_id = browser.client.post("/api/me/workspaces", json={"name": "Home lab"}).json()[
        "tenant_id"
    ]
    rows = browser.sql(f"SELECT email_domain FROM tenants WHERE id = '{tenant_id}'")
    assert rows == [(None,)]


def test_an_ask_notifies_the_admins_and_an_admin_approves_it(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    browser.sql(f"UPDATE tenants SET join_policy = 'ask' WHERE id = '{tenant_id}'")
    sign_in(colleague, f"asker@{domain}")
    joinable = colleague.client.get("/api/me/joinable-workspaces").json()
    assert [(item["how"], item["asked"]) for item in joinable] == [("ask", False)]
    refused = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/membership")
    assert (refused.status_code, refused.json()["code"]) == (409, "ask-to-join")

    asked = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/access-requests")
    assert asked.status_code == 201
    request_id = asked.json()["id"]
    assert asked.json()["status"] == "pending"
    repeated = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/access-requests")
    assert repeated.json()["id"] == request_id
    assert colleague.client.get("/api/me/joinable-workspaces").json()[0]["asked"] is True

    admin_id = browser.client.get("/api/me").json()["user_id"]
    asker_id = colleague.client.get("/api/me").json()["user_id"]
    notified = browser.sql(
        "SELECT user_id::text, target_type, payload->>'user_id' FROM notifications "
        f"WHERE kind = 'workspace-access-asked' AND tenant_id = '{tenant_id}'"
    )
    assert notified == [(admin_id, "access-request", asker_id)]

    pending = browser.client.get("/api/tenant/access-requests").json()
    assert [(item["id"], item["user_id"]) for item in pending] == [(request_id, asker_id)]
    approved = browser.client.post(f"/api/tenant/access-requests/{request_id}/approval")
    assert approved.status_code == 200
    assert (approved.json()["user_id"], approved.json()["role"]) == (asker_id, "reviewer")
    assert browser.client.get("/api/tenant/access-requests").json() == []
    twice = browser.client.post(f"/api/tenant/access-requests/{request_id}/approval")
    assert (twice.status_code, twice.json()["code"]) == (404, "access-request-not-found")
    workspaces = colleague.client.get("/api/me").json()["workspaces"]
    assert [(item["tenant_id"], item["role"]) for item in workspaces] == [(tenant_id, "reviewer")]


def test_a_reviewer_cannot_approve_an_ask(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    sign_in(colleague, f"reader@{domain}")
    colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/membership")
    assert colleague.client.get("/api/tenant/access-requests").status_code == 403


def test_setup_saves_the_specialties_on_the_person(browser: Browser) -> None:
    browser.login()
    saved = browser.client.patch(
        "/api/me", json={"specialties": ["Breast", "Lymph nodes", "Breast", "Neuropathology"]}
    )
    assert saved.status_code == 200
    assert saved.json()["specialties"] == ["Breast", "Lymph nodes", "Neuropathology"]
    assert browser.client.get("/api/me").json()["specialties"] == [
        "Breast",
        "Lymph nodes",
        "Neuropathology",
    ]
    assert browser.client.patch("/api/me", json={"specialties": [" "]}).status_code == 422


def test_setup_saves_the_logo_on_the_workspace(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain, logo="SL", logo_colour="#1f9d8b")
    workspace = browser.client.get("/api/me").json()["workspaces"][0]
    assert (workspace["logo"], workspace["logo_colour"]) == ("SL", "#1f9d8b")
    sign_in(colleague, f"reader@{domain}")
    listed = colleague.client.get("/api/me/joinable-workspaces").json()
    assert [(item["id"], item["logo"], item["logo_colour"]) for item in listed] == [
        (tenant_id, "SL", "#1f9d8b")
    ]


def test_a_workspace_without_a_chosen_logo_gets_its_initials(browser: Browser) -> None:
    browser.login()
    created = browser.client.post("/api/me/workspaces", json={"name": "brno nodes lab"}).json()
    assert created["logo"] == "BN"
    assert created["logo_colour"].startswith("#")
    refused = browser.client.post("/api/me/workspaces", json={"name": "Other", "logo": "toolong"})
    assert refused.status_code == 422


@pytest.mark.parametrize(
    "email",
    ["a@hotmail.co.uk", "a@yahoo.fr", "a@outlook.de", "a@yandex.ru", "a@mail.ru", "a@pm.me"],
)
def test_public_mail_domains_are_never_saved(email: str) -> None:
    assert email_domain_of(email) is None


def test_a_lab_domain_is_saved_in_lower_case() -> None:
    assert email_domain_of("Reader@FN-Vltava.Example") == "fn-vltava.example"


def test_a_join_that_loses_a_race_says_you_are_in_already(
    browser: Browser, colleague: Browser, domain: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    tenant_id = create_workspace(browser, domain)
    sign_in(colleague, f"reader@{domain}")
    path = f"/api/me/joinable-workspaces/{tenant_id}/membership"
    assert colleague.client.post(path).status_code == 201

    async def never(*_: object) -> bool:
        return False

    monkeypatch.setattr(workspace_access, "is_member", never)
    raced = colleague.client.post(path)
    assert (raced.status_code, raced.json()["code"]) == (409, "already-in-workspace")
    added = browser.sql(
        "SELECT count(*) FROM audit_events "
        f"WHERE action = 'member.added' AND tenant_id = '{tenant_id}'"
    )
    assert added == [(2,)]


def test_joining_directly_closes_an_open_ask_and_audits_the_request(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    browser.sql(f"UPDATE tenants SET join_policy = 'ask' WHERE id = '{tenant_id}'")
    sign_in(colleague, f"reader@{domain}")
    asked = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/access-requests")
    request_id = asked.json()["id"]
    audited = browser.sql(
        "SELECT target_id::text FROM audit_events "
        f"WHERE action = 'workspace.access-asked' AND tenant_id = '{tenant_id}'"
    )
    assert audited == [(request_id,)]
    browser.sql(f"UPDATE tenants SET join_policy = 'join' WHERE id = '{tenant_id}'")
    assert (
        colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/membership").status_code
        == 201
    )
    status = browser.sql(f"SELECT status FROM workspace_access_requests WHERE id = '{request_id}'")
    assert status == [("approved",)]
    assert browser.client.get("/api/tenant/access-requests").json() == []


def test_an_admin_declines_an_ask_and_the_person_may_ask_again(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    browser.sql(f"UPDATE tenants SET join_policy = 'ask' WHERE id = '{tenant_id}'")
    sign_in(colleague, f"asker@{domain}")
    asked = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/access-requests")
    request_id = asked.json()["id"]

    declined = browser.client.delete(f"/api/tenant/access-requests/{request_id}")
    assert declined.status_code == 204
    assert browser.client.get("/api/tenant/access-requests").json() == []
    twice = browser.client.delete(f"/api/tenant/access-requests/{request_id}")
    assert (twice.status_code, twice.json()["code"]) == (404, "access-request-not-found")
    too_late = browser.client.post(f"/api/tenant/access-requests/{request_id}/approval")
    assert too_late.status_code == 404
    assert colleague.client.get("/api/me").json()["workspaces"] == []
    audited = browser.sql(
        "SELECT target_id::text FROM audit_events "
        f"WHERE action = 'workspace.access-declined' AND tenant_id = '{tenant_id}'"
    )
    assert audited == [(request_id,)]
    assert colleague.client.get("/api/me/joinable-workspaces").json()[0]["asked"] is False
    again = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/access-requests")
    assert again.status_code == 201
    assert again.json()["id"] != request_id


def test_a_reviewer_cannot_decline_an_ask(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    sign_in(colleague, f"reader@{domain}")
    colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/membership")
    refused = colleague.client.delete(f"/api/tenant/access-requests/{tenant_id}")
    assert refused.status_code == 403


def test_an_admin_sets_the_join_domain_policy_and_logo(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    colour = browser.client.get("/api/me").json()["workspaces"][0]["logo_colour"]
    assert browser.client.get("/api/tenant/join-settings").json() == {
        "email_domain": domain,
        "join_policy": "join",
        "logo": "SL",
        "logo_colour": colour,
    }
    browser.client.put(
        "/api/tenant/join-settings", json={"email_domain": None, "join_policy": "join"}
    )
    changed = browser.client.put(
        "/api/tenant/join-settings",
        json={
            "email_domain": f" {domain.upper()} ",
            "join_policy": "ask",
            "logo": "PX",
            "logo_colour": "#0f766e",
        },
    )
    assert changed.status_code == 200
    expected = {
        "email_domain": domain,
        "join_policy": "ask",
        "logo": "PX",
        "logo_colour": "#0f766e",
    }
    assert changed.json() == expected
    assert browser.client.get("/api/tenant/join-settings").json() == expected
    audited = browser.sql(
        "SELECT details::jsonb->>'join_policy', details::jsonb->>'domain_changed' "
        "FROM audit_events "
        f"WHERE action = 'tenant.join-settings-changed' AND tenant_id = '{tenant_id}' "
        "ORDER BY seq"
    )
    assert audited == [("join", "true"), ("ask", "true")]

    sign_in(colleague, f"asker@{domain}")
    joinable = colleague.client.get("/api/me/joinable-workspaces").json()
    assert [(item["id"], item["how"], item["logo"]) for item in joinable] == [
        (tenant_id, "ask", "PX")
    ]


def test_a_workspace_cannot_claim_a_domain_its_admin_does_not_hold(
    browser: Browser, domain: str
) -> None:
    create_workspace(browser, domain)
    for other in (f"path.{domain}", f"other-{domain}"):
        refused = browser.client.put(
            "/api/tenant/join-settings", json={"email_domain": other, "join_policy": "join"}
        )
        assert (refused.status_code, refused.json()["code"]) == (400, "domain-not-yours")
    assert browser.client.get("/api/tenant/join-settings").json()["email_domain"] == domain


def test_a_change_without_a_logo_keeps_the_saved_logo(browser: Browser, domain: str) -> None:
    create_workspace(browser, domain, logo="QX", logo_colour="#be185d")
    kept = browser.client.put(
        "/api/tenant/join-settings", json={"email_domain": domain, "join_policy": "ask"}
    )
    assert (kept.json()["logo"], kept.json()["logo_colour"]) == ("QX", "#be185d")
    reset = browser.client.put(
        "/api/tenant/join-settings",
        json={"email_domain": domain, "join_policy": "ask", "logo": None},
    )
    assert (reset.json()["logo"], reset.json()["logo_colour"]) == ("SL", "#be185d")


@pytest.mark.parametrize("public", ["gmail.com", "Seznam.cz", "outlook.de", "yahoo.co.uk"])
def test_a_public_mail_domain_is_refused_as_the_join_domain(
    browser: Browser, domain: str, public: str
) -> None:
    create_workspace(browser, domain)
    refused = browser.client.put(
        "/api/tenant/join-settings", json={"email_domain": public, "join_policy": "join"}
    )
    assert (refused.status_code, refused.json()["code"]) == (400, "public-email-domain")
    assert browser.client.get("/api/tenant/join-settings").json()["email_domain"] == domain


@pytest.mark.parametrize("bad", ["not a domain", "lab", "-lab.cz", "lab..cz", "@lab.cz"])
def test_a_join_domain_that_is_not_a_domain_is_refused(
    browser: Browser, domain: str, bad: str
) -> None:
    create_workspace(browser, domain)
    refused = browser.client.put(
        "/api/tenant/join-settings", json={"email_domain": bad, "join_policy": "join"}
    )
    assert refused.status_code == 422


def test_clearing_the_join_domain_hides_the_workspace(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    create_workspace(browser, domain)
    cleared = browser.client.put(
        "/api/tenant/join-settings", json={"email_domain": None, "join_policy": "join"}
    )
    assert cleared.json()["email_domain"] is None
    assert cleared.json()["logo"] == "SL"
    sign_in(colleague, f"reader@{domain}")
    assert colleague.client.get("/api/me/joinable-workspaces").json() == []


def test_a_reviewer_cannot_change_the_join_settings(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    sign_in(colleague, f"reader@{domain}")
    colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/membership")
    refused = colleague.client.put(
        "/api/tenant/join-settings", json={"email_domain": None, "join_policy": "join"}
    )
    assert refused.status_code == 403


def test_an_ask_notification_links_to_the_join_requests_in_admin(
    browser: Browser, colleague: Browser, domain: str
) -> None:
    tenant_id = create_workspace(browser, domain)
    browser.sql(f"UPDATE tenants SET join_policy = 'ask' WHERE id = '{tenant_id}'")
    sign_in(colleague, f"asker@{domain}")
    asked = colleague.client.post(f"/api/me/joinable-workspaces/{tenant_id}/access-requests")
    request_id = asked.json()["id"]
    inbox = browser.client.get("/api/me/notifications").json()["notifications"]
    assert [item["link"] for item in inbox if item["kind"] == "workspace-access-asked"] == [
        f"/admin?section=people&request={request_id}"
    ]
