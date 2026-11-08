import hashlib
import io
import json
import uuid
import zipfile
from dataclasses import replace
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from order_support import run_orders
from test_annotations import make_slide
from test_check_options import made
from test_review_order import Ordered, ordered
from workspace_support import owner

from parfocal_api.annotate_import import candidates, drafts_of
from parfocal_api.training_exports import Manifest, letter_at, rgb_of

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

QUPATH = Path(__file__).parent / "fixtures" / "qupath-objects.geojson"
SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}
HUMAN = {"type": "Polygon", "coordinates": [[[50, 50], [80, 50], [80, 80], [50, 80], [50, 50]]]}
ARROW = {"type": "LineString", "coordinates": [[0, 0], [30, 30]]}
POINT = {"type": "Point", "coordinates": [5, 5]}
GEOMETRY_TYPES = {"Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"}
OBJECT_TYPES = {"annotation", "detection", "cell", "tile"}


def qupath_object(feature: dict[str, Any]) -> dict[str, Any]:
    assert feature["type"] == "Feature"
    assert str(uuid.UUID(feature["id"])) == feature["id"]
    geometry = feature["geometry"]
    assert geometry["type"] in GEOMETRY_TYPES
    assert isinstance(geometry["coordinates"], list)
    properties = feature["properties"]
    assert properties["objectType"] in OBJECT_TYPES
    assert isinstance(properties.get("isLocked", False), bool)
    assert isinstance(properties.get("name", ""), str)
    classification = properties.get("classification")
    if classification is not None:
        assert isinstance(classification["name"], str)
        color = classification.get("color", [0, 0, 0])
        assert len(color) == 3
        assert all(isinstance(part, int) and 0 <= part <= 255 for part in color)
    return {
        "id": feature["id"],
        "type": properties["objectType"],
        "class": None if classification is None else classification["name"],
        "geometry": geometry,
    }


def classed(database: str, o: Ordered) -> tuple[Ordered, uuid.UUID]:
    class_id = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO project_classes (tenant_id, project_id, key, name, colour) "
                f"VALUES ('{o.tenant}', '{o.project}', 1, 'Tumour', '#c80000') RETURNING id",
            )[0][0]
        )
    )
    slide = make_slide(database, o.tenant, o.project)
    set_id = owner(
        database,
        "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source) "
        f"VALUES ('{o.tenant}', '{o.project}', '{slide}', 'HoVer-NeXt', 'import') RETURNING id",
    )[0][0]
    owner(
        database,
        "INSERT INTO result_set_classes (tenant_id, project_id, result_set_id, position, "
        f"source_name, class_id) VALUES ('{o.tenant}', '{o.project}', '{set_id}', 0, "
        f"'tumor', '{class_id}')",
    )
    for number in (1, 2, 3, 4):
        owner(
            database,
            "INSERT INTO result_objects "
            "(tenant_id, result_set_id, kind, number, geometry, class_index) "
            f"VALUES ('{o.tenant}', '{set_id}', 'region', {number}, "
            f"ST_GeomFromText('POLYGON((0 0,{number}0 0,{number}0 9,0 9,0 0))', 0), 0)",
        )
    owner(
        database,
        f"UPDATE result_sets SET status = 'ready', region_count = 4 WHERE id = '{set_id}'",
    )
    return replace(
        o, slides=[o.slides[0], slide], sets=[o.sets[0], uuid.UUID(str(set_id))]
    ), class_id


def ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response.json() if response.content else None


def sign_off(api: ApiAs, o: Ordered, slide: str) -> None:
    ok(api(o.people["first"]).post(f"{slide}/check"))
    ok(api(o.people["owner"]).post(f"{slide}/sign-off"))


def exported(api: ApiAs, o: Ordered, task: str) -> tuple[dict[str, Any], dict[str, bytes]]:
    response = api(o.people["owner"]).get(f"/api/review-tasks/{task}/training-dataset")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"] == "application/zip"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        files = {name: archive.read(name) for name in archive.namelist()}
    return json.loads(files.pop("manifest.json")), files


def worked_slide(api: ApiAs, database: str) -> tuple[Ordered, str, str, uuid.UUID]:
    o, class_id = classed(database, ordered(database, api))
    task = made(api, o, slide=1, preset="mixed")
    run_orders(database, o.tenant)
    slide = f"/api/review-tasks/{task}/slides/{o.slides[1]}"
    layer = f"{slide}/shared-layer"
    first = api(o.people["first"])
    ok(first.post(f"{layer}/ai/T1/confirm", json={}), 201)
    ok(first.put(f"{layer}/ai/T2", json={"geometry": SQUARE}), 201)
    ok(first.put(f"{layer}/ai/T3", json={"deleted": True}), 201)
    undone = ok(first.post(f"{layer}/ai/T4/confirm", json={}), 201)
    ok(first.delete(f"{layer}/ai/T4/confirm", params={"version": undone["version"]}), 204)
    drawn = {"kind": "region", "geometry": HUMAN, "class_id": str(class_id)}
    ok(first.post(f"{layer}/objects", json=drawn), 201)
    ok(first.post(f"{layer}/objects", json={"kind": "arrow", "geometry": ARROW}), 201)
    note = {"kind": "text", "geometry": POINT, "text": "Private remark"}
    ok(first.post(f"{layer}/objects", json=note), 201)
    sign_off(api, o, slide)
    return o, task, slide, class_id


def test_a_signed_off_slide_exports_its_layer_with_origins_and_letters(
    api: ApiAs, database: str
) -> None:
    o, task, _, class_id = worked_slide(api, database)
    manifest, files = exported(api, o, task)
    Manifest.model_validate(manifest)
    (entry,) = manifest["slides"]
    path = f"slides/{o.slides[1]}.geojson"
    assert list(files) == [path]
    content = files[path]
    assert entry["file"] == {
        "path": path,
        "sha256": hashlib.sha256(content).hexdigest(),
        "bytes": len(content),
    }
    assert entry["objects"] == {"human": 1, "ai-confirmed": 1, "ai-edited": 1, "ai-unchecked": 0}
    assert (entry["unchecked_left_out"], entry["marks_left_out"]) == (1, 2)
    assert manifest["unchecked_left_out"] == 1
    assert manifest["origins"] == ["human", "ai-confirmed", "ai-edited"]
    assert manifest["check_options"]["unchecked_export"] == "leave-out"
    assert manifest["classes"] == [
        {"id": str(class_id), "key": 1, "name": "Tumour", "colour": "#c80000"}
    ]
    assert manifest["annotators"] == [
        {"letter": "A", "assigned": True},
        {"letter": "B", "assigned": False},
    ]
    assert entry["annotators"] == ["A"]
    assert entry["sign_off"]["signed_off_by"] == "B"
    features = json.loads(content)["features"]
    shown = {
        feature["properties"]["parfocal"]["source"] or "human": (
            feature["properties"]["parfocal"]["origin"],
            feature["properties"]["classification"],
            feature["properties"]["parfocal"]["author"],
            feature["properties"]["parfocal"]["class_key"],
        )
        for feature in features
    }
    tumour = {"name": "Tumour", "color": [200, 0, 0]}
    assert shown == {
        "T1": ("ai-confirmed", tumour, "A", 1),
        "T2": ("ai-edited", tumour, "A", 1),
        "human": ("human", tumour, "A", 1),
    }
    text = content.decode()
    assert "Private remark" not in text
    for person in o.people.values():
        assert str(person.user_id) not in text
        assert str(person.user_id) not in json.dumps(manifest)


def test_unchecked_ai_objects_join_the_export_when_the_task_includes_them(
    api: ApiAs, database: str
) -> None:
    o = ordered(database, api)
    task = made(api, o, slide=0, preset="mixed", check={"unchecked_export": "include"})
    run_orders(database, o.tenant)
    sign_off(api, o, f"/api/review-tasks/{task}/slides/{o.slides[0]}")
    manifest, files = exported(api, o, task)
    Manifest.model_validate(manifest)
    (entry,) = manifest["slides"]
    assert entry["objects"]["ai-unchecked"] == 12
    assert entry["unchecked_left_out"] == 0
    assert "ai-unchecked" in manifest["origins"]
    features = json.loads(files[entry["file"]["path"]])["features"]
    kinds = sorted(feature["properties"]["parfocal"]["kind"] for feature in features)
    assert kinds == ["cell"] * 6 + ["region"] * 6
    assert {feature["properties"]["parfocal"]["author"] for feature in features} == {None}
    again, _ = exported(api, o, task)
    assert [item["file"]["sha256"] for item in again["slides"]] == [entry["file"]["sha256"]]


def test_every_exported_file_imports_again_with_nothing_lost(api: ApiAs, database: str) -> None:
    o, task, _, _ = worked_slide(api, database)
    _, files = exported(api, o, task)
    classes = {item["id"]: item["name"] for item in manifest_classes(api, o, task)}
    fresh = made(api, o, slide=1, pinned=False)
    layer = f"/api/review-tasks/{fresh}/slides/{o.slides[1]}/shared-layer"
    for name, content in files.items():
        features = json.loads(content)["features"]
        result = ok(
            api(o.people["first"]).post(
                f"{layer}/imports", json={"file_name": name, "content": json.loads(content)}
            ),
            201,
        )
        assert (result["skipped"], result["unknown_classes"]) == ([], [])
        assert [
            (item["kind"], item["geometry"], classes.get(item["class_id"]))
            for item in result["objects"]
        ] == [
            (
                feature["properties"]["parfocal"]["kind"],
                feature["geometry"],
                feature["properties"].get("classification", {}).get("name"),
            )
            for feature in features
        ]


def manifest_classes(api: ApiAs, o: Ordered, task: str) -> list[dict[str, Any]]:
    manifest, _ = exported(api, o, task)
    return list(manifest["classes"])


def test_the_export_reads_as_qupath_geojson_like_the_fixture(api: ApiAs, database: str) -> None:
    fixture = json.loads(QUPATH.read_text())
    read = [qupath_object(feature) for feature in fixture["features"]]
    assert [item["type"] for item in read] == ["annotation", "cell"]
    drafts, skipped, _ = drafts_of(candidates(fixture), {"tumour": uuid.uuid4()})
    assert ([draft.kind.value for draft in drafts], skipped) == (["region", "cell"], [])
    o, task, _, _ = worked_slide(api, database)
    _, files = exported(api, o, task)
    for content in files.values():
        collection = json.loads(content)
        assert collection["type"] == fixture["type"]
        for feature in collection["features"]:
            item = qupath_object(feature)
            assert set(feature) <= {"type", "id", "geometry", "properties", "nucleusGeometry"}
            assert item["class"] == "Tumour"


def test_nothing_signed_off_means_nothing_to_export(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = made(api, o, slide=1)
    response = api(o.people["owner"]).get(f"/api/review-tasks/{task}/training-dataset")
    assert (response.status_code, response.json()["code"]) == (409, "nothing-signed-off")
    hidden = api(o.people["first"]).get(f"/api/review-tasks/{task}/training-dataset")
    assert hidden.status_code in {403, 404}
    review = api(o.people["owner"]).get(f"/api/review-tasks/{o.task}/training-dataset")
    assert review.json()["code"] == "not-an-annotate-task"


def test_letters_and_colours_are_plain() -> None:
    assert [letter_at(index) for index in (0, 25, 26, 27, 51, 52)] == [
        "A",
        "Z",
        "AA",
        "AB",
        "AZ",
        "BA",
    ]
    assert rgb_of("#c80a00") == [200, 10, 0]
