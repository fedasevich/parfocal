from typing import Any

import pytest
from db_support import ApiAs
from test_job_progress import execute, throughput_rows, tiled_plan
from test_model_runs import claim, make_lab, ok, problem, start
from workspace_support import Workspace, make_workspace, owner

from parfocal_api.tables import Role

pytestmark = pytest.mark.db

TIERS = "/api/tenant/model-tiers"


def team(database: str) -> Workspace:
    return make_workspace(
        database, {"admin": Role.RESEARCHER, "reviewer": Role.REVIEWER}, admins={"admin"}
    )


def listed(api: ApiAs, workspace: Workspace, who: str = "reviewer") -> dict[tuple[str, str], Any]:
    rows = ok(api(workspace.people[who]).get(TIERS))
    return {(row["task"], row["tier"]): row for row in rows}


def test_every_task_has_three_tiers_with_catalogue_defaults(api: ApiAs, database: str) -> None:
    tiers = listed(api, team(database))
    assert len(tiers) == 9
    best = tiers[("outline", "best")]
    assert best["set_by_lab"] is False
    assert best["model"] == {
        "name": "pathosam-hovernext",
        "version": "v1.2",
        "title": "PathoSAM + HoVer-NeXt",
        "description": "Tumor regions and every cell with a type",
        "label": "PathoSAM + HoVer-NeXt · v1.2",
    }
    assert tiers[("outline", "good")]["model"]["label"] == "HoVer-Net · v0.9"
    assert tiers[("tumor", "best")]["model"]["name"] == "camelyon-tumor"
    assert [key for key, row in tiers.items() if row["model"] is None] == [
        ("tumor", "good"),
        ("tumor", "fast"),
        ("outline", "fast"),
        ("typer", "fast"),
    ]


def test_the_lab_maps_a_tier_and_every_member_sees_the_exact_model(
    api: ApiAs, database: str
) -> None:
    w = team(database)
    response = api(w.people["admin"]).put(f"{TIERS}/outline/fast", json={"name": "hovernet"})
    mapping = ok(response)
    assert mapping["set_by_lab"] is True
    assert (mapping["model"]["name"], mapping["model"]["version"]) == ("hovernet", "v0.9")
    seen = listed(api, w)[("outline", "fast")]
    assert seen == mapping
    assert seen["model"]["label"] == "HoVer-Net · v0.9"
    assert owner(
        database,
        "SELECT details::jsonb->>'model' FROM audit_events "
        f"WHERE tenant_id = '{w.tenant_id}' AND action = 'model-tier.set'",
    ) == [("hovernet@v0.9",)]


def test_a_reset_tier_goes_back_to_the_default(api: ApiAs, database: str) -> None:
    w = team(database)
    ok(
        api(w.people["admin"]).put(
            f"{TIERS}/outline/best", json={"name": "hovernet", "version": "v0.9"}
        )
    )
    assert listed(api, w)[("outline", "best")]["model"]["name"] == "hovernet"
    reset = ok(api(w.people["admin"]).delete(f"{TIERS}/outline/best"))
    assert (reset["set_by_lab"], reset["model"]["name"]) == (False, "pathosam-hovernext")
    assert listed(api, w)[("outline", "best")] == reset


def test_a_mapping_belongs_to_one_workspace(api: ApiAs, database: str) -> None:
    first, second = team(database), team(database)
    ok(api(first.people["admin"]).put(f"{TIERS}/typer/fast", json={"name": "hovernet"}))
    assert listed(api, first)[("typer", "fast")]["model"]["name"] == "hovernet"
    assert listed(api, second)[("typer", "fast")]["model"] is None


@pytest.mark.parametrize(
    ("path", "choice", "expected"),
    [
        ("tumor/best", {"name": "nobody"}, (400, "model-not-found")),
        ("outline/best", {"name": "hovernet", "version": "v9"}, (400, "model-not-found")),
        ("tumor/good", {"name": "hovernet"}, (400, "model-wrong-task")),
    ],
)
def test_a_mapping_must_name_a_listed_model_that_does_the_task(
    api: ApiAs, database: str, path: str, choice: dict[str, str], expected: tuple[int, str]
) -> None:
    w = team(database)
    assert problem(api(w.people["admin"]).put(f"{TIERS}/{path}", json=choice)) == expected


def test_only_admins_map_tiers(api: ApiAs, database: str) -> None:
    w = team(database)
    reviewer = api(w.people["reviewer"])
    assert reviewer.put(f"{TIERS}/outline/fast", json={"name": "hovernet"}).status_code == 403
    assert reviewer.delete(f"{TIERS}/outline/fast").status_code == 403
    assert (
        api(w.people["admin"]).put(f"{TIERS}/outline/slow", json={"name": "hovernet"}).status_code
        == 422
    )


def run_by_tier(task: str, tier: str) -> dict[str, Any]:
    return {"parameters": {"tier": {"task": task, "tier": tier}}}


def test_a_run_by_tier_records_the_exact_model_and_labels_its_stages(
    api: ApiAs, database: str
) -> None:
    lab = make_lab(api, database)
    response = start(api, lab, **run_by_tier("outline", "good"))
    assert response.status_code == 201, response.text
    run = response.json()[0]
    assert run["parameters"]["detector"] == {"name": "hovernet", "version": "v0.9"}
    assert run["parameters"]["tier"] == "good"
    execute(database, claim(database, lab, tiled_plan(2)), tier=None)
    assert {row.tier for row in throughput_rows(database, run)} == {"good"}
    assert {row.model_version for row in throughput_rows(database, run)} == {"v0.9"}


def test_a_run_by_an_unmapped_tier_or_with_two_detectors_is_refused(
    api: ApiAs, database: str
) -> None:
    lab = make_lab(api, database)
    assert problem(start(api, lab, **run_by_tier("outline", "fast"))) == (400, "tier-not-mapped")
    both = {"detector": {"name": "hovernet"}, "tier": {"task": "outline", "tier": "best"}}
    assert start(api, lab, parameters=both).status_code == 422
