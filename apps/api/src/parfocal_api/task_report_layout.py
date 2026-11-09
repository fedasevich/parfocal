import uuid

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import update

from parfocal_api.audit import AuditAction
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation_exports import task_layout
from parfocal_api.permissions import Permission, require
from parfocal_api.projects import ProjectArchivedError, owned
from parfocal_api.review_tasks import audit, readable_task, task_row
from parfocal_api.tables import review_tasks
from parfocal_common.report_blocks import ReportBlocks, ReportFormat

router = APIRouter(prefix="/api/review-tasks/{task_id}/report-layout", tags=["review-tasks"])


class TaskReportLayoutDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    blocks: ReportBlocks
    format: ReportFormat = ReportFormat()


class TaskReportLayout(TaskReportLayoutDraft):
    own: bool


async def layout_of(connection: TenantConnection, task: object) -> TaskReportLayout:
    blocks, report_format = await task_layout(connection, task)
    return TaskReportLayout(
        blocks=list(blocks),
        format=report_format,
        own=getattr(task, "report_layout", None) is not None,
    )


@router.get(
    "", operation_id="getTaskReportLayout", **require(Permission.SEE_SLIDES, emergency=True)
)
async def get_task_report_layout(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> TaskReportLayout:
    task, _ = await readable_task(connection, principal, task_id)
    return await layout_of(connection, task)


@router.put("", operation_id="setTaskReportLayout", **require(Permission.CREATE_CASES, write=True))
async def set_task_report_layout(
    task_id: uuid.UUID,
    draft: TaskReportLayoutDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> TaskReportLayout:
    row = await task_row(connection, task_id)
    project = await owned(connection, principal, row.project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    await connection.execute(
        update(review_tasks)
        .where(review_tasks.c.id == task_id)
        .values(report_layout=draft.model_dump(mode="json"))
    )
    await audit(
        connection,
        principal,
        AuditAction.TASK_REPORT_LAYOUT_CHANGED,
        row.tenant_id,
        task_id,
        {"blocks": len(draft.blocks), "signed_off": row.signed_off_at is not None},
    )
    return await layout_of(connection, await task_row(connection, task_id))
