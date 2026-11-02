import csv
import io
import uuid
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from upload_support import Lab, exists, run_worker, send_file, start_upload, status_of
from workspace_support import make_slide, owner

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

FIXTURES = Path(__file__).resolve().parents[3] / "workers" / "ingest" / "tests" / "fixtures"
CHECKS = FIXTURES / "checks"
HEATMAP = (FIXTURES / "results" / "heatmap-level2.tif").read_bytes()


def upload(api: ApiAs, lab: Lab, name: str, data: bytes, **meta: Any) -> dict[str, Any]:
    started = start_upload(api, lab.lead, lab.project, name, len(data), kind="result", **meta)
    send_file(api, lab.lead, started, data)
    return started


def fixture(name: str) -> bytes:
    return (CHECKS / name).read_bytes()


def sized_slide(database: str, lab: Lab, width: int = 4000, height: int = 3000) -> uuid.UUID:
    slide_id = make_slide(database, lab.tenant_id, lab.project, f"Biopsy {uuid.uuid4().hex[:6]}")
    owner(
        database,
        f"UPDATE slides SET width = {width}, height = {height}, level_count = 3, mpp_x = 0.25 "
        f"WHERE id = '{slide_id}' RETURNING id",
    )
    return slide_id


def project_classes(api: ApiAs, lab: Lab, *names: str) -> dict[str, str]:
    colours = ["#6EE7B7", "#f87171", "#c084fc", "#43999d"]
    rows = [
        {"key": key, "name": name, "colour": colours[key - 1]}
        for key, name in enumerate(names, start=1)
    ]
    response = api(lab.lead).put(f"/api/projects/{lab.project}/classes", json={"classes": rows})
    assert response.status_code == 200, response.text
    return {row["name"]: row["id"] for row in response.json()}


def problems(api: ApiAs, lab: Lab, started: dict[str, Any]) -> dict[str, Any]:
    response = api(lab.lead).get(f"/api/uploads/{started['uploadId']}/problems")
    assert response.status_code == 200, response.text
    return response.json()


def choose(api: ApiAs, lab: Lab, started: dict[str, Any], **choices: Any) -> Any:
    return api(lab.lead).put(f"/api/uploads/{started['uploadId']}/import-choices", json=choices)


def checked(
    api: ApiAs, database: str, lab: Lab, work: Path, name: str, data: bytes, **meta: Any
) -> tuple[dict[str, Any], dict[str, Any]]:
    started = upload(api, lab, name, data, **meta)
    run_worker(database, lab.tenant_id, work)
    state = status_of(api, lab.lead, started)
    assert (state["status"], state["reason"]) == ("waiting", "needs-choices"), state
    assert state["message"]
    return started, problems(api, lab, started)


def imported_classes(api: ApiAs, lab: Lab, started: dict[str, Any]) -> list[tuple[str, int]]:
    state = status_of(api, lab.lead, started)
    assert state["status"] == "ready", state
    detail = api(lab.lead).get(f"/api/result-sets/{state['result_set_id']}").json()
    return [(item["source_name"], item["object_count"]) for item in detail["classes"]]


def test_three_objects_without_a_class_wait_and_take_the_chosen_class(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    ids = project_classes(api, lab, "Tumor", "Stroma")
    slide_id = sized_slide(database, lab)
    started, found = checked(
        api,
        database,
        lab,
        tmp_path,
        "regions.geojson",
        fixture("objects-without-class.geojson"),
        slide_id=str(slide_id),
    )
    assert found["readable"] == 5
    assert [(item["code"], item["count"], item["places"]) for item in found["problems"]] == [
        ("objects-without-class", 3, ["feature 2", "feature 4", "feature 5"])
    ]
    assert found["problems"][0]["message"]
    assert owner(database, f"SELECT id FROM result_sets WHERE slide_id = '{slide_id}'") == []
    assert exists(started["key"])

    chosen = choose(api, lab, started, unclassified_class_id=ids["Stroma"])
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["status"] == "processing"
    again = choose(api, lab, started)
    assert (again.status_code, again.json()["code"]) == (409, "result-import-started")
    run_worker(database, lab.tenant_id, tmp_path)
    assert imported_classes(api, lab, started) == [("Tumor", 2), ("Stroma", 3)]


def test_a_class_outside_the_project_cannot_be_chosen(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    project_classes(api, lab, "Tumor")
    slide_id = sized_slide(database, lab)
    started, _ = checked(
        api,
        database,
        lab,
        tmp_path,
        "regions.geojson",
        fixture("objects-without-class.geojson"),
        slide_id=str(slide_id),
    )
    wrong = choose(api, lab, started, unclassified_class_id=str(uuid.uuid4()))
    assert (wrong.status_code, wrong.json()["code"]) == (400, "unknown-class")
    stranger = api(lab.colleague).put(f"/api/uploads/{started['uploadId']}/import-choices", json={})
    assert stranger.status_code == 404


def test_three_new_classes_are_mapped_once_and_remembered(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    ids = project_classes(api, lab, "Tumor", "Stroma")
    slide_id = sized_slide(database, lab)
    data = fixture("new-classes.csv")
    started, found = checked(
        api, database, lab, tmp_path, "cells.csv", data, slide_id=str(slide_id)
    )
    assert [(item["code"], item["count"], item["names"]) for item in found["problems"]] == [
        ("classes-unknown", 3, ["Mitosis", "Necrosis", "Ki67 positive"])
    ]
    mappings = [
        {"source_name": "Mitosis", "class_id": ids["Tumor"]},
        {"source_name": "Necrosis", "class_id": ids["Stroma"]},
        {"source_name": "Ki67 positive", "class_id": ids["Tumor"]},
    ]
    assert choose(api, lab, started, class_mappings=mappings).status_code == 200
    run_worker(database, lab.tenant_id, tmp_path)
    assert imported_classes(api, lab, started) == [("Tumor", 5), ("Stroma", 1)]
    remembered = api(lab.lead).get(f"/api/projects/{lab.project}/class-mappings").json()
    assert {item["source_name"] for item in remembered} == {"mitosis", "necrosis", "ki67 positive"}

    second = upload(api, lab, "cells-again.csv", data, slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path)
    assert imported_classes(api, lab, second) == [("Tumor", 5), ("Stroma", 1)]


def test_rows_without_a_score_count_as_the_chosen_default(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = sized_slide(database, lab)
    started, found = checked(
        api,
        database,
        lab,
        tmp_path,
        "scores.csv",
        fixture("rows-without-score.csv"),
        slide_id=str(slide_id),
    )
    assert [(item["code"], item["places"]) for item in found["problems"]] == [
        ("scores-missing", ["row 3", "row 5", "row 7"])
    ]
    wrong = choose(api, lab, started, score_default="half")
    assert wrong.status_code == 422
    assert choose(api, lab, started, score_default="one").status_code == 200
    run_worker(database, lab.tenant_id, tmp_path)
    assert status_of(api, lab.lead, started)["status"] == "ready"
    assert owner(
        database, f"SELECT import_choices FROM uploads WHERE id = '{started['uploadId']}'"
    ) == [({"score_default": "one", "unclassified_class_id": None},)]


def test_unreadable_rows_are_in_the_error_report_and_the_others_import(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = sized_slide(database, lab)
    started, found = checked(
        api,
        database,
        lab,
        tmp_path,
        "rows.csv",
        fixture("unreadable-rows.csv"),
        slide_id=str(slide_id),
    )
    assert found["readable"] == 3
    report = api(lab.lead).get(f"/api/uploads/{started['uploadId']}/problems/report")
    assert report.status_code == 200
    assert report.headers["content-type"].startswith("text/csv")
    assert "attachment" in report.headers["content-disposition"]
    rows = list(csv.reader(io.StringIO(report.text)))
    assert {row[0] for row in rows[1:]} == {started["uploadId"]}
    assert [row[1:3] for row in rows] == [
        ["problem", "place"],
        ["objects-unreadable", "row 3"],
        ["objects-unreadable", "row 5"],
    ]
    assert choose(api, lab, started).status_code == 200
    run_worker(database, lab.tenant_id, tmp_path)
    state = status_of(api, lab.lead, started)
    assert state["status"] == "ready"
    assert [notice["code"] for notice in state["notices"]] == ["objects-skipped"]


def test_a_heatmap_at_level_2_scaled_by_4_reports_the_guess(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = sized_slide(database, lab, width=128, height=128)
    started, found = checked(
        api, database, lab, tmp_path, "heat.tif", HEATMAP, slide_id=str(slide_id)
    )
    assert status_of(api, lab.lead, started)["result_format"] == "heatmap"
    assert [(item["code"], item["guess"]) for item in found["problems"]] == [
        ("heatmap-scale", {"level": 2, "downsample": 4.0, "mpp": 1.0})
    ]
    assert choose(api, lab, started).status_code == 200
    run_worker(database, lab.tenant_id, tmp_path)
    state = status_of(api, lab.lead, started)
    assert (state["status"], state["reason"]) == ("failed", "result-heatmap-not-stored")


def test_a_heatmap_without_a_slide_is_cleared_by_choosing_one_or_leaving_it_out(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = sized_slide(database, lab, width=128, height=128)
    left = upload(api, lab, "heat-left.tif", HEATMAP)
    placed = upload(api, lab, "heat-placed.tif", HEATMAP)
    for started in (left, placed):
        assert status_of(api, lab.lead, started)["reason"] == "needs-slide"

    gone = api(lab.lead).post(f"/api/uploads/{left['uploadId']}/leave-out")
    assert gone.status_code == 200, gone.text
    assert (gone.json()["status"], gone.json()["reason"]) == ("failed", "upload-aborted")
    assert not exists(left["key"])
    twice = api(lab.lead).post(f"/api/uploads/{left['uploadId']}/leave-out")
    assert (twice.status_code, twice.json()["code"]) == (409, "result-import-ended")

    picked = api(lab.lead).put(
        f"/api/uploads/{placed['uploadId']}/slide", json={"slide_id": str(slide_id)}
    )
    assert picked.status_code == 200, picked.text
    run_worker(database, lab.tenant_id, tmp_path)
    assert status_of(api, lab.lead, placed)["reason"] == "needs-choices"
    out = api(lab.lead).post(f"/api/uploads/{placed['uploadId']}/leave-out")
    assert out.status_code == 200, out.text
    assert out.json()["status"] == "failed"


def test_a_file_outside_its_slide_changes_nothing_and_says_so(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = sized_slide(database, lab)
    started = upload(
        api, lab, "far.geojson", fixture("outside-slide.geojson"), slide_id=str(slide_id)
    )
    run_worker(database, lab.tenant_id, tmp_path)
    state = status_of(api, lab.lead, started)
    assert (state["status"], state["reason"]) == ("failed", "result-outside-slide")
    assert state["message"]
    assert owner(database, f"SELECT id FROM result_sets WHERE slide_id = '{slide_id}'") == []
    assert owner(database, f"SELECT last FROM slide_counters WHERE slide_id = '{slide_id}'") == []
    assert not exists(started["key"])
    nothing = choose(api, lab, started)
    assert (nothing.status_code, nothing.json()["code"]) == (409, "result-import-ended")


def test_a_clean_file_imports_without_asking(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = sized_slide(database, lab)
    data = b"x,y,class,score\n100,100,Tumor,0.9\n200,200,Tumor,0.8\n"
    started = upload(api, lab, "clean.csv", data, slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path)
    assert status_of(api, lab.lead, started)["status"] == "ready"
    assert problems(api, lab, started) == {
        "upload_id": started["uploadId"],
        "readable": None,
        "problems": [],
    }
    nothing = choose(api, lab, started)
    assert (nothing.status_code, nothing.json()["code"]) == (409, "result-already-imported")
