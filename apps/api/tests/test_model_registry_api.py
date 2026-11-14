import pytest
from db_support import ApiAs
from test_model_runs import ok, problem
from workspace_support import make_workspace

from parfocal_api.model_catalogue import CATALOGUE
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

REGISTRY = "/api/model-registry"


def test_members_list_every_registered_model_with_its_licences(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, {"researcher": Role.RESEARCHER, "reader": Role.REVIEWER})
    for who in ("researcher", "reader"):
        models = ok(api(workspace.people[who]).get(REGISTRY))
        assert {(model["name"], model["version"]) for model in models} >= {
            (model.name, model.version) for model in CATALOGUE
        }
        for model in models:
            licence = model["licence"]
            assert licence["weights"]
            assert licence["weights_class"]
            assert licence["code"]
            assert licence["data"]
            assert all(dataset["licence"] for dataset in licence["data"])
            assert licence["enforced"] is False
            assert model["allowed_tenant_kinds"] == ["diagnostic", "research", "second-opinion"]


def test_one_registered_model_reads_with_every_field(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, {"researcher": Role.RESEARCHER})
    model = ok(api(workspace.people["researcher"]).get(f"{REGISTRY}/pathosam-hovernext/v1.2"))
    assert model["family"] == "pathosam-hovernext"
    assert model["tasks"] == ["detector", "typer"]
    assert model["makes"] == ["regions", "cells"]
    assert model["host"] == "parfocal"
    assert model["input_mpp"] == 0.25
    assert model["calibration_temperatures"] == {"1": 1.42, "8": 1.29}
    assert model["evaluation_report"] == "docs/results/2026-11-04-typer-calibration-registry.md"
    assert model["status"] == "candidate"
    assert model["licence"]["weights_class"] == "restricted"
    assert model["licence"]["policy_kinds"] == []
    assert [dataset["dataset"] for dataset in model["licence"]["data"]] == [
        "PanNuke",
        "Lizard",
        "MoNuSeg",
    ]


def test_an_unregistered_model_is_not_found(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, {"researcher": Role.RESEARCHER})
    caller = api(workspace.people["researcher"])
    assert problem(caller.get(f"{REGISTRY}/cellvit/v1")) == (404, "registered-model-not-found")
    assert problem(caller.get(f"{REGISTRY}/hovernet/v9.9")) == (404, "registered-model-not-found")


def test_a_non_commercial_model_is_allowed_in_every_tenant_kind_while_not_enforced(
    api: ApiAs, database: str
) -> None:
    workspace = make_workspace(database, {"researcher": Role.RESEARCHER})
    model = ok(api(workspace.people["researcher"]).get(f"{REGISTRY}/camelyon-tumor/v1.0"))
    assert model["licence"]["policy_kinds"] == []
    assert "diagnostic" in model["allowed_tenant_kinds"]
