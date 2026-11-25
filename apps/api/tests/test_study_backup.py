import asyncio
import base64
import gzip
import json
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import replace
from datetime import date
from typing import Any

import httpx2
import pytest
from db_support import APP_URL, ApiAs, with_database
from storage_support import TEST_STORAGE
from workspace_support import make_workspace

from parfocal_api.principals import MemberPrincipal
from parfocal_api.study_backup import (
    BackupReport,
    DefenceDateMissingError,
    DefenceNotPassedError,
    DeleteReport,
    StudyBackupNotConfiguredError,
    StudyBackupSettings,
    backup_every_workspace,
    delete_after_defence,
    run,
    session_object_key,
    trace_object_key,
)
from parfocal_api.tables import Role
from parfocal_common.db import create_engine
from parfocal_common.object_store import ObjectStore, StorageLocation

SESSION = "s1-1764000000000"
ANSWERS: dict[str, Any] = {
    "id": SESSION,
    "participant": "P-7KQ2",
    "round": 5,
    "tasks": [{"id": "open-case", "success": True, "durationMs": 3100, "seq": 6}],
    "final": {"sus": [5, 1, 5, 1, 5, 1, 5, 1, 5, 1], "susScore": 100},
}
PARTS: dict[int, list[dict[str, Any]]] = {
    1764000000001: [{"t": 1, "k": "task", "taskId": "open-case", "edge": "start"}],
    1764000000002: [{"t": 2, "k": "key", "key": "•"}],
}
BEFORE_DEFENCE = date(2026, 6, 1)
DEFENCE = date(2026, 6, 30)
AFTER_DEFENCE = date(2026, 7, 1)


def packed(value: object) -> str:
    return base64.b64encode(gzip.compress(json.dumps(value).encode())).decode()


@pytest.fixture
def seat(database: str) -> MemberPrincipal:
    return make_workspace(database, {"seat": Role.RESEARCHER}).people["seat"]


@pytest.fixture
def bucket() -> StorageLocation:
    location = replace(TEST_STORAGE, bucket=f"study-{uuid.uuid4().hex[:12]}")
    with_store(location, lambda store: store.create_bucket())
    return location


def with_store[T](location: StorageLocation, work: Callable[[ObjectStore], Awaitable[T]]) -> T:
    async def go() -> T:
        async with httpx2.AsyncClient(timeout=30) as http:
            return await work(ObjectStore(location, http))

    return asyncio.run(go())


def with_engine_and_store[T](
    database: str,
    location: StorageLocation,
    work: Callable[[Any, ObjectStore], Awaitable[T]],
) -> T:
    async def go() -> T:
        engine = create_engine(with_database(APP_URL, database))
        try:
            async with httpx2.AsyncClient(timeout=30) as http:
                return await work(engine, ObjectStore(location, http))
        finally:
            await engine.dispose()

    return asyncio.run(go())


def backup(database: str, location: StorageLocation, today: date) -> BackupReport:
    return with_engine_and_store(
        database,
        location,
        lambda engine, store: backup_every_workspace(engine, store, DEFENCE, today),
    )


def remove(
    database: str, location: StorageLocation, defence: date | None, today: date
) -> DeleteReport:
    return with_engine_and_store(
        database,
        location,
        lambda engine, store: delete_after_defence(engine, store, defence, today),
    )


def stored(location: StorageLocation) -> dict[str, bytes]:
    async def read(store: ObjectStore) -> dict[str, bytes]:
        keys = await store.list_keys("study/")
        return {key: await store.get_stored_bytes(key) for key in keys}

    return with_store(location, read)


def own(location: StorageLocation, tenant_id: uuid.UUID) -> dict[str, bytes]:
    return {
        key: body for key, body in stored(location).items() if key.startswith(f"study/{tenant_id}/")
    }


def record_session(api: ApiAs, seat: MemberPrincipal, answers: dict[str, Any]) -> None:
    saved = api(seat).put(
        f"/api/me/study-sessions/{SESSION}",
        json={"participant": "P-7KQ2", "round": 5, "answers_gz": packed(answers)},
    )
    assert saved.status_code == 200, saved.text
    for seq, events in PARTS.items():
        part = api(seat).put(
            f"/api/me/study-sessions/{SESSION}/trace/{seq}", json={"events_gz": packed(events)}
        )
        assert part.status_code == 200, part.text


@pytest.mark.db
def test_a_backup_of_a_fake_session_reads_back_with_no_names(
    api: ApiAs, database: str, seat: MemberPrincipal, bucket: StorageLocation
) -> None:
    record_session(api, seat, ANSWERS)

    first = backup(database, bucket, BEFORE_DEFENCE)
    session_key = session_object_key(seat.tenant_id, SESSION)
    trace_keys = [trace_object_key(seat.tenant_id, SESSION, seq) for seq in PARTS]
    everything = stored(bucket)
    objects = own(bucket, seat.tenant_id)
    assert set(objects) == {session_key, *trace_keys}
    assert first.written == first.objects == len(everything)
    assert first.size == sum(len(body) for body in everything.values())

    session = json.loads(gzip.decompress(objects[session_key]))
    assert session.pop("created_at")
    assert session.pop("updated_at")
    assert session == {
        "session_key": SESSION,
        "participant": "P-7KQ2",
        "round": 5,
        "dry_run": False,
        "answers": ANSWERS,
    }
    for seq, key in zip(PARTS, trace_keys, strict=True):
        assert json.loads(gzip.decompress(objects[key])) == PARTS[seq]
    for body in objects.values():
        text = gzip.decompress(body).decode()
        assert seat.subject not in text
        assert str(seat.user_id) not in text
        assert "@" not in text

    assert backup(database, bucket, BEFORE_DEFENCE) == replace(first, written=0)
    record_session(api, seat, {**ANSWERS, "final": {"susScore": 90}})
    assert backup(database, bucket, BEFORE_DEFENCE).written == 1
    changed = json.loads(gzip.decompress(own(bucket, seat.tenant_id)[session_key]))
    assert changed["answers"]["final"] == {"susScore": 90}


@pytest.mark.db
def test_the_delete_step_refuses_without_a_passed_defence_date(
    api: ApiAs, database: str, seat: MemberPrincipal, bucket: StorageLocation
) -> None:
    record_session(api, seat, ANSWERS)
    backup(database, bucket, BEFORE_DEFENCE)

    with pytest.raises(DefenceDateMissingError):
        remove(database, bucket, None, AFTER_DEFENCE)
    with pytest.raises(DefenceNotPassedError):
        remove(database, bucket, DEFENCE, BEFORE_DEFENCE)
    with pytest.raises(DefenceNotPassedError):
        remove(database, bucket, DEFENCE, DEFENCE)

    assert len(own(bucket, seat.tenant_id)) == 3


@pytest.mark.db
def test_the_delete_step_on_a_past_date_leaves_only_the_anonymous_tables(
    api: ApiAs, database: str, bucket: StorageLocation
) -> None:
    people = make_workspace(
        database, {"seat": Role.RESEARCHER, "moderator": Role.RESEARCHER}
    ).people
    seat, moderator = people["seat"], people["moderator"]
    record_session(api, seat, ANSWERS)
    backup(database, bucket, BEFORE_DEFENCE)

    report = remove(database, bucket, DEFENCE, AFTER_DEFENCE)

    assert report.trace_rows == report.trace_objects >= 2
    assert not [key for key in stored(bucket) if "/trace/" in key]
    assert set(own(bucket, seat.tenant_id)) == {session_object_key(seat.tenant_id, SESSION)}
    trace = api(moderator).get(f"/api/tenant/study-sessions/{SESSION}/trace")
    assert trace.status_code == 200, trace.text
    assert trace.json() == {"parts": []}
    [row] = api(moderator).get("/api/tenant/study-sessions").json()["sessions"]
    assert row["answers"] == ANSWERS
    assert row["trace_parts"] == 0

    record_session(api, seat, ANSWERS)
    assert backup(database, bucket, AFTER_DEFENCE).written == 0
    assert set(own(bucket, seat.tenant_id)) == {session_object_key(seat.tenant_id, SESSION)}


def test_without_a_bucket_the_backup_is_a_no_op_and_the_delete_refuses() -> None:
    settings = StudyBackupSettings.model_validate(
        {"app_env": "dev", "database_url": "postgresql://parfocal_app@localhost:1/parfocal"}
    )
    today = date(2026, 11, 25)
    assert asyncio.run(run(settings, "backup", today)) == {"written": 0, "objects": 0, "size": 0}
    with pytest.raises(StudyBackupNotConfiguredError):
        asyncio.run(run(settings, "delete", today))


def test_the_backup_goes_nowhere_until_its_bucket_is_set() -> None:
    base = {
        "app_env": "dev",
        "database_url": "postgresql://parfocal_app@localhost:6432/parfocal",
    }
    assert StudyBackupSettings.model_validate(base).backup_location() is None
    assert StudyBackupSettings.model_validate(base).study_defence_date is None
    location = StudyBackupSettings.model_validate(
        {**base, "study_backup_bucket": "parfocal-prod"}
    ).backup_location()
    assert location is not None
    assert location.bucket == "parfocal-prod"
    assert location.key_prefix == ""
    with pytest.raises(ValueError, match="STUDY_BACKUP_SECRET_ACCESS_KEY"):
        StudyBackupSettings.model_validate(
            {
                "app_env": "prod",
                "database_url": "postgresql://parfocal_app@neon.example/parfocal?ssl=require",
                "study_backup_bucket": "parfocal-prod",
                "study_backup_endpoint": "https://account.r2.cloudflarestorage.com",
            }
        )
