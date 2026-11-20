import time
from datetime import UTC, datetime, timedelta
from typing import Any
from urllib.parse import parse_qs, urlparse

import pytest
from db_support import ApiAs
from idp_support import Browser
from starlette.requests import Request
from test_clinical_reports import Clinic, audit_actions, created, deposit, fill, make_clinic
from test_disagreements import queued_review

from parfocal_api.auth import SESSION_COOKIE, signed_in_at

pytestmark = pytest.mark.db

STALE = timedelta(minutes=6)
REFUSED = (403, "fresh-sign-in-needed")


@pytest.fixture
def clinic(database: str) -> Clinic:
    return make_clinic(database)


def ready(api: ApiAs, clinic: Clinic) -> dict[str, Any]:
    report = created(api, clinic)
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=2.5)
    fill(api, clinic)
    return report


def refusal(response: Any) -> tuple[int, str]:
    return response.status_code, response.json()["code"]


@pytest.mark.parametrize("ago", [STALE, None], ids=["stale", "never"])
@pytest.mark.parametrize("method", ["sso", "password"])
def test_a_sign_off_needs_a_fresh_sign_in(
    api: ApiAs, database: str, ago: timedelta | None, method: str
) -> None:
    r, task = queued_review(api, database)
    decide = f"{task}/disagreements/{r.slide}"
    api(r.people["owner"]).put(f"{decide}/T1", json={"answer": "agree"})
    api(r.people["owner"]).put(f"{decide}/T2/left-open", json={"note": "Ask Lenka"})
    api.acting.signed_in_ago = ago
    refused = api(r.people["owner"]).post(f"{task}/sign-off", json={"confirmed_with": method})
    assert refusal(refused) == REFUSED
    summary = api(r.people["owner"]).get(f"{task}/sign-off-summary").json()
    assert summary["signature"] is None
    api.acting.signed_in_ago = timedelta(minutes=4)
    signed = api(r.people["owner"]).post(f"{task}/sign-off", json={"confirmed_with": method})
    assert signed.status_code == 200, signed.text


@pytest.mark.parametrize("ago", [STALE, None], ids=["stale", "never"])
@pytest.mark.parametrize("method", ["sso", "password"])
def test_a_sign_out_needs_a_fresh_sign_in(
    api: ApiAs, database: str, clinic: Clinic, ago: timedelta | None, method: str
) -> None:
    report = ready(api, clinic)
    api.acting.signed_in_ago = ago
    refused = api(clinic.lead).post(f"{clinic.url}/sign", json={"confirmed_with": method})
    assert refusal(refused) == REFUSED
    assert api(clinic.lead).get(clinic.url).json()["versions"] == []
    assert "clinical-report.signed" not in audit_actions(database, report["id"])
    api.acting.signed_in_ago = timedelta(0)
    signed = api(clinic.lead).post(f"{clinic.url}/sign", json={"confirmed_with": method})
    assert signed.status_code == 200, signed.text


def test_a_co_sign_needs_a_fresh_sign_in(api: ApiAs, database: str, clinic: Clinic) -> None:
    report = ready(api, clinic)
    sent = api(clinic.junior).post(
        f"{clinic.url}/send", json={"cosigner_user_id": str(clinic.lead.user_id)}
    )
    assert sent.status_code == 200, sent.text
    api.acting.signed_in_ago = STALE
    refused = api(clinic.lead).post(f"{clinic.url}/sign")
    assert refusal(refused) == REFUSED
    slide = f"/api/projects/{clinic.project}/slides/{clinic.first}"
    viewer = f"{slide}/clinical-report/cosign-request/co-sign"
    assert refusal(api(clinic.lead).post(viewer, json={"method": "sso"})) == REFUSED
    assert api(clinic.lead).get(clinic.url).json()["state"] == "sent"
    assert "clinical-report.signed" not in audit_actions(database, report["id"])
    api.acting.signed_in_ago = timedelta(seconds=30)
    signed = api(clinic.lead).post(f"{clinic.url}/sign")
    assert signed.status_code == 200, signed.text
    assert signed.json()["state"] == "signed"


def signed_in_time(browser: Browser) -> datetime | None:
    session_id = browser.client.cookies.get(SESSION_COOKIE)
    assert session_id
    scope = {
        "type": "http",
        "headers": [(b"cookie", f"{SESSION_COOKIE}={session_id}".encode())],
        "app": browser.client.app,
    }
    portal = browser.client.portal
    assert portal is not None
    return portal.call(signed_in_at, Request(scope))


def test_a_silent_sign_in_is_not_fresh_and_the_sign_in_step_is(browser: Browser) -> None:
    an_hour_ago = int(time.time()) - 3600
    browser.idp.signed_in_at = an_hour_ago
    browser.login()
    assert browser.idp.prompts == [None]
    assert signed_in_time(browser) == datetime.fromtimestamp(an_hour_ago, UTC)
    started = browser.client.get("/api/auth/login", params={"reauth": "true"})
    query = parse_qs(urlparse(started.headers["location"]).query)
    assert (query["prompt"], query["max_age"]) == (["login"], ["0"])
    browser.login(reauth=True)
    fresh = signed_in_time(browser)
    assert fresh is not None
    assert datetime.now(UTC) - fresh < timedelta(seconds=5)


def test_a_refresh_keeps_the_time_of_the_sign_in(browser: Browser) -> None:
    browser.idp.expires_in = 0
    an_hour_ago = int(time.time()) - 3600
    browser.idp.signed_in_at = an_hour_ago
    browser.login()
    assert browser.session().status_code == 200
    assert browser.idp.refreshes == 1
    assert signed_in_time(browser) == datetime.fromtimestamp(an_hour_ago, UTC)


def test_a_token_without_an_auth_time_is_never_fresh(browser: Browser) -> None:
    browser.idp.claim_overrides = {"auth_time": "soon"}
    browser.login(reauth=True)
    assert signed_in_time(browser) is None
