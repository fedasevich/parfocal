import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_model_runs import DETECTOR, Lab, make_lab, ok, problem, started
from workspace_support import owner

from parfocal_api.model_catalogue import CATALOGUE, PARFOCAL_SERVER

pytestmark = pytest.mark.db

MODELS = "/api/tenant/models"


@pytest.fixture
def lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database, admins=("owner",))


def as_owner(api: ApiAs, lab: Lab) -> Any:
    return api(lab.people["owner"])


def connect(database: str, lab: Lab) -> str:
    made = owner(
        database,
        "INSERT INTO lab_models (tenant_id, name, version, address, sign_in, secret_last_four, "
        "tile_size, magnification, taxonomy, class_map, who_can_run) VALUES "
        f"('{lab.tenant}', 'Lab fork', 'v2', 'https://models.lab.example/infer', 'token', "
        "'9a3f', 512, 40, 'sentinel-node', '[]', 'admins') RETURNING id",
    )[0][0]
    owner(
        database,
        "INSERT INTO lab_model_projects (lab_model_id, project_id, tenant_id) "
        f"VALUES ('{made}', '{lab.project}', '{lab.tenant}')",
    )
    return str(made)


def test_run_defaults_pick_slides_without_results_and_a_shown_model(api: ApiAs, lab: Lab) -> None:
    url = f"/api/projects/{lab.project}/model-runs/defaults"
    defaults = ok(as_owner(api, lab).get(url))
    assert defaults["slide_ids"] == [str(slide) for slide in lab.slides[1:]]
    assert defaults["model_id"] in {model.name for model in CATALOGUE}
    unknown = f"/api/projects/{uuid.uuid4()}/model-runs/defaults"
    assert problem(as_owner(api, lab).get(unknown))[0] == 404


def test_the_model_list_names_parfocal_and_lab_models_and_the_runs_going_on(
    api: ApiAs, database: str, lab: Lab
) -> None:
    connect(database, lab)
    started(api, lab)
    listed = ok(as_owner(api, lab).get(MODELS))
    parfocal = [model for model in listed["models"] if model["source"] == "parfocal"]
    assert [model["id"] for model in parfocal] == [model.name for model in CATALOGUE]
    assert {model["runs_on"] for model in parfocal} == {PARFOCAL_SERVER}
    labbed = [model for model in listed["models"] if model["source"] == "lab"]
    assert [(model["name"], model["runs_on"], model["who_can_run"]) for model in labbed] == [
        ("Lab fork", "models.lab.example", "admins")
    ]
    assert all(model["result_sets"] == 0 for model in labbed)
    assert [item["model"] for item in listed["running"]] == [DETECTOR["name"]]
    going = listed["running"][0]
    assert going["project"]["id"] == str(lab.project)
    assert going["project"]["code"].startswith("P")
    assert (going["slides"], going["slides_done"]) == (1, 0)
    assert going["started_by"] == str(lab.people["owner"].user_id)
    assert api(lab.people["reader"]).get(MODELS).status_code == 403


def test_the_lab_connection_prefills_from_the_latest_connected_model(
    api: ApiAs, database: str, lab: Lab
) -> None:
    url = f"{MODELS}/connection"
    missing = as_owner(api, lab).get(url)
    assert missing.status_code == 404, missing.text
    connect(database, lab)
    connection = ok(as_owner(api, lab).get(url))
    assert connection["address"] == "https://models.lab.example/infer"
    assert connection["host"] == "models.lab.example"
    assert (connection["sign_in"], connection["last_four"]) == ("token", "9a3f")
    assert (connection["tile_size"], connection["magnification"]) == (512, 40)
    assert connection["project_ids"] == [str(lab.project)]
    assert connection["test"]["outcome"] == "untested"
    assert connection["test"]["model"] == {"name": "Lab fork", "version": "v2"}
    assert api(lab.people["reader"]).get(url).status_code == 403
