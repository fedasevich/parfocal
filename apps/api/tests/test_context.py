import uuid

import pytest
from db_support import api_settings
from fastapi.testclient import TestClient

from parfocal_api.app import create_app
from parfocal_api.principals import (
    GuestGrant,
    GuestPrincipal,
    MemberPrincipal,
    MissingGuestGrantError,
    PlatformOperator,
    SignedInUser,
    database_scope,
)
from parfocal_api.tables import Role
from parfocal_common.db import DatabaseScope

TENANT = uuid.uuid4()
CASE = uuid.uuid4()
VIEW = uuid.uuid4()
USER = uuid.uuid4()


def test_a_member_is_scoped_to_their_tenant() -> None:
    assert database_scope(MemberPrincipal("user", TENANT, USER, Role.CONSULTANT)) == DatabaseScope(
        tenant_id=TENANT, user_id=USER
    )


def test_a_guest_is_scoped_to_the_host_tenant_case_and_view() -> None:
    guest = GuestPrincipal("guest", GuestGrant(host_tenant_id=TENANT, case_id=CASE, view_id=VIEW))
    assert database_scope(guest) == DatabaseScope(tenant_id=TENANT, case_id=CASE, view_id=VIEW)


def test_a_guest_without_a_grant_has_no_scope() -> None:
    with pytest.raises(MissingGuestGrantError):
        database_scope(GuestPrincipal("guest", None))


def test_a_platform_operator_has_no_tenant() -> None:
    assert database_scope(PlatformOperator("operator")) == DatabaseScope(platform=True)


def test_a_signed_in_user_without_a_workspace_has_an_empty_scope() -> None:
    assert database_scope(SignedInUser("user", USER)) == DatabaseScope(user_id=USER)


def test_scope_parameters_clear_every_setting_they_do_not_use() -> None:
    assert DatabaseScope(tenant_id=TENANT).parameters() == {
        "tenant": str(TENANT),
        "user": "",
        "case": "",
        "view": "",
        "platform": "",
        "auth": "",
    }


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("GET", "/api/tenant"),
        ("GET", "/api/platform/tenants"),
        ("POST", f"/api/platform/tenants/{TENANT}/suspend"),
    ],
)
def test_requests_without_a_session_are_unauthenticated(method: str, path: str) -> None:
    response = TestClient(create_app(api_settings("unused"))).request(method, path)
    assert response.status_code == 401
    assert response.json()["code"] == "unauthenticated"
