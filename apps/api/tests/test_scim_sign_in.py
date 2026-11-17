import base64
import json
import os
import re
import secrets
import shutil
import subprocess
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass, field
from html.parser import HTMLParser
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

import httpx2
import pytest
from zitadel_support import SCIM_USER, command, scim_patch, settings_for

from parfocal_api.oidc import SCOPES as OIDC_SCOPES
from parfocal_api.sso import METADATA_SCOPE, RESOURCE_OWNER_CLAIM, groups_of
from parfocal_api.tenant_command import ProvisioningSettings

IDP_IMAGE = "kristophjunge/test-saml-idp:1.15"
IDP_PORT = os.environ.get("PARFOCAL_SAML_IDP_PORT", "8091")
IDP_CONTAINER = f"parfocal-api-saml-idp-{IDP_PORT}"
IDP_ORIGIN = f"http://localhost:{IDP_PORT}"
DOMAIN = "example.com"
SCOPES = f"{OIDC_SCOPES} {METADATA_SCOPE}"


@dataclass
class Form:
    action: str = ""
    fields: dict[str, str] = field(default_factory=dict[str, str])


class Forms(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.forms: list[Form] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        if tag == "form":
            self.forms.append(Form(values.get("action", "")))
        elif tag in {"input", "button"} and self.forms and values.get("name"):
            self.forms[-1].fields.setdefault(values["name"], values.get("value", ""))


def forms_in(page: str) -> list[Form]:
    parser = Forms()
    parser.feed(page)
    return parser.forms


def text_of(page: str) -> str:
    body = re.sub(r"(?s)<(script|style|head)\b.*?</\1>", " ", page)
    return " ".join(re.sub(r"<[^>]+>", " ", body).split())


@dataclass(frozen=True)
class Workspace:
    tenant_id: str
    organisation_id: str
    scim_endpoint: str
    scim_token: str


@dataclass(frozen=True)
class SignIn:
    code: str | None
    page: str


def admin(zitadel: dict[str, str], organisation: str | None = None) -> dict[str, str]:
    headers = {"authorization": f"Bearer {zitadel['ZITADEL_ADMIN_TOKEN']}"}
    if organisation:
        headers["x-zitadel-orgid"] = organisation
    return headers


def scim_headers(workspace: Workspace) -> dict[str, str]:
    return {
        "authorization": f"Bearer {workspace.scim_token}",
        "content-type": "application/scim+json",
    }


def provision_with_scim(
    settings: ProvisioningSettings, capsys: pytest.CaptureFixture[str], slug: str
) -> Workspace:
    tenant_id = command(
        [
            "provision",
            "--organisation-slug",
            f"org-{slug}",
            "--organisation-name",
            f"Organisation {slug}",
            "--slug",
            slug,
            "--name",
            f"Workspace {slug}",
            "--kind",
            "research",
        ],
        settings,
        capsys,
    )
    summary, token_line = command(
        ["connect-scim", tenant_id, "--token-days", "1"], settings, capsys
    ).splitlines()
    fields = dict(part.split("=", 1) for part in summary.split()[1:])
    endpoint = fields["scim_endpoint"]
    return Workspace(
        tenant_id,
        endpoint.rsplit("/", 1)[-1],
        endpoint,
        token_line.removeprefix("token="),
    )


def scim_create(workspace: Workspace, email: str) -> httpx2.Response:
    return httpx2.post(
        f"{workspace.scim_endpoint}/Users",
        headers=scim_headers(workspace),
        json={
            "schemas": [SCIM_USER],
            "userName": email,
            "externalId": f"idp-{email}",
            "name": {"givenName": "Ada", "familyName": "Lovelace"},
            "emails": [{"value": email, "primary": True}],
            "active": True,
        },
    )


def users_with_email(zitadel: dict[str, str], organisation: str, email: str) -> list[str]:
    response = httpx2.post(
        f"{zitadel['ZITADEL_ISSUER']}/v2/users",
        headers=admin(zitadel),
        json={
            "queries": [
                {"organizationIdQuery": {"organizationId": organisation}},
                {"emailQuery": {"emailAddress": email}},
            ]
        },
    )
    response.raise_for_status()
    return [str(user["userId"]) for user in response.json().get("result", [])]


def docker(*args: str) -> None:
    subprocess.run(["docker", *args], check=True, capture_output=True)


def start_idp(issuer: str, entity_id: str) -> str:
    subprocess.run(["docker", "rm", "-f", IDP_CONTAINER], capture_output=True)
    docker(
        "run",
        "--detach",
        "--platform",
        "linux/amd64",
        "--name",
        IDP_CONTAINER,
        "--publish",
        f"127.0.0.1:{IDP_PORT}:8080",
        "--env",
        f"SIMPLESAMLPHP_SP_ENTITY_ID={entity_id}",
        "--env",
        f"SIMPLESAMLPHP_SP_ASSERTION_CONSUMER_SERVICE={issuer}/ui/login/login/externalidp/saml/acs",
        IDP_IMAGE,
    )
    deadline = time.monotonic() + 120
    while True:
        try:
            response = httpx2.get(f"{IDP_ORIGIN}/simplesaml/saml2/idp/metadata.php", timeout=5)
            if response.status_code == 200:
                return response.text
        except httpx2.HTTPError:
            pass
        if time.monotonic() > deadline:
            pytest.fail("The test SAML IdP did not start")
        time.sleep(2)


def project_id(zitadel: dict[str, str]) -> str:
    response = httpx2.post(
        f"{zitadel['ZITADEL_ISSUER']}/management/v1/projects/_search",
        headers=admin(zitadel, zitadel["ZITADEL_ORGANIZATION_ID"]),
        json={},
    )
    response.raise_for_status()
    return str(response.json()["result"][0]["id"])


def callback_of(zitadel: dict[str, str]) -> str:
    response = httpx2.post(
        f"{zitadel['ZITADEL_ISSUER']}/management/v1/projects/{project_id(zitadel)}/apps/_search",
        headers=admin(zitadel, zitadel["ZITADEL_ORGANIZATION_ID"]),
        json={},
    )
    response.raise_for_status()
    for app in response.json()["result"]:
        config = app.get("oidcConfig", {})
        if config.get("clientId") == zitadel["ZITADEL_CLIENT_ID"]:
            return str(config["redirectUris"][0])
    pytest.fail("The local Zitadel has no OIDC app for ZITADEL_CLIENT_ID")


@pytest.fixture
def login(zitadel: dict[str, str]) -> Iterator[dict[str, str]]:
    docker_ready = shutil.which("docker") is not None and (
        subprocess.run(["docker", "info"], capture_output=True).returncode == 0
    )
    if not docker_ready:
        pytest.skip("The SAML sign-in test starts a test IdP in Docker")
    yield zitadel | {"CALLBACK": callback_of(zitadel)}
    subprocess.run(["docker", "rm", "-f", IDP_CONTAINER], capture_output=True)


def connect_saml(
    settings: ProvisioningSettings,
    capsys: pytest.CaptureFixture[str],
    zitadel: dict[str, str],
    tenant_id: str,
    metadata: Path,
) -> str:
    connected = command(
        [
            "connect-saml",
            tenant_id,
            "--metadata-file",
            str(metadata),
            "--email-domain",
            DOMAIN,
            "--project-organisation-id",
            zitadel["ZITADEL_ORGANIZATION_ID"],
            "--project-id",
            project_id(zitadel),
            "--default-role",
            "researcher",
            "--groups-attribute",
            "eduPersonAffiliation",
            "--subject-attribute",
            "uid",
        ],
        settings,
        capsys,
    )
    fields = dict(part.split("=", 1) for part in connected.split() if "=" in part)
    return fields["idp_id"]


class Browser:
    def __init__(self) -> None:
        self.client = httpx2.Client(timeout=30, headers={"accept-language": "en"})
        self.cookies: dict[str, str] = {}

    def __enter__(self) -> Browser:
        return self

    def __exit__(self, *_: object) -> None:
        self.client.close()

    def send(self, method: str, url: str, form: dict[str, str] | None = None) -> httpx2.Response:
        self.client.cookies.clear()
        cookie = "; ".join(f"{name}={value}" for name, value in self.cookies.items())
        response = self.client.request(
            method, url, data=form, headers={"cookie": cookie} if cookie else {}
        )
        for header in response.headers.get_list("set-cookie"):
            parsed = SimpleCookie()
            parsed.load(header)
            for name, morsel in parsed.items():
                if morsel.value and morsel["max-age"] not in {"0", "-1"}:
                    self.cookies[name] = morsel.value
                else:
                    self.cookies.pop(name, None)
        return response


def sign_in(zitadel: dict[str, str], workspace: Workspace, idp_id: str, user: str) -> SignIn:
    query = urlencode(
        {
            "client_id": zitadel["ZITADEL_CLIENT_ID"],
            "redirect_uri": zitadel["CALLBACK"],
            "response_type": "code",
            "scope": " ".join(
                [
                    SCOPES,
                    f"urn:zitadel:iam:org:id:{workspace.organisation_id}",
                    f"urn:zitadel:iam:org:idp:id:{idp_id}",
                ]
            ),
            "state": secrets.token_urlsafe(8),
            "nonce": secrets.token_urlsafe(8),
        }
    )
    url = f"{zitadel['ZITADEL_ISSUER']}/oauth/v2/authorize?{query}"
    with Browser() as browser:
        response = browser.send("GET", url)
        for _ in range(30):
            if response.is_redirect:
                url = urljoin(url, response.headers["location"])
                if url.startswith(zitadel["CALLBACK"]):
                    return SignIn(parse_qs(urlparse(url).query).get("code", [None])[0], "")
                response = browser.send("GET", url)
                continue
            forms = forms_in(response.text)
            if not forms:
                return SignIn(None, response.text)
            form = forms[0]
            if "username" in form.fields or "password" in form.fields:
                form.fields |= {"username": user, "password": f"{user}pass"}
            elif "SAMLResponse" not in form.fields:
                return SignIn(None, response.text)
            url = urljoin(url, form.action) if form.action else url
            response = browser.send("POST", url, form.fields)
    return SignIn(None, response.text)


def tokens_for(zitadel: dict[str, str], code: str) -> dict[str, str]:
    response = httpx2.post(
        f"{zitadel['ZITADEL_ISSUER']}/oauth/v2/token",
        auth=(zitadel["ZITADEL_CLIENT_ID"], zitadel["ZITADEL_CLIENT_SECRET"]),
        data={
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": zitadel["CALLBACK"],
        },
    )
    response.raise_for_status()
    return dict(response.json())


def claims_of(tokens: dict[str, str]) -> dict[str, object]:
    payload = tokens["id_token"].split(".")[1]
    return dict(json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))))


def subject_of(tokens: dict[str, str]) -> str:
    return str(claims_of(tokens)["sub"])


def refresh(zitadel: dict[str, str], tokens: dict[str, str]) -> httpx2.Response:
    return httpx2.post(
        f"{zitadel['ZITADEL_ISSUER']}/oauth/v2/token",
        auth=(zitadel["ZITADEL_CLIENT_ID"], zitadel["ZITADEL_CLIENT_SECRET"]),
        data={"grant_type": "refresh_token", "refresh_token": tokens["refresh_token"]},
    )


def zitadel_user(zitadel: dict[str, str], user_id: str) -> dict[str, object]:
    response = httpx2.get(f"{zitadel['ZITADEL_ISSUER']}/v2/users/{user_id}", headers=admin(zitadel))
    response.raise_for_status()
    return dict(response.json()["user"])


def password_account(zitadel: dict[str, str], email: str) -> str:
    organisation = zitadel["ZITADEL_ORGANIZATION_ID"]
    response = httpx2.post(
        f"{zitadel['ZITADEL_ISSUER']}/v2/users/human",
        headers=admin(zitadel),
        json={
            "organization": {"orgId": organisation},
            "username": email,
            "profile": {"givenName": "Password", "familyName": "Person"},
            "email": {"email": email, "isVerified": True},
            "password": {"password": f"{secrets.token_urlsafe(12)}Aa1!", "changeRequired": False},
        },
    )
    response.raise_for_status()
    return str(response.json()["userId"])


def delete_user(zitadel: dict[str, str], user_id: str) -> None:
    httpx2.delete(f"{zitadel['ZITADEL_ISSUER']}/v2/users/{user_id}", headers=admin(zitadel))


def idp_options(zitadel: dict[str, str], organisation: str, idp_id: str) -> dict[str, object]:
    response = httpx2.get(
        f"{zitadel['ZITADEL_ISSUER']}/management/v1/idps/templates/{idp_id}",
        headers=admin(zitadel, organisation),
    )
    response.raise_for_status()
    return dict(response.json()["idp"]["config"]["options"])


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_a_scim_created_person_signs_in_through_saml_as_the_same_zitadel_user(
    drill: str, login: dict[str, str], capsys: pytest.CaptureFixture[str], tmp_path: Path
) -> None:
    zitadel = login
    settings = settings_for(drill, zitadel)
    issuer = zitadel["ZITADEL_ISSUER"]
    workspace = provision_with_scim(settings, capsys, f"link-{uuid.uuid4().hex[:8]}")
    elsewhere: list[str] = []
    try:
        metadata = tmp_path / "idp.xml"
        metadata.write_text(start_idp(issuer, "http://placeholder.invalid/metadata"))
        idp_id = connect_saml(settings, capsys, zitadel, workspace.tenant_id, metadata)
        options = idp_options(zitadel, workspace.organisation_id, idp_id)
        assert options["isLinkingAllowed"] is True
        assert options["autoLinking"] == "AUTO_LINKING_OPTION_EMAIL"
        start_idp(issuer, f"{issuer}/idps/{idp_id}/saml/metadata")

        created = scim_create(workspace, f"user1@{DOMAIN}")
        assert created.status_code == 201
        provisioned = str(created.json()["id"])
        first = sign_in(zitadel, workspace, idp_id, "user1")
        assert first.code, text_of(first.page)
        tokens = tokens_for(zitadel, first.code)
        claims = claims_of(tokens)
        assert claims["sub"] == provisioned
        assert claims[RESOURCE_OWNER_CLAIM] == workspace.organisation_id
        assert groups_of(claims) == ["group1"]
        assert users_with_email(zitadel, workspace.organisation_id, f"user1@{DOMAIN}") == [
            provisioned
        ]
        again = sign_in(zitadel, workspace, idp_id, "user1")
        assert again.code
        assert subject_of(tokens_for(zitadel, again.code)) == provisioned

        elsewhere.append(password_account(zitadel, f"user2@{DOMAIN}"))
        other = sign_in(zitadel, workspace, idp_id, "user2")
        assert other.code, text_of(other.page)
        created_by_sso = subject_of(tokens_for(zitadel, other.code))
        assert created_by_sso != elsewhere[0]
        details = zitadel_user(zitadel, created_by_sso)["details"]
        assert isinstance(details, dict)
        assert details["resourceOwner"] == workspace.organisation_id

        renewed = refresh(zitadel, tokens)
        assert renewed.status_code == 200
        current = dict(renewed.json())
        deactivate = {"op": "replace", "value": {"active": False}}
        status = scim_patch(
            workspace.scim_endpoint, scim_headers(workspace), provisioned, deactivate
        )
        assert status == 204
        refused = refresh(zitadel, current)
        assert refused.status_code == 400
        assert refused.json()["error_description"] == "Errors.User.NotActive"
        bearer = {"authorization": f"Bearer {current['access_token']}"}
        assert httpx2.get(f"{issuer}/oidc/v1/userinfo", headers=bearer).status_code == 401
        blocked = sign_in(zitadel, workspace, idp_id, "user1")
        assert blocked.code is None
        assert "User is not active" in text_of(blocked.page)
    finally:
        for user_id in elsewhere:
            delete_user(zitadel, user_id)
        command(["deprovision", workspace.tenant_id], settings, capsys)


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_one_workspace_scim_token_cannot_reach_another_workspace(
    drill: str, zitadel: dict[str, str], capsys: pytest.CaptureFixture[str]
) -> None:
    settings = settings_for(drill, zitadel)
    first = provision_with_scim(settings, capsys, f"scim-a-{uuid.uuid4().hex[:8]}")
    second = provision_with_scim(settings, capsys, f"scim-b-{uuid.uuid4().hex[:8]}")
    try:
        own = httpx2.get(f"{first.scim_endpoint}/Users", headers=scim_headers(first))
        assert own.status_code == 200
        borrowed = Workspace(
            second.tenant_id, second.organisation_id, second.scim_endpoint, first.scim_token
        )
        listed = httpx2.get(f"{borrowed.scim_endpoint}/Users", headers=scim_headers(borrowed))
        theirs = httpx2.get(f"{second.scim_endpoint}/Users", headers=scim_headers(second))
        assert theirs.status_code == 200
        email = f"intruder@{DOMAIN}"
        intruded = scim_create(borrowed, email)
        for refused in (listed, intruded):
            assert refused.status_code == 404
            assert refused.json()["detail"] == "membership not found"
        assert users_with_email(zitadel, second.organisation_id, email) == []
        assert users_with_email(zitadel, first.organisation_id, email) == []
    finally:
        command(["deprovision", first.tenant_id], settings, capsys)
        command(["deprovision", second.tenant_id], settings, capsys)
