import uuid
from dataclasses import dataclass

import pytest
from db_support import ApiAs
from idp_support import Browser

from parfocal_api.principals import MemberPrincipal, PlatformOperator
from parfocal_api.signing import SigningMode, SigningRefusal, decide
from parfocal_api.tables import Role

OPERATOR = PlatformOperator("signing-operator")
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
SUPERVISOR = uuid.uuid4()

SIGN = (SigningMode.SIGN, None)
REVIEW = (SigningMode.SEND_FOR_REVIEW, None)
NO_RIGHT = (None, SigningRefusal.NO_SIGN_OUT_RIGHT)
NO_SUPERVISOR = (None, SigningRefusal.NO_SUPERVISOR)
NO_SIGNATURE = (None, SigningRefusal.NO_SIGNATURE)


@pytest.mark.parametrize(
    ("role", "signs_alone", "supervisor", "signature", "expected"),
    [
        (Role.CONSULTANT, None, None, True, SIGN),
        (Role.CONSULTANT, None, None, False, NO_SIGNATURE),
        (Role.CONSULTANT, False, SUPERVISOR, False, REVIEW),
        (Role.CONSULTANT, False, None, True, NO_SUPERVISOR),
        (Role.LEAD, None, None, True, SIGN),
        (Role.LEAD, None, None, False, NO_SIGNATURE),
        (Role.RESIDENT, None, SUPERVISOR, False, REVIEW),
        (Role.RESIDENT, None, SUPERVISOR, True, REVIEW),
        (Role.RESIDENT, None, None, True, NO_SUPERVISOR),
        (Role.RESIDENT, True, None, True, SIGN),
        (Role.RESIDENT, True, SUPERVISOR, False, NO_SIGNATURE),
        (Role.LAB, None, SUPERVISOR, True, NO_RIGHT),
        (Role.ADMIN, True, None, True, NO_RIGHT),
        (Role.OUTSIDE_CONSULTANT, None, None, True, NO_RIGHT),
    ],
)
def test_each_combination_decides_how_a_report_leaves(
    role: Role,
    signs_alone: bool | None,
    supervisor: uuid.UUID | None,
    signature: bool,
    expected: tuple[SigningMode | None, SigningRefusal | None],
) -> None:
    decision = decide(role, signs_alone, supervisor, signature)
    assert (decision.mode, decision.refusal) == expected
    assert (decision.message is None) == (decision.refusal is None)


@dataclass(frozen=True)
class Team:
    tenant_id: str
    people: dict[str, MemberPrincipal]

    def path(self, who: str) -> str:
        return f"/api/tenant/members/{self.people[who].user_id}/signing"


def make_team(api: ApiAs, browser: Browser, extra: tuple[str, ...] = ()) -> Team:
    slug = f"sig-{uuid.uuid4().hex[:10]}"
    organisation = api(OPERATOR).post(
        "/api/platform/organisations", json={"slug": slug, "name": slug}
    )
    tenant_id = (
        api(OPERATOR)
        .post(
            "/api/platform/tenants",
            json={
                "organisation_id": organisation.json()["id"],
                "slug": slug,
                "name": slug,
                "kind": "diagnostic",
                "region": "eu",
            },
        )
        .json()["id"]
    )
    people: dict[str, MemberPrincipal] = {}
    for who in ("lead", "consultant", "resident", "admin", *extra):
        role = who.rstrip("0123456789")
        subject = f"{slug}-{who}"
        user_id = browser.sql(
            "INSERT INTO users (subject, display_name, initials, avatar_colour) "
            f"VALUES ('{subject}', '{who}', 'PP', 1) RETURNING id"
        )[0][0]
        api(OPERATOR).post(
            f"/api/platform/tenants/{tenant_id}/members",
            json={"user_id": str(user_id), "role": role},
        )
        people[who] = MemberPrincipal(
            subject, uuid.UUID(tenant_id), uuid.UUID(str(user_id)), Role(role)
        )
    return Team(tenant_id, people)


def change(api: ApiAs, team: Team, by: str, who: str, **values: object) -> int:
    body = {"signs_alone": None, "supervisor_user_id": None} | values
    return api(team.people[by]).put(team.path(who), json=body).status_code


def decision(api: ApiAs, team: Team, who: str) -> dict[str, object]:
    return api(team.people["lead"]).get(team.path(who)).json()["decision"]


@pytest.mark.db
def test_a_resident_needs_a_supervisor_until_a_lead_lets_them_sign(
    api: ApiAs, browser: Browser
) -> None:
    team = make_team(api, browser)
    assert decision(api, team, "resident") == {
        "mode": None,
        "refusal": "no-supervisor",
        "message": "Reports from this person go to a supervisor first, and none is named. "
        "Ask a lead to choose one",
    }
    consultant = str(team.people["consultant"].user_id)
    assert change(api, team, "lead", "resident", supervisor_user_id=consultant) == 200
    assert decision(api, team, "resident")["mode"] == "send-for-review"
    assert change(api, team, "lead", "resident", signs_alone=True) == 200
    assert decision(api, team, "resident")["refusal"] == "no-signature"


@pytest.mark.db
def test_a_signature_on_file_lets_a_consultant_sign(api: ApiAs, browser: Browser) -> None:
    team = make_team(api, browser)
    assert decision(api, team, "consultant")["refusal"] == "no-signature"
    browser.idp.subject = team.people["consultant"].subject
    browser.login()
    upload = browser.client.put(
        "/api/me/signature", content=PNG, headers={"content-type": "image/png"}
    )
    assert upload.status_code == 204
    assert decision(api, team, "consultant")["mode"] == "sign"
    assert browser.client.delete("/api/me/signature").status_code == 204
    assert decision(api, team, "consultant")["refusal"] == "no-signature"
    for bad in (b"GIF89a", PNG + b"\x00" * 100_000):
        refused = browser.client.put(
            "/api/me/signature", content=bad, headers={"content-type": "image/png"}
        )
        assert (refused.status_code, refused.json()["code"]) == (400, "invalid-signature")
    actions = browser.sql(
        "SELECT action FROM audit_events JOIN audit_people ON audit_people.id = actor_id "
        f"WHERE subject = '{team.people['consultant'].subject}' AND action LIKE 'user.signature%' "
        "ORDER BY seq"
    )
    assert actions == [("user.signature-added",), ("user.signature-removed",)]


@pytest.mark.db
def test_the_supervisor_must_sign_alone_in_this_workspace(api: ApiAs, browser: Browser) -> None:
    team = make_team(api, browser, ("resident2",))
    other = make_team(api, browser)
    for supervisor in (
        team.people["resident2"].user_id,
        team.people["resident"].user_id,
        other.people["consultant"].user_id,
        team.people["admin"].user_id,
    ):
        response = api(team.people["lead"]).put(
            team.path("resident"),
            json={"signs_alone": None, "supervisor_user_id": str(supervisor)},
        )
        assert (response.status_code, response.json()["code"]) == (409, "invalid-supervisor")


@pytest.mark.db
def test_only_a_lead_changes_signing_and_never_their_own(api: ApiAs, browser: Browser) -> None:
    team = make_team(api, browser)
    refused = api(team.people["admin"]).put(
        team.path("resident"), json={"signs_alone": True, "supervisor_user_id": None}
    )
    assert (refused.status_code, refused.json()["code"]) == (403, "lead-only")
    assert change(api, team, "consultant", "resident", signs_alone=True) == 403
    own = api(team.people["lead"]).put(
        team.path("lead"), json={"signs_alone": False, "supervisor_user_id": None}
    )
    assert (own.status_code, own.json()["code"]) == (409, "own-role")


@pytest.mark.db
def test_every_change_is_audited_without_naming_anyone(api: ApiAs, browser: Browser) -> None:
    team = make_team(api, browser)
    consultant = team.people["consultant"]
    change(
        api, team, "lead", "resident", signs_alone=False, supervisor_user_id=str(consultant.user_id)
    )
    rows = browser.sql(
        f"SELECT action, details FROM audit_events WHERE tenant_id = '{team.tenant_id}' "
        "AND action = 'member.signing-changed'"
    )
    assert len(rows) == 1
    details = str(rows[0][1])
    assert '"signs_alone":{"from":null,"to":false}' in details
    assert str(consultant.user_id) not in details
    assert consultant.subject not in details
    pseudonym = browser.sql(f"SELECT id FROM audit_people WHERE subject = '{consultant.subject}'")[
        0
    ][0]
    assert str(pseudonym) in details


@pytest.mark.db
def test_a_new_role_starts_from_its_default(api: ApiAs, browser: Browser) -> None:
    team = make_team(api, browser)
    change(api, team, "lead", "resident", signs_alone=True)
    rights = api(team.people["lead"]).get(team.path("resident")).json()
    assert (rights["signs_alone"], rights["set_by_lead"]) == (True, True)
    resident = team.people["resident"].user_id
    api(team.people["lead"]).put(
        f"/api/tenant/members/{resident}/role", json={"role": "consultant"}
    )
    rights = api(team.people["lead"]).get(team.path("resident")).json()
    assert (rights["role"], rights["signs_alone"], rights["set_by_lead"]) == (
        "consultant",
        True,
        False,
    )
