import pytest
from db_support import ApiAs
from test_clinical_report_cosign import ready, send
from test_clinical_reports import Clinic, audit_actions, created, make_clinic
from test_reviewed_layer import review
from test_slide_viewer import decide
from workspace_support import owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

NOTE = "Known lobular carcinoma, sentinel node biopsy"


@pytest.fixture
def clinic(database: str) -> Clinic:
    return make_clinic(database)


def report_url(clinic: Clinic) -> str:
    return f"/api/projects/{clinic.project}/slides/{clinic.first}/clinical-report"


def test_the_evaluation_report_reads_the_task(api: ApiAs, database: str) -> None:
    r = review(api, database)
    decide(api, r, "first", "T1", "agree")
    decide(api, r, "second", "T1", "agree")
    decide(api, r, "first", "T2", "disagree")
    decide(api, r, "second", "T2", "unsure")
    url = f"/api/review-tasks/{r.task}/evaluation-report"
    response = api(r.people["owner"]).get(url)
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["task_code"].startswith("RT-")
    assert (report["round_name"], report["model"]) == ("Layer task", "HoVer-NeXt")
    assert (report["slides"], report["objects"], report["adjudicators"]) == (1, 7, 0)
    assert sorted(report["reviewer_ids"]) == sorted(
        str(r.people[who].user_id) for who in ("first", "second")
    )
    assert (report["version"], report["signed_at"], report["signed_by_user_id"]) == (1, None, None)
    assert report["project"]["id"] == str(r.project)
    assert report["lab"]["short"]
    template = report["template"]
    assert (template["id"], template["version"], template["latest_version"]) == ("detection", 1, 1)
    assert template["blocks"]
    assert [item["key"] for item in report["formats"]] == template["format"]["downloads"]
    assert report["confusion"] == {"classes": [], "counts": []}
    assert [item["object"] for item in report["worst"]] == ["T2", "T1"]
    assert sorted(answer["raw"] for answer in report["worst"][0]["answers"]) == [
        "disagree",
        "unsure",
    ]
    assert report["changes"] == []
    hidden = api(r.people["first"]).get(url)
    assert (hidden.status_code, hidden.json()["code"]) == (403, "evaluation-hidden")


def test_the_clinical_report_reads_the_case_of_the_slide(
    api: ApiAs, database: str, clinic: Clinic
) -> None:
    missing = api(clinic.lead).get(report_url(clinic))
    assert missing.status_code == 404
    ready(api, clinic)
    noted = api(clinic.lead).put(f"/api/cases/{clinic.case}/clinical-note", json={"note": NOTE})
    assert noted.status_code == 200, noted.text
    response = api(clinic.lead).get(report_url(clinic))
    assert response.status_code == 200, response.text
    report = response.json()
    assert report["case"]["clinical_history"] == NOTE
    assert report["template"]["version"] == "v1"
    assert [step["key"] for step in report["template"]["steps"]] == [
        "findings",
        "staging",
        "text",
        "sign",
    ]
    assert [slide["node"] for slide in report["slides"]] == [1, 2]
    assert report["author_user_id"] == str(clinic.lead.user_id)
    covers = {member["user_id"]: member["covers_case"] for member in report["members"]}
    assert covers == {str(clinic.lead.user_id): True, str(clinic.junior.user_id): False}
    values = report["values"]
    assert (values["specimen"], values["category"], values["examined"]) == (
        "Sentinel node, left axilla",
        "macro",
        "2",
    )
    assert [deposit["size_mm"] for deposit in values["deposits"]] == ["2.5"]
    details = owner(
        database,
        f"SELECT action, details::text FROM audit_events WHERE target_id = '{clinic.case}'",
    )
    assert ("case.patient-viewed", "{}") in [(str(a), str(b)) for a, b in details]
    assert all(NOTE not in str(row[1]) for row in details)
    unassigned = api(clinic.junior).get(report_url(clinic))
    assert (unassigned.status_code, unassigned.json()["detail"]) == (404, "Case not found")
    outside = api(clinic.outsider).get(report_url(clinic)).status_code
    assert outside == api(clinic.outsider).get(clinic.url).status_code == 403


def test_the_co_signer_returns_and_co_signs_at_the_slide_urls(
    api: ApiAs, database: str, clinic: Clinic
) -> None:
    report = ready(api, clinic)
    base = f"{report_url(clinic)}/cosign-request"
    assert api(clinic.lead).get(base).status_code == 404
    early = api(clinic.lead).post(f"{base}/co-sign", json={"method": "sso"})
    assert (early.status_code, early.json()["code"]) == (409, "clinical-report-state")
    send(api, clinic, clinic.lead)
    review = api(clinic.lead).get(base)
    assert review.status_code == 200, review.text
    asked = review.json()
    assert (asked["from_user_id"], asked["to_user_id"]) == (
        str(clinic.junior.user_id),
        str(clinic.lead.user_id),
    )
    assert asked["co_signer_covers_case"] is True
    assert asked["values"]["diagnosis"] == "Metastatic carcinoma in one of two nodes"
    assert api(clinic.lead).post(f"{base}/return", json={"note": "short"}).status_code == 422
    by_sender = api(clinic.junior).post(f"{base}/return", json={"note": "Please recount nodes"})
    assert (by_sender.status_code, by_sender.json()["code"]) == (403, "not-the-co-signer")
    returned = api(clinic.lead).post(f"{base}/return", json={"note": "Please recount nodes"})
    assert returned.status_code == 200, returned.text
    assert returned.json()["note"] == "Please recount nodes"
    assert api(clinic.junior).get(clinic.url).json()["state"] == "returned"
    send(api, clinic, clinic.lead)
    signed = api(clinic.lead).post(f"{base}/co-sign", json={"method": "password"})
    assert signed.status_code == 200, signed.text
    signature = signed.json()
    assert signature["version"] == 1
    assert signature["signed_by_user_id"] == str(clinic.lead.user_id)
    assert signature["reported_by_user_id"] == str(clinic.junior.user_id)
    assert api(clinic.lead).get(base).status_code == 404
    assert audit_actions(database, report["id"])[-4:] == [
        "clinical-report.sent",
        "clinical-report.returned",
        "clinical-report.sent",
        "clinical-report.signed",
    ]


def test_a_slide_outside_any_case_has_no_clinical_report(api: ApiAs, clinic: Clinic) -> None:
    created(api, clinic)
    url = f"/api/projects/{clinic.project}/slides/{clinic.case}/clinical-report"
    assert api(clinic.junior).get(url).status_code == 404
