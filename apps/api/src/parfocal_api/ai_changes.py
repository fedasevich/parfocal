import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.adjudications import reviewers_of
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.evaluation import EvaluationHiddenError
from parfocal_api.permissions import Permission, require
from parfocal_api.report_template import ReportAiChange, ReportAiChanges
from parfocal_api.review_order import CheckState, Results, state_of
from parfocal_api.review_tasks import readable_task
from parfocal_api.reviewed_export import path_parts
from parfocal_api.tables import AnnotationKind, AnnotationOrigin, annotations, review_task_slides
from parfocal_api.task_kinds import annotate_only
from parfocal_api.taxonomy import ProjectClass
from parfocal_api.training_exports import (
    EXPORTED_KINDS,
    Letters,
    ManifestAnnotator,
    ai_shapes,
    last_changers,
)
from parfocal_common.result_store import ResultStore

UNCLASSIFIED = "unclassified"


class Change(StrEnum):
    CONFIRMED = "confirmed"
    EDITED = "edited"
    DELETED = "deleted"
    UNCHECKED = "unchecked"
    ADDED = "added"


CHANGE_OF_STATE: Mapping[CheckState, Change] = {
    CheckState.CONFIRMED: Change.CONFIRMED,
    CheckState.EDITED: Change.EDITED,
    CheckState.DELETED: Change.DELETED,
    CheckState.UNCHECKED: Change.UNCHECKED,
}


class PersonChanges(BaseModel):
    letter: str
    confirmed: int
    edited: int
    deleted: int
    added: int


class Changes(BaseModel):
    ai_objects: int
    confirmed: int
    edited: int
    deleted: int
    unchecked: int
    added: int
    by: list[PersonChanges]


class ClassChanges(Changes):
    class_id: uuid.UUID | None
    class_name: str


class SlideChanges(BaseModel):
    slide_id: uuid.UUID
    slide: str
    result_set_id: uuid.UUID | None
    classes: list[ClassChanges]
    total: Changes


class AiChanges(BaseModel):
    task_id: uuid.UUID
    experts: list[ManifestAnnotator]
    slides: list[SlideChanges]
    classes: list[ClassChanges]
    total: Changes


@dataclass(frozen=True)
class Event:
    slide_id: uuid.UUID
    class_id: uuid.UUID | None
    class_name: str
    change: Change
    person: str | None


router = APIRouter(prefix="/api/review-tasks/{task_id}/evaluation", tags=["review-tasks"])


def letter_order(letter: str) -> tuple[int, str]:
    return len(letter), letter


def changes_of(events: Iterable[Event]) -> Changes:
    counted = dict.fromkeys(Change, 0)
    people: dict[str, dict[Change, int]] = defaultdict(lambda: dict.fromkeys(Change, 0))
    for event in events:
        counted[event.change] += 1
        if event.person is not None and event.change is not Change.UNCHECKED:
            people[event.person][event.change] += 1
    return Changes(
        ai_objects=sum(counted[change] for change in Change if change is not Change.ADDED),
        confirmed=counted[Change.CONFIRMED],
        edited=counted[Change.EDITED],
        deleted=counted[Change.DELETED],
        unchecked=counted[Change.UNCHECKED],
        added=counted[Change.ADDED],
        by=[
            PersonChanges(
                letter=letter,
                confirmed=found[Change.CONFIRMED],
                edited=found[Change.EDITED],
                deleted=found[Change.DELETED],
                added=found[Change.ADDED],
            )
            for letter, found in sorted(people.items(), key=lambda item: letter_order(item[0]))
        ],
    )


def per_class(events: list[Event], keys: Mapping[uuid.UUID, int]) -> list[ClassChanges]:
    grouped: dict[tuple[uuid.UUID | None, str], list[Event]] = defaultdict(list)
    for event in events:
        grouped[(event.class_id, event.class_name)].append(event)

    def order(item: tuple[uuid.UUID | None, str]) -> tuple[int, int, str]:
        class_id, name = item
        if class_id is not None and class_id in keys:
            return 0, keys[class_id], name
        return (2 if name == UNCLASSIFIED else 1), 0, name

    return [
        ClassChanges(
            class_id=class_id,
            class_name=name,
            **changes_of(grouped[(class_id, name)]).model_dump(),
        )
        for class_id, name in sorted(grouped, key=order)
    ]


def tallied(
    task_id: uuid.UUID,
    slides: list[tuple[uuid.UUID, str, uuid.UUID | None]],
    events: list[Event],
    letters: Letters,
    snapshot: list[ProjectClass],
) -> AiChanges:
    keys = {item.id: item.key for item in snapshot}
    return AiChanges(
        task_id=task_id,
        experts=letters.listed(),
        slides=[
            SlideChanges(
                slide_id=slide_id,
                slide=label,
                result_set_id=set_id,
                classes=per_class([event for event in events if event.slide_id == slide_id], keys),
                total=changes_of(event for event in events if event.slide_id == slide_id),
            )
            for slide_id, label, set_id in slides
        ],
        classes=per_class(events, keys),
        total=changes_of(events),
    )


def people_text(changes: Changes) -> str:
    return ", ".join(
        f"{person.letter} {person.confirmed + person.edited + person.deleted + person.added}"
        for person in changes.by
    )


def report_row(name: str, changes: Changes) -> ReportAiChange:
    return ReportAiChange(
        name=name,
        ai_objects=changes.ai_objects,
        confirmed=changes.confirmed,
        edited=changes.edited,
        deleted=changes.deleted,
        unchecked=changes.unchecked,
        added=changes.added,
        by=people_text(changes),
    )


def report_changes(changes: AiChanges) -> ReportAiChanges:
    return ReportAiChanges(
        classes=tuple(report_row(item.class_name, item) for item in changes.classes),
        slides=tuple(report_row(item.slide, item.total) for item in changes.slides),
        total=report_row("", changes.total),
    )


def class_of(
    class_id: uuid.UUID | None, source_name: str | None, classes: Mapping[uuid.UUID, ProjectClass]
) -> tuple[uuid.UUID | None, str]:
    found = classes.get(class_id) if class_id is not None else None
    if found is not None:
        return found.id, found.name
    return None, source_name or UNCLASSIFIED


async def slide_events(
    connection: AsyncConnection,
    store: ResultStore,
    task_id: uuid.UUID,
    slide: Any,
    letters: Letters,
    classes: Mapping[uuid.UUID, ProjectClass],
) -> list[Event]:
    rows = (
        await connection.execute(
            select(
                annotations.c.id,
                annotations.c.kind,
                annotations.c.origin,
                annotations.c.source_number,
                annotations.c.class_id,
                annotations.c.created_by_user_id,
                annotations.c.deleted_at,
            ).where(annotations.c.task_id == task_id, annotations.c.slide_id == slide.slide_id)
        )
    ).all()
    changers = await last_changers(connection, [row.id for row in rows])
    copies = {
        (AnnotationKind(row.kind), row.source_number): row
        for row in rows
        if row.source_number is not None and row.origin != AnnotationOrigin.HUMAN
    }
    ai = (
        {}
        if slide.result_set_id is None
        else await ai_shapes(connection, store, slide.result_set_id)
    )
    events: list[Event] = []
    for key, shape in ai.items():
        copy = copies.get(key)
        state = (
            CheckState.UNCHECKED
            if copy is None
            else state_of(copy.origin, copy.deleted_at is not None)
        )
        person = (
            None
            if copy is None or state is CheckState.UNCHECKED
            else letters.of(changers.get(copy.id, copy.created_by_user_id))
        )
        class_id, name = class_of(shape.class_id, shape.class_name, classes)
        events.append(Event(slide.slide_id, class_id, name, CHANGE_OF_STATE[state], person))
    for row in rows:
        if (
            row.origin != AnnotationOrigin.HUMAN
            or row.deleted_at is not None
            or AnnotationKind(row.kind) not in EXPORTED_KINDS
        ):
            continue
        class_id, name = class_of(row.class_id, None, classes)
        events.append(
            Event(slide.slide_id, class_id, name, Change.ADDED, letters.of(row.created_by_user_id))
        )
    return events


async def ai_changes(connection: AsyncConnection, task: Any, store: ResultStore) -> AiChanges:
    snapshot = [ProjectClass.model_validate(item) for item in task.class_snapshot or []]
    classes = {item.id: item for item in snapshot}
    letters = Letters(await reviewers_of(connection, task.id))
    rows = (
        await connection.execute(
            select(review_task_slides.c.slide_id, review_task_slides.c.result_set_id)
            .where(review_task_slides.c.task_id == task.id)
            .order_by(review_task_slides.c.position)
        )
    ).all()
    slides: list[tuple[uuid.UUID, str, uuid.UUID | None]] = []
    events: list[Event] = []
    for row in rows:
        slides.append(
            (row.slide_id, (await path_parts(connection, row.slide_id))[2], row.result_set_id)
        )
        events.extend(await slide_events(connection, store, task.id, row, letters, classes))
    return tallied(task.id, slides, events, letters, snapshot)


@router.get(
    "/ai-changes",
    operation_id="getTaskAiChanges",
    **require(Permission.SEE_SLIDES, emergency=True),
)
async def get_task_ai_changes(
    task_id: uuid.UUID,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> AiChanges:
    task, whole = await readable_task(connection, principal, task_id)
    annotate_only(task.kind)
    if not whole:
        raise EvaluationHiddenError
    return await ai_changes(connection, task, results)
