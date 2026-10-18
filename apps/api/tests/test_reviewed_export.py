import json
from typing import Any

import pytest
import shapely
from db_support import ApiAs
from test_reviewed_layer import SQUARE, Review, review
from workspace_support import owner

from parfocal_common.results_schema import validate
from parfocal_ingest.results import ReadResult, read_geojson, read_parfocal_json

pytestmark = pytest.mark.db

ADDED = {"type": "Polygon", "coordinates": [[[300, 0], [400, 0], [400, 50], [300, 50], [300, 0]]]}
NEARLY = {"type": "Polygon", "coordinates": [[[305, 0], [400, 0], [400, 50], [305, 50], [305, 0]]]}
POINT = {"type": "Point", "coordinates": [40, 40]}


def first_reviewed(api: ApiAs, database: str) -> Review:
    r = review(api, database)
    tumor = str(r.tumor)
    first = api(r.people["first"])
    assert (
        first.put(f"{r.base}/edits/T1", json={"class_id": tumor, "geometry": SQUARE}).status_code
        == 200
    )
    assert first.put(f"{r.base}/edits/T2", json={"deleted": True}).status_code == 200
    assert first.put(f"{r.base}/verdicts/T1", json={"value": "agree"}).status_code == 200
    added = first.post(
        f"{r.base}/added", json={"kind": "region", "geometry": ADDED, "class_id": tumor}
    )
    assert added.status_code == 201, added.text
    assert (
        first.post(f"{r.base}/added", json={"kind": "cell", "geometry": POINT}).status_code == 201
    )
    return r


def exported(api: ApiAs, r: Review, who: str, **params: Any) -> Any:
    response = api(r.people[who]).get(f"{r.base}/export", params=params)
    assert response.status_code == 200, response.text
    return response.json()


def signature(result: ReadResult) -> list[tuple[Any, ...]]:
    return sorted(
        (
            item.source_id,
            item.kind.value,
            item.class_name,
            shapely.normalize(item.geometry).wkt,
            tuple(item.properties["parfocal"]["changed"]),
            item.properties["parfocal"]["path"],
        )
        for item in result.objects
    )


def test_a_reviewed_layer_round_trips_through_geojson_and_parfocal_json(
    api: ApiAs, database: str
) -> None:
    r = first_reviewed(api, database)
    geojson = exported(api, r, "first")
    parfocal = exported(api, r, "first", format="parfocal")
    assert validate(json.dumps(parfocal)) == []
    from_geojson = read_geojson(json.dumps(geojson).encode())
    from_parfocal = read_parfocal_json(json.dumps(parfocal).encode())
    assert from_geojson.problems == from_parfocal.problems == []
    assert signature(from_geojson) == signature(from_parfocal)
    found = signature(from_geojson)
    assert [(entry[0], entry[1], entry[2], entry[4]) for entry in found] == [
        ("C6+", "cell", None, ("added",)),
        ("T1", "region", "Tumor", ("retyped", "reshaped")),
        ("T3+", "region", "Tumor", ("added",)),
    ]
    square = shapely.normalize(shapely.geometry.shape(SQUARE)).wkt
    assert found[1][3] == square
    assert all(
        entry[5].startswith("P01/~/") and entry[5].endswith(f"/{entry[0]}") for entry in found
    )


def test_the_consensus_keeps_agreed_regions_and_merges_added_ones(
    api: ApiAs, database: str
) -> None:
    r = first_reviewed(api, database)
    second = api(r.people["second"])
    assert second.put(f"{r.base}/verdicts/T1", json={"value": "agree"}).status_code == 200
    assert (
        second.put(
            f"{r.base}/verdicts/T2", json={"value": "disagree", "reason": "artefact"}
        ).status_code
        == 200
    )
    api(r.people["first"]).put(
        f"{r.base}/verdicts/T2", json={"value": "disagree", "reason": "artefact"}
    )
    near = api(r.people["second"]).post(
        f"{r.base}/added", json={"kind": "region", "geometry": NEARLY, "class_id": str(r.tumor)}
    )
    assert near.status_code == 201, near.text
    consensus = exported(api, r, "owner", consensus="true")
    ids = sorted(feature["id"] for feature in consensus["features"])
    assert ids == ["C6+", "T1", "T3+"]
    assert {
        feature["properties"]["parfocal"]["consensus"] for feature in consensus["features"]
    } == {
        "agree",
        "added",
    }


def test_layers_are_exported_by_their_reviewer_or_an_owner(api: ApiAs, database: str) -> None:
    r = first_reviewed(api, database)
    first_id = str(r.people["first"].user_id)
    peek = api(r.people["second"]).get(f"{r.base}/export", params={"reviewer_id": first_id})
    assert (peek.status_code, peek.json()["code"]) == (403, "other-reviewer")
    blocked = api(r.people["second"]).get(f"{r.base}/export", params={"consensus": "true"})
    assert (blocked.status_code, blocked.json()["code"]) == (403, "consensus-for-owners")
    as_owner = api(r.people["owner"]).get(f"{r.base}/export", params={"reviewer_id": first_id})
    assert len(as_owner.json()["features"]) == 3
    assert owner(database, "SELECT 1") == [(1,)]
