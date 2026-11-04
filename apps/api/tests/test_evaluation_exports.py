import csv
import io
import json
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import pytest
from db_support import ApiAs
from pypdf import PdfReader
from test_evaluation_api import scenario
from test_locales import REPORT
from test_reviewed_layer import Review

from parfocal_api.evaluation_exports import (
    CHECKSUM_HEADER,
    DECISION_COLUMNS,
    OBJECT_COLUMNS,
    Version,
    pdf_of,
)
from parfocal_api.report_template import render_report
from parfocal_common.report_blocks import HeadlineNumbers, TextBlock

KINDS = (
    "report.pdf",
    "decisions.csv",
    "objects.csv",
    "annotations.json",
    "annotations.geojson",
)


def text_of(pdf: bytes) -> str:
    return " ".join(
        " ".join((page.extract_text() or "").split()) for page in PdfReader(io.BytesIO(pdf)).pages
    )


def exported(api: ApiAs, r: Review, kind: str, who: str = "owner") -> Any:
    response = api(r.people[who]).get(f"/api/review-tasks/{r.task}/evaluation/exports/{kind}")
    assert response.status_code == 200, response.text
    return response


def rows_of(text: str) -> tuple[list[str], list[dict[str, str]]]:
    reader = csv.DictReader(io.StringIO(text))
    return list(reader.fieldnames or []), list(reader)


def test_the_pdf_follows_the_block_order_and_carries_the_checksum() -> None:
    data = replace(
        REPORT,
        blocks=(
            TextBlock(kind="text", title="Methods first", body="Two pathologists read."),
            HeadlineNumbers(kind="headline-numbers", title="Numbers after", metrics=["dice"]),
        ),
        headline={"dice": 0.6},
    )
    version = Version(1, "sha256:0123abcd", datetime(2026, 11, 3, 12, tzinfo=UTC))
    pdf = pdf_of(render_report(data), version)
    text = text_of(pdf)
    for expected in (
        "Evaluation report",
        "PROJECT-SENTINEL",
        "Checksum: sha256:0123abcd",
        "Signed off: 03/11/2026",
        "Two pathologists read.",
        "Dice 0.60",
        "Agree 7",
    ):
        assert expected in text, (expected, text)
    assert text.index("Methods first") < text.index("Numbers after") < text.index("Decisions")
    assert pdf_of(render_report(data), version) == pdf


@pytest.mark.db
def test_every_export_carries_the_same_checksum(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    (checksum,) = {exported(api, r, kind).headers[CHECKSUM_HEADER] for kind in KINDS}
    assert checksum.startswith("sha256:")
    assert len(checksum) == len("sha256:") + 64
    _, decisions = rows_of(exported(api, r, "decisions.csv").text)
    _, objects = rows_of(exported(api, r, "objects.csv").text)
    assert {row["evaluation_checksum"] for row in decisions + objects} == {checksum}
    assert json.loads(exported(api, r, "annotations.json").text)["evaluation"] == {
        "version": 1,
        "checksum": checksum,
        "signed": False,
    }
    geojson = json.loads(exported(api, r, "annotations.geojson").text)
    assert geojson["parfocal"]["evaluation"]["checksum"] == checksum
    assert checksum in text_of(exported(api, r, "report.pdf").content)


@pytest.mark.db
def test_the_decisions_csv_has_one_row_per_reviewer_and_object(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    response = exported(api, r, "decisions.csv")
    assert response.headers["content-type"].startswith("text/csv")
    columns, rows = rows_of(response.text)
    assert tuple(columns) == DECISION_COLUMNS
    assert len(rows) == 8
    by_object: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        by_object.setdefault(row["object_id"].rsplit("/", 1)[1], []).append(row)
    assert sorted(by_object) == ["C1", "C2", "T1", "T2"]
    assert all(row["object_id"].count("/") == 3 for row in rows)
    assert [row["decision"] for row in by_object["T1"]] == ["agree", "agree"]
    assert {row["consensus"] for row in by_object["T1"]} == {"agree"}
    assert sorted(row["reasons"] for row in by_object["T2"]) == ["boundary_off", "not_class"]
    assert {row["reason_class"] for row in by_object["C2"]} == {"Tumor"}
    assert {row["queue_decision"] for row in by_object["C1"]} == {"disagree"}
    assert len({row["reviewer_id"] for row in rows}) == 2


@pytest.mark.db
def test_the_objects_csv_lists_ai_and_added_objects(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    columns, rows = rows_of(exported(api, r, "objects.csv").text)
    assert tuple(columns) == OBJECT_COLUMNS
    assert len(rows) == 5
    origins = [row["origin"] for row in rows]
    assert (origins.count("ai"), origins.count("added")) == (4, 1)
    by_id = {row["object_id"].rsplit("/", 1)[1]: row for row in rows}
    assert (by_id["T1"]["agree"], by_id["T1"]["consensus"]) == ("2", "agree")
    assert (by_id["C1"]["agree"], by_id["C1"]["disagree"], by_id["C1"]["queue_decision"]) == (
        "1",
        "1",
        "disagree",
    )
    (added,) = (row for row in rows if row["origin"] == "added")
    assert added["object_id"].endswith("+")
    assert (added["kind"], added["class"]) == ("region", "Tumor")


@pytest.mark.db
def test_the_annotations_export_holds_the_consensus_layer(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    geojson = json.loads(exported(api, r, "annotations.geojson").text)
    assert geojson["type"] == "FeatureCollection"
    features = geojson["features"]
    assert len(features) == 2
    assert sorted(f["properties"]["parfocal"]["consensus"] for f in features) == [
        "added",
        "agree",
    ]
    assert all(f["properties"]["parfocal"]["path"].count("/") == 3 for f in features)
    document = json.loads(exported(api, r, "annotations.json").text)
    assert document["format"] == "parfocal-evaluation-annotations"
    ((slide),) = document["slides"]
    assert len(slide["objects"]) == 2
    assert {item["source_id"] for item in slide["objects"]} == {f["id"] for f in features}


@pytest.mark.db
def test_the_pdf_export_names_the_task_and_its_blocks(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    response = exported(api, r, "report.pdf")
    assert response.headers["content-type"] == "application/pdf"
    assert response.content.startswith(b"%PDF")
    text = text_of(response.content)
    for expected in (
        "Evaluation report",
        "Draft, not signed off",
        "Decisions",
        "Agree 3 Disagree 5",
    ):
        assert expected in text, (expected, text)
    assert exported(api, r, "report.pdf").content == response.content


@pytest.mark.db
def test_reviewers_cannot_export_the_evaluation(api: ApiAs, database: str) -> None:
    r = scenario(api, database)
    hidden = api(r.people["first"]).get(
        f"/api/review-tasks/{r.task}/evaluation/exports/objects.csv"
    )
    assert (hidden.status_code, hidden.json()["code"]) == (403, "evaluation-hidden")
    unknown = api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/evaluation/exports/x.txt")
    assert unknown.status_code == 422
