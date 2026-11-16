import re
import urllib.error
from collections.abc import Mapping

import pytest

from parfocal_deploy.smoke import (
    CSP,
    CSP_PARTS,
    ISOLATION_HEADERS,
    PERMISSIONS,
    SECURITY_HEADERS,
    SmokeCheckError,
    main,
    smoke_check,
)
from parfocal_deploy.tools import Fetch

ORIGIN = "https://app.parfocal.eu"
HEALTH = {**ISOLATION_HEADERS, "content-type": "application/json"}
POLICY = (
    "default-src 'self'; script-src 'nonce-{nonce}' 'strict-dynamic' 'wasm-unsafe-eval'; "
    "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
)
PAGE = {
    **ISOLATION_HEADERS,
    **SECURITY_HEADERS,
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "permissions-policy": "hid=(self), gamepad=(self), camera=(), microphone=(), usb=()",
    CSP: POLICY,
}


def site(
    health: tuple[int, Mapping[str, str]] = (200, HEALTH),
    page: tuple[int, Mapping[str, str]] = (200, PAGE),
) -> tuple[Fetch, list[str]]:
    asked: list[str] = []

    def get(url: str) -> tuple[int, Mapping[str, str]]:
        asked.append(url)
        if url.endswith("/api/health"):
            return health
        status, headers = page
        if CSP not in headers:
            return page
        return status, {**headers, CSP: headers[CSP].format(nonce=f"n{len(asked)}A==")}

    return get, asked


def without(headers: Mapping[str, str], name: str) -> dict[str, str]:
    return {key: value for key, value in headers.items() if key != name}


def test_a_healthy_isolated_site_passes_and_both_addresses_are_asked() -> None:
    get, asked = site()
    smoke_check(f"{ORIGIN}/", get)
    assert asked == [f"{ORIGIN}/api/health", f"{ORIGIN}/", f"{ORIGIN}/", f"{ORIGIN}/"]


@pytest.mark.parametrize("name", sorted(SECURITY_HEADERS))
def test_the_page_needs_each_security_header(name: str) -> None:
    with pytest.raises(SmokeCheckError, match=f"eu/ has a wrong {name}"):
        smoke_check(ORIGIN, site(page=(200, without(PAGE, name)))[0])


@pytest.mark.parametrize("feature", PERMISSIONS)
def test_the_permissions_policy_must_name_each_feature(feature: str) -> None:
    policy = PAGE["permissions-policy"].replace(feature, "")
    with pytest.raises(SmokeCheckError, match=re.escape(f"permissions-policy lacks {feature}")):
        smoke_check(ORIGIN, site(page=(200, {**PAGE, "permissions-policy": policy}))[0])


@pytest.mark.parametrize("part", CSP_PARTS)
def test_the_content_security_policy_must_keep_each_strict_part(part: str) -> None:
    page = {**PAGE, CSP: POLICY.replace(part, "")}
    with pytest.raises(SmokeCheckError, match=re.escape(f"{CSP} lacks {part}")):
        smoke_check(ORIGIN, site(page=(200, page))[0])


def test_the_content_security_policy_needs_a_fresh_nonce_per_request() -> None:
    with pytest.raises(SmokeCheckError, match="has no script nonce"):
        smoke_check(ORIGIN, site(page=(200, without(PAGE, CSP)))[0])
    cached = {**PAGE, CSP: POLICY.format(nonce="same==")}
    with pytest.raises(SmokeCheckError, match="repeats its nonce across requests"):
        smoke_check(ORIGIN, site(page=(200, cached))[0])


def test_an_origin_without_tls_is_refused_before_anything_is_asked() -> None:
    get, asked = site()
    with pytest.raises(SmokeCheckError, match="not served over TLS"):
        smoke_check("http://app.parfocal.eu", get)
    assert asked == []


def test_health_must_answer_200_with_json() -> None:
    with pytest.raises(SmokeCheckError, match="/api/health answered 503"):
        smoke_check(ORIGIN, site(health=(503, HEALTH))[0])
    with pytest.raises(SmokeCheckError, match="/api/health is not application/json"):
        smoke_check(ORIGIN, site(health=(200, {**HEALTH, "content-type": "text/html"}))[0])


@pytest.mark.parametrize("name", sorted(ISOLATION_HEADERS))
def test_health_and_the_page_both_need_each_isolation_header(name: str) -> None:
    with pytest.raises(SmokeCheckError, match=f"/api/health has a wrong {name}"):
        smoke_check(ORIGIN, site(health=(200, without(HEALTH, name)))[0])
    with pytest.raises(SmokeCheckError, match=f"eu/ has a wrong {name}"):
        smoke_check(ORIGIN, site(page=(200, without(PAGE, name)))[0])


def test_the_page_must_answer_200_and_keep_browsers_on_tls() -> None:
    with pytest.raises(SmokeCheckError, match="eu/ answered 404"):
        smoke_check(ORIGIN, site(page=(404, PAGE))[0])
    with pytest.raises(SmokeCheckError, match="no strict-transport-security"):
        smoke_check(ORIGIN, site(page=(200, without(PAGE, "strict-transport-security")))[0])


def test_a_certificate_or_network_failure_is_reported_as_a_smoke_failure() -> None:
    def broken(url: str) -> tuple[int, Mapping[str, str]]:
        raise urllib.error.URLError("certificate verify failed")

    with pytest.raises(SmokeCheckError, match="certificate verify failed"):
        smoke_check(ORIGIN, broken)


def test_the_command_exits_non_zero_on_failure_and_prints_on_success(
    capsys: pytest.CaptureFixture[str],
) -> None:
    with pytest.raises(SystemExit, match="smoke check failed"):
        main(["--origin", ORIGIN], site(health=(502, HEALTH))[0])
    main(["--origin", ORIGIN], site()[0])
    assert ORIGIN in capsys.readouterr().out
