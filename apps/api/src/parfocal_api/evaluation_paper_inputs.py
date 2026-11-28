import uuid
from typing import Any
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.disagreement_queue import get_disagreement_queue
from parfocal_api.evaluation import Evaluation, evaluate
from parfocal_api.evaluation_paper import Compared, PaperInputs, style_of
from parfocal_api.evaluation_report import get_evaluation_report
from parfocal_api.problems import ProblemError
from parfocal_api.review_order import Results
from parfocal_api.review_tasks import readable_task, task_of
from parfocal_api.tables import users
from parfocal_api.task_kinds import review_only
from parfocal_common.report_blocks import Comparison


async def names_of(connection: AsyncConnection, ids: set[uuid.UUID]) -> dict[str, str]:
    if not ids:
        return {}
    rows = await connection.execute(
        select(users.c.id, users.c.display_name).where(users.c.id.in_(ids))
    )
    return {str(row.id): row.display_name for row in rows}


async def compared_of(
    connection: AsyncConnection, principal: Any, blocks: list[Any], results: Results
) -> dict[str, Compared]:
    compared: dict[str, Compared] = {}
    for block in blocks:
        if not isinstance(block, Comparison) or block.task_id is None:
            continue
        try:
            other, whole = await readable_task(connection, principal, block.task_id)
            review_only(other.kind)
            if not whole:
                continue
            report = await get_evaluation_report(block.task_id, principal, connection, results)
        except ProblemError:
            continue
        compared[str(block.task_id)] = Compared(report, await evaluate(connection, other, results))
    return compared


async def paper_inputs(
    connection: AsyncConnection,
    principal: Any,
    task: Any,
    results: Results,
    evaluation: Evaluation,
    checksum: str,
    zone: ZoneInfo | None,
) -> PaperInputs:
    report = await get_evaluation_report(task.id, principal, connection, results)
    queue = await get_disagreement_queue(task.id, principal, connection, results)
    detail = task_of(task, 0, 0)
    ids = {
        *report.reviewer_ids,
        *([report.signed_by_user_id] if report.signed_by_user_id else []),
        *(change.by_user_id for change in report.changes if change.by_user_id),
        *(answer.user_id for row in queue.rows for answer in row.answers),
        *(
            change.changed_by_user_id
            for change in detail.counts_as_changes
            if change.changed_by_user_id
        ),
    }
    blocks = list(report.template.blocks)
    return PaperInputs(
        report=report,
        evaluation=evaluation,
        queue=queue.rows,
        changes=report.changes,
        blocks=blocks,
        format=report.template.format,
        template_version=report.template.version,
        names=await names_of(connection, ids),
        style=style_of(detail.decision),
        counts_as_changes=detail.counts_as_changes,
        compared=await compared_of(connection, principal, blocks, results),
        checksum=checksum,
        zone=zone,
    )
