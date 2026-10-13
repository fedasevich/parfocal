import re
import secrets
from typing import Any
from urllib.parse import parse_qs, urlparse

import httpx2
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from db_support import APP_URL, with_database
from idp_support import ISSUER, ORIGIN, Browser

from parfocal_api import operators
from parfocal_api.auth import LOGIN_COOKIE, SESSION_COOKIE

pytestmark = pytest.mark.db


def hop_target(response: httpx2.Response) -> str:
    match = re.search(r'url=([^"]+)"', response.text)
    assert match is not None, response.text
    return match.group(1)


def set_cookie_header(response: httpx2.Response, name: str) -> str:
    headers = [value for value in response.headers.get_list("set-cookie") if value.startswith(name)]
    assert len(headers) == 1, headers
    return headers[0]


def test_login_sets_a_strict_session_and_returns_to_the_deep_link(browser: Browser) -> None:
    landed = browser.login("/cases/S26-0001?slide=2")
    assert landed.status_code == 200
    assert hop_target(landed) == "/cases/S26-0001?slide=2"
    cookie = set_cookie_header(landed, SESSION_COOKIE).lower()
    for attribute in ("httponly", "secure", "samesite=strict", "path=/"):
        assert attribute in cookie
    assert f"{LOGIN_COOKIE.lower()}=" in set_cookie_header(landed, LOGIN_COOKIE).lower()
    session = browser.session()
    assert session.status_code == 200
    assert session.json() == {
        "subject": browser.idp.subject,
        "name": "Test Pathologist",
        "email": "pathologist@example.test",
        "operator": False,
    }


def test_the_login_binding_cookie_is_lax(browser: Browser) -> None:
    started = browser.client.get("/api/auth/login")
    cookie = set_cookie_header(started, LOGIN_COOKIE).lower()
    assert "samesite=lax" in cookie
    assert "httponly" in cookie
    assert "secure" in cookie


@pytest.mark.parametrize(
    "unsafe",
    ["https://evil.test/", "//evil.test/", "/\\evil.test", "javascript:alert(1)", "/a\nb"],
)
def test_login_never_returns_to_another_site(browser: Browser, unsafe: str) -> None:
    assert hop_target(browser.login(unsafe)) == "/"


def test_the_callback_needs_the_binding_cookie(browser: Browser) -> None:
    started = browser.client.get("/api/auth/login")
    location = started.headers["location"]
    code = browser.idp.authorize(location)
    state = parse_qs(urlparse(location).query)["state"][0]
    browser.client.cookies.clear()
    refused = browser.client.get("/api/auth/callback", params={"code": code, "state": state})
    assert refused.status_code == 400
    assert refused.json()["code"] == "login-failed"


def test_a_state_works_once(browser: Browser) -> None:
    started = browser.client.get("/api/auth/login")
    location = started.headers["location"]
    state = parse_qs(urlparse(location).query)["state"][0]
    code = browser.idp.authorize(location)
    first = browser.client.get("/api/auth/callback", params={"code": code, "state": state})
    assert first.is_success
    browser.client.get("/api/auth/login")
    again = browser.client.get("/api/auth/callback", params={"code": code, "state": state})
    assert again.status_code == 400


def test_an_unknown_state_is_refused(browser: Browser) -> None:
    browser.client.get("/api/auth/login")
    refused = browser.client.get("/api/auth/callback", params={"code": "x", "state": "unknown"})
    assert refused.status_code == 400


@pytest.mark.parametrize(
    "tampered",
    [
        {"nonce": "another-nonce"},
        {"aud": "another-client"},
        {"iss": "https://another-issuer.test"},
        {"exp": 1},
    ],
)
def test_an_id_token_that_fails_verification_is_refused(
    browser: Browser, tampered: dict[str, Any]
) -> None:
    browser.idp.claim_overrides = tampered
    refused = browser.login()
    assert refused.status_code == 400
    assert refused.json()["code"] == "login-failed"
    assert browser.session().status_code == 401


def test_a_token_signed_with_an_unknown_key_is_refused(browser: Browser) -> None:
    browser.idp.signing_kid = "unpublished"
    assert browser.login().status_code == 400


def test_a_token_with_a_forged_signature_is_refused(browser: Browser) -> None:
    browser.idp.signing_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert browser.login().status_code == 400


def test_an_expired_access_token_is_refreshed_without_the_page_noticing(browser: Browser) -> None:
    browser.idp.expires_in = 0
    browser.login()
    first_refresh_token = next(iter(browser.idp.refresh_tokens))
    assert browser.session().status_code == 200
    assert browser.idp.refreshes == 1
    assert first_refresh_token not in browser.idp.refresh_tokens
    assert browser.session().status_code == 200
    assert browser.idp.refreshes == 2


def test_a_refused_refresh_ends_the_session(browser: Browser) -> None:
    browser.idp.expires_in = 0
    browser.login()
    browser.idp.refresh_tokens.clear()
    assert browser.session().status_code == 401
    assert browser.sql(
        f"SELECT count(*) FROM sessions WHERE subject = '{browser.idp.subject}'"
    ) == [(0,)]


def test_logout_revokes_and_ends_the_session_at_the_idp(browser: Browser) -> None:
    browser.login()
    refresh_token = next(iter(browser.idp.refresh_tokens))
    out = browser.client.get("/api/auth/logout")
    assert out.status_code == 302
    location = urlparse(out.headers["location"])
    params = parse_qs(location.query)
    assert f"{location.scheme}://{location.netloc}{location.path}" == f"{ISSUER}/end_session"
    assert params["post_logout_redirect_uri"] == [f"{ORIGIN}/"]
    assert "id_token_hint" in params
    assert browser.idp.revoked == [refresh_token]
    assert f'{SESSION_COOKIE}=""' in set_cookie_header(out, SESSION_COOKIE)
    browser.client.cookies.set(SESSION_COOKIE, "stale", domain="testserver")
    assert browser.session().status_code == 401


def test_logout_without_a_session_goes_home(browser: Browser) -> None:
    out = browser.client.get("/api/auth/logout")
    assert out.headers["location"] == f"{ORIGIN}/"


def test_an_expired_session_is_refused(browser: Browser) -> None:
    browser.login()
    browser.sql(
        "UPDATE sessions SET expires_at = now() - interval '1 second' "
        f"WHERE subject = '{browser.idp.subject}'"
    )
    assert browser.session().status_code == 401


def test_a_forged_session_cookie_is_refused(browser: Browser) -> None:
    browser.client.cookies.set(SESSION_COOKIE, secrets.token_urlsafe(32), domain="testserver")
    assert browser.session().status_code == 401


def test_secrets_are_not_stored_in_the_clear(browser: Browser) -> None:
    landed = browser.login()
    session_id = set_cookie_header(landed, SESSION_COOKIE).split(";")[0].split("=", 1)[1]
    refresh_token = next(iter(browser.idp.refresh_tokens))
    dump = str(browser.sql("SELECT id_hash, subject, tokens FROM sessions"))
    assert browser.idp.subject in dump
    logins = str(browser.sql("SELECT * FROM auth_logins"))
    assert session_id not in dump
    assert refresh_token not in dump
    assert "pathologist@example.test" not in dump
    assert session_id not in logins


def test_a_platform_operator_reaches_platform_routes(browser: Browser) -> None:
    operator = browser.idp.subject
    browser.sql(f"INSERT INTO platform_operators (subject) VALUES ('{operator}')")
    browser.login()
    assert browser.session().json()["operator"] is True
    assert browser.client.get("/api/platform/tenants").status_code == 200
    browser.sql(f"DELETE FROM platform_operators WHERE subject = '{operator}'")
    assert browser.client.get("/api/platform/tenants").status_code == 403


def test_a_user_without_a_workspace_is_kept_out_of_tenant_routes(browser: Browser) -> None:
    browser.login()
    assert browser.client.get("/api/tenant").status_code == 403
    assert browser.client.get("/api/platform/tenants").status_code == 403


async def test_the_operator_tool_adds_lists_and_removes(database: str) -> None:
    url = with_database(APP_URL, database)
    subject = f"operator-{secrets.token_hex(6)}"
    assert subject in await operators.run(url, "add", subject)
    assert subject not in await operators.run(url, "remove", subject)
