import uuid
from typing import Any

import pytest
from db_support import ApiAs
from test_model_runs import ok, problem
from workspace_support import make_workspace, owner

from parfocal_api.model_catalogue import CATALOGUE
from parfocal_api.model_registry import PARTS
from parfocal_api.principals import PlatformOperator
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

REGISTRY = "/api/model-registry"
PLATFORM = "/api/platform/model-registry"
OPERATOR = PlatformOperator("registry-operator")


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


def draft(name: str, **change: Any) -> dict[str, Any]:
    return {
        "name": name,
        "version": "v1",
        "family": "open-detector",
        "title": "Open detector",
        "tasks": ["detector"],
        "makes": ["cells"],
        "host": "parfocal",
        "licence": {
            "weights": "Apache-2.0",
            "weights_class": "permitted",
            "code": "MIT",
            "data": [{"dataset": "TNBC", "licence": "CC BY 4.0", "licence_class": "permitted"}],
            "source": "docs/adr/0042-model-licensing-policy.md",
            "read_on": "2026-11-15",
        },
        "allowed_tenant_kinds": ["diagnostic", "research", "second-opinion"],
        "input_mpp": 0.5,
        **change,
    }


def test_an_operator_registers_a_model_at_run_time_and_members_read_it_back(
    api: ApiAs, database: str
) -> None:
    workspace = make_workspace(database, {"researcher": Role.RESEARCHER})
    name = f"open-detector-{uuid.uuid4().hex[:8]}"
    created = api(OPERATOR).post(PLATFORM, json=draft(name))
    assert created.status_code == 201, created.text
    model = ok(api(workspace.people["researcher"]).get(f"{REGISTRY}/{name}/v1"))
    assert model == created.json()
    assert model["status"] == "candidate"
    assert model["licence"]["weights"] == "Apache-2.0"
    assert model["licence"]["data"] == draft(name)["licence"]["data"]
    assert model["licence"]["read_on"] == "2026-11-15"
    assert model["licence"]["policy_kinds"] == ["diagnostic", "research", "second-opinion"]
    listed = ok(api(workspace.people["researcher"]).get(REGISTRY))
    assert (name, "v1") in {(entry["name"], entry["version"]) for entry in listed}
    [(action,)] = owner(
        database, f"SELECT action FROM audit_events WHERE details::text LIKE '%{name}%'"
    )
    assert action == "model.registered"


def test_a_model_registers_once_and_only_by_an_operator(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, {"admin": Role.RESEARCHER})
    name = f"once-{uuid.uuid4().hex[:8]}"
    assert api(workspace.people["admin"]).post(PLATFORM, json=draft(name)).status_code == 403
    assert api(OPERATOR).post(PLATFORM, json=draft(name)).status_code == 201
    assert problem(api(OPERATOR).post(PLATFORM, json=draft(name))) == (
        409,
        "registered-model-exists",
    )


@pytest.mark.parametrize(
    "change",
    [
        {"makes": []},
        {"part_of": {"name": "no-such-model", "version": "v1"}},
        {"calibration_temperatures": {"1": 1.2}},
    ],
)
def test_an_inconsistent_registration_is_refused(
    api: ApiAs, database: str, change: dict[str, Any]
) -> None:
    name = f"refused-{uuid.uuid4().hex[:8]}"
    assert problem(api(OPERATOR).post(PLATFORM, json=draft(name, **change))) == (
        400,
        "registration-refused",
    )


def test_a_blank_licence_field_is_refused(api: ApiAs, database: str) -> None:
    body = draft(f"blank-{uuid.uuid4().hex[:8]}")
    body["licence"]["code"] = " "
    assert api(OPERATOR).post(PLATFORM, json=body).status_code == 422


def test_every_part_of_the_line_up_reads_back_with_its_version(api: ApiAs, database: str) -> None:
    workspace = make_workspace(database, {"researcher": Role.RESEARCHER})
    caller = api(workspace.people["researcher"])
    for part in PARTS:
        entry = ok(caller.get(f"{REGISTRY}/{part.name}/{part.version}"))
        assert entry["version"] == part.version
        assert entry["part_of"] == {"name": "pathosam-hovernext", "version": "v1.2"}
        assert entry["licence"]["data"]
    encoder = ok(caller.get(f"{REGISTRY}/pathosam-vit-l-encoder/v1.2"))
    assert (encoder["tasks"], encoder["makes"]) == (["interactive-encoder"], [])


def test_a_part_of_a_run_time_model_registers_after_it(api: ApiAs, database: str) -> None:
    parent = f"parent-{uuid.uuid4().hex[:8]}"
    api(OPERATOR).post(PLATFORM, json=draft(parent))
    piece = draft(
        f"{parent}-encoder",
        tasks=["interactive-encoder"],
        makes=[],
        part_of={"name": parent, "version": "v1"},
    )
    assert ok(api(OPERATOR).post(PLATFORM, json=piece))["part_of"] == {
        "name": parent,
        "version": "v1",
    }
