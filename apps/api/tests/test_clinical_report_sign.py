import io
import json
from typing import Any

import pytest
from db_support import ApiAs
from pypdf import PdfReader
from test_clinical_reports import Clinic, audit_actions, created, deposit, fill, make_clinic
from test_sign_out_right import assign
from workspace_support import join_project, make_case, make_slide, owner

pytestmark = pytest.mark.db


@pytest.fixture
def clinic(database: str) -> Clinic:
    return make_clinic(database)


def ready(api: ApiAs, clinic: Clinic) -> dict[str, Any]:
    report = created(api, clinic)
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=2.5)
    fill(api, clinic)
    return report


def set_right(database: str, clinic: Clinic, right: str) -> None:
    owner(
        database,
        f"UPDATE project_members SET sign_out = '{right}' "
        f"WHERE project_id = '{clinic.project}' AND user_id = '{clinic.junior.user_id}'",
    )


def signed_audit(database: str, report_id: str) -> dict[str, Any]:
    rows = owner(
        database,
        "SELECT details FROM audit_events "
        f"WHERE target_id = '{report_id}' AND action = 'clinical-report.signed'",
    )
    assert len(rows) == 1
    return json.loads(str(rows[0][0]))


def test_own_cases_signs_the_case_the_member_is_assigned_on(
    api: ApiAs, database: str, clinic: Clinic
) -> None:
    ready(api, clinic)
    set_right(database, clinic, "own")
    assign(api, database, clinic.lead, clinic.project, clinic.first, clinic.junior)
    signed = api(clinic.junior).post(f"{clinic.url}/sign", json={"confirmed_with": "password"})
    assert signed.status_code == 200, signed.text
    assert signed.json()["state"] == "signed"
    assert signed.json()["versions"][0]["signed_by_user_id"] == str(clinic.junior.user_id)


def test_own_cases_refuses_another_case(api: ApiAs, database: str, clinic: Clinic) -> None:
    ready(api, clinic)
    set_right(database, clinic, "own")
    assign(api, database, clinic.lead, clinic.project, clinic.first, clinic.junior)
    other = make_case(database, clinic.lead.tenant_id, clinic.project, "N-other")
    make_slide(database, clinic.lead.tenant_id, clinic.project, "Other node", other)
    other_url = f"/api/projects/{clinic.project}/cases/{other}/clinical-report"
    assert api(clinic.junior).post(other_url).status_code == 201
    refused = api(clinic.junior).post(f"{other_url}/sign")
    assert (refused.status_code, refused.json()["code"]) == (403, "cannot-sign-out")
    state = api(clinic.junior).get(other_url).json()
    assert (state["state"], state["versions"]) == ("draft", [])


def test_own_cases_without_an_assignment_refuses_the_member(
    api: ApiAs, database: str, clinic: Clinic
) -> None:
    ready(api, clinic)
    set_right(database, clinic, "own")
    refused = api(clinic.junior).post(f"{clinic.url}/sign")
    assert (refused.status_code, refused.json()["code"]) == (403, "cannot-sign-out")


def test_any_case_signs_and_the_audit_names_the_confirmation(
    api: ApiAs, database: str, clinic: Clinic
) -> None:
    report = ready(api, clinic)
    set_right(database, clinic, "any")
    signed = api(clinic.junior).post(f"{clinic.url}/sign")
    assert signed.status_code == 200, signed.text
    details = signed_audit(database, report["id"])
    assert details["confirmed_with"] == "sso"
    assert details["version"] == 1
    assert details["co_signed"] is False
    assert details["case_id"] == str(clinic.case)
    stored = owner(
        database,
        f"SELECT content->>'confirmed_with' FROM clinical_report_versions "
        f"WHERE report_id = '{report['id']}'",
    )
    assert stored == [("sso",)]


def test_never_refuses_the_member_and_signs_nothing(
    api: ApiAs, database: str, clinic: Clinic
) -> None:
    report = ready(api, clinic)
    set_right(database, clinic, "never")
    refused = api(clinic.junior).post(f"{clinic.url}/sign")
    assert (refused.status_code, refused.json()["code"]) == (403, "cannot-sign-out")
    assert "clinical-report.signed" not in audit_actions(database, report["id"])
    assert api(clinic.lead).get(clinic.url).json()["state"] == "draft"


def test_a_viewer_cannot_sign(api: ApiAs, database: str, clinic: Clinic) -> None:
    ready(api, clinic)
    join_project(database, clinic.project, clinic.outsider, "viewer")
    refused = api(clinic.outsider).post(f"{clinic.url}/sign")
    assert refused.status_code == 403
    assert api(clinic.lead).get(clinic.url).json()["state"] == "draft"


def test_each_blocker_refuses_the_sign_out(api: ApiAs, database: str, clinic: Clinic) -> None:
    report = created(api, clinic)
    empty = api(clinic.lead).post(f"{clinic.url}/sign")
    assert (empty.status_code, empty.json()["code"]) == (409, "clinical-report-blocked")
    unmeasured = deposit(api, clinic, slide_id=str(clinic.first), object_id="T2").json()
    fill(api, clinic, category="none")
    refused = api(clinic.lead).post(f"{clinic.url}/sign")
    assert (refused.status_code, refused.json()["code"]) == (409, "clinical-report-blocked")
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=2.5)
    removed = api(clinic.lead).delete(f"{clinic.url}/deposits/{unmeasured['deposits'][0]['id']}")
    assert removed.status_code == 200, removed.text
    assert [b["code"] for b in removed.json()["blockers"]] == ["category-not-confirmed"]
    unconfirmed = api(clinic.lead).post(f"{clinic.url}/sign")
    assert (unconfirmed.status_code, unconfirmed.json()["code"]) == (409, "clinical-report-blocked")
    assert "clinical-report.signed" not in audit_actions(database, report["id"])
    state = api(clinic.lead).get(clinic.url).json()
    assert (state["state"], state["versions"]) == ("draft", [])


def test_a_failed_single_sign_on_leaves_nothing_signed(
    api: ApiAs, database: str, clinic: Clinic
) -> None:
    report = ready(api, clinic)
    silent = api(clinic.lead).post(
        f"{clinic.url}/sign", json={"confirmed_with": "sso", "identity_answered": False}
    )
    assert (silent.status_code, silent.json()["code"]) == (409, "single-sign-on-did-not-answer")
    state = api(clinic.lead).get(clinic.url).json()
    assert (state["state"], state["versions"], state["version"]) == ("draft", [], 0)
    assert "clinical-report.signed" not in audit_actions(database, report["id"])
    unknown = api(clinic.lead).post(f"{clinic.url}/sign", json={"confirmed_with": "fingerprint"})
    assert unknown.status_code == 422
    assert api(clinic.lead).get(clinic.url).json()["versions"] == []
    fallback = api(clinic.lead).post(
        f"{clinic.url}/sign", json={"confirmed_with": "password", "identity_answered": False}
    )
    assert fallback.status_code == 200, fallback.text
    assert signed_audit(database, report["id"])["confirmed_with"] == "password"


def pages_of(pdf: bytes) -> str:
    return " ".join(
        " ".join((page.extract_text() or "").split()) for page in PdfReader(io.BytesIO(pdf)).pages
    )


def test_the_signed_version_downloads_as_a_pdf(api: ApiAs, database: str, clinic: Clinic) -> None:
    ready(api, clinic)
    missing = api(clinic.lead).get(f"{clinic.url}/versions/1/pdf")
    assert missing.status_code == 404
    assert api(clinic.lead).post(f"{clinic.url}/sign").status_code == 200
    response = api(clinic.lead).get(f"{clinic.url}/versions/1/pdf")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/pdf"
    assert "_report_v1.pdf" in response.headers["content-disposition"]
    text = pages_of(response.content)
    assert "Metastatic carcinoma in one of two nodes" in text
    assert "by lead" in text
    assert "2.5 mm" in text
    assert api(clinic.outsider).get(f"{clinic.url}/versions/1/pdf").status_code == 403
