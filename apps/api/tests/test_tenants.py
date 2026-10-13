import uuid
from typing import Any

import pytest
from db_support import ApiAs

from parfocal_api.principals import MemberPrincipal, PlatformOperator

pytestmark = pytest.mark.db

OPERATOR = PlatformOperator("operator")


def unique_slug(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:10]}"


def create_organisation(api: ApiAs) -> dict[str, Any]:
    response = api(OPERATOR).post(
        "/api/platform/organisations",
        json={"slug": unique_slug("org"), "name": "Fakultní nemocnice"},
    )
    assert response.status_code == 201, response.text
    return response.json()


def create_tenant(api: ApiAs, **overrides: object) -> dict[str, Any]:
    organisation = create_organisation(api)
    draft = {
        "organisation_id": organisation["id"],
        "slug": unique_slug("diag"),
        "name": "Diagnostic",
        "kind": "diagnostic",
        "region": "eu",
    } | overrides
    response = api(OPERATOR).post("/api/platform/tenants", json=draft)
    assert response.status_code == 201, response.text
    return response.json()


def member_of(tenant: dict[str, Any]) -> MemberPrincipal:
    return MemberPrincipal("member", uuid.UUID(tenant["id"]), uuid.uuid4())


def test_an_operator_creates_an_active_tenant(api: ApiAs) -> None:
    tenant = create_tenant(api, kind="research", region="us")
    assert tenant["status"] == "active"
    assert tenant["plan"] == "pilot"
    assert (tenant["kind"], tenant["region"], tenant["suspended_at"]) == ("research", "us", None)
    listed = api(OPERATOR).get("/api/platform/tenants").json()
    assert tenant["id"] in [item["id"] for item in listed]
    assert api(OPERATOR).get(f"/api/platform/tenants/{tenant['id']}").json() == tenant


def test_an_organisation_holds_several_workspaces(api: ApiAs) -> None:
    organisation = create_organisation(api)
    for kind in ("diagnostic", "research", "second-opinion"):
        response = api(OPERATOR).post(
            "/api/platform/tenants",
            json={
                "organisation_id": organisation["id"],
                "slug": unique_slug(kind),
                "name": kind,
                "kind": kind,
                "region": "eu",
            },
        )
        assert response.status_code == 201, response.text
    tenants = api(OPERATOR).get("/api/platform/tenants").json()
    kinds = {item["kind"] for item in tenants if item["organisation_id"] == organisation["id"]}
    assert kinds == {"diagnostic", "research", "second-opinion"}


def test_a_slug_is_used_once(api: ApiAs) -> None:
    tenant = create_tenant(api)
    response = api(OPERATOR).post(
        "/api/platform/tenants",
        json={
            "organisation_id": tenant["organisation_id"],
            "slug": tenant["slug"],
            "name": "Copy",
            "kind": "diagnostic",
            "region": "eu",
        },
    )
    assert response.status_code == 409
    assert response.json()["code"] == "slug-taken"


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("slug", "Has Spaces"),
        ("slug", "-leading"),
        ("slug", "x"),
        ("kind", "billing"),
        ("region", "mars"),
        ("plan", "enterprise"),
        ("name", "   "),
    ],
)
def test_invalid_drafts_are_refused(api: ApiAs, field: str, value: str) -> None:
    organisation = create_organisation(api)
    draft = {
        "organisation_id": organisation["id"],
        "slug": unique_slug("ok"),
        "name": "Diagnostic",
        "kind": "diagnostic",
        "region": "eu",
        field: value,
    }
    response = api(OPERATOR).post("/api/platform/tenants", json=draft)
    assert response.status_code == 422
    assert [error["location"][-1] for error in response.json()["errors"]] == [field]


def test_a_tenant_needs_an_existing_organisation(api: ApiAs) -> None:
    response = api(OPERATOR).post(
        "/api/platform/tenants",
        json={
            "organisation_id": str(uuid.uuid4()),
            "slug": unique_slug("orphan"),
            "name": "Orphan",
            "kind": "diagnostic",
            "region": "eu",
        },
    )
    assert response.status_code == 404


def test_an_unknown_tenant_is_not_found(api: ApiAs) -> None:
    unknown = uuid.uuid4()
    assert api(OPERATOR).get(f"/api/platform/tenants/{unknown}").status_code == 404
    assert api(OPERATOR).post(f"/api/platform/tenants/{unknown}/suspend").status_code == 404


def test_members_see_their_own_tenant(api: ApiAs) -> None:
    tenant = create_tenant(api)
    response = api(member_of(tenant)).get("/api/tenant")
    assert response.status_code == 200
    assert response.json() == tenant


def test_a_suspended_tenants_members_are_refused_until_reactivated(api: ApiAs) -> None:
    tenant = create_tenant(api)
    suspended = api(OPERATOR).post(f"/api/platform/tenants/{tenant['id']}/suspend").json()
    assert suspended["status"] == "suspended"
    assert suspended["suspended_at"] is not None

    refused = api(member_of(tenant)).get("/api/tenant")
    assert refused.status_code == 403
    assert refused.json()["code"] == "tenant-suspended"

    again = api(OPERATOR).post(f"/api/platform/tenants/{tenant['id']}/suspend").json()
    assert again["suspended_at"] == suspended["suspended_at"]

    reactivated = api(OPERATOR).post(f"/api/platform/tenants/{tenant['id']}/reactivate").json()
    assert (reactivated["status"], reactivated["suspended_at"]) == ("active", None)
    assert api(member_of(tenant)).get("/api/tenant").status_code == 200


def test_suspending_one_tenant_leaves_the_others_open(api: ApiAs) -> None:
    suspended = create_tenant(api)
    open_tenant = create_tenant(api)
    api(OPERATOR).post(f"/api/platform/tenants/{suspended['id']}/suspend")
    assert api(member_of(open_tenant)).get("/api/tenant").status_code == 200


def test_a_member_of_an_unknown_tenant_is_refused(api: ApiAs) -> None:
    response = api(MemberPrincipal("member", uuid.uuid4(), uuid.uuid4())).get("/api/tenant")
    assert response.status_code == 403
    assert response.json()["code"] == "forbidden"


def test_members_cannot_use_platform_routes(api: ApiAs) -> None:
    tenant = create_tenant(api)
    member = api(member_of(tenant))
    assert member.get("/api/platform/tenants").status_code == 403
    assert member.post(f"/api/platform/tenants/{tenant['id']}/suspend").status_code == 403
    assert api(OPERATOR).get(f"/api/platform/tenants/{tenant['id']}").json()["status"] == "active"


def test_operators_have_no_tenant_of_their_own(api: ApiAs) -> None:
    assert api(OPERATOR).get("/api/tenant").status_code == 403
