import uuid
from collections.abc import AsyncIterator
from typing import Any

import pytest
from db_support import run_sql
from test_showcase import RESULTS
from test_showcase_annotation import example

from parfocal_api.disagreement_queue import QueueRowState, QueueTag, get_disagreement_queue
from parfocal_api.evaluation_report import get_evaluation_report
from parfocal_api.principals import MemberPrincipal
from parfocal_api.showcase import WORKSPACES
from parfocal_api.showcase_annotation import CHECKED_TASK, EXAMPLE_TASK
from parfocal_api.showcase_outcomes import (
    ADJUDICATOR_NOTE,
    CLASS_TASK,
    DATASET_NOTE,
    LATE_REASON,
    LEFT_OPEN_NOTE,
    OUTCOME_TASK,
    THREAD_TITLE,
)
from parfocal_api.tables import Role, TaskScope
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction

__all__ = ["example"]

pytestmark = pytest.mark.db


async def task_of(url: str, name: str) -> tuple[uuid.UUID, MemberPrincipal]:
    task_id, tenant_id, creator = (
        await run_sql(
            url,
            "SELECT t.id, t.tenant_id, t.created_by_user_id FROM review_tasks t "
            "JOIN tenants w ON w.id = t.tenant_id "
            f"WHERE t.name = '{name}' AND w.slug = '{WORKSPACES[0].slug}'",
        )
    )[0]
    principal = MemberPrincipal(
        "seed:ada", uuid.UUID(str(tenant_id)), uuid.UUID(str(creator)), Role.RESEARCHER, True
    )
    return uuid.UUID(str(task_id)), principal


async def as_owner(url: str, name: str) -> AsyncIterator[tuple[uuid.UUID, MemberPrincipal, Any]]:
    task_id, principal = await task_of(url, name)
    engine = create_engine(url)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=principal.tenant_id, user_id=principal.user_id)
        ) as connection:
            yield task_id, principal, connection
    finally:
        await engine.dispose()


async def test_the_signed_off_queue_holds_every_reason_and_every_answer(example: str) -> None:
    async for task_id, principal, connection in as_owner(example, OUTCOME_TASK):
        queue = await get_disagreement_queue(task_id, principal, connection, RESULTS)  # type: ignore[arg-type]
        assert {row.tag for row in queue.rows} == set(QueueTag)
        states = {row.state for row in queue.rows}
        assert {QueueRowState.DECIDED, QueueRowState.LEFT_OPEN, QueueRowState.ADJUDICATED} <= states
        raws = {row.decision.raw for row in queue.rows if row.decision is not None}
        assert {"agree", "disagree"} <= raws
        assert any(row.decision and row.decision.kept_type for row in queue.rows)
        assert any(row.settled_outline is not None for row in queue.rows)
        judged = next(row for row in queue.rows if row.state is QueueRowState.ADJUDICATED)
        assert judged.decision is not None
        assert judged.decision.note == ADJUDICATOR_NOTE
        left = next(row for row in queue.rows if row.state is QueueRowState.LEFT_OPEN)
        assert left.tag is QueueTag.SECOND
        assert left.decision is None
        assert (
            await run_sql(
                example,
                "SELECT count(*) FROM disagreement_decisions "
                f"WHERE task_id = '{task_id}' AND left_open AND note = '{LEFT_OPEN_NOTE}'",
            )
        )[0][0] == 1
        assert any(answer.retyped_to for row in queue.rows for answer in row.answers)


async def test_both_reviewers_looked_again_and_a_reviewer_added_a_missed_object(
    example: str,
) -> None:
    task_id, _ = await task_of(example, OUTCOME_TASK)
    asked = await run_sql(
        example,
        "SELECT count(*) FROM audit_events WHERE action = 'review.look-again-asked' "
        f"AND target_id = '{task_id}'",
    )
    assert asked[0][0] == 1
    added = await run_sql(
        example,
        f"SELECT count(*) FROM annotations WHERE task_id = '{task_id}' AND deleted_at IS NULL",
    )
    assert int(str(added[0][0])) >= 1


async def test_the_task_is_signed_frozen_exported_and_changed_after_sign_off(
    example: str,
) -> None:
    task_id, _ = await task_of(example, OUTCOME_TASK)
    signed = await run_sql(
        example, f"SELECT signed_off_at FROM review_tasks WHERE id = '{task_id}'"
    )
    assert signed[0][0] is not None
    frozen = await run_sql(
        example, f"SELECT number, note FROM dataset_versions WHERE task_id = '{task_id}'"
    )
    assert frozen == [(1, DATASET_NOTE)]
    exports = await run_sql(
        example,
        "SELECT status, input->>'format', input->>'dataset_version' FROM jobs "
        f"WHERE input->>'task_id' = '{task_id}'",
    )
    assert exports == [("done", "coco", "1")]
    layers = await run_sql(
        example, f"SELECT count(DISTINCT build) FROM final_layers WHERE task_id = '{task_id}'"
    )
    assert int(str(layers[0][0])) >= 2
    async for found_id, principal, connection in as_owner(example, OUTCOME_TASK):
        report = await get_evaluation_report(found_id, principal, connection, RESULTS)  # type: ignore[arg-type]
        assert [change.reason for change in report.changes] == [LATE_REASON]


async def test_the_class_task_is_decided_with_a_class(example: str) -> None:
    async for task_id, principal, connection in as_owner(example, CLASS_TASK):
        queue = await get_disagreement_queue(task_id, principal, connection, RESULTS)  # type: ignore[arg-type]
        decided = [row for row in queue.rows if row.decision is not None]
        assert decided
        assert decided[0].decision is not None
        assert decided[0].decision.raw not in {"agree", "disagree", "unsure"}


async def test_the_checked_annotate_task_signs_every_slide_under_every_check_rule(
    example: str,
) -> None:
    rows = await run_sql(
        example,
        "SELECT t.blind_first, t.check_options->>'sign_off', t.check_options->>'order', "
        "ts.signed_off_at IS NOT NULL, ts.result_set_id IS NULL, "
        "bool_and(a.submitted_at IS NOT NULL), bool_or(a.nothing_to_mark), count(a.user_id) "
        "FROM review_tasks t JOIN review_task_slides ts ON ts.task_id = t.id "
        "JOIN review_assignments a ON a.task_id = t.id AND a.slide_id = ts.slide_id "
        "JOIN tenants w ON w.id = t.tenant_id "
        f"WHERE t.name = '{CHECKED_TASK}' AND w.slug = '{WORKSPACES[0].slug}' "
        "GROUP BY t.id, ts.slide_id, ts.signed_off_at, ts.result_set_id "
        "ORDER BY ts.result_set_id IS NULL",
    )
    assert rows == [
        (True, "all-checked", "least-sure-first", True, False, True, False, 2),
        (True, "all-checked", "least-sure-first", True, True, True, True, 2),
    ]
    example_signed = await run_sql(
        example,
        "SELECT count(*) FROM review_task_slides ts JOIN review_tasks t ON t.id = ts.task_id "
        "JOIN tenants w ON w.id = t.tenant_id "
        f"WHERE t.name = '{EXAMPLE_TASK}' AND w.slug = '{WORKSPACES[0].slug}' "
        "AND ts.signed_off_at IS NOT NULL",
    )
    assert example_signed == [(1,)]


async def test_every_scope_is_used_and_a_review_object_has_a_mention_thread(example: str) -> None:
    used = await run_sql(
        example,
        "SELECT DISTINCT scope FROM review_tasks UNION "
        "SELECT DISTINCT part->>'kind' FROM review_tasks, jsonb_array_elements(extra_scopes) part",
    )
    assert {str(row[0]) for row in used} >= {kind.value for kind in TaskScope}
    task_id, _ = await task_of(example, OUTCOME_TASK)
    threads = await run_sql(
        example,
        "SELECT t.anchor_kind, t.object_id, m.body FROM threads t "
        "JOIN thread_messages m ON m.thread_id = t.id "
        f"WHERE t.task_id = '{task_id}' AND t.title = '{THREAD_TITLE}'",
    )
    assert len(threads) == 1
    kind, object_id, body = threads[0]
    assert kind == "object"
    assert object_id
    assert str(body).startswith("@[")
