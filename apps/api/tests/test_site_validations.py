from typing import Any

import pytest
from db_support import ApiAs
from workspace_support import Workspace, make_workspace, owner

from parfocal_api.tables import Role

pytestmark = pytest.mark.db

POSITIVE_SCORES = (0.9, 0.8, 0.7, 0.3)
NEGATIVE_SCORES = (0.1, 0.2, 0.6, 0.05, 0.4, 0.45)
SEEDED = [{"positive": True, "score": score} for score in POSITIVE_SCORES] + [
    {"positive": False, "score": score} for score in NEGATIVE_SCORES
]


def team(database: str) -> Workspace:
    return make_workspace(
        database,
        {"researcher": Role.RESEARCHER, "reviewer": Role.REVIEWER, "admin": Role.RESEARCHER},
        admins={"admin"},
    )


def run(**overrides: Any) -> dict[str, Any]:
    return {
        "model_name": "tumour-detector",
        "model_version": "2.1",
        "specimen_type": "breast core biopsy",
        "items": SEEDED,
        **overrides,
    }


def test_a_validation_on_seeded_results_reports_sensitivity_and_specificity(
    api: ApiAs, database: str
) -> None:
    w = team(database)
    response = api(w.people["admin"]).post("/api/site-validations", json=run())
    assert response.status_code == 201, response.text
    report = response.json()
    assert (
        report["cases"],
        report["true_positives"],
        report["false_negatives"],
        report["true_negatives"],
        report["false_positives"],
    ) == (10, 3, 1, 5, 1)
    sensitivity, specificity = report["sensitivity"], report["specificity"]
    assert (sensitivity["numerator"], sensitivity["denominator"]) == (3, 4)
    assert sensitivity["value"] == pytest.approx(0.75)
    assert (sensitivity["low"], sensitivity["high"]) == pytest.approx((0.3006, 0.9544), abs=1e-4)
    assert (specificity["numerator"], specificity["denominator"]) == (5, 6)
    assert specificity["value"] == pytest.approx(5 / 6)
    assert (specificity["low"], specificity["high"]) == pytest.approx((0.4365, 0.9699), abs=1e-4)
    listed = api(w.people["reviewer"]).get("/api/site-validations")
    assert listed.status_code == 200, listed.text
    assert [entry["id"] for entry in listed.json()] == [report["id"]]
    assert owner(
        database,
        "SELECT details::jsonb->>'cases' FROM audit_events "
        f"WHERE target_id = '{report['id']}' AND action = 'site-validation.recorded'",
    ) == [("10",)]


def test_the_threshold_decides_which_scores_count_as_positive(api: ApiAs, database: str) -> None:
    w = team(database)
    response = api(w.people["admin"]).post("/api/site-validations", json=run(threshold=0.25))
    assert response.status_code == 201, response.text
    report = response.json()
    assert (report["sensitivity"]["numerator"], report["specificity"]["numerator"]) == (4, 3)


def test_the_validation_is_announced_in_every_members_home_feed(api: ApiAs, database: str) -> None:
    w = team(database)
    report = api(w.people["admin"]).post("/api/site-validations", json=run()).json()
    expected = (
        "tumour-detector 2.1 was validated on 10 local breast core biopsy cases: "
        "sensitivity 75%, specificity 83%"
    )
    for who in ("researcher", "reviewer", "admin"):
        home = api(w.people[who]).get("/api/me/home")
        assert home.status_code == 200, home.text
        feed = home.json()["announcements"]
        assert [(entry["kind"], entry["text"]) for entry in feed] == [("model", expected)]
        assert feed[0]["id"] == report["announcement_id"]


def test_validations_are_checked_and_only_admins_record_them(api: ApiAs, database: str) -> None:
    w = team(database)
    admin = api(w.people["admin"])
    only_positive = run(items=[{"positive": True, "score": 0.9}, {"positive": True, "score": 0.1}])
    refused = admin.post("/api/site-validations", json=only_positive)
    assert refused.status_code == 400, refused.text
    assert refused.json()["code"] == "validation-needs-both-outcomes"
    for bad in (
        run(threshold=1.5),
        run(items=[{"positive": True, "score": 1.2}, {"positive": False, "score": 0.1}]),
        run(items=[{"positive": "yes", "score": 0.9}, {"positive": False, "score": 0.1}]),
        run(model_name="bad name"),
        run(specimen_type="  "),
    ):
        assert admin.post("/api/site-validations", json=bad).status_code == 422
    researcher = api(w.people["researcher"]).post("/api/site-validations", json=run())
    assert researcher.status_code == 403, researcher.text
    for table in ("site_validations", "announcements"):
        assert owner(
            database, f"SELECT count(*) FROM {table} WHERE tenant_id = '{w.tenant_id}'"
        ) == [(0,)]
