import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from fixture_support import fixture_path
from upload_support import (
    Lab,
    exists,
    keys_under,
    run_worker,
    send_file,
    single,
    start_upload,
    status_of,
)
from workspace_support import (
    join_project,
    make_case,
    make_project,
    make_slide,
    make_workspace,
    owner,
    person,
)

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role
from parfocal_common.result_imports import result_set_id_for

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

RESULTS = (
    Path(__file__).resolve().parents[3] / "workers" / "ingest" / "tests" / "fixtures" / "results"
)
REGIONS = (RESULTS / "regions.geojson").read_bytes()
SLIDE = "synthetic-jpeg.tiff"


def parfocal_file(slide_id: uuid.UUID | None = None) -> bytes:
    square = [[[1000, 1000], [3000, 1000], [3000, 2500], [1000, 2500], [1000, 1000]]]
    document: dict[str, Any] = {
        "format": "parfocal-results",
        "version": 1,
        "model": {"name": "HoVer-NeXt", "version": "1.2", "run_at": "2026-10-01T09:00:00Z"},
        "classes": [{"name": "Tumor"}, {"name": "Stroma"}],
        "objects": [
            {
                "kind": "region",
                "class": "Tumor",
                "score": 0.94,
                "geometry": {"type": "Polygon", "coordinates": square},
            }
        ],
    }
    if slide_id is not None:
        document["slide"] = {"slide_id": str(slide_id)}
    return json.dumps(document).encode()


def upload_result(
    api: ApiAs, lab: Lab, name: str, data: bytes, *, send: bool = True, **meta: Any
) -> dict[str, Any]:
    upload = start_upload(api, lab.lead, lab.project, name, len(data), kind="result", **meta)
    if send:
        send_file(api, lab.lead, upload, data)
    return upload


def upload_slide(api: ApiAs, lab: Lab, name: str = "A1_HE.tiff") -> dict[str, Any]:
    data = fixture_path(SLIDE).read_bytes()
    upload = start_upload(api, lab.lead, lab.project, name, len(data))
    send_file(api, lab.lead, upload, data)
    return upload


def pick(api: ApiAs, who: MemberPrincipal, upload: dict[str, Any], **choice: str) -> Any:
    return api(who).put(f"/api/uploads/{upload['uploadId']}/slide", json=choice)


def result_set(api: ApiAs, who: MemberPrincipal, set_id: str) -> dict[str, Any]:
    response = api(who).get(f"/api/result-sets/{set_id}")
    assert response.status_code == 200, response.text
    return response.json()


def numbers(database: str, set_id: str) -> list[tuple[object, ...]]:
    return owner(
        database,
        "SELECT kind, number, class_index, score FROM result_objects "
        f"WHERE result_set_id = '{set_id}' ORDER BY kind, number",
    )


def test_a_result_uploaded_with_its_slide_is_imported_once_the_slide_is_ready(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_upload = upload_slide(api, lab)
    result = upload_result(
        api,
        lab,
        "A1_HE.geojson",
        REGIONS,
        slide_upload_id=slide_upload["uploadId"],
        pairing_rule="next-to-slide",
        pairing_certainty="sure",
    )
    before = status_of(api, lab.lead, result)
    assert (before["kind"], before["status"], before["reason"], before["job_id"]) == (
        "result",
        "waiting",
        "waiting-for-slide",
        None,
    )
    assert (before["slide_upload_id"], before["pairing_rule"], before["pairing_certainty"]) == (
        slide_upload["uploadId"],
        "next-to-slide",
        "sure",
    )

    run_worker(database, lab.tenant_id, tmp_path / "work")

    slide_id = status_of(api, lab.lead, slide_upload)["slide_id"]
    after = status_of(api, lab.lead, result)
    assert (after["status"], after["slide_id"], after["reason"]) == ("ready", slide_id, None)
    assert {notice["code"] for notice in after["notices"]} == {"objects-skipped"}
    set_id = after["result_set_id"]
    assert set_id == str(result_set_id_for(uuid.UUID(result["uploadId"])))
    detail = result_set(api, lab.colleague, set_id)
    assert (detail["slide_id"], detail["status"], detail["source"], detail["name"]) == (
        slide_id,
        "ready",
        "import",
        "GeoJSON import",
    )
    assert (detail["region_count"], detail["zone_count"], detail["cell_count"]) == (2, 1, 1)
    assert [(item["source_name"], item["object_count"]) for item in detail["classes"]] == [
        ("Tumor", 1),
        ("Stroma", 1),
        ("Lymphocyte", 1),
    ]
    assert numbers(database, set_id) == [
        ("region", 1, 0, 232),
        ("region", 2, 1, None),
        ("zone", 1, None, None),
    ]
    listed = api(lab.colleague).get(f"/api/slides/{slide_id}/result-sets").json()
    assert [item["id"] for item in listed] == [set_id]
    assert keys_under(f"t/{lab.tenant_id}/s/{slide_id}/results/{set_id}/") == {
        "source.geojson",
        "chunk-00000.pfc",
        "summary.pfc",
    }
    assert not exists(result["key"])
    assert keys_under(f"t/{lab.tenant_id}/quarantine/") == set()
    assert ("upload.completed",) in owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{result['uploadId']}'"
    )
    assert single(
        database, f"SELECT created_by_user_id FROM result_sets WHERE id = '{set_id}'"
    ) == (lab.lead.user_id,)


def test_a_result_paired_with_a_ready_slide_is_imported_at_once_and_keeps_ids(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "Biopsy")
    first = upload_result(api, lab, "Biopsy.geojson", REGIONS, slide_id=str(slide_id))
    assert status_of(api, lab.lead, first)["status"] == "processing"
    run_worker(database, lab.tenant_id, tmp_path / "work")
    second = upload_result(api, lab, "Biopsy.json", parfocal_file(), slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path / "work")

    one = status_of(api, lab.lead, first)
    two = status_of(api, lab.lead, second)
    assert (one["status"], two["status"], two["notices"]) == ("ready", "ready", [])
    assert (one["pairing_rule"], one["pairing_certainty"]) == ("picked", "sure")
    detail = result_set(api, lab.lead, two["result_set_id"])
    assert (detail["name"], detail["model_version"], detail["produced_at"]) == (
        "HoVer-NeXt",
        "1.2",
        "2026-10-01T09:00:00Z",
    )
    assert [item["source_name"] for item in detail["classes"]] == ["Tumor", "Stroma"]
    assert numbers(database, two["result_set_id"]) == [("region", 3, 0, 240)]
    assert single(
        database,
        f"SELECT last FROM slide_counters WHERE slide_id = '{slide_id}' AND letter = 'T'",
    ) == (3,)


def test_a_new_set_inherits_the_ids_of_the_objects_it_shares_with_an_older_set(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "Biopsy")
    first = upload_result(api, lab, "first.json", parfocal_file(), slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path / "work")
    second = upload_result(api, lab, "second.json", parfocal_file(), slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path / "work")
    sets = [status_of(api, lab.lead, upload)["result_set_id"] for upload in (first, second)]
    assert [numbers(database, set_id) for set_id in sets] == [[("region", 1, 0, 240)]] * 2


def test_an_unpaired_result_waits_until_a_person_picks_its_slide(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "Biopsy")
    result = upload_result(api, lab, "tumor_031_prob.geojson", REGIONS)
    waiting = status_of(api, lab.lead, result)
    assert (waiting["status"], waiting["reason"], waiting["slide_id"]) == (
        "waiting",
        "needs-slide",
        None,
    )
    assert waiting["message"]
    run_worker(database, lab.tenant_id, tmp_path / "work")
    assert status_of(api, lab.lead, result)["status"] == "waiting"
    assert pick(api, lab.colleague, result, slide_id=str(slide_id)).status_code == 404

    picked = pick(api, lab.lead, result, slide_id=str(slide_id))
    assert picked.status_code == 200, picked.text
    assert (picked.json()["status"], picked.json()["pairing_rule"]) == ("processing", "picked")
    run_worker(database, lab.tenant_id, tmp_path / "work")

    done = status_of(api, lab.lead, result)
    assert (done["status"], done["slide_id"]) == ("ready", str(slide_id))
    assert ("upload.paired",) in owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{result['uploadId']}'"
    )


def test_the_slide_of_a_result_can_change_before_it_is_sent(
    api: ApiAs, database: str, lab: Lab
) -> None:
    wrong = make_slide(database, lab.tenant_id, lab.project, "Wrong")
    right = upload_slide(api, lab, "Right.tiff")
    result = upload_result(api, lab, "Right.geojson", REGIONS, send=False, slide_id=str(wrong))
    changed = pick(api, lab.lead, result, slide_upload_id=right["uploadId"])
    assert changed.status_code == 200, changed.text
    state = changed.json()
    assert (state["status"], state["slide_id"], state["slide_upload_id"]) == (
        "uploading",
        None,
        right["uploadId"],
    )


def test_the_slide_cannot_change_once_the_result_is_imported(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "Biopsy")
    other = make_slide(database, lab.tenant_id, lab.project, "Other")
    result = upload_result(api, lab, "Biopsy.geojson", REGIONS, slide_id=str(slide_id))
    started = pick(api, lab.lead, result, slide_id=str(other))
    assert (started.status_code, started.json()["code"]) == (409, "result-import-started")
    run_worker(database, lab.tenant_id, tmp_path / "work")

    refused = pick(api, lab.lead, result, slide_id=str(other))
    assert (refused.status_code, refused.json()["code"]) == (409, "result-already-imported")
    state = status_of(api, lab.lead, result)
    assert (state["status"], state["slide_id"]) == ("ready", str(slide_id))


def test_a_slide_upload_cannot_be_paired(api: ApiAs, database: str, lab: Lab) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "Biopsy")
    upload = start_upload(api, lab.lead, lab.project, "A1.svs", 10)
    response = pick(api, lab.lead, upload, slide_id=str(slide_id))
    assert (response.status_code, response.json()["code"]) == (409, "not-a-result-upload")


@pytest.mark.parametrize(
    ("name", "data", "reason"),
    [
        ("broken.geojson", b'{"type": "FeatureCollection", "features": [', "result-unreadable"),
        (
            "cells-renamed.csv",
            (RESULTS / "cells-renamed.csv").read_bytes(),
            "result-columns-unmapped",
        ),
        ("empty.geojson", b'{"type": "FeatureCollection", "features": []}', "result-empty"),
    ],
)
def test_a_result_file_that_cannot_be_imported_fails_with_its_reason(
    api: ApiAs,
    database: str,
    lab: Lab,
    tmp_path: Path,
    name: str,
    data: bytes,
    reason: str,
) -> None:
    slide_id = make_slide(database, lab.tenant_id, lab.project, "Biopsy")
    result = upload_result(api, lab, name, data, slide_id=str(slide_id))
    run_worker(database, lab.tenant_id, tmp_path / "work")

    state = status_of(api, lab.lead, result)
    assert (state["status"], state["reason"], state["result_set_id"]) == ("failed", reason, None)
    assert state["message"]
    assert owner(database, f"SELECT id FROM result_sets WHERE slide_id = '{slide_id}'") == []
    assert not exists(result["key"])
    assert ("upload.refused",) in owner(
        database, f"SELECT action FROM audit_events WHERE target_id = '{result['uploadId']}'"
    )
    ended = pick(api, lab.lead, result, slide_id=str(slide_id))
    assert (ended.status_code, ended.json()["code"]) == (409, "result-import-ended")


def test_a_result_whose_slide_is_refused_asks_for_another_slide(
    api: ApiAs, database: str, lab: Lab, tmp_path: Path
) -> None:
    junk = b"not a slide at all"
    slide_upload = start_upload(api, lab.lead, lab.project, "A1.svs", len(junk))
    send_file(api, lab.lead, slide_upload, junk)
    result = upload_result(
        api, lab, "A1.geojson", REGIONS, slide_upload_id=slide_upload["uploadId"]
    )
    run_worker(database, lab.tenant_id, tmp_path / "work")

    assert status_of(api, lab.lead, slide_upload)["status"] == "failed"
    state = status_of(api, lab.lead, result)
    assert (state["status"], state["reason"]) == ("waiting", "slide-refused")
    other = make_slide(database, lab.tenant_id, lab.project, "Other")
    assert pick(api, lab.lead, result, slide_id=str(other)).status_code == 200
    run_worker(database, lab.tenant_id, tmp_path / "work")
    assert status_of(api, lab.lead, result)["status"] == "ready"


def test_a_result_upload_checks_its_slide_and_format(api: ApiAs, database: str, lab: Lab) -> None:
    def create(name: str, **meta: Any) -> Any:
        return api(lab.lead).post(
            "/api/uploads/s3/multipart",
            json={
                "filename": name,
                "metadata": {"project_id": str(lab.project), "size": 10, **meta},
            },
        )

    elsewhere = make_slide(
        database, lab.tenant_id, make_project(database, lab.tenant_id), "Elsewhere"
    )
    colleague_upload = start_upload(api, lab.colleague, lab.project, "B1.svs", 10)
    cases = [
        (create("A1.svs", slide_id=str(uuid.uuid4())), 422, None),
        (create("A1.geojson", kind="result", pairing_rule="file-name"), 422, None),
        (create("heat.png", kind="result"), 400, "result-format-unknown"),
        (create("A1.geojson", kind="result", slide_id=str(elsewhere)), 404, "slide-not-found"),
        (
            create("A1.geojson", kind="result", slide_upload_id=colleague_upload["uploadId"]),
            404,
            "slide-upload-not-found",
        ),
    ]
    for response, status, code in cases:
        assert response.status_code == status, response.text
        if code is not None:
            assert response.json()["code"] == code
    named = create("results.txt", kind="result", result_format="csv")
    assert named.status_code == 201, named.text
    sniffed = create("results.json", kind="result")
    assert sniffed.status_code == 201, sniffed.text
    assert owner(
        database,
        f"SELECT file_name, result_format FROM uploads WHERE project_id = '{lab.project}' "
        "AND kind = 'result' ORDER BY file_name",
    ) == [("results.json", None), ("results.txt", "csv")]


def test_dropped_files_pair_with_slides_in_the_drop_and_in_the_case(
    api: ApiAs, database: str, lab: Lab
) -> None:
    case = make_case(database, lab.tenant_id, lab.project, "S26-04812")
    in_case = make_slide(database, lab.tenant_id, lab.project, "B7_HE", case)
    elsewhere = make_slide(database, lab.tenant_id, lab.project, "Loose")
    files = [
        {"path": "S26-04812/A1_HE.svs"},
        {"path": "S26-04812/A1_HE.geojson"},
        {"path": "S26-04812/A2_HE.svs"},
        {"path": "S26-04812/A2_HE/cells.csv"},
        {"path": "results/B7_HE.geojson"},
        {"path": "results/run-9.json", "head": parfocal_file(in_case).decode()},
        {"path": "results/Loose.geojson"},
        {"path": "results/tumor_031_prob.png"},
        {"path": "notes.txt"},
    ]
    response = api(lab.lead).post(
        "/api/uploads/pairings",
        json={"project_id": str(lab.project), "case_id": str(case), "files": files},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["slides"] == ["S26-04812/A1_HE.svs", "S26-04812/A2_HE.svs"]
    assert body["others"] == ["notes.txt"]
    found = {
        item["path"]: (item["outcome"], item["slide"], item["rule"], item["certainty"])
        for item in body["results"]
    }
    assert found == {
        "S26-04812/A1_HE.geojson": (
            "paired",
            {"path": "S26-04812/A1_HE.svs", "slide_id": None},
            "next-to-slide",
            "sure",
        ),
        "S26-04812/A2_HE/cells.csv": (
            "paired",
            {"path": "S26-04812/A2_HE.svs", "slide_id": None},
            "folder-named-like-slide",
            "sure",
        ),
        "results/B7_HE.geojson": (
            "paired",
            {"path": None, "slide_id": str(in_case)},
            "file-name",
            "sure",
        ),
        "results/run-9.json": (
            "paired",
            {"path": None, "slide_id": str(in_case)},
            "embedded-id",
            "sure",
        ),
        "results/Loose.geojson": ("unmatched", None, None, None),
        "results/tumor_031_prob.png": ("unmatched", None, None, None),
    }
    whole_project = api(lab.lead).post(
        "/api/uploads/pairings",
        json={"project_id": str(lab.project), "files": [{"path": "Loose.geojson"}]},
    )
    [loose] = whole_project.json()["results"]
    assert loose["slide"] == {"path": None, "slide_id": str(elsewhere)}


def test_a_tie_comes_back_with_its_candidates(api: ApiAs, lab: Lab) -> None:
    response = api(lab.lead).post(
        "/api/uploads/pairings",
        json={
            "project_id": str(lab.project),
            "files": [{"path": "one/A1.svs"}, {"path": "two/A1.svs"}, {"path": "A1.geojson"}],
        },
    )
    [tie] = response.json()["results"]
    assert (tie["outcome"], tie["slide"], tie["rule"]) == ("tie", None, "file-name")
    assert [item["path"] for item in tie["candidates"]] == ["one/A1.svs", "two/A1.svs"]


def test_only_project_owners_pair_files(api: ApiAs, database: str, lab: Lab) -> None:
    body = {"project_id": str(lab.project), "files": [{"path": "A1.geojson"}]}
    stranger = make_workspace(database, {"stranger": Role.RESEARCHER}).people["stranger"]
    assert api(stranger).post("/api/uploads/pairings", json=body).status_code == 404
    viewer = person(database, lab.tenant_id, "viewer", Role.RESEARCHER)
    join_project(database, lab.project, viewer, "viewer")
    refused = api(viewer).post("/api/uploads/pairings", json=body)
    assert (refused.status_code, refused.json()["code"]) == (403, "uploading-not-allowed")
