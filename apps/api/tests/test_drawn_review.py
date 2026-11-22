import io
import json
import uuid
import zipfile
from dataclasses import dataclass
from typing import Any, cast

import pytest
from db_support import ApiAs
from submit_support import submitted
from test_annotations import make_class, make_slide
from test_outline_disagreements import square
from test_settled_outlines import same_shape
from workspace_support import join_project, make_project, make_workspace, owner

from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

HAND = square(0, 0, 100)
SMART = square(400, 400, 60)
WRONG = square(900, 900, 30)
FIXED = square(0, 0, 80)


@dataclass(frozen=True)
class Drawn:
    people: dict[str, MemberPrincipal]
    tenant: uuid.UUID
    project: uuid.UUID
    slide: uuid.UUID
    codes: dict[str, str]


def ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response


def drawn_slide(api: ApiAs, database: str) -> Drawn:
    workspace = make_workspace(
        database,
        {"owner": Role.RESEARCHER, "first": Role.REVIEWER, "second": Role.REVIEWER},
    )
    people, tenant = workspace.people, workspace.tenant_id
    project = make_project(database, tenant, "de-identified")
    join_project(database, project, people["owner"], "owner")
    for label in ("first", "second"):
        join_project(database, project, people[label], "reviewer")
    slide = make_slide(database, tenant, project)
    tumor = make_class(database, tenant, project)
    codes: dict[str, str] = {}
    for name, shape, tool in (("hand", HAND, "hand"), ("smart", SMART, "smart-select")):
        made = ok(
            api(people["owner"]).post(
                f"/api/slides/{slide}/annotations",
                json={"kind": "region", "geometry": shape, "class_id": str(tumor), "tool": tool},
            ),
            201,
        ).json()
        codes[name] = made["code"]
    made = ok(
        api(people["owner"]).post(
            f"/api/slides/{slide}/annotations", json={"kind": "region", "geometry": WRONG}
        ),
        201,
    ).json()
    codes["wrong"] = made["code"]
    ok(
        api(people["owner"]).post(
            f"/api/slides/{slide}/annotations",
            json={"kind": "measurement", "geometry": square(0, 0, 5)},
        ),
        201,
    )
    return Drawn(people, tenant, project, slide, codes)


def drawn_task(api: ApiAs, d: Drawn) -> uuid.UUID:
    created = ok(
        api(d.people["owner"]).post(
            f"/api/projects/{d.project}/review-tasks",
            json={
                "name": "Drawn task",
                "slide_ids": [str(d.slide)],
                "drawn_slide_ids": [str(d.slide)],
                "reviewer_ids": [str(d.people[label].user_id) for label in ("first", "second")],
                "split": "everyone",
                "scope": {"kind": "all-regions"},
                "decision": {"style": "agree"},
            },
        ),
        201,
    )
    return uuid.UUID(created.json()["id"])


def plain(code: str) -> str:
    return code.rstrip("+")


def test_a_review_task_takes_a_slides_drawn_objects_with_who_drew_them_and_how(
    api: ApiAs, database: str
) -> None:
    d = drawn_slide(api, database)
    as_owner = api(d.people["owner"])
    [listed] = ok(as_owner.get(f"/api/projects/{d.project}/slides")).json()
    assert (listed["drawn_count"], listed["result_set_ids"]) == (3, [])
    task = drawn_task(api, d)
    detail = ok(as_owner.get(f"/api/review-tasks/{task}")).json()
    [pinned] = detail["slides"]
    assert pinned["result_set_id"] is not None
    assert ok(as_owner.get(f"/api/projects/{d.project}/result-sets")).json() == []
    assert ok(as_owner.get(f"/api/slides/{d.slide}/result-sets")).json() == []
    objects = ok(
        api(d.people["first"]).get(f"/api/review-tasks/{task}/slides/{d.slide}/objects")
    ).json()["objects"]
    found = {item["object"]: item for item in objects}
    assert set(found) == {plain(code) for code in d.codes.values()}
    hand, smart, wrong = (found[plain(d.codes[key])] for key in ("hand", "smart", "wrong"))
    assert (hand["drawn"], hand["tool"], hand["class_name"]) == (True, "hand", "Tumor")
    assert hand["drawn_by_user_id"] == str(d.people["owner"].user_id)
    assert smart["tool"] == "smart-select"
    assert (wrong["drawn"], wrong["tool"]) == (True, None)
    assert hand["outline"]
    owner(
        database,
        "UPDATE annotations "
        "SET geometry = ST_GeomFromText('POLYGON((5 5,15 5,15 15,5 15,5 5))', 0) "
        f"WHERE slide_id = '{d.slide}' AND number = {hand['number']}",
    )
    again = ok(
        api(d.people["first"]).get(f"/api/review-tasks/{task}/slides/{d.slide}/objects")
    ).json()["objects"]
    assert (
        next(item for item in again if item["object"] == hand["object"])["outline"]
        == (hand["outline"])
    )


def test_a_slide_without_drawn_outlines_cannot_be_reviewed_from_them(
    api: ApiAs, database: str
) -> None:
    d = drawn_slide(api, database)
    other = make_slide(database, d.tenant, d.project)
    refused = api(d.people["owner"]).post(
        f"/api/projects/{d.project}/review-tasks",
        json={
            "name": "Nothing drawn",
            "slide_ids": [str(other)],
            "drawn_slide_ids": [str(other)],
            "reviewer_ids": [str(d.people["first"].user_id)],
            "split": "everyone",
            "scope": {"kind": "all-regions"},
        },
    )
    assert refused.status_code == 400, refused.text
    assert refused.json()["code"] == "no-result-set"


def test_a_reviewed_drawn_object_reaches_the_final_layer_with_its_drawer(
    api: ApiAs, database: str
) -> None:
    d = drawn_slide(api, database)
    task = drawn_task(api, d)
    base = f"/api/review-tasks/{task}/slides/{d.slide}"
    hand, smart, wrong = (plain(d.codes[key]) for key in ("hand", "smart", "wrong"))
    for who in ("first", "second"):
        reviewer = api(d.people[who])
        ok(reviewer.put(f"{base}/decisions/{hand}", json={"value": "agree"}))
        ok(reviewer.put(f"{base}/decisions/{smart}", json={"value": "agree"}))
        ok(
            reviewer.put(
                f"{base}/decisions/{wrong}", json={"value": "disagree", "reasons": ["artefact"]}
            )
        )
    ok(api(d.people["first"]).put(f"{base}/edits/{hand}", json={"geometry": FIXED}))
    for who in ("first", "second"):
        ok(submitted(api(d.people[who]), base))
    as_owner = api(d.people["owner"])
    queued = ok(as_owner.get(f"/api/review-tasks/{task}/disagreements")).json()
    assert [(item["object"], item["drawn"], item["why"]) for item in queued] == [
        (wrong, True, "against-the-ai")
    ]
    ok(
        as_owner.put(
            f"/api/review-tasks/{task}/disagreements/{d.slide}/{wrong}",
            json={"answer": "disagree"},
        )
    )
    ok(as_owner.post(f"/api/review-tasks/{task}/sign-off"))
    stored = owner(
        database,
        "SELECT objects::text FROM final_layers "
        f"WHERE task_id = '{task}' ORDER BY build DESC LIMIT 1",
    )[0][0]
    layer = cast(list[dict[str, Any]], json.loads(str(stored)))
    entries = {int(entry["number"]): entry for entry in layer}
    by_number = {code: int(code[1:]) for code in (hand, smart, wrong)}
    fixed, kept, dropped = (entries[by_number[code]] for code in (hand, smart, wrong))
    assert (fixed["state"], fixed["person"], fixed["tool"]) == ("edited", True, "hand")
    assert fixed["drawn_by"] == str(d.people["owner"].user_id)
    assert (kept["state"], kept["tool"]) == ("confirmed", "smart-select")
    assert (dropped["state"], dropped["tool"]) == ("rejected", None)
    response = ok(as_owner.get(f"/api/review-tasks/{task}/training-dataset"))
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        collection = json.loads(archive.read(f"slides/{d.slide}.geojson"))
    features = {
        feature["properties"]["parfocal"]["id"]: feature for feature in collection["features"]
    }
    assert set(features) == {f"{hand}+", f"{smart}+"}
    assert same_shape(features[f"{hand}+"]["geometry"], FIXED)
    smart_props = features[f"{smart}+"]["properties"]["parfocal"]
    assert (smart_props["origin"], smart_props["tool"]) == ("ai-confirmed", "smart-select")
    assert smart_props["drawn_by"] is not None
