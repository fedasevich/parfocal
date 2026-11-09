import io
from typing import Any

import pytest
from db_support import ApiAs
from pypdf import PdfReader
from test_evaluation_api import scenario
from test_evaluation_exports import exported
from workspace_support import person

from parfocal_api.tables import Role

TEMPLATE_BLOCKS = [
    {"kind": "headline-numbers", "title": "Headline", "metrics": ["dice"]},
    {"kind": "text", "title": "Methods", "body": "Two pathologists read."},
]


def admin_of(database: str, r: Any) -> Any:
    return person(
        database, r.people["owner"].tenant_id, "admin", Role.RESEARCHER, admin_rights=True
    )


def preview_of(api: ApiAs, who: Any, task: Any) -> Any:
    return api(who).get(f"/api/review-tasks/{task}/evaluation/preview")


@pytest.mark.db
def test_the_preview_has_the_same_pages_as_the_pdf_export(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    pdf = PdfReader(io.BytesIO(exported(api, r, "report.pdf").content))
    response = preview_of(api, r.people["owner"], r.task)
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["page_count"] == len(pdf.pages) == len(body["pages"])
    assert body["paper"] == "a4"
    assert body["sample"] is False
    assert body["file_name"] == "evaluation_v1_report.pdf"
    assert all(page.lstrip().startswith("<svg") for page in body["pages"])
    assert preview_of(api, r.people["owner"], r.task).json() == body


@pytest.mark.db
def test_reviewers_cannot_preview_the_evaluation(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    hidden = preview_of(api, r.people["first"], r.task)
    assert (hidden.status_code, hidden.json()["code"]) == (403, "evaluation-hidden")


@pytest.mark.db
def test_a_template_previews_with_the_sample_numbers(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    admin = admin_of(database, r)
    response = api(admin).post(
        "/api/study-templates/preview",
        json={"name": "Outline study", "blocks": TEMPLATE_BLOCKS, "format": {"paper": "letter"}},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sample"] is True
    assert body["paper"] == "letter"
    assert body["file_name"] == "Outline_study_sample.pdf"
    assert body["page_count"] == len(body["pages"]) >= 1
    file = api(admin).post(
        "/api/study-templates/preview/pdf",
        json={"name": "Outline study", "blocks": TEMPLATE_BLOCKS, "format": {"paper": "letter"}},
    )
    assert file.status_code == 200, file.text
    assert len(PdfReader(io.BytesIO(file.content)).pages) == body["page_count"]


@pytest.mark.db
def test_a_template_preview_refuses_an_unknown_block(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    response = api(admin_of(database, r)).post(
        "/api/study-templates/preview",
        json={"name": "Bad", "blocks": [{"kind": "nope", "title": "x"}]},
    )
    assert response.status_code == 422


@pytest.mark.db
def test_a_saved_template_previews_by_its_id(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    templates = api(r.people["owner"]).get("/api/study-templates").json()
    saved = templates[0]["id"]
    response = api(r.people["owner"]).get(f"/api/study-templates/{saved}/preview")
    assert api(r.people["first"]).get(f"/api/study-templates/{saved}/preview").status_code == 403
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["sample"] is True
    assert body["title"] == templates[0]["name"]
    file = api(r.people["owner"]).get(f"/api/study-templates/{saved}/preview/pdf")
    assert len(PdfReader(io.BytesIO(file.content)).pages) == body["page_count"]
