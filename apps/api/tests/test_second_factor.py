import json
import uuid

import pytest
from idp_support import ISSUER, Browser

from parfocal_api.auth import SECOND_FACTOR_SETUP_PATH

pytestmark = pytest.mark.db

PASSWORD_ONLY = ["pwd"]
PASSWORD_AND_CODE = ["pwd", "otp", "mfa"]


def new_workspace(browser: Browser, *, two_factors: bool) -> str:
    slug = f"mfa-{uuid.uuid4().hex[:10]}"
    tenant_id = str(
        browser.sql(
            f"WITH organisation AS (INSERT INTO organisations (slug, name) VALUES ('{slug}', "
            f"'{slug}') RETURNING id) INSERT INTO tenants (organisation_id, slug, name, kind, "
            f"region, plan) SELECT id, '{slug}', '{slug}', 'diagnostic', 'eu', 'pilot' "
            "FROM organisation RETURNING id"
        )[0][0]
    )
    values = json.dumps({"two_factor_required": two_factors})
    browser.sql(
        f"INSERT INTO workspace_settings (tenant_id, \"values\") VALUES ('{tenant_id}', '{values}')"
    )
    browser.sql(
        "INSERT INTO memberships (tenant_id, user_id, role) SELECT "
        f"'{tenant_id}', id, 'researcher' FROM users WHERE subject = '{browser.idp.subject}'"
    )
    return tenant_id


def enter(browser: Browser, tenant_id: str) -> None:
    browser.sql(
        f"UPDATE sessions SET active_tenant_id = '{tenant_id}' "
        f"WHERE subject = '{browser.idp.subject}'"
    )


def sign_in(browser: Browser, factors: list[str] | None) -> None:
    if factors is None:
        browser.idp.claim_overrides.pop("amr", None)
    else:
        browser.idp.claim_overrides["amr"] = factors
    assert browser.login().status_code == 200


def workspace_status(browser: Browser) -> tuple[int, str | None]:
    response = browser.client.get("/api/tenant")
    return response.status_code, response.json().get("code")


def test_one_factor_is_refused_where_the_workspace_requires_two(browser: Browser) -> None:
    sign_in(browser, PASSWORD_ONLY)
    enter(browser, new_workspace(browser, two_factors=True))
    assert workspace_status(browser) == (403, "second-factor-required")
    assert browser.session().json()["code"] == "second-factor-required"


def test_one_factor_is_accepted_where_the_workspace_does_not_require_two(
    browser: Browser,
) -> None:
    sign_in(browser, PASSWORD_ONLY)
    enter(browser, new_workspace(browser, two_factors=False))
    assert workspace_status(browser)[0] == 200


def test_a_workspace_without_saved_settings_accepts_one_factor(browser: Browser) -> None:
    sign_in(browser, PASSWORD_ONLY)
    tenant_id = new_workspace(browser, two_factors=False)
    browser.sql(f"DELETE FROM workspace_settings WHERE tenant_id = '{tenant_id}'")
    enter(browser, tenant_id)
    assert workspace_status(browser)[0] == 200


def test_two_factors_are_accepted_and_survive_a_refresh(browser: Browser) -> None:
    browser.idp.expires_in = 0
    sign_in(browser, PASSWORD_AND_CODE)
    enter(browser, new_workspace(browser, two_factors=True))
    browser.idp.claim_overrides.pop("amr")
    assert workspace_status(browser)[0] == 200
    assert browser.idp.refreshes >= 1
    assert workspace_status(browser)[0] == 200


def test_a_session_without_factors_is_refused(browser: Browser) -> None:
    sign_in(browser, None)
    enter(browser, new_workspace(browser, two_factors=True))
    assert workspace_status(browser) == (403, "second-factor-required")


def test_turning_the_switch_on_refuses_the_next_request(browser: Browser) -> None:
    sign_in(browser, PASSWORD_ONLY)
    tenant_id = new_workspace(browser, two_factors=False)
    enter(browser, tenant_id)
    assert workspace_status(browser)[0] == 200
    browser.sql(
        'UPDATE workspace_settings SET "values" = \'{"two_factor_required": true}\' '
        f"WHERE tenant_id = '{tenant_id}'"
    )
    assert workspace_status(browser) == (403, "second-factor-required")


def test_switching_into_a_workspace_that_requires_two_is_refused(browser: Browser) -> None:
    sign_in(browser, PASSWORD_ONLY)
    open_one = new_workspace(browser, two_factors=False)
    strict = new_workspace(browser, two_factors=True)
    enter(browser, open_one)
    switched = browser.client.put("/api/me/workspace", json={"tenant_id": strict})
    assert switched.status_code == 403
    assert switched.json()["code"] == "second-factor-required"
    active = browser.sql(
        f"SELECT active_tenant_id FROM sessions WHERE subject = '{browser.idp.subject}'"
    )
    assert str(active[0][0]) == open_one
    assert workspace_status(browser)[0] == 200


def test_switching_with_two_factors_is_allowed(browser: Browser) -> None:
    sign_in(browser, PASSWORD_AND_CODE)
    open_one = new_workspace(browser, two_factors=False)
    strict = new_workspace(browser, two_factors=True)
    enter(browser, open_one)
    assert browser.client.put("/api/me/workspace", json={"tenant_id": strict}).status_code == 200
    assert workspace_status(browser)[0] == 200


def test_setting_up_a_second_factor_opens_the_identity_provider(browser: Browser) -> None:
    started = browser.client.get("/api/auth/second-factor")
    assert started.status_code == 302
    assert started.headers["location"] == f"{ISSUER}{SECOND_FACTOR_SETUP_PATH}"
