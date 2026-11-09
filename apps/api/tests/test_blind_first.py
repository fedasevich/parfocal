import re
from typing import Any

import pytest
from db_support import ApiAs
from test_ai_changes import report_text
from test_annotate_sign_off import SQUARE, on_slide, post, two_slides
from test_review_order import Ordered, ordered
from workspace_support import owner

from parfocal_api.realtime import RecordedRealtime

pytestmark = [pytest.mark.db, pytest.mark.usefixtures("storage")]


def ids_seen(api: ApiAs, o: Ordered, who: str, slide: str) -> set[str]:
    response = api(o.people[who]).get(f"{slide}/shared-layer")
    assert response.status_code == 200, response.text
    return {item["id"] for item in response.json()["objects"]}


def added(api: ApiAs, o: Ordered, task: str) -> int:
    response = api(o.people["owner"]).get(f"/api/review-tasks/{task}/evaluation/ai-changes")
    assert response.status_code == 200, response.text
    return sum(slide["total"]["added"] for slide in response.json()["slides"])


def published(live: RecordedRealtime) -> list[tuple[list[str], object, object]]:
    return [(rooms, event["kind"], event["ids"]) for _, rooms, event in live.published]


def drawn(api: ApiAs, o: Ordered, who: str, slide: str) -> dict[str, Any]:
    response = post(api, o, who, f"{slide}/shared-layer/objects", kind="region", geometry=SQUARE)
    assert response.status_code == 201, response.text
    return dict(response.json())


def test_blind_first_is_off_by_default_and_only_on_annotate_tasks(
    api: ApiAs, database: str
) -> None:
    o = ordered(database, api)
    task = two_slides(api, o)
    shown = api(o.people["owner"]).get(f"/api/review-tasks/{task}")
    assert shown.json()["blind_first"] is False
    blind = two_slides(api, o, blind_first=True)
    assert api(o.people["owner"]).get(f"/api/review-tasks/{blind}").json()["blind_first"] is True
    refused = api(o.people["owner"]).post(
        f"/api/projects/{o.project}/review-tasks",
        json={
            "name": "Review with blind first",
            "slide_ids": [str(o.slides[0])],
            "result_sets": [{"slide_id": str(o.slides[0]), "result_set_id": str(o.sets[0])}],
            "reviewer_ids": [str(o.people["first"].user_id)],
            "split": "everyone",
            "scope": {"kind": "all-regions"},
            "blind_first": True,
        },
    )
    assert refused.status_code == 422


def test_without_blind_first_colleagues_see_new_objects_at_once(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = two_slides(api, o)
    slide = on_slide(o, task, 0)
    made = drawn(api, o, "first", slide)
    assert made["id"] in ids_seen(api, o, "second", slide)


def test_a_new_object_stays_hidden_until_its_author_checks_the_slide(
    api: ApiAs, database: str
) -> None:
    o = ordered(database, api)
    task = two_slides(api, o, blind_first=True)
    live = RecordedRealtime()
    api.app.state.realtime = live
    slide = on_slide(o, task, 0)
    made = drawn(api, o, "first", slide)
    path = f"{slide}/shared-layer/objects/{made['id']}"
    assert made["id"] in ids_seen(api, o, "first", slide)
    assert made["id"] not in ids_seen(api, o, "second", slide)
    assert made["id"] not in ids_seen(api, o, "owner", slide)
    assert api(o.people["second"]).get(f"{path}/history").status_code == 404
    edit = {"version": 1, "geometry": SQUARE}
    assert api(o.people["second"]).patch(path, json=edit).status_code == 404
    assert api(o.people["second"]).delete(path, params={"version": 1}).status_code == 404
    assert added(api, o, task) == 0
    empty = post(api, o, "second", f"{slide}/check", nothing_to_mark=True)
    assert empty.status_code == 200, empty.text
    first, second = (str(o.people[who].user_id) for who in ("first", "second"))
    ids = {"task": task, "slide": str(o.slides[0])}
    assert published(live) == [
        ([f"user:{first}"], "layer.object-changed", ids | {"annotation": made["id"]}),
        ([f"task:{task}"], "layer.visibility-changed", ids | {"user": second}),
    ]
    assert post(api, o, "first", f"{slide}/check").status_code == 200
    assert made["id"] in ids_seen(api, o, "second", slide)
    assert made["id"] in ids_seen(api, o, "owner", slide)
    assert added(api, o, task) == 1
    changed = api(o.people["second"]).patch(path, json=edit)
    assert changed.status_code == 200, changed.text
    assert published(live)[2:] == [
        ([f"task:{task}"], "layer.visibility-changed", ids | {"user": first}),
        ([f"task:{task}"], "layer.object-changed", ids | {"annotation": made["id"]}),
    ]
    assert post(api, o, "first", f"{slide}/uncheck").status_code == 200
    assert made["id"] not in ids_seen(api, o, "second", slide)


def test_ai_copies_stay_shared_under_blind_first(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = two_slides(api, o, blind_first=True)
    slide = on_slide(o, task, 0)
    copied = api(o.people["first"]).put(f"{slide}/shared-layer/ai/T1", json={"deleted": True})
    assert copied.status_code == 201, copied.text
    assert copied.json()["id"] in ids_seen(api, o, "second", slide)


def test_a_thread_on_a_hidden_object_stays_hidden_with_it(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = two_slides(api, o, blind_first=True, blinded=False)
    slide = on_slide(o, task, 0)
    made = drawn(api, o, "first", slide)
    thread = post(
        api,
        o,
        "first",
        f"{slide}/threads",
        title="Margin",
        body="Is this the margin?",
        anchor={"kind": "object", "object_id": made["code"]},
    )
    assert thread.status_code == 201, thread.text
    path = f"{slide}/threads/{thread.json()['id']}"
    assert api(o.people["second"]).get(path).status_code == 404
    listed = api(o.people["second"]).get(f"{slide}/threads")
    assert listed.status_code == 200, listed.text
    assert listed.json() == []
    assert post(api, o, "first", f"{slide}/check").status_code == 200
    assert api(o.people["second"]).get(path).status_code == 200


def added_in_report(api: ApiAs, o: Ordered, task: str) -> int:
    found = re.search(r"All (\d+) (\d+) (\d+) (\d+) (\d+) (\d+)", report_text(api, o, task))
    assert found is not None
    return int(found.group(6))


def test_the_report_leaves_out_hidden_objects(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = two_slides(api, o, blind_first=True)
    slide = on_slide(o, task, 0)
    drawn(api, o, "first", slide)
    assert added_in_report(api, o, task) == 0
    assert post(api, o, "first", f"{slide}/check").status_code == 200
    assert added_in_report(api, o, task) == 1


def test_a_colleague_cannot_anchor_a_thread_on_a_hidden_object(api: ApiAs, database: str) -> None:
    o = ordered(database, api)
    task = two_slides(api, o, blind_first=True, blinded=False)
    slide = on_slide(o, task, 0)
    made = drawn(api, o, "first", slide)
    anchor = {"kind": "object", "object_id": made["code"]}
    body = {"title": "Margin", "body": "Is this the margin?", "anchor": anchor}
    unknown = body | {"anchor": anchor | {"object_id": f"{made['code'][0]}999"}}
    guessed = post(api, o, "second", f"{slide}/threads", **body)
    missing = post(api, o, "second", f"{slide}/threads", **unknown)
    assert guessed.status_code == missing.status_code == 400
    assert guessed.json()["code"] == missing.json()["code"]
    assert post(api, o, "first", f"{slide}/check").status_code == 200
    assert post(api, o, "second", f"{slide}/threads", **body).status_code == 201


def switch(api: ApiAs, o: Ordered, who: str, task: str, on: bool) -> Any:
    return api(o.people[who]).patch(f"/api/review-tasks/{task}", json={"blind_first": on})


def test_turning_blind_first_off_shows_every_object_and_back_on_hides_only_later_ones(
    api: ApiAs, database: str
) -> None:
    o = ordered(database, api)
    task = two_slides(api, o, blind_first=True)
    slide = on_slide(o, task, 0)
    early = drawn(api, o, "first", slide)
    assert early["id"] not in ids_seen(api, o, "second", slide)
    off = switch(api, o, "owner", task, False)
    assert off.status_code == 200, off.text
    assert off.json()["blind_first"] is False
    assert early["id"] in ids_seen(api, o, "second", slide)
    middle = drawn(api, o, "first", slide)
    assert middle["id"] in ids_seen(api, o, "second", slide)
    on = switch(api, o, "owner", task, True)
    assert on.json()["blind_first"] is True
    assert {early["id"], middle["id"]} <= ids_seen(api, o, "second", slide)
    later = drawn(api, o, "first", slide)
    assert later["id"] in ids_seen(api, o, "first", slide)
    assert later["id"] not in ids_seen(api, o, "second", slide)
    assert post(api, o, "first", f"{slide}/check").status_code == 200
    assert later["id"] in ids_seen(api, o, "second", slide)


def test_the_switch_is_audited_without_names_and_only_when_it_changes(
    api: ApiAs, database: str
) -> None:
    o = ordered(database, api)
    task = two_slides(api, o, blind_first=True)
    assert switch(api, o, "owner", task, True).status_code == 200
    assert switch(api, o, "owner", task, False).status_code == 200
    rows = owner(
        database,
        f"SELECT details FROM audit_events WHERE target_id = '{task}' "
        "AND action = 'task.blind-first-changed'",
    )
    assert [row[0] for row in rows] == ['{"blind_first":false}']


def test_only_the_task_owner_can_switch_and_only_on_an_annotate_task(
    api: ApiAs, database: str
) -> None:
    o = ordered(database, api)
    task = two_slides(api, o, blind_first=True)
    assert switch(api, o, "first", task, False).status_code in {403, 404}
    assert api(o.people["owner"]).get(f"/api/review-tasks/{task}").json()["blind_first"] is True
    listed = api(o.people["owner"]).get(f"/api/projects/{o.project}/review-tasks").json()
    review = next(item for item in listed if item["kind"] == "review")
    assert switch(api, o, "owner", review["id"], True).status_code == 400
