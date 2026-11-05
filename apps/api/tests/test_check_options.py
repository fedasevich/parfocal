import uuid
from dataclasses import replace
from typing import Any

import pytest
from db_support import ApiAs
from order_support import run_orders
from test_review_order import SCORED, UNSCORED, Ordered, ordered, result_set
from workspace_support import owner

from parfocal_common.object_ids import ObjectId
from parfocal_common.review_order import unpack
from parfocal_common.scope import sample

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]

BY_HAND: dict[str, Any] = {
    "preset": "annotate-by-hand",
    "scope": [],
    "order": "least-sure-first",
    "sign_off": "warn",
    "unchecked_export": "leave-out",
}
PRESETS: dict[str, dict[str, Any]] = {
    "annotate-by-hand": BY_HAND,
    "check-whole-slide-run": BY_HAND
    | {
        "preset": "check-whole-slide-run",
        "scope": [{"kind": "all-objects", "count": None, "score": None}],
        "sign_off": "all-checked",
    },
    "check-sample": BY_HAND
    | {
        "preset": "check-sample",
        "scope": [{"kind": "random-cells", "count": 200, "score": None}],
        "sign_off": "all-checked",
    },
    "fix-ai-on-selected-areas": BY_HAND
    | {
        "preset": "fix-ai-on-selected-areas",
        "scope": [{"kind": "inside-rois", "count": None, "score": None}],
        "order": "position",
        "sign_off": "all-checked",
    },
    "mixed": BY_HAND
    | {"preset": "mixed", "scope": [{"kind": "all-objects", "count": None, "score": None}]},
}


PLACED = [(7, 20, 3000), (8, 90, 3000)]


def annotate(api: ApiAs, o: Ordered, slide: int = 0, pinned: bool = True, **extra: Any) -> Any:
    sets = [{"slide_id": str(o.slides[slide]), "result_set_id": str(o.sets[slide])}]
    return api(o.people["owner"]).post(
        f"/api/projects/{o.project}/review-tasks",
        json={
            "name": "Check the AI",
            "kind": "annotate",
            "slide_ids": [str(o.slides[slide])],
            "result_sets": sets if pinned else [],
            "reviewer_ids": [str(o.people["first"].user_id)],
            "split": "everyone",
        }
        | extra,
    )


def made(api: ApiAs, o: Ordered, slide: int = 0, pinned: bool = True, **extra: Any) -> str:
    response = annotate(api, o, slide, pinned, **extra)
    assert response.status_code == 201, response.text
    return str(response.json()["id"])


def stored_order(database: str, task: str, slide: uuid.UUID) -> list[str]:
    rows = owner(
        database,
        f"SELECT objects FROM review_order WHERE task_id = '{task}' AND slide_id = '{slide}'",
    )
    if not rows:
        return []
    packed = rows[0][0]
    assert isinstance(packed, bytes)
    return [ObjectId(letter, number).text(ascii=True) for letter, number in unpack(packed)]


def test_each_preset_fills_in_the_check_options(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    for preset, options in PRESETS.items():
        response = annotate(api, o, preset=preset)
        assert response.status_code == 201, response.text
        assert response.json()["check"] == options
    plain = annotate(api, o)
    assert plain.json()["check"] == BY_HAND
    audited = owner(
        database,
        "SELECT details::jsonb->>'preset', details::jsonb->>'sign_off' FROM audit_events "
        f"WHERE target_id = '{plain.json()['id']}'",
    )
    assert audited == [("annotate-by-hand", "warn")]
    review = api(o.people["owner"]).get(f"/api/review-tasks/{o.task}").json()
    assert review["check"] is None
    refused = api(o.people["owner"]).post(
        f"/api/projects/{o.project}/review-tasks",
        json={
            "name": "Review",
            "slide_ids": [str(o.slides[1])],
            "model_name": "HoVer-NeXt",
            "reviewer_ids": [str(o.people["first"].user_id)],
            "split": "everyone",
            "scope": {"kind": "all-regions"},
            "preset": "mixed",
        },
    )
    assert refused.status_code == 422


def test_an_option_changes_after_a_preset(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = made(
        api, o, slide=1, preset="check-whole-slide-run", check={"unchecked_export": "include"}
    )
    boss = api(o.people["owner"])
    assert boss.get(f"/api/review-tasks/{task}").json()["check"]["unchecked_export"] == "include"
    changed = boss.patch(
        f"/api/review-tasks/{task}", json={"check": {"order": "position", "sign_off": "warn"}}
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["check"] == PRESETS["check-whole-slide-run"] | {
        "order": "position",
        "sign_off": "warn",
        "unchecked_export": "include",
    }
    run_orders(database, o.tenant)
    assert stored_order(database, task, o.slides[1]) == ["T1", "T2", "T3", "T4"]
    cleared = boss.patch(f"/api/review-tasks/{task}", json={"check": {"scope": []}})
    assert cleared.json()["check"]["scope"] == []
    assert stored_order(database, task, o.slides[1]) == []
    refused = boss.patch(f"/api/review-tasks/{o.task}", json={"check": {"order": "position"}})
    assert (refused.status_code, refused.json()["code"]) == (400, "check-not-for-task-kind")
    repeated = boss.patch(
        f"/api/review-tasks/{task}",
        json={"check": {"scope": [{"kind": "inside-rois"}, {"kind": "inside-rois"}]}},
    )
    assert repeated.status_code == 422


def test_a_check_scope_stores_the_least_sure_first_order(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    placed = result_set(
        database, o.tenant, o.project, o.slides[0], SCORED, cells=True, placed=PLACED
    )
    task = made(api, o, preset="check-whole-slide-run")
    by_position = made(
        api,
        replace(o, sets=[placed, o.sets[1]]),
        preset="check-whole-slide-run",
        check={"order": "position"},
    )
    by_hand = made(api, o)
    run_orders(database, o.tenant)
    order = stored_order(database, task, o.slides[0])
    assert sorted(order) == sorted([f"T{n}" for n in range(1, 7)] + [f"C{n}" for n in range(1, 7)])
    regions = [key for key in order if key.startswith("T")]
    assert regions[:4] == ["T2", "T3", "T5", "T1"]
    assert order.index("C1") < order.index("C2") < order.index("C3")
    assert stored_order(database, by_position, o.slides[0]) == [
        *(f"T{n}" for n in range(1, 7)),
        *(f"C{n}" for n in range(1, 7)),
        "T8",
        "T7",
    ]
    assert stored_order(database, by_hand, o.slides[0]) == []


def sample_seed(database: str, task: str) -> int:
    rows = owner(
        database, f"SELECT check_options->'scope'->0->>'seed' FROM review_tasks WHERE id = '{task}'"
    )
    return int(str(rows[0][0]))


def test_the_researcher_sets_the_sample_size(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    boss = api(o.people["owner"])
    task = made(
        api,
        o,
        preset="check-sample",
        check={"scope": [{"kind": "random-cells", "count": 3}]},
    )
    assert boss.get(f"/api/review-tasks/{task}").json()["check"]["scope"] == [
        {"kind": "random-cells", "count": 3, "score": None}
    ]
    run_orders(database, o.tenant)
    seed = sample_seed(database, task)
    picked = [f"C{n}" for n in sample(range(1, 7), 3, seed, str(o.slides[0]))]
    assert sorted(stored_order(database, task, o.slides[0])) == sorted(picked)
    smaller = boss.patch(
        f"/api/review-tasks/{task}",
        json={"check": {"scope": [{"kind": "random-cells", "count": 2}]}},
    )
    assert smaller.status_code == 200, smaller.text
    assert smaller.json()["check"]["scope"][0]["count"] == 2
    assert sample_seed(database, task) == seed
    run_orders(database, o.tenant)
    assert sorted(stored_order(database, task, o.slides[0])) == [
        f"C{n}" for n in sample(range(1, 7), 2, seed, str(o.slides[0]))
    ]
    refused = annotate(
        api, o, preset="check-sample", check={"scope": [{"kind": "random-cells", "count": 0}]}
    )
    assert refused.status_code == 422


def test_the_objects_of_a_new_run_join_the_check_scope(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = made(api, o, slide=1, pinned=False, preset="check-whole-slide-run")
    expert = api(o.people["first"])
    runs = f"/api/review-tasks/{task}/slides/{o.slides[1]}/runs"
    first = expert.post(runs, json={"result_set_id": str(o.sets[1])})
    assert first.status_code == 200, first.text
    assert (first.json()["result_set_id"], first.json()["run_set_ids"]) == (str(o.sets[1]), [])
    run_orders(database, o.tenant)
    assert sorted(stored_order(database, task, o.slides[1])) == ["T1", "T2", "T3", "T4"]
    later = result_set(
        database, o.tenant, o.project, o.slides[1], [(7, None, None, None), (8, 1, 30, None)]
    )
    second = expert.post(runs, json={"result_set_id": str(later)})
    assert second.json()["run_set_ids"] == [str(later)]
    assert expert.post(runs, json={"result_set_id": str(later)}).json()["run_set_ids"] == [
        str(later)
    ]
    run_orders(database, o.tenant)
    assert sorted(stored_order(database, task, o.slides[1])) == [
        "T1",
        "T2",
        "T3",
        "T4",
        "T7",
        "T8",
    ]
    other_slide = expert.post(runs, json={"result_set_id": str(o.sets[0])})
    assert (other_slide.status_code, other_slide.json()["code"]) == (400, "no-result-set")
    outsider = api(o.people["third"]).post(runs, json={"result_set_id": str(later)})
    assert outsider.status_code in {403, 404}


def check_all(api: ApiAs, o: Ordered, task: str, numbers: list[int]) -> None:
    layer = f"/api/review-tasks/{task}/slides/{o.slides[1]}/shared-layer"
    for number in numbers:
        response = api(o.people["first"]).put(f"{layer}/ai/T{number}", json={"deleted": True})
        assert response.status_code == 201, response.text


def submitted(api: ApiAs, o: Ordered, task: str) -> None:
    response = api(o.people["first"]).post(f"/api/review-tasks/{task}/slides/{o.slides[1]}/submit")
    assert response.status_code == 200, response.text


def test_sign_off_is_refused_with_an_unchecked_object(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    assert len(UNSCORED) == 4
    strict = made(api, o, slide=1, preset="check-whole-slide-run")
    lenient = made(api, o, slide=1, preset="mixed")
    run_orders(database, o.tenant)
    for task in (strict, lenient):
        submitted(api, o, task)
    check_all(api, o, strict, [1, 2, 3])
    refused = api(o.people["owner"]).post(f"/api/review-tasks/{strict}/sign-off")
    assert (refused.status_code, refused.json()["code"]) == (409, "objects-unchecked"), refused.text
    check_all(api, o, strict, [4])
    signed = api(o.people["owner"]).post(f"/api/review-tasks/{strict}/sign-off")
    assert signed.status_code == 200, signed.text
    warned = api(o.people["owner"]).post(f"/api/review-tasks/{lenient}/sign-off")
    assert warned.status_code == 200, warned.text
