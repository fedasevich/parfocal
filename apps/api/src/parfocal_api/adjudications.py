import string
import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Request, Response
from pydantic import BaseModel, Field, StringConstraints
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.disagreements import (
    UNDECIDED,
    Adjudication,
    DecidersOnlyError,
    DecisionDraft,
    QueuedObject,
    audit,
    counted_value,
    is_open,
    queue_of,
    store,
)
from parfocal_api.notification_catalogue import TargetKind
from parfocal_api.notifications import deliver_after_commit, notify
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.project_access import role_in
from parfocal_api.projects import code_of as project_code
from parfocal_api.review_tasks import code_of as task_code
from parfocal_api.review_tasks import readable_task, task_row
from parfocal_api.reviewed_layer import KINDS, TaskSignedOffError, ai_object
from parfocal_api.tables import (
    Availability,
    DecisionStyle,
    NotificationKind,
    ProjectRole,
    VerdictReason,
    VerdictValue,
    adjudication_objects,
    adjudications,
    memberships,
    project_members,
    projects,
    review_assignments,
    review_tasks,
    slides,
    users,
)
from parfocal_api.task_changes import person_of
from parfocal_common.disagreements import Why

type SendNote = Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)]


class ObjectRef(BaseModel):
    slide_id: uuid.UUID
    object: str


class AdjudicationDraft(BaseModel):
    adjudicator_user_id: uuid.UUID
    objects: Annotated[list[ObjectRef], Field(min_length=1, max_length=500)]
    note: SendNote | None = None


class DeclineDraft(BaseModel):
    note: SendNote | None = None


class Candidate(BaseModel):
    user_id: uuid.UUID
    display_name: str
    reviewer_of_task: bool
    away: bool


class ReviewerDecision(BaseModel):
    reviewer: str
    answer: str
    value: VerdictValue
    reasons: list[VerdictReason]
    note: str | None


class AdjudicatorDecision(BaseModel):
    answer: str | None
    answer_class_id: uuid.UUID | None
    value: VerdictValue
    note: str | None


class AdjudicatedObject(BaseModel):
    adjudication_id: uuid.UUID
    task_id: uuid.UUID
    slide_id: uuid.UUID
    object: str
    why: Why
    style: DecisionStyle
    note: str | None
    sent_at: datetime
    reviewer_decisions: list[ReviewerDecision]
    decision: AdjudicatorDecision | None = None


class ProjectRef(BaseModel):
    id: uuid.UUID
    code: str
    name: str


class MyAdjudication(BaseModel):
    id: uuid.UUID
    task_id: uuid.UUID
    task_code: str
    task_name: str
    project: ProjectRef
    asked_by_user_id: uuid.UUID | None
    slide_id: uuid.UUID
    slide_label: str
    objects: list[str]
    decided: int
    sent_at: datetime


class ReviewerOfTaskError(ConflictError):
    code = "reviewer-of-task"
    title = "A reviewer of this task cannot adjudicate it"


class NotProjectMemberError(BadRequestError):
    code = "not-a-project-member"
    title = "The adjudicator must be a member of this project"


class NotOpenError(ConflictError):
    code = "object-not-open"
    title = "Only open queued objects go to an adjudicator"


class AlreadyDeclinedError(ConflictError):
    code = "adjudication-declined"
    title = "This adjudication was already declined"


task_router = APIRouter(prefix="/api/review-tasks/{task_id}/disagreements", tags=["review-tasks"])
router = APIRouter(prefix="/api/adjudications", tags=["adjudications"])


async def owned_task(connection: AsyncConnection, principal: Principal, task_id: uuid.UUID) -> Any:
    task, _ = await readable_task(connection, principal, task_id)
    if await role_in(connection, principal, task.project_id) is not ProjectRole.OWNER:
        raise DecidersOnlyError
    return task


async def reviewers_of(connection: AsyncConnection, task_id: uuid.UUID) -> list[uuid.UUID]:
    rows = await connection.execute(
        select(review_assignments.c.user_id)
        .where(review_assignments.c.task_id == task_id)
        .group_by(review_assignments.c.user_id)
        .order_by(func.min(review_assignments.c.assigned_at), review_assignments.c.user_id)
    )
    return list(rows.scalars())


@task_router.get(
    "/adjudicators",
    operation_id="listAdjudicatorCandidates",
    **require(Permission.CREATE_CASES),
)
async def list_adjudicator_candidates(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[Candidate]:
    task = await owned_task(connection, principal, task_id)
    reviewers = set(await reviewers_of(connection, task_id))
    rows = await connection.execute(
        select(users.c.id, users.c.display_name, memberships.c.availability)
        .join(project_members, project_members.c.user_id == users.c.id)
        .join(
            memberships,
            (memberships.c.user_id == users.c.id)
            & (memberships.c.tenant_id == project_members.c.tenant_id),
        )
        .where(project_members.c.project_id == task.project_id)
        .order_by(users.c.display_name, users.c.id)
    )
    return [
        Candidate(
            user_id=row.id,
            display_name=row.display_name,
            reviewer_of_task=row.id in reviewers,
            away=row.availability == Availability.AWAY,
        )
        for row in rows
    ]


def find(queue: list[QueuedObject], slide_id: uuid.UUID, object_id: str) -> QueuedObject | None:
    found = ai_object(object_id)
    kind = KINDS[found.letter]
    return next(
        (
            item
            for item in queue
            if item.slide_id == slide_id and item.kind is kind and item.number == found.number
        ),
        None,
    )


async def chosen(
    connection: AsyncConnection, task: Any, draft: AdjudicationDraft
) -> list[QueuedObject]:
    queue = await queue_of(connection, task.id)
    picked: dict[tuple[uuid.UUID, str], QueuedObject] = {}
    for ref in draft.objects:
        item = find(queue, ref.slide_id, ref.object)
        if item is None:
            raise NotFoundError("This object is not in the disagreement queue")
        if not is_open(item) or item.looking_again:
            raise NotOpenError
        picked[(item.slide_id, item.object)] = item
    return list(picked.values())


async def check_adjudicator(connection: AsyncConnection, task: Any, user_id: uuid.UUID) -> None:
    if user_id in await reviewers_of(connection, task.id):
        raise ReviewerOfTaskError
    member = await connection.scalar(
        select(project_members.c.role).where(
            project_members.c.project_id == task.project_id, project_members.c.user_id == user_id
        )
    )
    if member is None:
        raise NotProjectMemberError


@task_router.post(
    "/adjudications",
    operation_id="sendToAdjudicator",
    status_code=201,
    **require(Permission.CREATE_CASES, write=True),
)
async def send_to_adjudicator(
    task_id: uuid.UUID,
    draft: AdjudicationDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    http: Request,
    background: BackgroundTasks,
) -> list[QueuedObject]:
    task = await owned_task(connection, principal, task_id)
    if task.signed_off_at is not None:
        raise TaskSignedOffError
    await check_adjudicator(connection, task, draft.adjudicator_user_id)
    items = await chosen(connection, task, draft)
    adjudication_id = await connection.scalar(
        insert(adjudications)
        .values(
            tenant_id=task.tenant_id,
            task_id=task_id,
            adjudicator_user_id=draft.adjudicator_user_id,
            sent_by_user_id=principal.user_id if isinstance(principal, MemberPrincipal) else None,
            note=draft.note or None,
        )
        .returning(adjudications.c.id)
    )
    await connection.execute(
        insert(adjudication_objects),
        [
            {
                "adjudication_id": adjudication_id,
                "tenant_id": task.tenant_id,
                "task_id": task_id,
                "slide_id": item.slide_id,
                "kind": item.kind,
                "number": item.number,
            }
            for item in items
        ],
    )
    await notify(
        connection,
        task.tenant_id,
        [draft.adjudicator_user_id],
        NotificationKind.ADJUDICATION_REQUESTED,
        TargetKind.TASK,
        task_id,
        {"adjudication_id": str(adjudication_id), "objects": len(items)},
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.REVIEW_ADJUDICATION_SENT,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=task.tenant_id,
        details={
            "adjudication_id": str(adjudication_id),
            "adjudicator": await person_of(connection, draft.adjudicator_user_id),
            "objects": [f"{item.slide_id}/{item.object}" for item in items],
            "noted": bool(draft.note),
        },
    )
    background.add_task(deliver_after_commit, http.app, task.tenant_id)
    sent = {(item.slide_id, item.object) for item in items}
    return [
        item for item in await queue_of(connection, task_id) if (item.slide_id, item.object) in sent
    ]


def me(principal: Principal) -> uuid.UUID:
    if not isinstance(principal, MemberPrincipal):
        raise NotFoundError("Adjudication not found")
    return principal.user_id


async def adjudicated(
    connection: AsyncConnection, task: Any, user_id: uuid.UUID
) -> list[AdjudicatedObject]:
    queue = [
        (item, item.adjudication)
        for item in await queue_of(connection, task.id)
        if item.adjudication is not None
        and item.adjudication.active
        and item.adjudication.adjudicator_user_id == user_id
    ]
    if not queue:
        return []
    letters = {
        person: string.ascii_uppercase[index % 26]
        for index, person in enumerate(await reviewers_of(connection, task.id))
    }
    return [shown(item, sent, task, letters, user_id) for item, sent in queue]


def shown(
    item: QueuedObject,
    sent: Adjudication,
    task: Any,
    letters: dict[uuid.UUID, str],
    user_id: uuid.UUID,
) -> AdjudicatedObject:
    decision = item.decision
    return AdjudicatedObject(
        adjudication_id=sent.id,
        task_id=task.id,
        slide_id=item.slide_id,
        object=item.object,
        why=item.why,
        style=DecisionStyle(task.decision_style),
        note=sent.note,
        sent_at=sent.sent_at,
        reviewer_decisions=sorted(
            (
                ReviewerDecision(
                    reviewer=letters[given.user_id],
                    answer=given.answer,
                    value=given.value,
                    reasons=given.reasons,
                    note=given.note,
                )
                for given in item.reviewers()
            ),
            key=lambda given: given.reviewer,
        ),
        decision=AdjudicatorDecision(
            answer=decision.answer,
            answer_class_id=decision.answer_class_id,
            value=decision.value,
            note=item.note,
        )
        if decision is not None and decision.decided_by_user_id == user_id
        else None,
    )


@router.get("/objects", operation_id="listAdjudicationObjects", **require(Permission.REVIEW))
async def list_adjudication_objects(
    principal: CurrentPrincipal, connection: TenantConnection, task_id: uuid.UUID | None = None
) -> list[AdjudicatedObject]:
    user_id = me(principal)
    query = (
        select(adjudications.c.task_id)
        .where(
            adjudications.c.adjudicator_user_id == user_id, adjudications.c.declined_at.is_(None)
        )
        .group_by(adjudications.c.task_id)
        .order_by(func.min(adjudications.c.sent_at))
    )
    if task_id is not None:
        query = query.where(adjudications.c.task_id == task_id)
    found: list[AdjudicatedObject] = []
    for task in (await connection.execute(query)).scalars():
        found += await adjudicated(connection, await task_row(connection, task), user_id)
    return found


@router.put(
    "/{task_id}/{slide_id}/{object_id}",
    operation_id="decideAsAdjudicator",
    **require(Permission.REVIEW, write=True),
)
async def decide_as_adjudicator(
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    object_id: str,
    draft: DecisionDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> AdjudicatedObject:
    user_id = me(principal)
    task = await task_row(connection, task_id)
    item = find(await queue_of(connection, task_id), slide_id, object_id)
    if (
        item is None
        or not item.with_adjudicator()
        or item.adjudication is None
        or item.adjudication.adjudicator_user_id != user_id
    ):
        raise NotFoundError("Adjudication not found")
    if task.signed_off_at is not None:
        raise TaskSignedOffError
    found = ai_object(object_id)
    value = await counted_value(connection, task, slide_id, found, draft)
    values = UNDECIDED | {
        "style": task.decision_style,
        "answer": draft.answer,
        "answer_class_id": draft.answer_class_id,
        "value": value,
        "note": draft.note or None,
        "decided_by_user_id": user_id,
    }
    await store(connection, task, slide_id, found, values, values)
    await audit(
        connection,
        principal,
        AuditAction.REVIEW_DECISION_SET,
        task,
        slide_id,
        found,
        {
            "style": task.decision_style,
            "answer": draft.answer,
            "value": value.value,
            "adjudication_id": str(item.adjudication.id),
        },
    )
    mine = await adjudicated(connection, task, user_id)
    return next(
        shown for shown in mine if (shown.slide_id, shown.object) == (slide_id, item.object)
    )


@router.post(
    "/{adjudication_id}/decline",
    operation_id="declineAdjudication",
    status_code=204,
    **require(Permission.REVIEW, write=True),
)
async def decline_adjudication(
    adjudication_id: uuid.UUID,
    draft: DeclineDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> Response:
    user_id = me(principal)
    row = (
        await connection.execute(
            select(adjudications).where(
                adjudications.c.id == adjudication_id,
                adjudications.c.adjudicator_user_id == user_id,
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Adjudication not found")
    if row.declined_at is not None:
        raise AlreadyDeclinedError
    await connection.execute(
        update(adjudications)
        .where(adjudications.c.id == adjudication_id)
        .values(declined_at=func.now(), declined_note=draft.note or None)
    )
    await record(
        connection,
        actor_of(principal),
        AuditAction.REVIEW_ADJUDICATION_DECLINED,
        AuditTarget.REVIEW_TASK,
        row.task_id,
        tenant_id=row.tenant_id,
        details={"adjudication_id": str(adjudication_id), "noted": bool(draft.note)},
    )
    return Response(status_code=204)


@router.get("", operation_id="listMyAdjudications", **require(Permission.REVIEW))
async def list_my_adjudications(
    principal: CurrentPrincipal, connection: TenantConnection
) -> list[MyAdjudication]:
    user_id = me(principal)
    sends = await connection.execute(
        select(
            adjudications,
            review_tasks.c.number.label("task_number"),
            review_tasks.c.name.label("task_name"),
            projects.c.id.label("project_id"),
            projects.c.number.label("project_number"),
            projects.c.name.label("project_name"),
        )
        .join(review_tasks, review_tasks.c.id == adjudications.c.task_id)
        .join(projects, projects.c.id == review_tasks.c.project_id)
        .where(
            adjudications.c.adjudicator_user_id == user_id,
            adjudications.c.declined_at.is_(None),
            review_tasks.c.archived_at.is_(None),
        )
        .order_by(adjudications.c.sent_at, adjudications.c.id)
    )
    queues: dict[uuid.UUID, list[QueuedObject]] = {}
    found: list[MyAdjudication] = []
    for send in sends:
        if send.task_id not in queues:
            queues[send.task_id] = await queue_of(connection, send.task_id)
        items = [
            item
            for item in queues[send.task_id]
            if item.adjudication is not None and item.adjudication.id == send.id
        ]
        if not items:
            continue
        label = await connection.scalar(
            select(slides.c.label).where(slides.c.id == items[0].slide_id)
        )
        found.append(
            MyAdjudication(
                id=send.id,
                task_id=send.task_id,
                task_code=task_code(send.task_number),
                task_name=send.task_name,
                project=ProjectRef(
                    id=send.project_id,
                    code=project_code(send.project_number),
                    name=send.project_name,
                ),
                asked_by_user_id=send.sent_by_user_id,
                slide_id=items[0].slide_id,
                slide_label=label or "",
                objects=[item.object for item in items],
                decided=sum(
                    item.decision is not None and item.decision.decided_by_user_id == user_id
                    for item in items
                ),
                sent_at=send.sent_at,
            )
        )
    return found
