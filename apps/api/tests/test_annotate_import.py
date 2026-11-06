from typing import Any

import pytest
from db_support import ApiAs
from test_annotate_layer import POINT, SQUARE, WIDE, Layer, draw, read, shared_layer

pytestmark = pytest.mark.db

QUPATH: dict[str, Any] = {
    "type": "FeatureCollection",
    "features": [
        {
            "type": "Feature",
            "geometry": SQUARE,
            "properties": {"objectType": "annotation", "classification": {"name": "tumor"}},
        },
        {
            "type": "Feature",
            "geometry": {"type": "MultiPoint", "coordinates": [[1, 1], [2, 2]]},
            "properties": {"objectType": "annotation"},
        },
        {
            "type": "Feature",
            "geometry": POINT,
            "properties": {"objectType": "detection", "classification": {"name": "Stroma"}},
        },
        {"type": "Feature", "geometry": None, "properties": {}},
    ],
}


def bring(api: ApiAs, layer: Layer, who: str, name: str, content: Any) -> Any:
    return api(layer.people[who]).post(
        f"{layer.base}/imports", json={"file_name": name, "content": content}
    )


def test_an_import_lands_on_the_shared_layer_with_origin_author_and_file(
    api: ApiAs, database: str
) -> None:
    layer = shared_layer(api, database)
    drawn = draw(api, layer, "second", {"kind": "region", "geometry": WIDE}).json()
    response = bring(api, layer, "first", "case-7.geojson", QUPATH)
    assert response.status_code == 201, response.text
    result = response.json()
    assert [(o["kind"], o["origin"], o["created_by_user_id"]) for o in result["objects"]] == [
        ("region", "human", layer.user("first")),
        ("cell", "human", layer.user("first")),
        ("cell", "human", layer.user("first")),
        ("cell", "human", layer.user("first")),
    ]
    assert result["objects"][0]["class_id"] == str(layer.tumor)
    assert result["unknown_classes"] == ["Stroma"]
    assert result["skipped"] == [{"index": 3, "reason": "It has no geometry"}]
    seen = {o["id"]: o for o in read(api, layer, "second")["objects"]}
    assert drawn["id"] in seen
    assert {o["id"] for o in result["objects"]} <= seen.keys()
    imported = result["objects"][0]["id"]
    history = api(layer.people["owner"]).get(f"{layer.base}/objects/{imported}/history").json()
    assert [(v["change"], v["changed_by_user_id"], v["file_name"]) for v in history] == [
        ("created", layer.user("first"), "case-7.geojson")
    ]
    drawn_history = api(layer.people["owner"]).get(f"{layer.base}/objects/{drawn['id']}/history")
    assert drawn_history.json()[0]["file_name"] is None
    assert len(layer.live.published) == 5


def test_the_same_file_imported_twice_adds_its_objects_again(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database)
    own: dict[str, Any] = {
        "format": "parfocal-annotations",
        "version": 1,
        "objects": [{"kind": "region", "class": "Tumor", "geometry": SQUARE}],
    }
    first = bring(api, layer, "first", "mine.json", own).json()["objects"]
    second = bring(api, layer, "second", "mine.json", own).json()["objects"]
    assert first[0]["code"] != second[0]["code"]
    assert len(read(api, layer)["objects"]) == 2


def test_an_unreadable_or_empty_file_is_refused(api: ApiAs, database: str) -> None:
    layer = shared_layer(api, database)
    refusals = [
        bring(api, layer, "first", "notes.json", {"hello": "world"}),
        bring(api, layer, "first", "empty.geojson", {"type": "FeatureCollection", "features": []}),
        bring(api, layer, "third", "case.geojson", QUPATH),
    ]
    assert [(r.status_code, r.json()["code"]) for r in refusals] == [
        (400, "unreadable-import"),
        (400, "nothing-to-import"),
        (404, "not-found"),
    ]
    assert read(api, layer)["objects"] == []
