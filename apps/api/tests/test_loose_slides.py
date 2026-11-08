import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from fixture_support import fixture_path
from test_result_uploads import REGIONS, SLIDE, choose_and_import, pick, upload_result
from upload_support import Lab, run_worker, send_file, start_upload, status_of
from workspace_support import make_case, owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

REASON = "Filed once the request form arrived"

DROP = [
    {"path": "intake/S26-07001/A1_HE.tiff", "size": 100},
    {"path": "intake/S26-07001/A1_HE.geojson"},
    {"path": "intake/tumor_031.tiff", "size": 100},
    {"path": "intake/stray_overlay.geojson"},
]


def upload_slide_into(
    api: ApiAs, lab: Lab, name: str, case_id: uuid.UUID | None = None
) -> dict[str, Any]:
    data = fixture_path(SLIDE).read_bytes()
    meta = {"case_id": str(case_id)} if case_id is not None else {}
    upload = start_upload(api, lab.lead, lab.project, name, len(data), **meta)
    send_file(api, lab.lead, upload, data)
    return upload


def slide_of(api: ApiAs, lab: Lab, upload: dict[str, Any]) -> str:
    state = status_of(api, lab.lead, upload)
    assert state["status"] == "ready", state
    return str(state["slide_id"])


def listed(api: ApiAs, lab: Lab) -> dict[str, tuple[Any, Any]]:
    response = api(lab.colleague).get("/api/me/slides", params={"project_id": str(lab.project)})
    assert response.status_code == 200, response.text
    return {row["id"]: (row["label"], row["case_label"]) for row in response.json()["slides"]}


def case_of(database: str, slide_id: str) -> Any:
    return owner(database, f"SELECT case_id FROM slides WHERE id = '{slide_id}'")[0][0]


def move(api: ApiAs, lab: Lab, slide_id: str, case_id: uuid.UUID) -> Any:
    return api(lab.lead).post(
        f"/api/slides/{slide_id}/move", json={"case_id": str(case_id), "reason": REASON}
    )


def test_a_slide_whose_name_names_no_case_stays_loose_in_the_project(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    sorting = api(lab.lead).post(
        "/api/uploads/sorting/apply",
        json={"project_id": str(lab.project), "files": [{"path": "tumor_031.tiff", "size": 9}]},
    )
    assert sorting.status_code == 200, sorting.text
    assert [(item["outcome"], item["case"]) for item in sorting.json()["slides"]] == [
        ("loose", None)
    ]
    assert sorting.json()["new_cases"] == []

    first = upload_slide_into(api, lab, "tumor_031.tiff")
    second = upload_slide_into(api, lab, "tumor_031.tiff")
    run_worker(database, lab.tenant_id, tmp_path / "work")

    one, two = slide_of(api, lab, first), slide_of(api, lab, second)
    assert case_of(database, one) is None
    assert case_of(database, two) is None
    assert listed(api, lab) == {one: ("tumor_031", None), two: ("tumor_031 (2)", None)}
    cases = api(lab.colleague).get("/api/cases", params={"project_id": str(lab.project)})
    assert cases.json() == []


def test_a_loose_slide_is_filed_into_a_case_later_with_its_results(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    upload = upload_slide_into(api, lab, "tumor_031.tiff")
    run_worker(database, lab.tenant_id, tmp_path / "work")
    slide_id = slide_of(api, lab, upload)
    result = upload_result(api, lab, "tumor_031.geojson", REGIONS, slide_id=slide_id)
    run_worker(database, lab.tenant_id, tmp_path / "work")
    choose_and_import(api, database, lab, result, tmp_path / "work")
    set_id = status_of(api, lab.lead, result)["result_set_id"]

    case_id = make_case(database, lab.tenant_id, lab.project, "S26-07002")
    taken = make_case(database, lab.tenant_id, lab.project, "S26-07003")
    owner(
        database,
        "INSERT INTO slides (tenant_id, project_id, case_id, label) "
        f"VALUES ('{lab.tenant_id}', '{lab.project}', '{taken}', 'tumor_031')",
    )
    clash = move(api, lab, slide_id, taken)
    assert (clash.status_code, clash.json()["code"]) == (409, "slide-label-taken")
    assert case_of(database, slide_id) is None
    filed = move(api, lab, slide_id, case_id)
    assert filed.status_code == 200, filed.text
    assert (filed.json()["from_case_id"], filed.json()["result_set_ids"]) == (None, [set_id])

    assert case_of(database, slide_id) == case_id
    assert listed(api, lab)[slide_id] == ("tumor_031", "S26-07002")
    detail = api(lab.colleague).get(f"/api/cases/{case_id}")
    assert [slide["id"] for slide in detail.json()["slides"]] == [slide_id]
    sets = api(lab.colleague).get(f"/api/slides/{slide_id}/result-sets").json()
    assert [item["id"] for item in sets] == [set_id]
    logged = owner(
        database,
        "SELECT target_id, details FROM audit_events "
        f"WHERE action = 'case.slide-moved' AND tenant_id = '{lab.tenant_id}'",
    )
    assert len(logged) == 1
    assert logged[0][0] == case_id
    details = json.loads(str(logged[0][1]))
    assert (details["from_case_id"], details["direction"], details["result_sets"]) == (
        None,
        "in",
        1,
    )


def test_an_upload_with_loose_and_unmatched_files_leaves_its_other_files_alone(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    applied = api(lab.lead).post(
        "/api/uploads/sorting/apply", json={"project_id": str(lab.project), "files": DROP}
    )
    assert applied.status_code == 200, applied.text
    body = applied.json()
    places = {item["path"]: (item["outcome"], item["case"]) for item in body["slides"]}
    case_id = uuid.UUID(places["intake/S26-07001/A1_HE.tiff"][1]["case_id"])
    assert places["intake/tumor_031.tiff"] == ("loose", None)
    outcomes = {item["path"]: item["outcome"] for item in body["results"]}
    assert outcomes == {
        "intake/S26-07001/A1_HE.geojson": "paired",
        "intake/stray_overlay.geojson": "unmatched",
    }

    cased = upload_slide_into(api, lab, "A1_HE.tiff", case_id)
    loose = upload_slide_into(api, lab, "tumor_031.tiff")
    paired = upload_result(
        api,
        lab,
        "A1_HE.geojson",
        REGIONS,
        slide_upload_id=cased["uploadId"],
        pairing_rule="next-to-slide",
        pairing_certainty="sure",
    )
    stray = upload_result(api, lab, "stray_overlay.geojson", REGIONS)
    run_worker(database, lab.tenant_id, tmp_path / "work")
    choose_and_import(api, database, lab, paired, tmp_path / "work")

    cased_slide, loose_slide = slide_of(api, lab, cased), slide_of(api, lab, loose)
    assert case_of(database, cased_slide) == case_id
    assert case_of(database, loose_slide) is None
    done = status_of(api, lab.lead, paired)
    assert (done["status"], done["slide_id"]) == ("ready", cased_slide)
    waiting = status_of(api, lab.lead, stray)
    assert (waiting["status"], waiting["reason"], waiting["slide_id"]) == (
        "waiting",
        "needs-slide",
        None,
    )
    assert listed(api, lab) == {
        cased_slide: ("A1_HE", "S26-07001"),
        loose_slide: ("tumor_031", None),
    }

    picked = pick(api, lab.lead, stray, slide_id=loose_slide)
    assert picked.status_code == 200, picked.text
    run_worker(database, lab.tenant_id, tmp_path / "work")
    choose_and_import(api, database, lab, stray, tmp_path / "work")
    filed = status_of(api, lab.lead, stray)
    assert (filed["status"], filed["slide_id"]) == ("ready", loose_slide)
    assert status_of(api, lab.lead, paired)["result_set_id"] == done["result_set_id"]
    assert case_of(database, loose_slide) is None
