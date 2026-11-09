import io

import pytest
from db_support import ApiAs
from pypdf import PdfReader
from test_evaluation_api import scenario
from test_evaluation_exports import exported
from test_reviewed_layer import Review
from workspace_support import owner

ARRANGED = [
    {"kind": "text", "title": "Zebra opening", "body": "Written first."},
    {"kind": "headline-numbers", "title": "Headline", "metrics": ["dice"]},
]


def layout_path(r: Review) -> str:
    return f"/api/review-tasks/{r.task}/report-layout"


def pdf_text(api: ApiAs, r: Review) -> str:
    pdf = PdfReader(io.BytesIO(exported(api, r, "report.pdf").content))
    return " ".join(page.extract_text() for page in pdf.pages)


@pytest.mark.db
def test_a_task_starts_with_its_template_and_keeps_its_own_arrangement(
    api: ApiAs, database: str
) -> None:
    r = scenario(api, database)
    start = api(r.people["owner"]).get(layout_path(r))
    assert start.status_code == 200, start.text
    assert start.json()["own"] is False
    saved = api(r.people["owner"]).put(
        layout_path(r), json={"blocks": ARRANGED, "format": {"paper": "letter"}}
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["own"] is True
    assert [block["kind"] for block in body["blocks"]] == ["text", "headline-numbers"]
    assert body["format"]["paper"] == "letter"
    assert api(r.people["owner"]).get(layout_path(r)).json() == body


@pytest.mark.db
def test_the_pdf_follows_the_arranged_order(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    api(r.people["owner"]).put(layout_path(r), json={"blocks": ARRANGED})
    text = pdf_text(api, r)
    assert text.index("Zebra opening") < text.index("Headline")


@pytest.mark.db
def test_a_change_to_the_arrangement_is_audited_and_the_template_is_untouched(
    api: ApiAs, database: str
) -> None:
    r = scenario(api, database)
    before = api(r.people["owner"]).get("/api/study-templates").json()
    assert api(r.people["owner"]).put(layout_path(r), json={"blocks": ARRANGED}).status_code == 200
    assert api(r.people["owner"]).get("/api/study-templates").json() == before
    rows = owner(
        database,
        f"SELECT count(*) FROM audit_events WHERE target_id = '{r.task}' "
        "AND action = 'task.report-layout-changed'",
    )
    assert int(str(rows[0][0])) == 1


@pytest.mark.db
def test_an_unknown_block_and_a_reviewer_are_refused(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    unknown = api(r.people["owner"]).put(layout_path(r), json={"blocks": [{"kind": "nope"}]})
    assert unknown.status_code == 422
    assert api(r.people["first"]).put(layout_path(r), json={"blocks": ARRANGED}).status_code in {
        403,
        404,
    }
