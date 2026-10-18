import pytest
from idp_support import ORIGIN, Browser

from parfocal_api.auth import SESSION_COOKIE
from parfocal_api.origin_check import from_elsewhere

COOKIE = f"{SESSION_COOKIE}=abc".encode()


@pytest.mark.parametrize(
    ("headers", "refused"),
    [
        ({b"cookie": COOKIE, b"origin": ORIGIN.encode()}, False),
        ({b"cookie": COOKIE, b"origin": ORIGIN.upper().encode()}, False),
        ({b"cookie": COOKIE, b"origin": b"https://evil.example"}, True),
        ({b"cookie": COOKIE, b"origin": b"http://reports.localhost:5173"}, True),
        ({b"cookie": COOKIE, b"origin": b"null"}, True),
        ({b"cookie": COOKIE, b"sec-fetch-site": b"same-origin"}, False),
        ({b"cookie": COOKIE, b"sec-fetch-site": b"same-site"}, True),
        ({b"cookie": COOKIE}, True),
        ({b"cookie": b"theme=dark", b"origin": b"https://evil.example"}, False),
        ({b"authorization": b"Bearer pf_x", b"origin": b"https://evil.example"}, False),
        ({}, False),
    ],
)
def test_only_cookie_writes_from_the_app_origin_pass(
    headers: dict[bytes, bytes], refused: bool
) -> None:
    assert from_elsewhere(headers, ORIGIN) is refused


@pytest.mark.db
def test_a_signed_in_write_from_another_origin_is_refused(browser: Browser) -> None:
    browser.login()
    assert browser.client.post("/api/auth/activity").status_code == 204
    refused = browser.client.post(
        "/api/auth/activity", headers={"origin": "https://reports.parfocal.eu"}
    )
    assert (refused.status_code, refused.json()["code"]) == (403, "cross-origin-write")
    assert refused.headers["content-type"] == "application/problem+json"
    assert (
        browser.client.get(
            "/api/auth/session", headers={"origin": "https://evil.example"}
        ).status_code
        == 200
    )
