import asyncio
import json
import uuid
from collections.abc import AsyncIterator, Iterator
from typing import Any

import pytest
from db_support import OWNER_URL, migrated_database, run_sql, with_database
from fastapi import BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncConnection
from test_showcase import RESULTS, EmptyStore

from parfocal_api.annotate_import import LayerImport, import_shared_objects
from parfocal_api.annotate_layer import get_shared_layer, list_shared_object_history
from parfocal_api.annotation_exports import ExportFormat, export_slide_objects
from parfocal_api.evaluation import class_names
from parfocal_api.layer_groups import get_shared_layer_groups
from parfocal_api.my_work import list_my_review_tasks
from parfocal_api.principals import MemberPrincipal
from parfocal_api.realtime import NoRealtime
from parfocal_api.showcase import WORKSPACES, seed
from parfocal_api.showcase_annotation import (
    CELLS_GROUP,
    EXAMPLE_NOTE,
    EXAMPLE_SLIDE,
    EXAMPLE_TASK,
    OUTLINES_GROUP,
)
from parfocal_api.tables import AnnotationChange, AnnotationKind, AnnotationOrigin, Role
from parfocal_common import flatgeobuf
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction

pytestmark = pytest.mark.db

OWNER = "owner@example.test"
AGENT = "agent-example@example.test"


@pytest.fixture(scope="module")
def example() -> Iterator[str]:
    with migrated_database() as name:
        url = with_database(OWNER_URL, name)
        asyncio.run(
            seed(
                url,
                EmptyStore(),  # type: ignore[arg-type]
                RESULTS,  # type: ignore[arg-type]
                OWNER,
                agent_emails=[AGENT],
            )
        )
        yield url


async def person(url: str, email: str) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID, MemberPrincipal]:
    task_id, slide_id, tenant_id, user_id = (
        await run_sql(
            url,
            "SELECT t.id, ts.slide_id, t.tenant_id, u.id FROM review_tasks t "
            "JOIN review_task_slides ts ON ts.task_id = t.id "
            "JOIN slides s ON s.id = ts.slide_id "
            "JOIN review_assignments a ON a.task_id = t.id AND a.slide_id = ts.slide_id "
            "JOIN users u ON u.id = a.user_id JOIN tenants w ON w.id = t.tenant_id "
            f"WHERE t.name = '{EXAMPLE_TASK}' AND s.label = '{EXAMPLE_SLIDE}' "
            f"AND u.email = '{email}' AND w.slug = '{WORKSPACES[0].slug}'",
        )
    )[0]
    principal = MemberPrincipal(
        f"seed:{email}",
        uuid.UUID(str(tenant_id)),
        uuid.UUID(str(user_id)),
        Role.RESEARCHER,
        True,
    )
    return uuid.UUID(str(task_id)), uuid.UUID(str(slide_id)), principal.tenant_id, principal


async def in_layer(url: str, email: str = OWNER) -> AsyncIterator[Any]:
    task_id, slide_id, tenant_id, principal = await person(url, email)
    engine = create_engine(url)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=tenant_id, user_id=principal.user_id)
        ) as connection:
            yield task_id, slide_id, principal, connection
    finally:
        await engine.dispose()


async def downloaded(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    format: ExportFormat,
) -> tuple[bytes, int]:
    response = await export_slide_objects(
        slide_id,
        principal,
        connection,
        RESULTS,  # type: ignore[arg-type]
        format,
        None,
        task_id,
    )
    parts = [
        part if isinstance(part, bytes) else str(part).encode()
        async for part in response.body_iterator
    ]
    return b"".join(parts), int(response.headers["X-Object-Count"])


async def test_both_accounts_open_the_example_from_my_work(example: str) -> None:
    for email in (OWNER, AGENT):
        async for task_id, _, principal, connection in in_layer(example, email):
            mine = await list_my_review_tasks(principal, connection)
            assert task_id in {task.id for task in mine}


async def test_the_example_holds_shapes_in_every_class_and_typed_cells(example: str) -> None:
    async for task_id, slide_id, principal, connection in in_layer(example):
        layer = await get_shared_layer(task_id, slide_id, principal, connection)
        live = [item for item in layer.objects if item.deleted_at is None]
        names = await class_names(connection, (await project_of(example, task_id)))
        regions = {item.class_id for item in live if item.kind is AnnotationKind.REGION}
        assert set(names) <= regions
        cells = [item for item in live if item.kind is AnnotationKind.CELL]
        assert {item.class_id for item in cells if item.origin is AnnotationOrigin.HUMAN} == set(
            names
        )
        assert {item.origin for item in cells} == {
            AnnotationOrigin.HUMAN,
            AnnotationOrigin.AI_CONFIRMED,
            AnnotationOrigin.AI_EDITED,
        }
        assert any(
            item.origin is AnnotationOrigin.AI_EDITED and item.deleted_at is not None
            for item in layer.objects
        )
        assert {item.text for item in live if item.kind is AnnotationKind.TEXT} == {EXAMPLE_NOTE}
        assert any(item.kind is AnnotationKind.MEASUREMENT for item in live)
        assert layer.result_set_id is not None


async def project_of(url: str, task_id: uuid.UUID) -> uuid.UUID:
    rows = await run_sql(url, f"SELECT project_id FROM review_tasks WHERE id = '{task_id}'")
    return uuid.UUID(str(rows[0][0]))


async def test_the_example_keeps_the_history_of_edits_and_ai_changes(example: str) -> None:
    async for task_id, slide_id, principal, connection in in_layer(example):
        layer = await get_shared_layer(task_id, slide_id, principal, connection)
        changes: dict[tuple[str, str], list[list[AnnotationChange]]] = {}
        for item in layer.objects:
            history = await list_shared_object_history(
                task_id, slide_id, item.id, principal, connection
            )
            key = (item.kind.value, item.origin.value)
            changes.setdefault(key, []).append([version.change for version in history])
            assert all(version.changed_by_user_id == principal.user_id for version in history)
        created, edited, deleted = (
            AnnotationChange.CREATED,
            AnnotationChange.EDITED,
            AnnotationChange.DELETED,
        )
        assert [created, edited, edited] in changes[("region", "human")]
        assert [created, edited] in changes[("cell", "ai-edited")]
        assert [edited] in changes[("cell", "ai-edited")]
        assert [deleted] in changes[("cell", "ai-edited")]
        assert [created] in changes[("cell", "ai-confirmed")]


async def test_the_example_saves_two_named_groups_in_the_shared_task(example: str) -> None:
    async for task_id, slide_id, principal, connection in in_layer(example):
        saved = await get_shared_layer_groups(task_id, slide_id, principal, connection)
        assert [group.name for group in saved.groups] == [OUTLINES_GROUP, CELLS_GROUP]
        layer = await get_shared_layer(task_id, slide_id, principal, connection)
        kinds = {item.id: item.kind for item in layer.objects if item.deleted_at is None}
        by_group: dict[int, set[AnnotationKind]] = {}
        for member in saved.members:
            by_group.setdefault(member.group_id, set()).add(kinds[member.annotation_id])
        assert by_group == {1: {AnnotationKind.REGION}, 2: {AnnotationKind.CELL}}


def feature_list(format: ExportFormat, data: bytes) -> dict[str, Any]:
    if format is ExportFormat.FLATGEOBUF:
        return {"type": "FeatureCollection", "features": flatgeobuf.read_features(data)}
    return json.loads(data)


@pytest.mark.parametrize("format", list(ExportFormat))
async def test_each_export_downloads_and_imports_back_cleanly(
    example: str, format: ExportFormat
) -> None:
    async for task_id, slide_id, principal, connection in in_layer(example):
        layer = await get_shared_layer(task_id, slide_id, principal, connection)
        live = [item for item in layer.objects if item.deleted_at is None]
        data, count = await downloaded(connection, principal, task_id, slide_id, format)
        assert count == len(live)
        content = feature_list(format, data)
        savepoint = await connection.begin_nested()
        imported = await import_shared_objects(
            task_id,
            slide_id,
            LayerImport(file_name=f"example.{format.value}", content=content),
            principal,
            connection,
            BackgroundTasks(),
            NoRealtime(),
        )
        await savepoint.rollback()
        assert imported.skipped == []
        assert imported.unknown_classes == []
        assert sorted(
            (item.kind, str(item.class_id), item.text) for item in imported.objects
        ) == sorted((item.kind, str(item.class_id), item.text) for item in live)
