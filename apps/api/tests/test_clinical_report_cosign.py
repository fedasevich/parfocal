import io
from typing import Any

import pytest
from db_support import ApiAs
from pypdf import PdfReader
from test_clinical_reports import Clinic, audit_actions, created, deposit, fill, make_clinic
from workspace_support import join_project, owner

from parfocal_api.principals import MemberPrincipal

pytestmark = pytest.mark.db


@pytest.fixture
def clinic(database: str) -> Clinic:
    return make_clinic(database)


def ready(api: ApiAs, clinic: Clinic) -> dict[str, Any]:
    created(api, clinic)
    deposit(api, clinic, slide_id=str(clinic.first), size_mm=2.5)
    return fill(api, clinic)


def send(api: ApiAs, clinic: Clinic, to: MemberPrincipal) -> Any:
    return api(clinic.junior).post(f"{clinic.url}/send", json={"cosigner_user_id": str(to.user_id)})


def asks(api: ApiAs, who: MemberPrincipal) -> list[dict[str, Any]]:
    response = api(who).get("/api/me/cosign-requests")
    assert response.status_code == 200, response.text
    return response.json()


def name_of(database: str, who: MemberPrincipal) -> str:
    return str(owner(database, f"SELECT display_name FROM users WHERE id = '{who.user_id}'")[0][0])


def test_sending_needs_a_co_signer_whose_right_covers_the_case(
    api: ApiAs, database: str, clinic: Clinic
) -> None:
    ready(api, clinic)
    join_project(database, clinic.project, clinic.outsider, "reviewer")
    owner(
        database,
        "UPDATE project_members SET sign_out = 'never' "
        f"WHERE user_id = '{clinic.outsider.user_id}'",
    )
    refused = send(api, clinic, clinic.outsider)
    assert (refused.status_code, refused.json()["code"]) == (409, "co-signer-not-covering")
    assert api(clinic.junior).get(clinic.url).json()["state"] == "draft"
    sent = send(api, clinic, clinic.lead)
    assert sent.status_code == 200, sent.text
    report = sent.json()
    assert report["state"] == "sent"
    assert report["cosigner_user_id"] == str(clinic.lead.user_id)
    assert report["sent_at"] is not None
    assert report["sent"]["values"]["specimen"] == "Sentinel node, left axilla"
    assert report["changes"] == []
    [ask] = asks(api, clinic.lead)
    assert ask["case_id"] == str(clinic.case)
    assert ask["from_user_id"] == str(clinic.junior.user_id)
    assert ask["template"]["key"] == "sentinel-node"
    assert asks(api, clinic.junior) == []
    assert asks(api, clinic.outsider) == []


def test_a_return_needs_a_note_of_10_to_300_characters(api: ApiAs, clinic: Clinic) -> None:
    ready(api, clinic)
    send(api, clinic, clinic.lead)
    url = f"{clinic.url}/return"
    for note in ("x" * 9, "x" * 301):
        assert api(clinic.lead).post(url, json={"note": note}).status_code == 422
    assert api(clinic.lead).post(url, json={"note": "x" * 10}).json()["state"] == "returned"
    send(api, clinic, clinic.lead)
    longest = api(clinic.lead).post(url, json={"note": "y" * 300}).json()
    assert (longest["state"], longest["return_note"]) == ("returned", "y" * 300)


def test_the_sender_sees_the_co_signers_changes_and_sends_again(api: ApiAs, clinic: Clinic) -> None:
    ready(api, clinic)
    send(api, clinic, clinic.lead)
    edit = api(clinic.lead).patch(
        clinic.url, json={"diagnosis": "Macrometastasis in one of two nodes", "nodes_examined": 3}
    )
    assert edit.json()["changes"] == ["nodes_examined", "diagnosis"]
    api(clinic.lead).post(f"{clinic.url}/return", json={"note": "Recount the examined nodes"})
    seen = api(clinic.junior).get(clinic.url).json()
    assert seen["state"] == "returned"
    assert seen["return_note"] == "Recount the examined nodes"
    assert seen["changes"] == ["nodes_examined", "diagnosis"]
    assert seen["sent"]["values"]["nodes_examined"] == 2
    assert seen["nodes_examined"] == 3
    assert asks(api, clinic.lead) == []
    fill(api, clinic, nodes_examined=4, diagnosis="Macrometastasis in one of four nodes")
    again = send(api, clinic, clinic.lead).json()
    assert again["state"] == "sent"
    assert again["return_note"] is None
    assert again["sent"]["values"]["nodes_examined"] == 4
    assert again["changes"] == []
    assert len(asks(api, clinic.lead)) == 1


def test_only_the_sender_withdraws_a_request(api: ApiAs, database: str, clinic: Clinic) -> None:
    report = ready(api, clinic)
    send(api, clinic, clinic.lead)
    url = f"{clinic.url}/withdraw"
    refused = api(clinic.lead).post(url)
    assert (refused.status_code, refused.json()["code"]) == (403, "not-the-sender")
    withdrawn = api(clinic.junior).post(url).json()
    assert withdrawn["state"] == "draft"
    assert (withdrawn["cosigner_user_id"], withdrawn["sent"], withdrawn["sent_at"]) == (
        None,
        None,
        None,
    )
    assert asks(api, clinic.lead) == []
    twice = api(clinic.junior).post(url)
    assert (twice.status_code, twice.json()["code"]) == (409, "clinical-report-state")
    assert audit_actions(database, report["id"])[-2:] == [
        "clinical-report.sent",
        "clinical-report.withdrawn",
    ]


def test_co_signing_names_both_people(api: ApiAs, database: str, clinic: Clinic) -> None:
    report = ready(api, clinic)
    send(api, clinic, clinic.lead)
    api(clinic.lead).patch(clinic.url, json={"microscopic": "Cohesive tumour cells"})
    signed = api(clinic.lead).post(f"{clinic.url}/sign").json()
    assert signed["state"] == "signed"
    version = signed["versions"][0]
    assert version["signed_by_user_id"] == str(clinic.lead.user_id)
    assert version["reported_by_user_id"] == str(clinic.junior.user_id)
    assert asks(api, clinic.lead) == []
    pdf = api(clinic.junior).get(f"{clinic.url}/versions/1/pdf")
    assert pdf.status_code == 200
    text = " ".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf.content)).pages)
    text = " ".join(text.split())
    signer, reporter = name_of(database, clinic.lead), name_of(database, clinic.junior)
    assert f"by {signer}, reported by {reporter}" in text
    assert "Cohesive tumour cells" in text
    details = owner(
        database,
        f"SELECT details::jsonb->>'co_signed', details::jsonb->>'cosigner_user_id' "
        f"FROM audit_events "
        f"WHERE target_id = '{report['id']}' AND action IN "
        f"('clinical-report.signed', 'clinical-report.sent') ORDER BY seq",
    )
    assert details == [(None, str(clinic.lead.user_id)), ("true", None)]
    assert audit_actions(database, report["id"]) == [
        "clinical-report.created",
        "clinical-report.deposit-added",
        "clinical-report.changed",
        "clinical-report.sent",
        "clinical-report.changed",
        "clinical-report.signed",
    ]
