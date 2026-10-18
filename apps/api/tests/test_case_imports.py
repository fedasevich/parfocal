import uuid
from dataclasses import dataclass
from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

HEADER = "case,slide,barcode,stain,patient_name,mrn,birth_date,sex,age_years"


@dataclass(frozen=True)
class Lab:
    people: dict[str, MemberPrincipal]
    clinical: uuid.UUID
    de_identified: uuid.UUID


def lab(database: str) -> Lab:
    workspace = make_workspace(
        database, {"owner": Role.RESEARCHER, "viewer": Role.RESEARCHER, "outsider": Role.RESEARCHER}
    )
    clinical = make_project(database, workspace.tenant_id, "clinical")
    de_identified = make_project(database, workspace.tenant_id, "de-identified")
    for project in (clinical, de_identified):
        join_project(database, project, workspace.people["owner"], "owner")
        join_project(database, project, workspace.people["viewer"], "viewer")
    return Lab(workspace.people, clinical, de_identified)


def five_hundred_rows(tag: str) -> str:
    lines = [HEADER]
    for case in range(100):
        for slide in range(5):
            lines.append(
                f"S26-{tag}-{case:03d},A{slide + 1},{tag}-{case:03d}-{slide},H&E,"
                f"Patient {case},MRN-{tag}-{case:03d},1970-01-{case % 28 + 1:02d},female,55"
            )
    return "\n".join(lines) + "\n"


def send(
    api: ApiAs, lab: Lab, project: uuid.UUID, text: str, *, dry_run: bool, who: str = "owner"
) -> Any:
    return api(lab.people[who]).post(
        f"/api/projects/{project}/case-imports", json={"csv": text, "dry_run": dry_run}
    )


def counts(database: str, project: uuid.UUID) -> tuple[int, int, int]:
    rows = owner(
        database,
        f"SELECT (SELECT count(*) FROM cases WHERE project_id = '{project}'), "
        f"(SELECT count(*) FROM patients WHERE project_id = '{project}'), "
        f"(SELECT count(*) FROM slides WHERE project_id = '{project}')",
    )
    first, second, third = (int(str(value)) for value in rows[0])
    return first, second, third


def summary(report: dict[str, Any]) -> tuple[int, ...]:
    return (
        report["cases_created"],
        report["cases_existing"],
        report["patients_created"],
        report["slides_created"],
        report["slides_existing"],
    )


def test_a_500_row_file_imports_twice_without_duplicates(api: ApiAs, database: str) -> None:
    lab_ = lab(database)
    text = five_hundred_rows(uuid.uuid4().hex[:4])
    dry = send(api, lab_, lab_.clinical, text, dry_run=True)
    assert dry.status_code == 200, dry.text
    assert (dry.json()["rows"], summary(dry.json())) == (500, (100, 0, 100, 500, 0))
    assert counts(database, lab_.clinical) == (0, 0, 0)
    first = send(api, lab_, lab_.clinical, text, dry_run=False).json()
    assert (first["imported"], first["problems"]) == (True, [])
    assert summary(first) == (100, 0, 100, 500, 0)
    again = send(api, lab_, lab_.clinical, text, dry_run=False).json()
    assert summary(again) == (0, 100, 0, 0, 500)
    assert counts(database, lab_.clinical) == (100, 100, 500)
    sources = owner(
        database, f"SELECT DISTINCT source FROM cases WHERE project_id = '{lab_.clinical}'"
    )
    assert sources == [("import",)]


def test_a_re_run_adds_only_new_slides_and_reuses_patients_by_mrn(
    api: ApiAs, database: str
) -> None:
    lab_ = lab(database)
    tag = uuid.uuid4().hex[:4]
    first = f"{HEADER}\nC-{tag},A1,,H&E,Ann Smith,M-{tag},,,\n"
    second = (
        f"{HEADER}\nC-{tag},A1,,H&E,Ann Smith,M-{tag},,,\n"
        f"C-{tag},A2,,,,,,,\nD-{tag},B1,,,Ann Smith,M-{tag},,,\n"
    )
    send(api, lab_, lab_.clinical, first, dry_run=False)
    report = send(api, lab_, lab_.clinical, second, dry_run=False).json()
    assert summary(report) == (1, 1, 0, 2, 1)
    assert counts(database, lab_.clinical) == (2, 1, 3)


PROBLEMS = (
    f"{HEADER},colour\n"
    ",A1,,,,,,,,\n"
    "~,A1,,,,,,,,\n"
    "C1,A1,BC-1,,Ann,M1,1970-13-01,female,55,\n"
    "C1,A1,,,,,,,,\n"
    "C1,A2,BC-1,,Ann,M1,,robot,old,\n"
    "C1,A3,,,Bob,M2,,,,\n"
    "C2,B1,,,,M3,,,,\n"
)


def test_problems_are_named_by_row_and_nothing_is_written(api: ApiAs, database: str) -> None:
    lab_ = lab(database)
    report = send(api, lab_, lab_.clinical, PROBLEMS, dry_run=False).json()
    assert report["imported"] is False
    assert [(p["row"], p["column"]) for p in report["problems"]] == [
        (1, None),
        (2, "case"),
        (3, "case"),
        (4, "birth_date"),
        (5, "slide"),
        (6, "age_years"),
        (6, "barcode"),
        (6, "patient_name"),
        (6, "sex"),
        (7, "patient_name"),
        (8, "patient_name"),
    ]
    assert counts(database, lab_.clinical) == (0, 0, 0)


def test_a_de_identified_project_takes_no_patient_fields(api: ApiAs, database: str) -> None:
    lab_ = lab(database)
    text = f"{HEADER}\nC1,A1,,,Ann,,,,\nC2,B1,,,,,,,\n"
    report = send(api, lab_, lab_.de_identified, text, dry_run=False).json()
    assert [(p["row"], p["message"]) for p in report["problems"]] == [
        (2, "This project is de-identified and takes no patient fields")
    ]
    plain = send(api, lab_, lab_.de_identified, "case,slide\nC2,B1\nC2,B2\n", dry_run=False)
    assert summary(plain.json()) == (1, 0, 0, 2, 0)


def test_existing_cases_and_barcodes_are_checked(api: ApiAs, database: str) -> None:
    lab_ = lab(database)
    send(api, lab_, lab_.clinical, f"{HEADER}\nC1,A1,BC-9,,Ann,M1,,,\n", dry_run=False)
    clash = send(
        api,
        lab_,
        lab_.clinical,
        f"{HEADER}\nC1,A1,BC-9,,Bob,M2,,,\nC2,B1,BC-9,,,,,,\n",
        dry_run=True,
    ).json()
    assert [(p["row"], p["column"], p["message"]) for p in clash["problems"]] == [
        (2, "mrn", "The case already belongs to another patient"),
        (3, "barcode", "The barcode is used on row 2"),
        (3, "barcode", "Another slide has this barcode"),
    ]


def test_only_project_owners_import(api: ApiAs, database: str) -> None:
    lab_ = lab(database)
    text = "case\nC1\n"
    viewer = send(api, lab_, lab_.clinical, text, dry_run=True, who="viewer")
    assert (viewer.status_code, viewer.json()["code"]) == (403, "project-owners-only")
    assert send(api, lab_, lab_.clinical, text, dry_run=True, who="outsider").status_code == 404
    bad = send(api, lab_, lab_.clinical, "slide,barcode\nA1,x\n", dry_run=True)
    assert (bad.status_code, bad.json()["code"]) == (400, "not-a-csv")
