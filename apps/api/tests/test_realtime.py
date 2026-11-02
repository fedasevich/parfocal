import base64
import json
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx2
import pytest
from db_support import ApiAs, api_as
from pydantic import SecretStr, ValidationError
from workspace_support import join_project, make_project, make_slide, make_workspace, owner

from parfocal_api.principals import PlatformOperator
from parfocal_api.realtime import (
    PUBLISH_HEADER,
    EdgeRealtime,
    RecordedRealtime,
    RoomEvent,
    sign_publish,
)
from parfocal_api.room_access import ROOM_PROTOCOL, ROOM_TOKEN_SECONDS
from parfocal_api.tables import Role
from parfocal_api.tile_access import sign_capability, verified_claims

VECTOR = json.loads(
    (Path(__file__).resolve().parents[2] / "edge" / "test" / "room-token-vector.json").read_text()
)
SECRET = VECTOR["secret"]


def test_the_api_signs_the_room_token_and_publish_call_the_edge_expects() -> None:
    assert sign_capability(SECRET, VECTOR["claims"]) == VECTOR["token"]
    publish = VECTOR["publish"]
    assert sign_publish(SECRET, publish["stamp"], publish["body"]) == publish["signature"]


def test_events_carry_ids_and_kinds_only() -> None:
    slide = uuid.uuid4()
    event = RoomEvent(kind="slide.changed", ids={"slide": slide})
    assert event.wire() == {"kind": "slide.changed", "ids": {"slide": str(slide)}}
    for kind, ids in (
        ("slide.changed", {"patient": "Jana Nováková"}),
        ("Slide changed", {}),
        ("slide.changed", {"Patient Name": str(slide)}),
    ):
        with pytest.raises(ValidationError):
            RoomEvent.model_validate({"kind": kind, "ids": ids})


async def test_the_edge_client_signs_each_call_and_survives_an_outage() -> None:
    seen: list[httpx2.Request] = []

    def answer(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(200 if len(seen) == 1 else 503)

    tenant, user, project, slide = (uuid.uuid4() for _ in range(4))
    async with httpx2.AsyncClient(transport=httpx2.MockTransport(answer)) as http:
        edge = EdgeRealtime("https://edge.test", SECRET, http)
        await edge.publish(
            tenant, [f"slide:{slide}"], RoomEvent(kind="slide.changed", ids={"slide": slide})
        )
        await edge.revoke(tenant, user, project)
    assert [str(request.url) for request in seen] == [
        "https://edge.test/rt-internal/publish",
        "https://edge.test/rt-internal/revoke",
    ]
    body = seen[0].content.decode()
    assert json.loads(body) == {
        "tenant": str(tenant),
        "rooms": [f"slide:{slide}"],
        "event": {"kind": "slide.changed", "ids": {"slide": str(slide)}},
    }
    stamp = int(seen[0].headers[PUBLISH_HEADER].split(".")[0])
    assert abs(stamp - time.time()) < 5
    assert seen[0].headers[PUBLISH_HEADER] == sign_publish(SECRET, stamp, body)
    assert json.loads(seen[1].content) == {
        "tenant": str(tenant),
        "user": str(user),
        "project": str(project),
    }


@dataclass(frozen=True)
class Lab:
    api: ApiAs
    tenant_id: uuid.UUID
    people: dict[str, Any]
    project: uuid.UUID
    slide: uuid.UUID
    task: uuid.UUID
    live: RecordedRealtime

    def access(self, who: str, room: str) -> httpx2.Response:
        return self.api(self.people[who]).get(f"/api/rooms/{room}/access")


@pytest.fixture(scope="module")
def lab(database: str) -> Iterator[Lab]:
    workspace = make_workspace(
        database,
        {"owner": Role.RESEARCHER, "colleague": Role.RESEARCHER, "unassigned": Role.REVIEWER},
    )
    people: dict[str, Any] = dict(workspace.people)
    people["outsider"] = make_workspace(database, {"outsider": Role.RESEARCHER}).people["outsider"]
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["unassigned"], "reviewer")
    slide = make_slide(database, workspace.tenant_id, project, "A1")
    task = uuid.UUID(
        str(
            owner(
                database,
                "INSERT INTO review_tasks (tenant_id, project_id, number, name, split, scope, "
                "opinion_form_version, start_mode) "
                f"VALUES ('{workspace.tenant_id}', '{project}', 1, 'Live', 'everyone', "
                "'all-regions', 1, 'guided') RETURNING id",
            )[0][0]
        )
    )
    with api_as(database) as api:
        api.app.settings = api.app.settings.model_copy(update={"room_token_key": SecretStr(SECRET)})
        live = RecordedRealtime()
        api.app.state.realtime = live
        yield Lab(api, workspace.tenant_id, people, project, slide, task, live)


def claims_of(lab: Lab, response: httpx2.Response) -> dict[str, Any]:
    assert response.status_code == 200, response.text
    claims = verified_claims(SECRET, response.json()["token"])
    assert claims is not None
    return claims


def refused_as_outsider(response: httpx2.Response) -> bool:
    return (response.status_code, response.json()["code"]) == (403, "emergency-access-needed")


@pytest.mark.db
def test_a_reader_gets_a_short_lived_token_for_the_slide_room(lab: Lab) -> None:
    started = int(time.time())
    response = lab.access("owner", f"slide:{lab.slide}")
    claims = claims_of(lab, response)
    body = response.json()
    assert body["path"] == f"/rt/slide:{lab.slide}"
    assert body["protocol"] == ROOM_PROTOCOL
    assert body["lifetime_seconds"] == ROOM_TOKEN_SECONDS
    assert response.headers["Cache-Control"] == "private, no-store"
    assert {key: claims[key] for key in "vtrup"} == {
        "v": 1,
        "t": str(lab.tenant_id),
        "r": f"slide:{lab.slide}",
        "u": str(lab.people["owner"].user_id),
        "p": str(lab.project),
    }
    assert started + ROOM_TOKEN_SECONDS <= claims["e"] <= int(time.time()) + ROOM_TOKEN_SECONDS


@pytest.mark.db
def test_task_and_own_user_rooms_follow_the_reader_grant(lab: Lab) -> None:
    task = claims_of(lab, lab.access("owner", f"task:{lab.task}"))
    assert (task["r"], task["p"]) == (f"task:{lab.task}", str(lab.project))
    own = lab.people["unassigned"].user_id
    mine = claims_of(lab, lab.access("unassigned", f"user:{own}"))
    assert (mine["r"], mine["p"]) == (f"user:{own}", None)
    assert lab.access("unassigned", f"task:{lab.task}").status_code == 404
    assert lab.access("unassigned", f"slide:{lab.slide}").status_code == 404
    assert refused_as_outsider(lab.access("colleague", f"slide:{lab.slide}"))
    assert lab.access("owner", f"user:{own}").status_code == 404


@pytest.mark.db
def test_another_workspace_never_gets_a_token_for_this_workspace_rooms(lab: Lab) -> None:
    for room in (
        f"slide:{lab.slide}",
        f"task:{lab.task}",
        f"user:{lab.people['owner'].user_id}",
    ):
        response = lab.access("outsider", room)
        assert response.status_code == 404, room
        assert "token" not in response.json()


@pytest.mark.db
def test_an_unknown_room_is_not_found(lab: Lab) -> None:
    for room in ("case:1", f"case:{lab.slide}", "slide:nope", f"slide:{uuid.uuid4()}"):
        assert lab.access("owner", room).status_code == 404, room


@pytest.mark.db
def test_without_a_room_key_live_updates_are_unavailable(lab: Lab) -> None:
    settings = lab.api.app.settings
    lab.api.app.settings = settings.model_copy(update={"room_token_key": None})
    try:
        response = lab.access("owner", f"slide:{lab.slide}")
    finally:
        lab.api.app.settings = settings
    assert (response.status_code, response.json()["code"]) == (503, "realtime-not-configured")


@pytest.mark.db
def test_removal_from_a_project_closes_the_person_s_sockets_after_commit(
    database: str, lab: Lab
) -> None:
    colleague = lab.people["colleague"]
    join_project(database, lab.project, colleague, "viewer")
    assert lab.access("colleague", f"slide:{lab.slide}").status_code == 200
    lab.live.revoked.clear()
    removed = lab.api(lab.people["owner"]).delete(
        f"/api/projects/{lab.project}/members/{colleague.user_id}"
    )
    assert removed.status_code == 204, removed.text
    assert lab.live.revoked == [(lab.tenant_id, colleague.user_id, lab.project)]
    assert refused_as_outsider(lab.access("colleague", f"slide:{lab.slide}"))


def test_the_room_token_differs_from_a_tile_token() -> None:
    payload = VECTOR["token"].split(".")[0]
    claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
    assert "s" not in claims
    assert {"r", "u"} <= set(claims)


@pytest.mark.db
def test_erasing_a_person_closes_their_sockets_in_every_workspace(database: str, lab: Lab) -> None:
    leaver = make_workspace(database, {"leaver": Role.RESEARCHER}).people["leaver"]
    lab.live.revoked.clear()
    erased = lab.api(PlatformOperator(subject="operator-realtime")).post(
        f"/api/platform/users/{leaver.user_id}/erase"
    )
    assert erased.status_code == 200, erased.text
    assert lab.live.revoked == [(leaver.tenant_id, leaver.user_id, None)]
