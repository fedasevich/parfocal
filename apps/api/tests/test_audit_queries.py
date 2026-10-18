import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey
from db_support import ApiAs
from workspace_support import make_workspace

from parfocal_api.audit import AuditEvent, chain_breaks, event_hash
from parfocal_api.audit_trail import signed_bytes
from parfocal_api.principals import MemberPrincipal
from parfocal_api.tables import Role

pytestmark = pytest.mark.db

REASON = "Patient asked the department about this result"
EVENTS = "/api/tenant/audit-events"


@dataclass(frozen=True)
class History:
    people: dict[str, MemberPrincipal]
    project: str
    case: str
    patient: str
    other_case: str
    started: datetime


def history(api: ApiAs, database: str) -> History:
    people = make_workspace(
        database,
        {
            "admin": Role.ADMIN,
            "owner": Role.RESEARCHER,
            "outsider": Role.RESEARCHER,
            "reviewer": Role.REVIEWER,
        },
    ).people
    started = datetime.now(UTC) - timedelta(seconds=1)
    owner = api(people["owner"])
    project = owner.post("/api/projects", json={"name": "Audit", "privacy_mode": "clinical"})
    project_id = project.json()["id"]
    case = owner.post(
        "/api/cases",
        json={"project_id": project_id, "label": "S26-1", "patient": {"name": "Eva Testová"}},
    ).json()
    other = owner.post("/api/cases", json={"project_id": project_id, "label": "S26-2"}).json()
    granted = api(people["admin"]).post(
        f"/api/projects/{project_id}/emergency-access", json={"reason": REASON}
    )
    assert granted.status_code == 201, granted.text
    changed = api(people["admin"]).put(
        f"/api/tenant/members/{people['reviewer'].user_id}/role", json={"role": "researcher"}
    )
    assert changed.status_code == 200, changed.text
    return History(people, project_id, case["id"], case["patient"]["id"], other["id"], started)


def actions(api: ApiAs, admin: MemberPrincipal, **filters: Any) -> list[str]:
    response = api(admin).get(EVENTS, params=filters)
    assert response.status_code == 200, response.text
    return [event["action"] for event in response.json()]


def test_each_filter_narrows_the_trail(api: ApiAs, database: str) -> None:
    past = history(api, database)
    admin = past.people["admin"]
    assert actions(api, admin, person=str(past.people["owner"].user_id)) == [
        "project.created",
        "case.created",
        "case.created",
    ]
    assert actions(api, admin, person=str(past.people["reviewer"].user_id)) == [
        "member.role-changed"
    ]
    assert actions(api, admin, patient_id=past.patient) == [
        "case.created",
        "project.emergency-access",
    ]
    assert actions(api, admin, case_id=past.other_case) == ["case.created"]
    assert actions(api, admin, project_id=past.project) == [
        "project.created",
        "project.emergency-access",
    ]
    assert actions(api, admin, action="member.role-changed") == ["member.role-changed"]
    assert actions(api, admin, action_prefix="project.") == [
        "project.created",
        "project.emergency-access",
    ]
    assert actions(api, admin, since=past.started.isoformat()) == actions(api, admin)
    assert actions(api, admin, until=past.started.isoformat()) == []


def test_only_admins_query_and_export_the_trail(api: ApiAs, database: str) -> None:
    past = history(api, database)
    for label in ("owner", "reviewer"):
        client = api(past.people[label])
        assert client.get(EVENTS).status_code == 403
        assert client.get(f"{EVENTS}/export").status_code == 403
        assert client.get(f"{EVENTS}/signing-keys").status_code == 403


def public_key(api: ApiAs, admin: MemberPrincipal, key_id: str) -> Ed25519PublicKey:
    keys = api(admin).get(f"{EVENTS}/signing-keys").json()
    (key,) = [row for row in keys if row["key_id"] == key_id]
    raw = base64.urlsafe_b64decode(key["public_key"] + "=" * (-len(key["public_key"]) % 4))
    return Ed25519PublicKey.from_public_bytes(raw)


def signature_of(document: dict[str, Any]) -> bytes:
    value = document["signature"]["value"]
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def test_a_signed_export_verifies_and_matches_the_chain(api: ApiAs, database: str) -> None:
    past = history(api, database)
    admin = past.people["admin"]
    response = api(admin).get(f"{EVENTS}/export", params={"patient_id": past.patient})
    assert response.status_code == 200, response.text
    document = response.json()
    assert (document["format"], document["version"], document["filters"]) == (
        "parfocal-audit-export",
        1,
        {"patient_id": past.patient},
    )
    key = public_key(api, admin, document["signature"]["key_id"])
    key.verify(signature_of(document), signed_bytes(document))
    tampered = json.loads(json.dumps(document))
    tampered["events"][0]["action"] = "case.opened"
    with pytest.raises(InvalidSignature):
        key.verify(signature_of(tampered), signed_bytes(tampered))
    exported = [AuditEvent.model_validate(event) for event in document["events"]]
    assert all(event_hash(event) == event.hash for event in exported)
    full = [AuditEvent.model_validate(row) for row in api(admin).get(EVENTS).json()]
    assert chain_breaks(full) == []
    by_seq = {event.seq: event.hash for event in full}
    assert all(by_seq[event.seq] == event.hash for event in exported)
    marked = [(e["action"], e["emergency"], e["reason"]) for e in document["events"]]
    assert marked == [("case.created", False, None), ("project.emergency-access", True, REASON)]
    assert document["chain_head"]["seq"] == max(by_seq) - 1
    assert actions(api, admin, action="audit.exported") == ["audit.exported"]


def test_another_workspace_cannot_verify_with_its_own_key(api: ApiAs, database: str) -> None:
    mine, theirs = history(api, database), history(api, database)
    document = api(mine.people["admin"]).get(f"{EVENTS}/export").json()
    other_key = public_key(api, theirs.people["admin"], document["signature"]["key_id"])
    with pytest.raises(InvalidSignature):
        other_key.verify(signature_of(document), signed_bytes(document))
