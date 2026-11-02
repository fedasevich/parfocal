import uuid
from typing import Any

import pytest
from db_support import ApiAs
from upload_support import Lab
from workspace_support import join_project, make_case, make_slide, owner, person

from parfocal_api.tables import Role

pytestmark = pytest.mark.db

DROP = [
    {"path": "P07-upload/S26-04812/A1_HE.svs", "size": 100},
    {"path": "P07-upload/S26-04812/A1_HE.geojson"},
    {"path": "P07-upload/S26-04813_B1_HE.svs", "size": 100},
    {"path": "P07-upload/tumor_031.tif", "size": 100},
    {"path": "P07-upload/results/tumor_031_prob.png"},
    {"path": "P07-upload/readme.txt"},
]


def sort(api: ApiAs, lab: Lab, route: str = "sorting", **body: Any) -> Any:
    return api(lab.lead).post(
        f"/api/uploads/{route}", json={"project_id": str(lab.project), "files": DROP, **body}
    )


def sorted_ok(api: ApiAs, lab: Lab, route: str = "sorting", **body: Any) -> dict[str, Any]:
    response = sort(api, lab, route, **body)
    assert response.status_code == 200, response.text
    return response.json()


def slides_of(body: dict[str, Any]) -> dict[str, tuple[Any, ...]]:
    return {
        item["path"].removeprefix("P07-upload/"): (
            item["outcome"],
            item["case"]["label"] if item["case"] else None,
            item["rule"],
        )
        for item in body["slides"]
    }


def results_of(body: dict[str, Any]) -> dict[str, tuple[Any, ...]]:
    return {
        item["path"].removeprefix("P07-upload/"): (item["outcome"], item["slide"], item["rule"])
        for item in body["results"]
    }


def case_rows(database: str, lab: Lab) -> list[tuple[Any, ...]]:
    return owner(
        database,
        f"SELECT label, source FROM cases WHERE project_id = '{lab.project}' ORDER BY label",
    )


def test_each_slide_gets_a_case_from_its_folder_or_name_or_stays_loose(
    api: ApiAs, database: str, lab: Lab
) -> None:
    existing = make_case(database, lab.tenant_id, lab.project, "S26-04813")
    body = sorted_ok(api, lab)
    assert slides_of(body) == {
        "S26-04812/A1_HE.svs": ("in-case", "S26-04812", "folder"),
        "S26-04813_B1_HE.svs": ("in-case", "S26-04813", "file-name"),
        "tumor_031.tif": ("loose", None, None),
    }
    assert [item["case"]["case_id"] for item in body["slides"] if item["case"]] == [
        None,
        str(existing),
    ]
    assert body["new_cases"] == ["S26-04812"]
    assert body["others"] == ["P07-upload/readme.txt"]
    assert results_of(body) == {
        "S26-04812/A1_HE.geojson": (
            "paired",
            {"path": "P07-upload/S26-04812/A1_HE.svs", "slide_id": None},
            "next-to-slide",
        ),
        "results/tumor_031_prob.png": (
            "paired",
            {"path": "P07-upload/tumor_031.tif", "slide_id": None},
            "file-name",
        ),
    }
    assert case_rows(database, lab) == [("S26-04813", "manual")]


def test_keeping_all_loose_puts_no_slide_in_a_case(api: ApiAs, lab: Lab) -> None:
    body = sorted_ok(api, lab, cases="loose")
    assert {outcome for outcome, _, _ in slides_of(body).values()} == {"loose"}
    assert body["new_cases"] == []


def test_every_decision_can_be_changed_before_applying(api: ApiAs, database: str, lab: Lab) -> None:
    project_slide = make_slide(database, lab.tenant_id, lab.project, "Elsewhere")
    body = sorted_ok(
        api,
        lab,
        slide_decisions=[
            {"path": "P07-upload/S26-04812/A1_HE.svs", "loose": True},
            {"path": "P07-upload/tumor_031.tif", "case": "S26-09999"},
            {"path": "P07-upload/S26-04813_B1_HE.svs", "keep": False},
        ],
        result_decisions=[
            {"path": "P07-upload/S26-04812/A1_HE.geojson", "slide_id": str(project_slide)},
            {"path": "P07-upload/results/tumor_031_prob.png"},
        ],
    )
    assert slides_of(body) == {
        "S26-04812/A1_HE.svs": ("loose", None, None),
        "S26-04813_B1_HE.svs": ("left-out", "S26-04813", "file-name"),
        "tumor_031.tif": ("in-case", "S26-09999", "picked"),
    }
    assert body["new_cases"] == ["S26-09999"]
    assert results_of(body) == {
        "S26-04812/A1_HE.geojson": (
            "paired",
            {"path": None, "slide_id": str(project_slide)},
            "picked",
        ),
        "results/tumor_031_prob.png": ("unmatched", None, None),
    }


def test_a_slide_the_project_already_has_is_left_out_and_its_results_go_to_it(
    api: ApiAs, database: str, lab: Lab
) -> None:
    case = make_case(database, lab.tenant_id, lab.project, "S26-04812")
    held = make_slide(database, lab.tenant_id, lab.project, "A1_HE", case)
    owner(database, f"UPDATE slides SET file_bytes = 100 WHERE id = '{held}'")
    make_slide(database, lab.tenant_id, lab.project, "tumor_031", case)
    body = sorted_ok(api, lab)
    duplicate = body["slides"][0]
    assert (duplicate["outcome"], duplicate["duplicate_of"]) == ("left-out", str(held))
    assert slides_of(body)["tumor_031.tif"] == ("loose", None, None)
    assert results_of(body)["S26-04812/A1_HE.geojson"] == (
        "paired",
        {"path": None, "slide_id": str(held)},
        "file-name",
    )
    kept = sorted_ok(
        api, lab, slide_decisions=[{"path": "P07-upload/S26-04812/A1_HE.svs", "keep": True}]
    )
    assert kept["slides"][0]["outcome"] == "in-case"
    owner(database, f"UPDATE slides SET file_bytes = 999 WHERE id = '{held}'")
    other_size = sorted_ok(api, lab)
    assert (other_size["slides"][0]["outcome"], other_size["slides"][0]["duplicate_of"]) == (
        "in-case",
        None,
    )


def test_applying_creates_the_cases_once_and_answers_their_ids(
    api: ApiAs, database: str, lab: Lab
) -> None:
    applied = sorted_ok(api, lab, "sorting/apply")
    assert applied["new_cases"] == ["S26-04812", "S26-04813"]
    assert case_rows(database, lab) == [("S26-04812", "upload"), ("S26-04813", "upload")]
    ids = {
        str(label): str(case_id)
        for label, case_id in owner(
            database, f"SELECT label, id::text FROM cases WHERE project_id = '{lab.project}'"
        )
    }
    assert {
        item["case"]["label"]: item["case"]["case_id"] for item in applied["slides"] if item["case"]
    } == ids
    audited = owner(
        database,
        "SELECT count(*) FROM audit_events WHERE action = 'case.created' "
        f"AND details::jsonb->>'source' = 'upload' AND tenant_id = '{lab.tenant_id}'",
    )
    assert audited == [(2,)]
    again = sorted_ok(api, lab, "sorting/apply")
    assert again["new_cases"] == []
    assert len(case_rows(database, lab)) == 2


def test_a_failed_apply_leaves_no_case_behind(api: ApiAs, database: str, lab: Lab) -> None:
    refused = sort(
        api,
        lab,
        "sorting/apply",
        result_decisions=[
            {"path": "P07-upload/S26-04812/A1_HE.geojson", "slide_id": str(uuid.uuid4())}
        ],
    )
    assert refused.status_code == 404, refused.text
    left_out_target = sort(
        api,
        lab,
        "sorting/apply",
        slide_decisions=[{"path": "P07-upload/tumor_031.tif", "keep": False}],
        result_decisions=[
            {
                "path": "P07-upload/results/tumor_031_prob.png",
                "slide_path": "P07-upload/tumor_031.tif",
            }
        ],
    )
    assert (left_out_target.status_code, left_out_target.json()["code"]) == (
        400,
        "not-a-dropped-slide",
    )
    assert case_rows(database, lab) == []
    assert owner(
        database,
        f"SELECT count(*) FROM audit_events WHERE tenant_id = '{lab.tenant_id}' "
        "AND action = 'case.created'",
    ) == [(0,)]


def test_decisions_must_name_dropped_files_and_real_cases(api: ApiAs, lab: Lab) -> None:
    unknown = sort(api, lab, slide_decisions=[{"path": "nowhere.svs", "loose": True}])
    assert (unknown.status_code, unknown.json()["code"]) == (400, "not-a-dropped-file")
    loose_mark = sort(api, lab, slide_decisions=[{"path": DROP[0]["path"], "case": "~"}])
    assert loose_mark.status_code == 422
    both = sort(api, lab, slide_decisions=[{"path": DROP[0]["path"], "case": "X", "loose": True}])
    assert both.status_code == 422


def test_only_project_owners_create_cases_by_sorting(api: ApiAs, database: str, lab: Lab) -> None:
    viewer = person(database, lab.tenant_id, "viewer", Role.RESEARCHER)
    join_project(database, lab.project, viewer, "viewer")
    body = {"project_id": str(lab.project), "files": DROP}
    refused = api(viewer).post("/api/uploads/sorting/apply", json=body)
    assert (refused.status_code, refused.json()["code"]) == (403, "uploading-not-allowed")
    assert case_rows(database, lab) == []
