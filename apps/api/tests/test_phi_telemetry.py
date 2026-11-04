import json
import logging
import re
import uuid
from collections.abc import Generator
from pathlib import Path
from urllib.parse import quote, quote_plus

import pytest
from db_support import ApiAs
from synthetic_people import SYNTHETIC_PATIENT_NAMES
from test_case_creation import create, draft, make_lab
from test_case_imports import HEADER

from parfocal_common.structured_logging import configure_logging

SEEDED = ("Eva Testová", "Jana Nováková", "Petr Novák", "Doomed Patient")
SEEDED_MRNS = ("MRN-TELEMETRY-1", "MRN-TELEMETRY-2", "MRN-TELEMETRY-3")


def forms(value: str) -> set[str]:
    return {value, quote(value), quote_plus(value), json.dumps(value)[1:-1]}


def leaks(text: str, values: tuple[str, ...]) -> list[str]:
    found: list[str] = []
    for value in values:
        for form in forms(value):
            if re.search(rf"(?<!\w){re.escape(form)}(?!\w)", text, re.IGNORECASE):
                found.append(form)
    return sorted(set(found))


@pytest.fixture
def exported(tmp_path: Path) -> Generator[Path]:
    path = tmp_path / "telemetry.jsonl"
    with path.open("w", encoding="utf-8") as stream:
        handler = configure_logging("api", "test", stream=stream, level=logging.DEBUG)
        try:
            yield path
        finally:
            logging.getLogger().removeHandler(handler)
            logging.getLogger().setLevel(logging.INFO)


def test_the_scan_finds_a_seeded_name_in_any_form() -> None:
    assert set(SEEDED) <= SYNTHETIC_PATIENT_NAMES
    assert leaks('"GET /api/search?q=Eva%20Testov%C3%A1"', SEEDED) == ["Eva%20Testov%C3%A1"]
    assert leaks('{"message": "Eva Testov\\u00e1"}', SEEDED) == ["Eva Testov\\u00e1"]
    assert leaks("evaluation of petr novák", SEEDED) == ["Petr Novák"]
    assert leaks("Novákov and Evangeline", SEEDED) == []


@pytest.mark.db
def test_patient_flows_leave_no_seeded_name_in_the_exported_logs(
    api: ApiAs, database: str, exported: Path
) -> None:
    lab = make_lab(database)
    researcher = lab.people["researcher"]
    body = draft(lab)
    body["patient"] |= {"name": SEEDED[0], "mrn": SEEDED_MRNS[0]}
    first = create(api, researcher, body)
    assert first.status_code == 201, first.text
    case_id = first.json()["id"]
    again = create(api, researcher, draft(lab, patient={"name": SEEDED[3], "mrn": SEEDED_MRNS[0]}))
    assert again.status_code >= 400
    too_long = create(api, researcher, draft(lab, patient={"name": SEEDED[3] * 40}))
    assert too_long.status_code >= 400
    as_researcher = api(researcher)
    assert as_researcher.get(f"/api/cases/{case_id}").status_code == 200
    assert as_researcher.get(f"/api/cases/{uuid.uuid4()}").status_code == 404
    for scope in ("patients", "all"):
        response = as_researcher.get("/api/search", params={"q": SEEDED[0], "scope": scope})
        assert response.status_code == 200, response.text
    rows = [
        HEADER,
        f"T-1,A1,T-1-1,H&E,{SEEDED[1]},{SEEDED_MRNS[1]},1970-01-02,female,55",
        f"T-2,A1,T-2-1,H&E,{SEEDED[2]},{SEEDED_MRNS[2]},1970-01-03,male,56",
        f"T-3,A1,T-3-1,H&E,{SEEDED[2]},{SEEDED_MRNS[1]},not-a-date,male,56",
    ]
    for dry_run in (True, False):
        response = as_researcher.post(
            f"/api/projects/{lab.clinical}/case-imports",
            json={"csv": "\n".join(rows) + "\n", "dry_run": dry_run},
        )
        assert response.status_code < 500, response.text
    text = exported.read_text(encoding="utf-8")
    routes = {json.loads(line).get("route") for line in text.splitlines()}
    assert {"/api/cases", "/api/cases/{case_id}", "/api/search"} <= routes
    assert leaks(text, SEEDED + SEEDED_MRNS) == []
