import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request

BASE = f"http://localhost:{os.environ.get('IDP_SCRATCH_PORT', '8089')}"
TOKEN = os.environ["IDP_SCRATCH_TOKEN"]
PASSWORD = os.environ["IDP_SCRATCH_PASSWORD"]
TEST_USER = "e2e-pathologist@parfocal.eu"
EXPECTED_APPS = {
    "parfocal-api-dev": ("http://localhost:5173/api/auth/callback", True),
    "parfocal-api-preview": (
        "https://parfocal-edge-pr-*.example.workers.dev/api/auth/callback",
        True,
    ),
    "parfocal-api-staging": ("https://staging.parfocal.eu/api/auth/callback", False),
}

failures: list[str] = []


def expect(label: str, actual: object, wanted: object) -> None:
    if actual != wanted:
        failures.append(f"{label}: got {actual!r}, wanted {wanted!r}")


def call(
    method: str,
    path: str,
    *,
    org_id: str | None = None,
    body: dict | None = None,
    form: dict | None = None,
    basic: tuple[str, str] | None = None,
) -> tuple[int, dict]:
    headers = {"Accept": "application/json"}
    data = None
    if basic is None:
        headers["Authorization"] = f"Bearer {TOKEN}"
    else:
        pair = ":".join(urllib.parse.quote(part, safe="") for part in basic)
        headers["Authorization"] = "Basic " + base64.b64encode(pair.encode()).decode()
    if org_id is not None:
        headers["x-zitadel-orgid"] = org_id
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body).encode()
    if form is not None:
        headers["Content-Type"] = "application/x-www-form-urlencoded"
        data = urllib.parse.urlencode(form).encode()
    request = urllib.request.Request(BASE + path, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as error:
        raw = error.read()
        try:
            return error.code, json.loads(raw or b"{}")
        except json.JSONDecodeError:
            return error.code, {}


def outputs() -> dict:
    result = subprocess.run(["tofu", "output", "-json"], check=True, capture_output=True, text=True)
    return {name: entry["value"] for name, entry in json.loads(result.stdout).items()}


def check_discovery() -> None:
    status, document = call("GET", "/.well-known/openid-configuration")
    expect("discovery status", status, 200)
    expect("issuer", document.get("issuer"), BASE)


def check_policies(org_id: str) -> None:
    status, answer = call("GET", "/management/v1/policies/login", org_id=org_id)
    expect("login policy status", status, 200)
    policy = answer.get("policy", {})
    expect("login policy is the organisation's own", answer.get("isDefault", False), False)
    expect("password login", policy.get("allowUsernamePassword", False), True)
    expect("registration", policy.get("allowRegister", False), True)
    expect("external identity providers", policy.get("allowExternalIdp", False), False)
    expect("forced second factor", policy.get("forceMfa", False), False)
    expect("passkey sign-in", policy.get("passwordlessType"), "PASSWORDLESS_TYPE_ALLOWED")
    expect(
        "second factors",
        sorted(policy.get("secondFactors", [])),
        ["SECOND_FACTOR_TYPE_OTP", "SECOND_FACTOR_TYPE_U2F"],
    )
    expect(
        "multi factors", policy.get("multiFactors", []), ["MULTI_FACTOR_TYPE_U2F_WITH_VERIFICATION"]
    )
    expect("unknown usernames hidden", policy.get("ignoreUnknownUsernames", False), True)

    status, answer = call("GET", "/management/v1/policies/password/complexity", org_id=org_id)
    expect("password policy status", status, 200)
    expect("password policy is the organisation's own", answer.get("isDefault", False), False)
    expect("password length", int(answer.get("policy", {}).get("minLength", 0)), 12)

    status, answer = call("GET", "/management/v1/policies/lockout", org_id=org_id)
    expect("lockout policy status", status, 200)
    expect("lockout policy is the organisation's own", answer.get("isDefault", False), False)
    expect("password attempts", int(answer.get("policy", {}).get("maxPasswordAttempts", 0)), 10)
    expect("one-time code attempts", int(answer.get("policy", {}).get("maxOtpAttempts", 0)), 5)


def check_project(org_id: str, project_id: str) -> None:
    status, answer = call("GET", f"/management/v1/projects/{project_id}", org_id=org_id)
    expect("project status", status, 200)
    expect(
        "project limited to its organisation",
        answer.get("project", {}).get("hasProjectCheck", False),
        True,
    )

    status, answer = call(
        "POST", f"/management/v1/projects/{project_id}/apps/_search", org_id=org_id, body={}
    )
    expect("apps status", status, 200)
    apps = {app["name"]: app.get("oidcConfig", {}) for app in answer.get("result", [])}
    expect("app names", sorted(apps), sorted(EXPECTED_APPS))
    for name, (redirect_uri, dev_mode) in EXPECTED_APPS.items():
        config = apps.get(name, {})
        expect(f"{name} redirect", config.get("redirectUris"), [redirect_uri])
        expect(f"{name} development mode", config.get("devMode", False), dev_mode)
        expect(
            f"{name} client auth",
            config.get("authMethodType", "OIDC_AUTH_METHOD_TYPE_BASIC"),
            "OIDC_AUTH_METHOD_TYPE_BASIC",
        )
        expect(
            f"{name} profile claims in the ID token",
            config.get("idTokenUserinfoAssertion", False),
            True,
        )


def check_clients(client_ids: dict, client_secrets: dict) -> None:
    expect("client environments", sorted(client_ids), ["dev", "preview", "staging"])
    for env, client_id in client_ids.items():
        form = {
            "grant_type": "authorization_code",
            "code": "not-a-code",
            "redirect_uri": EXPECTED_APPS[f"parfocal-api-{env}"][0],
        }
        _, answer = call(
            "POST", "/oauth/v2/token", form=form, basic=(client_id, client_secrets[env])
        )
        expect(f"{env} client secret accepted", answer.get("error"), "invalid_request")
        _, answer = call("POST", "/oauth/v2/token", form=form, basic=(client_id, "wrong-secret"))
        expect(f"{env} wrong client secret refused", answer.get("error"), "invalid_client")


def check_test_user() -> None:
    def sign_in(password: str) -> int:
        checks = {"user": {"loginName": TEST_USER}, "password": {"password": password}}
        status, _ = call("POST", "/v2/sessions", body={"checks": checks})
        return status

    expect("test user signs in with its password", sign_in(PASSWORD), 201)
    expect("test user refused with a wrong password", sign_in(PASSWORD + "x") >= 400, True)


def main() -> int:
    values = outputs()
    check_discovery()
    check_policies(values["org_id"])
    check_project(values["org_id"], values["project_id"])
    check_clients(values["client_ids"], values["client_secrets"])
    check_test_user()
    for failure in failures:
        print(f"FAIL {failure}")
    if not failures:
        print("identity provider scratch checks passed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
