import io
import uuid
from types import SimpleNamespace
from typing import Any

import pytest
from db_support import ApiAs
from pypdf import PdfReader
from test_annotate_sign_off import SQUARE, on_slide, post, two_slides
from test_evaluation_api import scenario
from test_evaluation_exports import exported
from test_locales import EMPTY_REPORT
from test_report_blocks_pdf import created_template
from test_review_order import ordered
from workspace_support import join_project, owner, person

from parfocal_api import evaluation_exports
from parfocal_api.principals import MemberPrincipal
from parfocal_api.report_template import render_report
from parfocal_api.tables import Role

TEMPLATE_BLOCKS = [
    {"kind": "headline-numbers", "title": "Headline", "metrics": ["dice"]},
    {"kind": "text", "title": "Methods", "body": "Two pathologists read."},
]


def admin_of(database: str, r: Any) -> Any:
    return person(
        database, r.people["owner"].tenant_id, "admin", Role.RESEARCHER, admin_rights=True
    )


def preview_of(api: ApiAs, who: Any, task: Any, **window: int) -> Any:
    return api(who).get(f"/api/review-tasks/{task}/evaluation/preview", params=window)


class CountedTypst:
    def __init__(self) -> None:
        self.real = evaluation_exports.typst_module()
        self.made: list[str] = []

    def compile(self, source: bytes, format: str, **options: Any) -> Any:
        self.made.append(format)
        return self.real.compile(source, format=format, **options)


@pytest.fixture
def counted(monkeypatch: pytest.MonkeyPatch) -> CountedTypst:
    evaluation_exports.REPORTS.clear()
    typst = CountedTypst()
    monkeypatch.setattr(evaluation_exports, "typst_module", lambda: typst)
    return typst


LONG_BLOCKS = [
    {"kind": "text", "title": f"Notes {number}", "body": "A long paragraph of notes. " * 180}
    for number in range(16)
]


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


@pytest.mark.db
def test_a_long_report_comes_in_pages_and_reuses_the_cache(
    api: ApiAs, database: str, counted: CountedTypst
) -> None:
    r = scenario(api, database)
    template = created_template(api, admin_of(database, r), "Long notes", LONG_BLOCKS)
    owner(
        database,
        f"UPDATE review_tasks SET study_template_id = '{template}', study_template_version = 1 "
        f"WHERE id = '{r.task}'",
    )
    reader = r.people["owner"]
    first = preview_of(api, reader, r.task).json()
    total = first["page_count"]
    assert len(first["pages"]) == 4
    assert total > 8
    assert first["offset"] == 0
    pages = list(first["pages"])
    while len(pages) < total:
        more = preview_of(api, reader, r.task, offset=len(pages), limit=3).json()
        assert more["offset"] == len(pages)
        assert more["page_count"] == total
        assert 1 <= len(more["pages"]) <= 3
        pages += more["pages"]
    assert pages == preview_of(api, reader, r.task, offset=0, limit=20).json()["pages"]
    assert preview_of(api, reader, r.task, limit=21).status_code == 422
    assert counted.made == ["svg"]
    downloads = [exported(api, r, "report.pdf").content for _ in range(2)]
    assert downloads[0] == downloads[1]
    assert len(PdfReader(io.BytesIO(downloads[0])).pages) == total
    assert counted.made == ["svg", "pdf"]


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_readers_with_different_blind_first_views_get_their_own_cached_preview(
    api: ApiAs, database: str, counted: CountedTypst
) -> None:
    o = ordered(database, api)
    people = [str(o.people[who].user_id) for who in ("owner", "first", "second")]
    task = two_slides(api, o, blind_first=True, reviewer_ids=people)
    slide = on_slide(o, task, 0)
    made = post(api, o, "owner", f"{slide}/shared-layer/objects", kind="region", geometry=SQUARE)
    assert made.status_code == 201, made.text
    tenant = o.people["owner"].tenant_id
    colleague_reader = person(database, tenant, "colleague", Role.RESEARCHER)
    join_project(database, o.project, colleague_reader, "owner")
    author = preview_of(api, o.people["owner"], task)
    colleague = preview_of(api, colleague_reader, task)
    assert author.status_code == colleague.status_code == 200, colleague.text
    assert author.json()["pages"] != colleague.json()["pages"]
    assert preview_of(api, o.people["owner"], task).json() == author.json()
    assert preview_of(api, colleague_reader, task).json() == colleague.json()
    assert counted.made == ["svg", "svg"]


def test_the_cache_key_holds_the_reader_only_under_blind_first() -> None:
    tenant = uuid.uuid4()
    readers = [MemberPrincipal(f"r{n}", tenant, uuid.uuid4(), Role.RESEARCHER) for n in (1, 2)]
    report = render_report(EMPTY_REPORT)
    version = evaluation_exports.Version(1, "sha256:same", None)

    def keys(blind_first: bool) -> set[Any]:
        task = SimpleNamespace(tenant_id=tenant, id=uuid.uuid4(), blind_first=blind_first)
        return {
            evaluation_exports.report_key(reader, task, report, version, "svg")
            for reader in readers
        }

    assert len(keys(True)) == 2
    assert len(keys(False)) == 1
