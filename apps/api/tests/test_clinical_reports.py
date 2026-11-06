import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from test_sign_out_right import assign
from workspace_support import (
    join_project,
    make_case,
    make_project,
    make_slide,
    make_workspace,
    owner,
)

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db


@dataclass(frozen=True)
class Clinic:
    lead: MemberPrincipal
    junior: MemberPrincipal
    outsider: MemberPrincipal
    project: uuid.UUID
    case: uuid.UUID
    first: uuid.UUID
    second: uuid.UUID

    @property
    def url(self) -> str:
        return f"/api/projects/{self.project}/cases/{self.case}/clinical-report"


def make_clinic(
    database: str, privacy_mode: str = "clinical", template: str | None = None
) -> Clinic:
    people = make_workspace(
        database,
        {"lead": Role.RESEARCHER, "junior": Role.RESEARCHER, "outsider": Role.RESEARCHER},
    ).people
    lead, junior = people["lead"], people["junior"]
    project = make_project(database, lead.tenant_id, privacy_mode)
    join_project(database, project, lead, "owner")
    join_project(database, project, junior, "reviewer")
    if privacy_mode == "clinical":
        owner(
            database,
            f"UPDATE project_members SET sign_out = CASE user_id WHEN '{lead.user_id}' "
            f"THEN 'any' ELSE 'never' END WHERE project_id = '{project}'",
        )
    if template:
        owner(
            database, f"UPDATE projects SET clinical_template = '{template}' WHERE id = '{project}'"
        )
    case = make_case(database, lead.tenant_id, project, f"N-{uuid.uuid4().hex[:6]}")
    first = make_slide(database, lead.tenant_id, project, "Node 1", case)
    second = make_slide(database, lead.tenant_id, project, "Node 2", case)
    return Clinic(lead, junior, people["outsider"], project, case, first, second)


@pytest.fixture
def clinic(database: str) -> Clinic:
    return make_clinic(database)


def created(api: ApiAs, clinic: Clinic) -> dict[str, Any]:
    response = api(clinic.junior).post(clinic.url)
    assert response.status_code == 201, response.text
    return response.json()


def deposit(api: ApiAs, clinic: Clinic, who: MemberPrincipal | None = None, **body: Any) -> Any:
    return api(who or clinic.junior).post(f"{clinic.url}/deposits", json=body)


def fill(api: ApiAs, clinic: Clinic, **extra: Any) -> dict[str, Any]:
    body = {
        "specimen": "Sentinel node, left axilla",
        "category": "macro",
        "nodes_examined": 2,
        "extranodal": "absent",
        "diagnosis": "Metastatic carcinoma in one of two nodes",
        **extra,
    }
    response = api(clinic.junior).patch(clinic.url, json=body)
    assert response.status_code == 200, response.text
    return response.json()


def codes(report: dict[str, Any]) -> list[tuple[str, str | None]]:
    return [(blocker["code"], blocker["field"]) for blocker in report["blockers"]]


def audit_actions(database: str, report_id: str) -> list[str]:
    rows = owner(
        database,
        f"SELECT action FROM audit_events WHERE target_id = '{report_id}' ORDER BY seq",
    )
    return [str(row[0]) for row in rows]


def test_a_draft_follows_the_sentinel_node_template(api: ApiAs, clinic: Clinic) -> None:
    report = created(api, clinic)
    assert report["state"] == "draft"
    assert report["template"]["key"] == "sentinel-node"
    assert report["template"]["version"] == 1
    assert report["template"]["steps"] == ["findings", "staging", "text", "sign"]
    assert report["staging"]["suggested_category"] == "none"
    assert report["staging"]["suggested_pn"] == "pN0(sn)"
    again = api(clinic.junior).post(clinic.url)
    assert (again.status_code, again.json()["code"]) == (409, "clinical-report-exists")


def test_a_template_without_staging(api: ApiAs, database: str) -> None:
    clinic = make_clinic(database, template="lymph-node-excision")
    report = created(api, clinic)
    assert report["template"]["steps"] == ["findings", "text", "sign"]
    assert report["staging"] is None
    assert codes(report) == [
        ("required-field-empty", "specimen"),
        ("required-field-empty", "diagnosis"),
    ]
    refused = deposit(api, clinic, slide_id=str(clinic.first), size_mm=1.0)
    assert (refused.status_code, refused.json()["code"]) == (409, "no-staging")
    staged = api(clinic.junior).patch(clinic.url, json={"category": "micro"})
    assert (staged.status_code, staged.json()["code"]) == (409, "no-staging")


def test_a_de_identified_project_has_no_report(api: ApiAs, database: str) -> None:
    clinic = make_clinic(database, privacy_mode="de-identified")
    refused = api(clinic.junior).post(clinic.url)
    assert (refused.status_code, refused.json()["code"]) == (409, "no-clinical-report")
    read = api(clinic.junior).get(clinic.url)
    assert (read.status_code, read.json()["code"]) == (409, "no-clinical-report")


def test_deposits_from_an_object_and_by_hand(api: ApiAs, database: str, clinic: Clinic) -> None:
    created(api, clinic)
    owner(database, f"UPDATE slides SET mpp_x = 0.25 WHERE id = '{clinic.first}'")
    owner(
        database,
        "INSERT INTO annotations (tenant_id, project_id, slide_id, kind, number, geometry) "
        f"VALUES ('{clinic.lead.tenant_id}', '{clinic.project}', '{clinic.first}', "
        "'measurement', 1, ST_GeomFromText('LINESTRING(0 0, 9600 0)'))",
    )
    measured = deposit(api, clinic, slide_id=str(clinic.first), object_id="M1")
    assert measured.status_code == 201, measured.text
    from_object = deposit(
        api, clinic, slide_id=str(clinic.second), object_id="T4", note="Subcapsular"
    )
    by_hand = deposit(api, clinic, slide_id=str(clinic.second), size_mm=0.15)
    report = by_hand.json()
    rows = [(row["object_id"], row["size_mm"], row["note"]) for row in report["deposits"]]
    assert rows == [("M1", 2.4, None), ("T4", None, "Subcapsular"), (None, 0.15, None)]
    assert from_object.status_code == 201
    assert report["findings"]["measurements"] == [
        {"slide_id": str(clinic.first), "object_id": "M1", "length_mm": 2.4}
    ]
    no_size = deposit(api, clinic, slide_id=str(clinic.second))
    assert (no_size.status_code, no_size.json()["code"]) == (409, "deposit-size-needed")
    missing = deposit(api, clinic, slide_id=str(clinic.first), object_id="M9")
    assert missing.status_code == 404


def test_a_size_of_zero_is_refused(api: ApiAs, clinic: Clinic) -> None:
    created(api, clinic)
    for size in (0, -1.5):
        refused = deposit(api, clinic, slide_id=str(clinic.first), size_mm=size)
        assert refused.status_code == 422


def test_removing_a_deposit(api: ApiAs, clinic: Clinic) -> None:
    created(api, clinic)
    report = deposit(api, clinic, slide_id=str(clinic.first), size_mm=3.0).json()
    gone = api(clinic.junior).delete(f"{clinic.url}/deposits/{report['deposits'][0]['id']}")
    assert gone.status_code == 200
    assert gone.json()["deposits"] == []
    assert gone.json()["staging"]["suggested_category"] == "none"
    again = api(clinic.junior).delete(f"{clinic.url}/deposits/{report['deposits'][0]['id']}")
    assert again.status_code == 404


def test_the_largest_deposit_sets_the_category(api: ApiAs, clinic: Clinic) -> None:
    created(api, clinic)
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=0.1)
    report = deposit(api, clinic, slide_id=str(clinic.second), size_mm=1.4).json()
    assert report["staging"]["largest_mm"] == 1.4
    assert report["staging"]["suggested_category"] == "micro"
    assert report["staging"]["suggested_pn"] == "pN1mi(sn)"
    assert [row["largest"] for row in report["deposits"]] == [False, True]
    report = deposit(api, clinic, slide_id=str(clinic.first), size_mm=2.6).json()
    assert report["staging"]["suggested_category"] == "macro"
    assert report["staging"]["suggested_pn"] == "pN1a(sn)"


def test_a_contradicting_category_needs_a_confirmation(api: ApiAs, clinic: Clinic) -> None:
    created(api, clinic)
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=1.4)
    report = fill(api, clinic, category="macro")
    assert report["staging"]["contradicts"] is True
    assert report["staging"]["confirmed"] is False
    assert codes(report) == [("category-not-confirmed", "category")]
    assert report["staging"]["suggested_pn"] == "pN1a(sn)"
    report = api(clinic.junior).patch(clinic.url, json={"confirm_category": True}).json()
    assert report["staging"]["confirmed"] is True
    assert report["blockers"] == []
    report = deposit(api, clinic, slide_id=str(clinic.second), size_mm=0.1).json()
    assert report["blockers"] == []
    report = deposit(api, clinic, slide_id=str(clinic.second), size_mm=0.15).json()
    gone = api(clinic.junior).delete(f"{clinic.url}/deposits/{report['deposits'][0]['id']}")
    assert gone.json()["staging"]["suggested_category"] == "itc"
    assert codes(gone.json()) == [("category-not-confirmed", "category")]
    agreeing = fill(api, clinic, category="itc")
    assert agreeing["staging"]["contradicts"] is False
    assert agreeing["blockers"] == []


def test_two_deposits_in_one_node_count_once(api: ApiAs, clinic: Clinic) -> None:
    created(api, clinic)
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=2.5)
    report = deposit(api, clinic, slide_id=str(clinic.first), size_mm=0.4).json()
    assert report["staging"]["nodes_positive"] == 1
    report = deposit(api, clinic, slide_id=str(clinic.second), size_mm=0.3).json()
    assert report["staging"]["nodes_positive"] == 2


def test_each_blocker(api: ApiAs, clinic: Clinic) -> None:
    report = created(api, clinic)
    assert codes(report) == [
        ("required-field-empty", "specimen"),
        ("required-field-empty", "diagnosis"),
        ("required-field-empty", "category"),
        ("required-field-empty", "nodes_examined"),
        ("required-field-empty", "extranodal"),
    ]
    unmeasured = deposit(api, clinic, slide_id=str(clinic.first), object_id="T2").json()
    report = fill(api, clinic, category="none", diagnosis="  ")
    assert [(b["code"], b["field"], b["deposit_id"]) for b in report["blockers"]] == [
        ("required-field-empty", "diagnosis", None),
        ("deposit-without-size", None, unmeasured["deposits"][0]["id"]),
    ]
    signed = api(clinic.lead).post(f"{clinic.url}/sign")
    assert (signed.status_code, signed.json()["code"]) == (409, "clinical-report-blocked")
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=2.5)
    report = fill(api, clinic, category="none")
    assert codes(report) == [
        ("deposit-without-size", None),
        ("category-not-confirmed", "category"),
    ]


def test_the_lifecycle_with_co_sign(api: ApiAs, database: str, clinic: Clinic) -> None:
    created(api, clinic)
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=2.5)
    fill(api, clinic)
    own = api(clinic.junior).post(f"{clinic.url}/sign")
    assert (own.status_code, own.json()["code"]) == (403, "cannot-sign-out")
    to_self = api(clinic.junior).post(
        f"{clinic.url}/send", json={"cosigner_user_id": str(clinic.junior.user_id)}
    )
    assert (to_self.status_code, to_self.json()["code"]) == (409, "co-signer-not-covering")
    sent = api(clinic.junior).post(
        f"{clinic.url}/send", json={"cosigner_user_id": str(clinic.lead.user_id)}
    )
    assert sent.json()["state"] == "sent"
    locked = api(clinic.junior).patch(clinic.url, json={"comment": "More"})
    assert (locked.status_code, locked.json()["code"]) == (409, "clinical-report-state")
    short = api(clinic.lead).post(f"{clinic.url}/return", json={"note": "Too short"})
    assert short.status_code == 422
    not_cosigner = api(clinic.junior).post(
        f"{clinic.url}/return", json={"note": "Please recheck the second node"}
    )
    assert (not_cosigner.status_code, not_cosigner.json()["code"]) == (403, "not-the-co-signer")
    returned = api(clinic.lead).post(
        f"{clinic.url}/return", json={"note": "Please recheck the second node"}
    )
    assert returned.json()["state"] == "returned"
    assert returned.json()["return_note"] == "Please recheck the second node"
    fill(api, clinic, comment="Second node rechecked")
    api(clinic.junior).post(
        f"{clinic.url}/send", json={"cosigner_user_id": str(clinic.lead.user_id)}
    )
    changed = api(clinic.lead).patch(clinic.url, json={"microscopic": "Cohesive tumour cells"})
    assert changed.status_code == 200
    signed = api(clinic.lead).post(f"{clinic.url}/sign").json()
    assert signed["state"] == "signed"
    assert signed["version"] == 1
    assert signed["versions"][0]["signed_by_user_id"] == str(clinic.lead.user_id)
    assert signed["versions"][0]["reported_by_user_id"] == str(clinic.junior.user_id)
    again = api(clinic.lead).post(f"{clinic.url}/sign")
    assert (again.status_code, again.json()["code"]) == (409, "clinical-report-state")
    frozen = deposit(api, clinic, who=clinic.lead, slide_id=str(clinic.first), size_mm=1.0)
    assert frozen.status_code == 409
    assert audit_actions(database, signed["id"]) == [
        "clinical-report.created",
        "clinical-report.deposit-added",
        "clinical-report.changed",
        "clinical-report.sent",
        "clinical-report.returned",
        "clinical-report.changed",
        "clinical-report.sent",
        "clinical-report.changed",
        "clinical-report.signed",
    ]


def test_an_amendment_keeps_the_earlier_version(api: ApiAs, database: str, clinic: Clinic) -> None:
    created(api, clinic)
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=2.5)
    fill(api, clinic)
    first = api(clinic.lead).post(f"{clinic.url}/sign").json()
    assert first["state"] == "signed"
    short = api(clinic.lead).post(
        f"{clinic.url}/amendments", json={"reason": "Typo", "change": {"comment": "x"}}
    )
    assert short.status_code == 422
    junior = api(clinic.junior).post(
        f"{clinic.url}/amendments",
        json={"reason": "Corrected the diagnosis wording", "change": {"diagnosis": "Revised"}},
    )
    assert (junior.status_code, junior.json()["code"]) == (403, "cannot-sign-out")
    amended = (
        api(clinic.lead)
        .post(
            f"{clinic.url}/amendments",
            json={
                "reason": "Corrected the diagnosis wording",
                "change": {"diagnosis": "Metastatic carcinoma, one of two nodes, revised"},
            },
        )
        .json()
    )
    assert amended["state"] == "amended"
    assert amended["version"] == 2
    assert [row["reason"] for row in amended["versions"]] == [
        None,
        "Corrected the diagnosis wording",
    ]
    earlier = api(clinic.lead).get(f"{clinic.url}/versions/1").json()
    assert earlier["values"]["diagnosis"] == "Metastatic carcinoma in one of two nodes"
    assert earlier["staging"]["suggested_category"] == "macro"
    later = api(clinic.junior).get(f"{clinic.url}/versions/2").json()
    assert later["values"]["diagnosis"] == "Metastatic carcinoma, one of two nodes, revised"
    assert api(clinic.lead).get(f"{clinic.url}/versions/3").status_code == 404
    assert audit_actions(database, amended["id"])[-2:] == [
        "clinical-report.signed",
        "clinical-report.amended",
    ]


def test_findings_draw_on_the_case_decisions(api: ApiAs, database: str, clinic: Clinic) -> None:
    assign(api, database, clinic.lead, clinic.project, clinic.first, clinic.junior)
    task = owner(
        database, f"SELECT task_id FROM review_assignments WHERE slide_id = '{clinic.first}'"
    )
    owner(
        database,
        "INSERT INTO verdicts (tenant_id, project_id, task_id, slide_id, user_id, kind, number, "
        f"value, style, answer) VALUES ('{clinic.lead.tenant_id}', '{clinic.project}', "
        f"'{task[0][0]}', '{clinic.first}', '{clinic.junior.user_id}', 'region', 3, "
        "'agree', 'agree', 'agree')",
    )
    report = created(api, clinic)
    assert report["findings"]["decisions"] == [
        {"slide_id": str(clinic.first), "object_id": "T3", "decision": "agree"}
    ]


def test_isolation(api: ApiAs, database: str, clinic: Clinic) -> None:
    created(api, clinic)
    outside = api(clinic.outsider).get(clinic.url)
    assert (outside.status_code, outside.json()["code"]) == (403, "emergency-access-needed")
    assert api(clinic.outsider).post(f"{clinic.url}/sign").status_code == 403
    elsewhere = make_clinic(database)
    assert api(elsewhere.lead).get(clinic.url).status_code == 404
    other_case = f"/api/projects/{elsewhere.project}/cases/{clinic.case}/clinical-report"
    assert api(elsewhere.lead).get(other_case).status_code == 404
    foreign = deposit(api, clinic, slide_id=str(elsewhere.first), size_mm=1.0)
    assert foreign.status_code == 404
