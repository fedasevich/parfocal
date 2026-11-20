import uuid
from collections.abc import Mapping
from dataclasses import dataclass

from fastapi import BackgroundTasks
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.adjudications import AdjudicationDraft, ObjectRef, send_to_adjudicator
from parfocal_api.decision_styles import DecisionSettings
from parfocal_api.disagreements import queue_of
from parfocal_api.principals import MemberPrincipal
from parfocal_api.realtime import NoRealtime
from parfocal_api.review_tasks import Scope, SlideSet, TaskDraft, create_review_task
from parfocal_api.seed_request import seed_request
from parfocal_api.tables import (
    DecisionReason,
    DecisionStyle,
    DecisionValue,
    TaskKind,
    TaskScope,
    TaskSplit,
    adjudications,
    review_assignments,
    review_decisions,
    review_tasks,
)
from parfocal_common.result_store import ResultStore

QUEUE_TASK = "Disagreement queue example"


@dataclass
class Seeded:
    tenant_id: uuid.UUID
    people: dict[str, uuid.UUID]
    owner: uuid.UUID | None = None


async def decide(
    connection: AsyncConnection,
    seeded: Seeded,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    key: str,
    value: DecisionValue,
    reasons: list[DecisionReason] | None = None,
) -> None:
    await connection.execute(
        insert(review_decisions).values(
            tenant_id=seeded.tenant_id,
            project_id=project_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=seeded.people[key],
            kind="region",
            number=1,
            value=value,
            style=DecisionStyle.AGREE,
            answer=value,
            reasons=[reason.value for reason in reasons or []],
        )
    )


async def submit(connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID) -> None:
    await connection.execute(
        update(review_assignments)
        .where(review_assignments.c.task_id == task_id, review_assignments.c.slide_id == slide_id)
        .values(submitted_at=func.now())
    )


async def agree_and_submit(
    connection: AsyncConnection,
    seeded: Seeded,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
) -> None:
    for key in ("rhea", "remy"):
        await decide(connection, seeded, project_id, task_id, slide_id, key, DecisionValue.AGREE)
    await submit(connection, task_id, slide_id)


async def review_task(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    name: str,
    sets: Mapping[uuid.UUID, uuid.UUID | None],
    reviewers: list[uuid.UUID],
    style: DecisionStyle,
    kind: TaskKind = TaskKind.REVIEW,
    template_id: uuid.UUID | None = None,
    scope: Scope | None = None,
) -> uuid.UUID:
    reviewing = kind is TaskKind.REVIEW
    draft = TaskDraft(
        name=name,
        kind=kind,
        slide_ids=list(sets),
        result_sets=[
            SlideSet(slide_id=slide_id, result_set_id=set_id)
            for slide_id, set_id in sets.items()
            if set_id is not None
        ],
        reviewer_ids=reviewers,
        split=TaskSplit.EVERYONE,
        scope=(scope or Scope(kind=TaskScope.ALL_REGIONS)) if reviewing else None,
        blinded=False,
        decision=DecisionSettings(style=style) if reviewing else None,
    )
    if template_id is not None:
        draft = draft.model_copy(update={"study_template_id": template_id})
    task = await create_review_task(
        project_id,
        draft,
        principal,
        connection,
        results,
        NoRealtime(),
        BackgroundTasks(),
        seed_request(),
    )
    return task.id


async def seed_adjudication(
    connection: AsyncConnection, creator: MemberPrincipal, adjudicator: uuid.UUID
) -> None:
    task = (
        await connection.execute(
            select(review_tasks.c.id, review_tasks.c.project_id).where(
                review_tasks.c.tenant_id == creator.tenant_id,
                review_tasks.c.name == QUEUE_TASK,
            )
        )
    ).one_or_none()
    if task is None:
        return
    sent = await connection.scalar(
        select(adjudications.c.id).where(adjudications.c.task_id == task.id).limit(1)
    )
    if sent is not None:
        return
    first = (await queue_of(connection, task.id))[0]
    await send_to_adjudicator(
        task.id,
        AdjudicationDraft(
            adjudicator_user_id=adjudicator,
            objects=[ObjectRef(slide_id=first.slide_id, object=first.object)],
        ),
        creator,
        connection,
        seed_request(),
        BackgroundTasks(),
    )
