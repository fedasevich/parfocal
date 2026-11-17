import pytest
from db_support import ApiAs
from test_study_templates import TEMPLATES, team, template

pytestmark = pytest.mark.db

DEFAULTS = f"{TEMPLATES}/review-defaults"


def test_each_template_gives_its_scope_decision_display_and_form(api: ApiAs, database: str) -> None:
    people = team(database)
    own_form = api(people["admin"]).post(TEMPLATES, json=template("Cells with a form"))
    assert own_form.status_code == 201, own_form.text
    presets = {
        "objects_to_check": {"kind": "cells-below-score", "score": 0.35},
        "decision": {
            "style": "certainty",
            "counts_as": ["disagree", "unsure", "unsure", "agree", "agree"],
        },
        "display": {"draw_as": "fill", "confidence": "colour", "buttons": "under-slide"},
    }
    plain = api(people["admin"]).post(TEMPLATES, json=template("Low scores", presets=presets))
    assert plain.status_code == 201, plain.text
    listed = api(people["researcher"]).get(DEFAULTS)
    assert listed.status_code == 200, listed.text
    body = listed.json()
    by_id = {item["template_id"]: item for item in body["templates"]}
    cells = by_id[own_form.json()["id"]]
    assert cells["scope_kinds"] == ["cells"]
    assert cells["scope_options"] == {"cells": 150, "low": 0.6, "rois": [], "unsure_zones": []}
    assert cells["decision"] == {"kind": "certainty5", "agree_from": 4, "disagree_to": 2}
    assert cells["display"]["colorBy"] == "class"
    assert cells["display"]["buttons"] == "right"
    forms = {form["key"]: form for form in body["opinion_forms"]}
    assert {"default", "reader", "outline"} <= set(forms)
    assert forms[cells["opinion_form"]]["questions"] == [
        {"label": "Fine?", "kind": "yesno", "required": False}
    ]
    low = by_id[plain.json()["id"]]
    assert low["scope_kinds"] == ["low"]
    assert low["scope_options"]["low"] == 0.35
    assert low["decision"] == {"kind": "certainty5", "agree_from": 4, "disagree_to": 1}
    assert low["opinion_form"] == "default"
    low_display = low["display"]
    assert (low_display["draw"], low_display["conf"], low_display["buttons"]) == (
        "fill",
        "color",
        "bottom",
    )
    assert api(people["reviewer"]).get(DEFAULTS).status_code == 403
