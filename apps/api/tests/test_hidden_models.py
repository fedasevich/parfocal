from typing import Any

import pytest
from db_support import ApiAs
from test_model_runs import Lab, make_lab, ok, problem, start
from workspace_support import owner

pytestmark = pytest.mark.db

HIDDEN = "/api/tenant/hidden-models"


def admin_lab(api: ApiAs, database: str) -> Lab:
    return make_lab(api, database, admins=("owner",))


def listed(api: ApiAs, lab: Lab, who: str = "reader") -> list[str]:
    models = ok(api(lab.people[who]).get(f"/api/projects/{lab.project}/models"))
    return [model["name"] for model in models]


def shown(api: ApiAs, lab: Lab, who: str = "reader") -> dict[str, bool]:
    return {row["name"]: row["shown"] for row in ok(api(lab.people[who]).get(HIDDEN))}


def run_with(detector: str) -> dict[str, Any]:
    return {"parameters": {"detector": {"name": detector}}}


def test_every_parfocal_model_is_shown_until_someone_hides_it(api: ApiAs, database: str) -> None:
    lab = admin_lab(api, database)
    assert shown(api, lab) == {"camelyon-tumor": True, "pathosam-hovernext": True, "hovernet": True}
    assert listed(api, lab) == ["camelyon-tumor", "pathosam-hovernext", "hovernet"]


def test_a_hidden_model_leaves_every_model_list_for_every_member(api: ApiAs, database: str) -> None:
    lab = admin_lab(api, database)
    hidden = ok(api(lab.people["owner"]).put(f"{HIDDEN}/camelyon-tumor"))
    assert hidden == {
        "name": "camelyon-tumor",
        "title": "CAMELYON tumor model",
        "shown": False,
        "hidden_by": str(lab.people["owner"].user_id),
    }
    for who in ("owner", "viewer", "reader"):
        assert listed(api, lab, who) == ["pathosam-hovernext", "hovernet"]
    assert shown(api, lab)["camelyon-tumor"] is False
    assert ok(api(lab.people["owner"]).put(f"{HIDDEN}/camelyon-tumor"))["shown"] is False


def test_undo_shows_the_model_again(api: ApiAs, database: str) -> None:
    lab = admin_lab(api, database)
    ok(api(lab.people["owner"]).put(f"{HIDDEN}/hovernet"))
    again = ok(api(lab.people["owner"]).delete(f"{HIDDEN}/hovernet"))
    assert again["shown"] is True
    assert "hovernet" in listed(api, lab)
    assert owner(
        database,
        "SELECT action, details::jsonb->>'model' FROM audit_events "
        f"WHERE tenant_id = '{lab.tenant}' AND action LIKE 'model.%' ORDER BY seq",
    ) == [("model.hidden", "hovernet"), ("model.shown", "hovernet")]


def test_the_result_sets_a_hidden_model_made_stay(api: ApiAs, database: str) -> None:
    lab = admin_lab(api, database)
    response = start(api, lab, **run_with("hovernet"))
    assert response.status_code == 201, response.text
    made = response.json()[0]["result_set_id"]
    sets = f"/api/slides/{lab.slides[0]}/result-sets"
    before = ok(api(lab.people["owner"]).get(sets))
    ok(api(lab.people["owner"]).put(f"{HIDDEN}/hovernet"))
    after = ok(api(lab.people["owner"]).get(sets))
    assert after == before
    assert made in {item["id"] for item in after}


def test_a_hidden_model_cannot_be_started(api: ApiAs, database: str) -> None:
    lab = admin_lab(api, database)
    ok(api(lab.people["owner"]).put(f"{HIDDEN}/hovernet"))
    assert problem(start(api, lab, **run_with("hovernet"))) == (400, "model-hidden")
    by_tier = start(api, lab, parameters={"tier": {"task": "outline", "tier": "good"}})
    assert problem(by_tier) == (400, "model-hidden")
    assert start(api, lab, **run_with("camelyon-tumor")).status_code == 201


def test_hiding_belongs_to_one_workspace(api: ApiAs, database: str) -> None:
    mine, theirs = admin_lab(api, database), admin_lab(api, database)
    ok(api(mine.people["owner"]).put(f"{HIDDEN}/hovernet"))
    assert "hovernet" in listed(api, theirs)
    assert shown(api, theirs)["hovernet"] is True


def test_only_admins_hide_and_only_parfocal_models(api: ApiAs, database: str) -> None:
    lab = admin_lab(api, database)
    for who in ("viewer", "reader"):
        assert api(lab.people[who]).put(f"{HIDDEN}/hovernet").status_code == 403
        assert api(lab.people[who]).delete(f"{HIDDEN}/hovernet").status_code == 403
    assert problem(api(lab.people["owner"]).put(f"{HIDDEN}/cellvit")) == (400, "model-not-found")
