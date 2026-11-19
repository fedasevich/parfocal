import uuid

from fastapi import APIRouter, BackgroundTasks
from sqlalchemy import func, update

from parfocal_api.audit import AuditAction
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal
from parfocal_api.projects import ProjectArchivedError, owned
from parfocal_api.realtime import RealtimeClient
from parfocal_api.review_tasks import ReviewTaskDetail, audit, detail_of, task_row
from parfocal_api.tables import review_tasks
from parfocal_api.worklist_events import announce_worklist, task_people

router = APIRouter(prefix="/api/review-tasks", tags=["review-tasks"])


@router.post(
    "/{task_id}/withdraw",
    operation_id="withdrawReviewTask",
    **require(Permission.CREATE_CASES, write=True),
)
async def withdraw_review_task(
    task_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    background: BackgroundTasks,
    live: RealtimeClient,
) -> ReviewTaskDetail:
    row = await task_row(connection, task_id)
    project = await owned(connection, principal, row.project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    if row.withdrawn_at is None:
        await connection.execute(
            update(review_tasks)
            .where(review_tasks.c.id == task_id)
            .values(
                withdrawn_at=func.now(),
                withdrawn_by_user_id=(
                    principal.user_id if isinstance(principal, MemberPrincipal) else None
                ),
            )
        )
        await audit(connection, principal, AuditAction.TASK_WITHDRAWN, row.tenant_id, task_id, {})
        announce_worklist(
            background, live, row.tenant_id, await task_people(connection, task_id), task=task_id
        )
    return await detail_of(connection, principal, await task_row(connection, task_id), True)
