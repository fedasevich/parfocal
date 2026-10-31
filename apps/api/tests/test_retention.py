import asyncio
import uuid
from datetime import timedelta
from typing import Any

import pytest
from db_support import APP_URL, ApiAs, with_database
from test_audit import trail
from workspace_support import Workspace, make_project, make_workspace, owner

from parfocal_api.audit import AuditEvent, chain_breaks, event_hash
from parfocal_api.retention import RETENTION, schedule_retention
from parfocal_api.tables import Role
from parfocal_common.db import async_database_url, create_engine
from parfocal_common.jobs import work

pytestmark = pytest.mark.db

SQUARE = "SRID=0;POLYGON((0 0,9 0,9 9,0 9,0 0))"


def team(database: str) -> Workspace:
    return make_workspace(
        database, {"admin": Role.RESEARCHER, "researcher": Role.RESEARCHER}, admins={"admin"}
    )


def one(database: str, statement: str) -> uuid.UUID:
    return uuid.UUID(str(owner(database, statement)[0][0]))


def slide(database: str, w: Workspace, project: uuid.UUID, deleted_days: int | None) -> uuid.UUID:
    deleted = f"now() - interval '{deleted_days} days'" if deleted_days is not None else "NULL"
    return one(
        database,
        "INSERT INTO slides (tenant_id, project_id, label, deleted_at) "
        f"VALUES ('{w.tenant_id}', '{project}', 'S-{uuid.uuid4().hex[:6]}', {deleted}) "
        "RETURNING id",
    )


def annotation(
    database: str, w: Workspace, project: uuid.UUID, on: uuid.UUID, deleted_days: int
) -> uuid.UUID:
    found = one(
        database,
        "INSERT INTO annotations (tenant_id, project_id, slide_id, kind, number, geometry, "
        f"deleted_at) VALUES ('{w.tenant_id}', '{project}', '{on}', 'region', "
        f"{deleted_days + 1}, '{SQUARE}', now() - interval '{deleted_days} days') RETURNING id",
    )
    owner(
        database,
        "INSERT INTO annotation_versions (tenant_id, annotation_id, version, change, geometry) "
        f"VALUES ('{w.tenant_id}', '{found}', 1, 'created', '{SQUARE}')",
    )
    return found


def result_set(
    database: str, w: Workspace, project: uuid.UUID, on: uuid.UUID, deleted_days: int
) -> uuid.UUID:
    found = one(
        database,
        "INSERT INTO result_sets (tenant_id, project_id, slide_id, name, source, status) "
        f"VALUES ('{w.tenant_id}', '{project}', '{on}', 'Model', 'import', 'importing') "
        "RETURNING id",
    )
    owner(
        database,
        "INSERT INTO result_objects (tenant_id, result_set_id, kind, number, geometry) "
        f"VALUES ('{w.tenant_id}', '{found}', 'region', 1, '{SQUARE}')",
    )
    owner(
        database,
        f"UPDATE result_sets SET status = 'ready', deleted_at = now() - interval "
        f"'{deleted_days} days' WHERE id = '{found}'",
    )
    return found


def exists(database: str, table: str, row: uuid.UUID) -> bool:
    return owner(database, f"SELECT count(*) FROM {table} WHERE id = '{row}'") == [(1,)]


def run_retention(database: str, w: Workspace) -> int:
    async def go() -> list[uuid.UUID]:
        engine = create_engine(async_database_url(with_database(APP_URL, database)))
        try:
            scheduled = await schedule_retention(engine)
            await work(engine, [RETENTION], "test", idle_exit_seconds=0.2, poll_seconds=0.1)
            return scheduled
        finally:
            await engine.dispose()

    scheduled = asyncio.run(go())
    mine = owner(
        database,
        f"SELECT id, status FROM jobs WHERE tenant_id = '{w.tenant_id}' AND kind = 'retention'",
    )
    ran = [row for row in mine if row[0] in scheduled]
    assert all(row[1] == "done" for row in ran), ran
    return len(ran)


def set_policy(api: ApiAs, w: Workspace, **policy: Any) -> None:
    response = api(w.people["admin"]).put("/api/tenant/retention", json=policy)
    assert response.status_code == 200, response.text


def age_audit_entries(database: str, w: Workspace, count: int, days: int) -> None:
    rows = owner(
        database,
        "SELECT id, tenant_id, seq, occurred_at, actor_kind, actor_id, action, target_type, "
        f"target_id, details FROM audit_events WHERE tenant_id = '{w.tenant_id}' ORDER BY seq",
    )
    previous = bytes(32).hex()
    updates: list[str] = []
    for index, row in enumerate(rows):
        values = dict(
            zip(
                (
                    "id",
                    "tenant_id",
                    "seq",
                    "occurred_at",
                    "actor_kind",
                    "actor_id",
                    "action",
                    "target_type",
                    "target_id",
                    "details",
                ),
                row,
                strict=True,
            )
        )
        event = AuditEvent.model_validate({**values, "prev_hash": previous, "hash": ""})
        if index < count:
            event = event.model_copy(
                update={"occurred_at": event.occurred_at - timedelta(days=days)}
            )
        digest = event_hash(event)
        updates.append(
            f"UPDATE audit_events SET occurred_at = '{event.occurred_at.isoformat()}', "
            f"prev_hash = decode('{previous}', 'hex'), hash = decode('{digest}', 'hex') "
            f"WHERE id = '{event.id}';"
        )
        previous = digest
    owner(
        database,
        "DO $$ BEGIN PERFORM set_config('session_replication_role', 'replica', true); "
        + " ".join(updates)
        + " END $$",
    )


def test_the_scheduled_job_purges_expired_records_and_keeps_held_and_used_ones(
    api: ApiAs, database: str
) -> None:
    w = team(database)
    project = make_project(database, w.tenant_id, "de-identified")
    held_project = make_project(database, w.tenant_id, "de-identified")
    live = slide(database, w, project, None)
    old_annotation = annotation(database, w, project, live, 40)
    recent_annotation = annotation(database, w, project, live, 5)
    old_set = result_set(database, w, project, live, 40)
    pinned_set = result_set(database, w, project, live, 40)
    owner(
        database,
        "INSERT INTO review_tasks (tenant_id, project_id, number, name, split, scope, "
        "opinion_form_version, start_mode) "
        f"VALUES ('{w.tenant_id}', '{project}', 1, 'Pinned', 'everyone', 'all-regions', 1, "
        "'guided')",
    )
    owner(
        database,
        "INSERT INTO review_task_slides (tenant_id, project_id, task_id, slide_id, position, "
        f"result_set_id) SELECT '{w.tenant_id}', '{project}', id, '{live}', 0, '{pinned_set}' "
        f"FROM review_tasks WHERE tenant_id = '{w.tenant_id}'",
    )
    gone_slide = slide(database, w, project, 40)
    held_slide = slide(database, w, held_project, 40)
    held_annotation = annotation(database, w, held_project, held_slide, 40)
    hold = api(w.people["admin"]).post(
        "/api/tenant/legal-holds", json={"project_id": str(held_project), "reason": "Court order"}
    )
    assert hold.status_code == 201, hold.text
    set_policy(api, w, deleted_after_days=30)
    assert run_retention(database, w) == 1
    assert not exists(database, "annotations", old_annotation)
    assert owner(
        database,
        f"SELECT count(*) FROM annotation_versions WHERE annotation_id = '{old_annotation}'",
    ) == [(0,)]
    assert not exists(database, "result_sets", old_set)
    assert owner(
        database, f"SELECT count(*) FROM result_objects WHERE result_set_id = '{old_set}'"
    ) == [(0,)]
    assert not exists(database, "slides", gone_slide)
    for kept, table in (
        (recent_annotation, "annotations"),
        (pinned_set, "result_sets"),
        (held_slide, "slides"),
        (held_annotation, "annotations"),
        (live, "slides"),
    ):
        assert exists(database, table, kept), table
    purged = {
        (event.target_type, str(event.target_id))
        for event in trail(api, w.people["admin"], action="retention.purged")
    }
    assert purged == {
        ("annotation", str(old_annotation)),
        ("result-set", str(old_set)),
        ("slide", str(gone_slide)),
    }
    assert run_retention(database, w) == 0


def test_old_audit_entries_are_purged_and_the_chain_verifies_from_the_anchor(
    api: ApiAs, database: str
) -> None:
    w = team(database)
    for days in (100, 200, 300):
        set_policy(api, w, deleted_after_days=days)
    before = trail(api, w.people["admin"])
    assert len(before) == 3
    age_audit_entries(database, w, 2, 400)
    assert chain_breaks(trail(api, w.people["admin"])) == []
    set_policy(api, w, deleted_after_days=300, audit_after_days=365)
    assert run_retention(database, w) == 1
    after = trail(api, w.people["admin"])
    assert min(event.seq for event in after) == 3
    [anchor] = [event for event in after if event.action == "audit.purged"]
    assert '"count":2' in anchor.details
    assert '"through_seq":2' in anchor.details
    assert chain_breaks(after) == []
    tampered = [
        event.model_copy(update={"details": "{}"}) if event.seq == 3 else event for event in after
    ]
    assert chain_breaks(tampered) == [3]


def test_a_workspace_hold_stops_every_purge(api: ApiAs, database: str) -> None:
    w = team(database)
    project = make_project(database, w.tenant_id, "de-identified")
    old = slide(database, w, project, 40)
    hold = api(w.people["admin"]).post("/api/tenant/legal-holds", json={"reason": "Audit"})
    assert hold.status_code == 201, hold.text
    set_policy(api, w, deleted_after_days=30, audit_after_days=365)
    age_audit_entries(database, w, 2, 400)
    count = len(trail(api, w.people["admin"]))
    run_retention(database, w)
    assert exists(database, "slides", old)
    assert len(trail(api, w.people["admin"])) == count
    released = api(w.people["admin"]).post(f"/api/tenant/legal-holds/{hold.json()['id']}/release")
    assert released.json()["released_at"] is not None
    owner(database, f"DELETE FROM jobs WHERE tenant_id = '{w.tenant_id}' AND kind = 'retention'")
    run_retention(database, w)
    assert not exists(database, "slides", old)


def test_retention_settings_are_checked_and_only_admins_change_them(
    api: ApiAs, database: str
) -> None:
    w = team(database)
    assert api(w.people["admin"]).get("/api/tenant/retention").json() == {
        "deleted_after_days": None,
        "audit_after_days": None,
    }
    assert (
        api(w.people["admin"])
        .put("/api/tenant/retention", json={"audit_after_days": 30})
        .status_code
        == 422
    )
    assert (
        api(w.people["admin"])
        .put("/api/tenant/retention", json={"deleted_after_days": 0})
        .status_code
        == 422
    )
    assert api(w.people["researcher"]).get("/api/tenant/retention").status_code == 200
    assert api(w.people["researcher"]).put("/api/tenant/retention", json={}).status_code == 403
    assert (
        api(w.people["researcher"])
        .post("/api/tenant/legal-holds", json={"reason": "No"})
        .status_code
        == 403
    )
    missing = api(w.people["admin"]).post(
        "/api/tenant/legal-holds", json={"project_id": str(uuid.uuid4()), "reason": "Unknown"}
    )
    assert (missing.status_code, missing.json()["code"]) == (404, "project-not-found")
