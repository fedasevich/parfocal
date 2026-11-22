import io
import json
import zipfile
from typing import Any, cast

import pytest
from db_support import ApiAs
from submit_support import submitted
from test_outline_disagreements import square
from test_reviewed_layer import Review, ai_snapshot, edit, review
from test_settled_outlines import same_shape
from workspace_support import owner

pytestmark = pytest.mark.db

REDRAWN = square(0, 0, 80)
DRAWN = square(390, 90, 20)
ADDED = square(300, 300, 40)
ADDED_AGAIN = square(302, 302, 40)
AI_T2 = {"type": "Polygon", "coordinates": [[[0, 0], [200, 0], [200, 50], [0, 50], [0, 0]]]}

DECISIONS: dict[str, dict[str, dict[str, Any]]] = {
    "first": {
        "T1": {"value": "agree"},
        "T2": {"value": "agree"},
        "C1": {"value": "disagree", "reasons": ["artefact"]},
        "C2": {"value": "agree"},
        "C3": {"value": "agree"},
        "C4": {"value": "unsure"},
        "C5": {"value": "agree"},
    },
    "second": {
        "T1": {"value": "agree"},
        "T2": {"value": "agree"},
        "C1": {"value": "disagree", "reasons": ["artefact"]},
        "C2": {"value": "disagree", "reasons": ["boundary_off"]},
        "C3": {"value": "disagree", "reasons": ["artefact"]},
        "C4": {"value": "unsure"},
        "C5": {"value": "disagree", "reasons": ["artefact"]},
    },
}

QUEUE_ANSWERS: dict[str, str | None] = {
    "C1": "disagree",
    "C2": "agree",
    "C3": "disagree",
    "C4": "unsure",
    "C5": None,
    "T2": "agree",
}


def ok(response: Any, status: int = 200) -> Any:
    assert response.status_code == status, response.text
    return response


def worked_review(api: ApiAs, database: str) -> Review:
    r = review(api, database)
    for who, given in DECISIONS.items():
        for object_id, body in given.items():
            ok(api(r.people[who]).put(f"{r.base}/decisions/{object_id}", json=body))
    ok(edit(api, r, "first", "T2", {"geometry": REDRAWN}))
    ok(
        api(r.people["first"]).post(f"{r.base}/added", json={"kind": "region", "geometry": ADDED}),
        201,
    )
    ok(
        api(r.people["second"]).post(
            f"{r.base}/added", json={"kind": "region", "geometry": ADDED_AGAIN}
        ),
        201,
    )
    for who in DECISIONS:
        ok(submitted(api(r.people[who]), r.base))
    as_owner = api(r.people["owner"])
    task = f"/api/review-tasks/{r.task}"
    queued = {item["object"] for item in ok(as_owner.get(f"{task}/disagreements")).json()}
    assert {"C2", "C3", "C5"} <= queued
    decide = f"{task}/disagreements/{r.slide}"
    outline = f"{task}/disagreement-queue/{r.slide}/C2/outline"
    ok(as_owner.put(outline, json={"geometry": DRAWN}))
    for object_id in sorted(queued):
        answer = QUEUE_ANSWERS[object_id]
        if answer is None:
            ok(as_owner.put(f"{decide}/{object_id}/left-open", json={"note": "Later"}))
        else:
            ok(as_owner.put(f"{decide}/{object_id}", json={"answer": answer}))
    return r


def exported(
    api: ApiAs, r: Review, path: str = "training-dataset"
) -> tuple[dict[str, Any], dict[str, Any]]:
    response = ok(api(r.people["owner"]).get(f"/api/review-tasks/{r.task}/{path}"))
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        collection = json.loads(archive.read(f"slides/{r.slide}.geojson"))
    features = {
        feature["properties"]["parfocal"]["id"]: feature for feature in collection["features"]
    }
    return manifest, features


def test_a_signed_off_review_exports_what_its_decisions_and_edits_say(
    api: ApiAs, database: str
) -> None:
    r = worked_review(api, database)
    before = ai_snapshot(database, r)
    task = f"/api/review-tasks/{r.task}"
    early = api(r.people["owner"]).post(f"{task}/final-layer")
    assert (early.status_code, early.json()["code"]) == (409, "task-not-signed-off")
    ok(api(r.people["owner"]).post(f"{task}/sign-off"))
    manifest, features = exported(api, r)
    parfocal = {key: feature["properties"]["parfocal"] for key, feature in features.items()}
    [added] = [key for key, item in parfocal.items() if item["origin"] == "human"]
    assert set(parfocal) == {"T1", "T2", "C2", added}
    first = parfocal["T2"]["author"]
    assert first in {"A", "B"}
    assert (parfocal["T1"]["origin"], parfocal["T1"]["author"]) == ("ai-confirmed", first)
    assert parfocal["T1"]["differs_from_ai"] == "same"
    assert parfocal["T2"]["origin"] == "ai-edited"
    assert parfocal["T2"]["source"] == "T2"
    assert same_shape(features["T2"]["geometry"], REDRAWN)
    assert parfocal["T2"]["differs_from_ai"] == "shape"
    assert parfocal["C2"]["origin"] == "ai-edited"
    assert parfocal["C2"]["author"] == parfocal["C2"]["changed_by"]
    assert parfocal["C2"]["author"] not in {"A", "B"}
    assert same_shape(features["C2"]["geometry"], DRAWN)
    assert features["C2"]["properties"]["objectType"] == "cell"
    assert (parfocal[added]["author"], parfocal[added]["source"]) == (first, None)
    assert same_shape(features[added]["geometry"], ADDED)
    [slide] = manifest["slides"]
    assert slide["objects"] == {"human": 1, "ai-confirmed": 1, "ai-edited": 2, "ai-unchecked": 0}
    assert (slide["unsure_left_out"], slide["open_left_out"], slide["unchecked_left_out"]) == (
        1,
        1,
        0,
    )
    assert (manifest["unsure_left_out"], manifest["open_left_out"]) == (1, 1)
    assert slide["sign_off"]["signed_off_at"]
    with_unchecked = ok(
        api(r.people["owner"]).get(f"{task}/dataset", params={"include_unchecked": "true"})
    ).json()
    assert with_unchecked["objects"]["ai-unchecked"] == 0
    assert (with_unchecked["unsure_left_out"], with_unchecked["open_left_out"]) == (1, 1)
    assert with_unchecked["final_layer"]["counts"] == {
        "confirmed": 1,
        "edited": 2,
        "rejected": 2,
        "added": 1,
        "unsure": 1,
        "open": 1,
    }
    assert with_unchecked["final_layer"]["current"] is True
    assert ai_snapshot(database, r) == before


def test_the_dataset_page_builds_the_layer_again_and_patches_accept_the_task(
    api: ApiAs, database: str
) -> None:
    r = worked_review(api, database)
    task = f"/api/review-tasks/{r.task}"
    as_owner = api(r.people["owner"])
    ok(as_owner.post(f"{task}/sign-off"))
    assert as_owner.get(f"{task}/dataset").json()["final_layer"]["build"] == 1
    rebuilt = ok(as_owner.post(f"{task}/final-layer")).json()
    assert (rebuilt["build"], rebuilt["current"]) == (2, True)
    refused = api(r.people["first"]).post(f"{task}/final-layer")
    assert refused.status_code in {403, 404}
    builds = owner(
        database,
        f"SELECT build, count(*) FROM final_layers WHERE task_id = '{r.task}' "
        "GROUP BY build ORDER BY build",
    )
    assert builds == [(1, 1), (2, 1)]
    actions = owner(
        database,
        f"SELECT count(*) FROM audit_events WHERE action = 'review.final-layer-built' "
        f"AND target_id = '{r.task}'",
    )
    assert actions == [(2,)]
    _, features = exported(api, r)
    assert {"T1", "T2", "C2"} <= set(features)
    job = ok(as_owner.post(f"{task}/patch-exports", json={}), 202).json()["job_id"]
    status = f"{task}/patch-exports/{job}/status"
    assert ok(as_owner.get(status)).json()["state"] == "cutting"
    owner(database, f"UPDATE jobs SET status = 'failed' WHERE id = '{job}'")
    assert ok(as_owner.get(status)).json()["state"] == "failed"
    owner(database, f"UPDATE jobs SET status = 'done' WHERE id = '{job}'")
    assert ok(as_owner.get(status)).json()["state"] == "done"
    frozen = ok(as_owner.post(f"{task}/dataset-versions", json={"note": "Review"}), 201).json()
    assert frozen["counts"]["open_left_out"] == 1


def test_an_unbuilt_layer_is_refused_by_the_dataset(api: ApiAs, database: str) -> None:
    r = worked_review(api, database)
    task = f"/api/review-tasks/{r.task}"
    ok(api(r.people["owner"]).post(f"{task}/sign-off"))
    owner(
        database,
        f"UPDATE evaluation_versions SET number = number + 10 WHERE task_id = '{r.task}'",
    )
    stale = api(r.people["owner"]).get(f"{task}/training-dataset")
    assert (stale.status_code, stale.json()["code"]) == (409, "final-layer-missing")
    patches = api(r.people["owner"]).post(f"{task}/patch-exports", json={})
    assert (patches.status_code, patches.json()["code"]) == (409, "final-layer-missing")
    ok(api(r.people["owner"]).post(f"{task}/final-layer"))
    ok(api(r.people["owner"]).get(f"{task}/training-dataset"))


def test_the_final_layer_of_a_review_task_holds_the_project_classes(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    ok(edit(api, r, "first", "T1", {"class_id": str(r.tumor)}))
    for who in ("first", "second"):
        for object_id in ("T1", "T2"):
            ok(api(r.people[who]).put(f"{r.base}/decisions/{object_id}", json={"value": "agree"}))
        ok(submitted(api(r.people[who]), r.base))
    task = f"/api/review-tasks/{r.task}"
    as_owner = api(r.people["owner"])
    ok(as_owner.post(f"{task}/sign-off"))
    [(stored,)] = owner(database, f"SELECT classes FROM final_layers WHERE task_id = '{r.task}'")
    assert isinstance(stored, list)
    assert [(item["key"], item["name"]) for item in cast("list[dict[str, Any]]", stored)] == [
        (1, "Tumor")
    ]
    manifest, features = exported(api, r)
    assert [(item["id"], item["key"], item["name"]) for item in manifest["classes"]] == [
        (str(r.tumor), 1, "Tumor")
    ]
    keys = {key: item["properties"]["parfocal"]["class_key"] for key, item in features.items()}
    assert keys == {"T1": 1, "T2": None}
    summary = ok(as_owner.get(f"{task}/dataset")).json()
    assert summary["classes"] == {str(r.tumor): 1, "none": 1}
    assert [item["name"] for item in summary["class_names"]] == ["Tumor"]
    owner(database, f"UPDATE final_layers SET classes = NULL WHERE task_id = '{r.task}'")
    older, _ = exported(api, r)
    assert [item["key"] for item in older["classes"]] == [1]


def test_the_queue_decision_wins_over_the_reviewers_edits(api: ApiAs, database: str) -> None:
    r = review(api, database)
    first = str(r.people["first"].user_id)
    answers = {
        "first": {"T1": {"value": "agree"}, "T2": {"value": "disagree", "reasons": ["artefact"]}},
        "second": {"T1": {"value": "agree"}, "T2": {"value": "agree"}},
    }
    for who, given in answers.items():
        for object_id, body in given.items():
            ok(api(r.people[who]).put(f"{r.base}/decisions/{object_id}", json=body))
    ok(edit(api, r, "first", "T1", {"geometry": REDRAWN}))
    ok(edit(api, r, "second", "T1", {"geometry": DRAWN}))
    ok(edit(api, r, "first", "T2", {"geometry": ADDED, "class_id": str(r.tumor)}))
    for who in answers:
        ok(submitted(api(r.people[who]), r.base))
    as_owner = api(r.people["owner"])
    task = f"/api/review-tasks/{r.task}"
    ok(
        as_owner.put(
            f"{task}/disagreement-queue/{r.slide}/T1/outline", json={"from_user_id": first}
        )
    )
    ok(as_owner.put(f"{task}/disagreements/{r.slide}/T1", json={"answer": "disagree"}))
    ok(as_owner.put(f"{task}/disagreements/{r.slide}/T2", json={"answer": "agree"}))
    ok(as_owner.post(f"{task}/sign-off"))
    _, features = exported(api, r)
    assert set(features) == {"T2"}
    t2 = features["T2"]["properties"]["parfocal"]
    assert (t2["origin"], t2["differs_from_ai"], t2["class_key"]) == ("ai-confirmed", "same", None)
    counts = ok(as_owner.get(f"{task}/dataset")).json()["final_layer"]["counts"]
    assert (counts["rejected"], counts["confirmed"], counts["edited"]) == (1, 1, 0)


def test_the_queue_shows_and_settles_a_single_reviewers_redraw_and_retype(
    api: ApiAs, database: str
) -> None:
    r = review(api, database, reviewers=("first",))
    first = str(r.people["first"].user_id)
    task = f"/api/review-tasks/{r.task}"
    disagree = {"value": "disagree", "reasons": ["artefact"]}
    ok(api(r.people["first"]).put(f"{r.base}/decisions/T1", json=disagree))
    summary = ok(api(r.people["owner"]).get(f"{task}/sign-off-summary")).json()
    assert summary["objects"] == {"total": 2, "undecided": 1}
    ok(api(r.people["first"]).put(f"{r.base}/decisions/T2", json={"value": "agree"}))
    ok(edit(api, r, "first", "T1", {"geometry": REDRAWN, "class_id": str(r.tumor)}))
    ok(submitted(api(r.people["first"]), r.base))
    as_owner = api(r.people["owner"])
    rows = ok(as_owner.get(f"{task}/disagreement-queue")).json()["rows"]
    [row] = [row for row in rows if row["object"] == "T1"]
    assert row["outline_differs"] is False
    [drawn] = row["outlines"]
    assert drawn["user_id"] == first
    assert same_shape(drawn["outline"], REDRAWN)
    [answer] = row["answers"]
    assert answer["retyped_to"] == "Tumor"
    ok(
        as_owner.put(
            f"{task}/disagreement-queue/{r.slide}/T1/outline", json={"from_user_id": first}
        )
    )
    ok(as_owner.put(f"{task}/disagreements/{r.slide}/T1", json={"answer": "agree"}))
    ok(as_owner.post(f"{task}/sign-off"))
    _, features = exported(api, r)
    t1 = features["T1"]["properties"]["parfocal"]
    assert (t1["origin"], t1["class_key"]) == ("ai-edited", None)
    assert same_shape(features["T1"]["geometry"], REDRAWN)


def test_the_consensus_export_keeps_only_the_agreeing_reviewers_redraw(
    api: ApiAs, database: str
) -> None:
    r = review(api, database)
    disagree = {"value": "disagree", "reasons": ["artefact"]}
    answers = {
        "first": {"T1": {"value": "agree"}, "T2": disagree},
        "second": {"T1": disagree, "T2": {"value": "agree"}},
    }
    for who, given in answers.items():
        for object_id, body in given.items():
            ok(api(r.people[who]).put(f"{r.base}/decisions/{object_id}", json=body))
    ok(edit(api, r, "second", "T1", {"geometry": DRAWN}))
    ok(edit(api, r, "first", "T1", {"geometry": REDRAWN}))
    ok(edit(api, r, "first", "T2", {"geometry": ADDED}))
    for who in answers:
        ok(submitted(api(r.people[who]), r.base))
    as_owner = api(r.people["owner"])
    decide = f"/api/review-tasks/{r.task}/disagreements/{r.slide}"
    for object_id in ("T1", "T2"):
        ok(as_owner.put(f"{decide}/{object_id}", json={"answer": "agree"}))
    consensus = ok(api(r.people["owner"]).get(f"{r.base}/export", params={"consensus": "true"}))
    features = {feature["id"]: feature for feature in consensus.json()["features"]}
    assert {"T1", "T2"} <= set(features)
    assert same_shape(features["T1"]["geometry"], REDRAWN)
    assert same_shape(features["T2"]["geometry"], AI_T2)
    assert features["T2"]["properties"]["parfocal"]["changed"] == []


def test_the_queue_keeps_a_reviewers_new_type_in_the_training_data(
    api: ApiAs, database: str
) -> None:
    r = review(api, database, reviewers=("first",))
    first = str(r.people["first"].user_id)
    task = f"/api/review-tasks/{r.task}"
    disagree = {"value": "disagree", "reasons": ["artefact"]}
    for object_id in ("T1", "T2"):
        ok(api(r.people["first"]).put(f"{r.base}/decisions/{object_id}", json=disagree))
    ok(edit(api, r, "first", "T1", {"geometry": REDRAWN, "class_id": str(r.tumor)}))
    ok(submitted(api(r.people["first"]), r.base))
    as_owner = api(r.people["owner"])
    queue = f"{task}/disagreement-queue/{r.slide}"
    keep = {"action": "keep-type", "raw": "Tumor"}
    refused = as_owner.post(f"{queue}/T2", json=keep)
    assert (refused.status_code, refused.json()["code"]) == (400, "not-retyped")
    ok(as_owner.put(f"{queue}/T1/outline", json={"from_user_id": first}))
    ok(as_owner.put(f"{task}/disagreements/{r.slide}/T1", json={"answer": "agree"}))
    kept = ok(as_owner.post(f"{queue}/T1", json=keep)).json()
    assert (kept["state"], kept["decision"]["kept_type"]) == ("decided", "Tumor")
    ok(as_owner.put(f"{task}/disagreements/{r.slide}/T2", json={"answer": "agree"}))
    stored = owner(
        database,
        f"SELECT number, kept_class_id, value FROM disagreement_decisions "
        f"WHERE task_id = '{r.task}' ORDER BY number",
    )
    assert stored == [(1, r.tumor, "disagree"), (2, None, "agree")]
    consensus = ok(as_owner.get(f"{r.base}/export", params={"consensus": "true"}))
    shown = {feature["id"]: feature for feature in consensus.json()["features"]}
    t1 = shown["T1"]["properties"]
    assert t1["classification"] == {"name": "Tumor"}
    assert t1["parfocal"]["changed"] == ["retyped", "reshaped", "settled"]
    assert same_shape(shown["T1"]["geometry"], REDRAWN)
    ok(as_owner.post(f"{task}/sign-off"))
    for path in ("training-dataset", "dataset-versions/1"):
        if path != "training-dataset":
            ok(as_owner.post(f"{task}/dataset-versions", json={"note": "Kept type"}), 201)
        _, features = exported(api, r, path)
        parfocal = features["T1"]["properties"]["parfocal"]
        assert (parfocal["origin"], parfocal["class_key"]) == ("ai-edited", 1)
        assert same_shape(features["T1"]["geometry"], REDRAWN)
    counts = ok(as_owner.get(f"{task}/dataset")).json()["final_layer"]["counts"]
    assert (counts["edited"], counts["confirmed"]) == (1, 1)
