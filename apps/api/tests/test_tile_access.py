import base64
import hashlib
import hmac
import json
import time
import uuid
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs, api_as
from pydantic import SecretStr
from storage_support import with_store
from workspace_support import join_project, make_project, make_slide, make_workspace, owner

from parfocal_api.audit import actor_of
from parfocal_api.tables import Role
from parfocal_api.tile_access import (
    REFRESH_GRACE_SECONDS,
    TOKEN_SECONDS,
    sign_capability,
    viewer_of,
)
from parfocal_common.ingest import original_key, restricted_ranges_key
from parfocal_common.object_store import StorageLocation

VECTOR = json.loads(
    (Path(__file__).resolve().parents[2] / "edge" / "test" / "capability-vector.json").read_text()
)
SECRET = VECTOR["secret"]
FILE_BYTES = 50_000
RANGES = [[1000, 2000], [30_000, 34_000]]


def test_the_api_signs_the_token_the_edge_expects() -> None:
    assert sign_capability(SECRET, VECTOR["claims"]) == VECTOR["token"]


def claims_of(token: str) -> dict[str, Any]:
    payload, signature = token.split(".")
    expected = hmac.new(base64.b64decode(SECRET), payload.encode(), hashlib.sha256).digest()
    assert base64.urlsafe_b64decode(signature + "=" * (-len(signature) % 4)) == expected
    decoded: dict[str, Any] = json.loads(
        base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4))
    )
    return decoded


@dataclass(frozen=True)
class Lab:
    api: ApiAs
    tenant_id: uuid.UUID
    people: dict[str, Any]
    slide: uuid.UUID
    bare: uuid.UUID
    unstored: uuid.UUID
    patient: str
    patients_slide: uuid.UUID

    def path(self, slide: uuid.UUID) -> str:
        return f"/api/slides/{slide}/tile-access"


def stored_slide(
    database: str,
    tenant_id: uuid.UUID,
    project: uuid.UUID,
    label: str,
    case_id: uuid.UUID | None = None,
) -> uuid.UUID:
    slide = make_slide(database, tenant_id, project, label, case_id)
    key = original_key(tenant_id, slide, "upload.svs")
    owner(
        database,
        f"UPDATE slides SET original_key = '{key}', file_bytes = {FILE_BYTES} WHERE id = '{slide}'",
    )
    return slide


@pytest.fixture(scope="module")
def lab(database: str, storage: StorageLocation) -> Iterator[Lab]:
    assert storage.bucket
    workspace = make_workspace(
        database,
        {
            "owner": Role.RESEARCHER,
            "colleague": Role.RESEARCHER,
            "admin": Role.RESEARCHER,
            "unassigned": Role.REVIEWER,
        },
        admins={"admin"},
    )
    people: dict[str, Any] = dict(workspace.people)
    people["outsider"] = make_workspace(database, {"outsider": Role.RESEARCHER}).people["outsider"]
    project = make_project(database, workspace.tenant_id)
    join_project(database, project, people["owner"], "owner")
    join_project(database, project, people["colleague"], "owner")
    join_project(database, project, people["unassigned"], "reviewer")
    slide = stored_slide(database, workspace.tenant_id, project, "A1")
    bare = stored_slide(database, workspace.tenant_id, project, "A2")
    unstored = make_slide(database, workspace.tenant_id, project, "A3")
    body = json.dumps({"ranges": RANGES}).encode()
    key = restricted_ranges_key(workspace.tenant_id, slide)
    with_store(lambda store: store.put_object(key, body, "application/json"))
    with api_as(database) as api:
        api.app.settings = api.app.settings.model_copy(update={"tile_token_key": SecretStr(SECRET)})
        case = api(people["owner"]).post(
            "/api/cases",
            json={"project_id": str(project), "label": "C-1", "patient": {"name": "Jana Nováková"}},
        )
        assert case.status_code == 201, case.text
        patients_slide = stored_slide(
            database, workspace.tenant_id, project, "B1", uuid.UUID(case.json()["id"])
        )
        yield Lab(
            api,
            workspace.tenant_id,
            people,
            slide,
            bare,
            unstored,
            case.json()["patient"]["id"],
            patients_slide,
        )


@pytest.mark.db
def test_a_reader_gets_a_short_lived_token_for_the_slide(lab: Lab) -> None:
    started = int(time.time())
    response = lab.api(lab.people["owner"]).get(lab.path(lab.slide))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["base_path"] == f"/tiles/{lab.slide}/"
    assert body["original"] == "original.svs"
    assert body["lifetime_seconds"] == TOKEN_SECONDS
    claims = claims_of(body["token"])
    assert {key: claims[key] for key in "tsond"} == {
        "t": str(lab.tenant_id),
        "s": str(lab.slide),
        "o": "original.svs",
        "n": FILE_BYTES,
        "d": RANGES,
    }
    assert started + TOKEN_SECONDS <= claims["e"] <= int(time.time()) + TOKEN_SECONDS


@pytest.mark.db
def test_a_slide_without_recorded_ranges_keeps_its_whole_original_closed(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(lab.path(lab.bare))
    assert response.status_code == 200, response.text
    assert claims_of(response.json()["token"])["d"] == [[0, FILE_BYTES]]


@pytest.mark.db
@pytest.mark.parametrize(("who", "status"), [("outsider", 404), ("unassigned", 404)])
def test_a_person_who_cannot_read_the_slide_gets_no_token(lab: Lab, who: str, status: int) -> None:
    response = lab.api(lab.people[who]).get(lab.path(lab.slide))
    assert response.status_code == status, response.text
    assert "token" not in response.json()


@pytest.mark.db
def test_a_slide_without_a_stored_file_gets_no_token(lab: Lab) -> None:
    response = lab.api(lab.people["owner"]).get(lab.path(lab.unstored))
    assert response.status_code == 404
    assert response.json()["code"] == "slide-file-not-found"


@pytest.mark.db
def test_no_token_is_signed_without_a_key(lab: Lab) -> None:
    configured = lab.api.app.settings
    lab.api.app.settings = configured.model_copy(update={"tile_token_key": None})
    try:
        response = lab.api(lab.people["owner"]).get(lab.path(lab.slide))
    finally:
        lab.api.app.settings = configured
    assert response.status_code == 503
    assert response.json()["code"] == "tile-access-not-configured"


def opens(database: str, lab: Lab, slide: uuid.UUID) -> list[tuple[Any, ...]]:
    return owner(
        database,
        "SELECT target_type, actor_id, details FROM audit_events "
        f"WHERE tenant_id = '{lab.tenant_id}' AND action = 'slide.opened' "
        f"AND target_id = '{slide}' ORDER BY seq",
    )


def mint(lab: Lab, who: str, slide: uuid.UUID, previous: str | None = None) -> str:
    headers = {} if previous is None else {"Previous-Tile-Token": previous}
    response = lab.api(lab.people[who]).get(lab.path(slide), headers=headers)
    assert response.status_code == 200, response.text
    token: str = response.json()["token"]
    return token


def resigned(token: str, **changes: Any) -> str:
    return sign_capability(SECRET, claims_of(token) | changes)


@pytest.mark.db
def test_opening_a_slide_records_one_audit_entry_and_refreshing_records_none(
    database: str, lab: Lab
) -> None:
    before = len(opens(database, lab, lab.bare))
    first = mint(lab, "owner", lab.bare)
    second = mint(lab, "owner", lab.bare, previous=first)
    mint(lab, "owner", lab.bare, previous=second)
    entries = opens(database, lab, lab.bare)[before:]
    assert len(entries) == 1
    assert entries[0][0] == "slide"
    assert json.loads(entries[0][2]) == {}
    assert claims_of(first)["a"] == viewer_of(actor_of(lab.people["owner"]))


@pytest.mark.db
def test_a_previous_token_that_does_not_continue_the_open_records_a_new_one(
    database: str, lab: Lab
) -> None:
    held = mint(lab, "owner", lab.bare)
    stale = int(time.time()) - REFRESH_GRACE_SECONDS - 5
    payload, signature = held.split(".")
    forged = f"{payload}.{signature[::-1]}"
    other_slide = mint(lab, "owner", lab.slide)
    for previous in [
        resigned(held, e=stale),
        forged,
        other_slide,
        "not-a-token",
        sign_capability(base64.b64encode(b"y" * 32).decode(), claims_of(held)),
    ]:
        before = len(opens(database, lab, lab.bare))
        mint(lab, "owner", lab.bare, previous=previous)
        assert len(opens(database, lab, lab.bare)) == before + 1
    before = len(opens(database, lab, lab.bare))
    mint(lab, "colleague", lab.bare, previous=held)
    assert len(opens(database, lab, lab.bare)) == before + 1


@pytest.mark.db
def test_a_refused_token_records_no_open(database: str, lab: Lab) -> None:
    before = len(opens(database, lab, lab.slide))
    assert lab.api(lab.people["unassigned"]).get(lab.path(lab.slide)).status_code == 404
    assert len(opens(database, lab, lab.slide)) == before


@pytest.mark.db
def test_a_slide_open_shows_in_the_patients_audit_trail(lab: Lab) -> None:
    mint(lab, "colleague", lab.patients_slide)
    response = lab.api(lab.people["admin"]).get(
        "/api/tenant/audit-events", params={"patient_id": lab.patient}
    )
    assert response.status_code == 200, response.text
    opened = [event for event in response.json() if event["action"] == "slide.opened"]
    assert [event["target_id"] for event in opened] == [str(lab.patients_slide)]
