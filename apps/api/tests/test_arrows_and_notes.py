from typing import Any

import pytest
from db_support import ApiAs
from test_annotate_import import bring
from test_annotate_layer import read, shared_layer
from test_blinding import ok, study
from test_result_sets import lab
from test_study_templates import TEMPLATES, team, template
from test_threads import start

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

ARROW = {"type": "LineString", "coordinates": [[0, 0], [30, 30]]}
SPOT = {"type": "Point", "coordinates": [12, 8]}
WORDS = "Mitosis near the margin"
NOTE: dict[str, Any] = {"kind": "text", "geometry": SPOT, "text": WORDS}


def test_a_thread_attaches_to_an_arrow_and_a_note(api: ApiAs, database: str) -> None:
    s = study(api, database, blinded=False, hidden=False)
    drawn = [
        ok(api(s.people["owner"]).post(f"/api/slides/{s.slide}/annotations", json=body)).json()
        for body in ({"kind": "arrow", "geometry": ARROW}, NOTE)
    ]
    codes = [item["code"] for item in drawn]
    assert codes == ["A1", "N1"]
    anchored = [
        ok(start(api, s, "first", {"kind": "object", "object_id": code.lower()})).json()
        for code in codes
    ]
    assert [thread["anchor"]["object_id"] for thread in anchored] == codes
    for missing in ("A2", "N2"):
        refused = start(api, s, "first", {"kind": "object", "object_id": missing})
        assert refused.status_code == 400, missing
        assert refused.json()["code"] == "bad-anchor"
    roi = start(api, s, "first", {"kind": "roi", "object_id": "N1"})
    assert roi.status_code == 400


def test_a_report_block_places_an_arrow_and_a_note(api: ApiAs, database: str) -> None:
    people = team(database)
    blocks = [
        {"kind": "slide-figure", "title": "Arrow", "object_id": "A1"},
        {"kind": "slide-figure", "title": "Note", "object_id": "N3", "layers": ["reviewed"]},
    ]
    created = api(people["admin"]).post(TEMPLATES, json=template(blocks=blocks))
    assert created.status_code == 201, created.text
    assert [block["object_id"] for block in created.json()["blocks"]] == ["A1", "N3"]


def test_an_import_brings_a_note_with_its_words(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database)
    own: dict[str, Any] = {
        "format": "parfocal-annotations",
        "version": 1,
        "objects": [
            {"kind": "text", "geometry": SPOT, "text": "  Look here  "},
            {"kind": "arrow", "geometry": ARROW},
            {"kind": "text", "geometry": SPOT},
        ],
    }
    geojson = {
        "type": "Feature",
        "geometry": SPOT,
        "properties": {"objectType": "annotation", "parfocal": {"kind": "text", "text": "Stroma"}},
    }
    first = bring(api, layer, "first", "notes.json", own)
    assert first.status_code == 201, first.text
    result = first.json()
    assert [(o["kind"], o["text"]) for o in result["objects"]] == [
        ("text", "Look here"),
        ("arrow", None),
    ]
    assert [skip["index"] for skip in result["skipped"]] == [2]
    second = bring(api, layer, "first", "note.geojson", geojson)
    assert second.status_code == 201, second.text
    assert second.json()["objects"][0]["text"] == "Stroma"
    saved = {o["code"]: o["text"] for o in read(api, layer)["objects"] if o["kind"] == "text"}
    assert sorted(saved.values()) == ["Look here", "Stroma"]


def test_the_slide_export_carries_the_note_words(api: ApiAs, database: str) -> None:
    lb = lab(database)
    owner = api(lb.people["owner"])
    for body in ({"kind": "arrow", "geometry": ARROW}, NOTE):
        assert owner.post(f"/api/slides/{lb.slide}/annotations", json=body).status_code == 201

    def export(format: str) -> Any:
        response = owner.get(f"/api/slides/{lb.slide}/export?format={format}")
        assert response.status_code == 200, response.text[:300]
        return response

    features = export("geojson").json()["features"]
    found = {f["properties"]["parfocal"]["id"]: f["properties"]["parfocal"] for f in features}
    assert found["N1"]["text"] == WORDS
    assert "text" not in found["A1"]
    objects = {o["source_id"]: o for o in export("parfocal").json()["objects"]}
    assert objects["N1"]["text"] == WORDS
    assert "text" not in objects["A1"]
    assert WORDS.encode() in export("flatgeobuf").content
