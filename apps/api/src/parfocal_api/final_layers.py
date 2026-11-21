import json
import uuid
from collections import Counter
from collections.abc import Collection
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel
from sqlalchemy import func, insert, select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.disagreements import signed_version
from parfocal_api.evaluation import ai_objects, class_names, first_of_each_match
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ConflictError
from parfocal_api.review_tasks import readable_task
from parfocal_api.tables import (
    AnnotationOrigin,
    TaskKind,
    annotation_versions,
    annotations,
    disagreement_decisions,
    final_layers,
    review_decisions,
    review_edit_versions,
    review_edits,
    review_task_slides,
)
from parfocal_api.taxonomy import ProjectClass, classes_of
from parfocal_common import evaluation as engine

FEATURE_NAMESPACE = uuid.UUID("0c2f6b8e-6a41-4f0e-b7d3-5e1a9c4d2f70")


class FinalState(StrEnum):
    CONFIRMED = "confirmed"
    EDITED = "edited"
    REJECTED = "rejected"
    ADDED = "added"
    UNSURE = "unsure"
    OPEN = "open"


class SettledBy(StrEnum):
    AGREEMENT = "agreement"
    ADJUDICATION = "adjudication"
    PERSON = "person"


LEFT_OUT_STATES = (FinalState.UNSURE, FinalState.OPEN)


class TaskNotSignedOffError(ConflictError):
    code = "task-not-signed-off"
    title = "Sign off the review task before building its final layer"


class FinalLayerMissingError(ConflictError):
    code = "final-layer-missing"
    title = "Build the final layer of this review task before exporting its dataset"


class NotABuildableTaskError(ConflictError):
    code = "not-a-review-task"
    title = "Only a review task has a final layer"


class FinalCounts(BaseModel):
    confirmed: int = 0
    edited: int = 0
    rejected: int = 0
    added: int = 0
    unsure: int = 0
    open: int = 0


class FinalLayerStatus(BaseModel):
    build: int
    task_version: int
    current: bool
    built_at: datetime
    counts: FinalCounts


@dataclass(frozen=True)
class LayerRow:
    id: str
    kind: str
    number: int
    person: bool
    origin: str
    source_number: int | None
    class_id: uuid.UUID | None
    version: int
    created_by_user_id: uuid.UUID | None
    changed_by_user_id: uuid.UUID | None
    deleted: bool
    geojson: str | None


@dataclass(frozen=True)
class Outcome:
    state: FinalState
    class_id: uuid.UUID | None = None
    geometry: str | None = None
    author: uuid.UUID | None = None
    changed_by: uuid.UUID | None = None
    settled_by: SettledBy = SettledBy.AGREEMENT


type Key = tuple[str, int]


@dataclass(frozen=True)
class Redraw:
    geometry: str
    user_id: uuid.UUID | None


@dataclass(frozen=True)
class Retype:
    class_id: uuid.UUID
    user_id: uuid.UUID | None


@dataclass(frozen=True)
class Facts:
    decisions: dict[Key, list[Any]]
    adjudicated: dict[Key, Any]
    redraws: dict[Key, list[Redraw]]
    retypes: dict[Key, list[Retype]]
    edit_versions: Counter[Key]

    def redraw(self, key: Key, by: Collection[uuid.UUID | None] | None = None) -> Redraw | None:
        return next((d for d in self.redraws.get(key, []) if by is None or d.user_id in by), None)

    def retype(self, key: Key, by: Collection[uuid.UUID | None] | None = None) -> Retype | None:
        return next((r for r in self.retypes.get(key, []) if by is None or r.user_id in by), None)


router = APIRouter(prefix="/api/review-tasks/{task_id}/final-layer", tags=["review-tasks"])


def user_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


async def facts_of(connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID) -> Facts:
    decisions: dict[Key, list[Any]] = {}
    for row in await connection.execute(
        select(review_decisions)
        .where(review_decisions.c.task_id == task_id, review_decisions.c.slide_id == slide_id)
        .order_by(review_decisions.c.created_at, review_decisions.c.user_id)
    ):
        decisions.setdefault((row.kind, row.number), []).append(row)
    adjudicated = {
        (row.kind, row.number): row
        for row in await connection.execute(
            select(
                disagreement_decisions,
                func.ST_AsGeoJSON(disagreement_decisions.c.outline).label("outline_geojson"),
            ).where(
                disagreement_decisions.c.task_id == task_id,
                disagreement_decisions.c.slide_id == slide_id,
            )
        )
    }
    redraws: dict[Key, list[Redraw]] = {}
    retypes: dict[Key, list[Retype]] = {}
    for edit in await connection.execute(
        select(
            review_edits.c.kind,
            review_edits.c.number,
            review_edits.c.user_id,
            review_edits.c.class_id,
            func.ST_AsGeoJSON(review_edits.c.geometry).label("geojson"),
        )
        .where(
            review_edits.c.task_id == task_id,
            review_edits.c.slide_id == slide_id,
            review_edits.c.split == "",
            review_edits.c.deleted.is_(False),
        )
        .order_by(review_edits.c.created_at, review_edits.c.user_id)
    ):
        key = (edit.kind, edit.number)
        if edit.geojson is not None:
            redraws.setdefault(key, []).append(Redraw(edit.geojson, edit.user_id))
        if edit.class_id is not None:
            retypes.setdefault(key, []).append(Retype(edit.class_id, edit.user_id))
    edit_versions: Counter[Key] = Counter(
        (row.kind, row.number)
        for row in await connection.execute(
            select(review_edit_versions.c.kind, review_edit_versions.c.number).where(
                review_edit_versions.c.task_id == task_id,
                review_edit_versions.c.slide_id == slide_id,
                review_edit_versions.c.split == "",
            )
        )
    )
    return Facts(decisions, adjudicated, redraws, retypes, edit_versions)


def wrong_class_of(given: list[Any]) -> Retype | None:
    disagreeing = [row for row in given if row.value == engine.DISAGREE]
    if not disagreeing or not all(engine.WRONG_CLASS in row.reasons for row in disagreeing):
        return None
    classes = {row.reason_class_id for row in disagreeing}
    if len(classes) != 1 or None in classes:
        return None
    return Retype(disagreeing[0].reason_class_id, disagreeing[0].user_id)


def first_agreeing(given: list[Any]) -> uuid.UUID | None:
    return next((row.user_id for row in given if row.value == engine.AGREE), None)


def upheld_by(key: Key, facts: Facts) -> set[uuid.UUID | None] | None:
    judged = facts.adjudicated.get(key)
    if judged is None or judged.value is None:
        return None
    return {row.user_id for row in facts.decisions.get(key, []) if row.value == engine.AGREE}


def outcome_of(consensus: engine.Consensus, key: Key, facts: Facts) -> Outcome:
    given = facts.decisions.get(key, [])
    judged = facts.adjudicated.get(key)
    decided = judged is not None and judged.value is not None
    judge = judged.decided_by_user_id if decided and judged is not None else None
    settled_by = SettledBy.ADJUDICATION if decided else SettledBy.AGREEMENT
    if consensus is engine.Consensus.UNSURE:
        return Outcome(FinalState.UNSURE)
    if consensus is engine.Consensus.UNDECIDED:
        return Outcome(FinalState.OPEN)
    outline = judged.outline_geojson if judged is not None else None
    shape: Redraw | None = (
        Redraw(outline, judged.outline_from_user_id or judged.outline_by_user_id)
        if outline is not None and judged is not None
        else None
    )
    shape_changer = judged.outline_by_user_id if shape is not None and judged is not None else None
    answer_class = judged.answer_class_id if judged is not None else None
    retype: Retype | None = (
        Retype(answer_class, judged.decided_by_user_id)
        if answer_class is not None and judged is not None
        else None
    )
    if consensus is engine.Consensus.DISAGREE:
        if decided and retype is None:
            return Outcome(FinalState.REJECTED, author=judge, settled_by=settled_by)
        if not decided:
            shape = shape or facts.redraw(key)
            retype = retype or facts.retype(key) or wrong_class_of(given)
        if shape is None and retype is None:
            return Outcome(FinalState.REJECTED, author=judge, settled_by=settled_by)
    else:
        upheld = upheld_by(key, facts)
        shape = shape or facts.redraw(key, upheld)
        retype = retype or facts.retype(key, upheld)
    if shape is None and retype is None:
        return Outcome(
            FinalState.CONFIRMED,
            author=judge or first_agreeing(given),
            settled_by=settled_by,
        )
    author = shape.user_id if shape is not None else retype.user_id if retype else None
    return Outcome(
        FinalState.EDITED,
        class_id=retype.class_id if retype else None,
        geometry=shape.geometry if shape else None,
        author=author,
        changed_by=judge or shape_changer or author,
        settled_by=settled_by,
    )


def ai_entry(
    task_id: uuid.UUID, slide_id: uuid.UUID, key: Key, outcome: Outcome, versions: int
) -> dict[str, Any]:
    kind, number = key
    return {
        "feature_id": str(uuid.uuid5(FEATURE_NAMESPACE, f"{task_id}/{slide_id}/{kind}/{number}")),
        "kind": kind,
        "number": number,
        "person": False,
        "source_number": number,
        "state": outcome.state.value,
        "settled_by": outcome.settled_by.value,
        "class_id": None if outcome.class_id is None else str(outcome.class_id),
        "geometry": None if outcome.geometry is None else json.loads(outcome.geometry),
        "author": None if outcome.author is None else str(outcome.author),
        "changed_by": None if outcome.changed_by is None else str(outcome.changed_by),
        "versions": 1 + versions,
    }


async def added_entries(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, kept: set[uuid.UUID]
) -> list[dict[str, Any]]:
    rows = (
        await connection.execute(
            select(
                annotations.c.id,
                annotations.c.kind,
                annotations.c.number,
                annotations.c.class_id,
                annotations.c.version,
                annotations.c.created_by_user_id,
                func.ST_AsGeoJSON(annotations.c.geometry).label("geojson"),
            )
            .where(
                annotations.c.task_id == task_id,
                annotations.c.slide_id == slide_id,
                annotations.c.deleted_at.is_(None),
                annotations.c.kind.in_(["region", "cell"]),
            )
            .order_by(annotations.c.kind, annotations.c.number)
        )
    ).all()
    changers: dict[uuid.UUID, uuid.UUID] = {}
    if rows:
        for version in await connection.execute(
            select(annotation_versions.c.annotation_id, annotation_versions.c.changed_by_user_id)
            .where(annotation_versions.c.annotation_id.in_([row.id for row in rows]))
            .order_by(annotation_versions.c.annotation_id, annotation_versions.c.version)
        ):
            if version.changed_by_user_id:
                changers[version.annotation_id] = version.changed_by_user_id
    return [
        {
            "feature_id": str(row.id),
            "kind": row.kind,
            "number": row.number,
            "person": True,
            "source_number": None,
            "state": FinalState.ADDED.value,
            "settled_by": SettledBy.PERSON.value,
            "class_id": None if row.class_id is None else str(row.class_id),
            "geometry": json.loads(row.geojson),
            "author": None if row.created_by_user_id is None else str(row.created_by_user_id),
            "changed_by": None if row.id not in changers else str(changers[row.id]),
            "versions": row.version,
        }
        for row in rows
        if row.id in kept
    ]


async def build_final_layer(connection: AsyncConnection, task: Any, principal: Principal) -> int:
    names = await class_names(connection, task.project_id)
    consensus = {
        (uuid.UUID(item.slide), item.kind, item.number): engine.consensus(item)
        for item in await ai_objects(connection, task.id, names)
    }
    added = (
        await connection.execute(
            select(annotations.c.id)
            .where(
                annotations.c.task_id == task.id,
                annotations.c.deleted_at.is_(None),
                annotations.c.kind.in_(["region", "cell"]),
            )
            .order_by(annotations.c.created_at, annotations.c.id)
        )
    ).scalars()
    kept = await first_of_each_match(connection, task.id, list(added))
    build = 1 + (
        await connection.scalar(
            select(func.coalesce(func.max(final_layers.c.build), 0)).where(
                final_layers.c.task_id == task.id
            )
        )
        or 0
    )
    version = await signed_version(connection, task.id)
    slide_ids = (
        await connection.execute(
            select(review_task_slides.c.slide_id)
            .where(review_task_slides.c.task_id == task.id)
            .order_by(review_task_slides.c.position)
        )
    ).scalars()
    snapshot = [
        item.model_dump(mode="json") for item in await classes_of(connection, task.project_id)
    ]
    totals: Counter[str] = Counter()
    for slide_id in list(slide_ids):
        facts = await facts_of(connection, task.id, slide_id)
        objects = [
            ai_entry(
                task.id,
                slide_id,
                (kind, number),
                outcome_of(found, (kind, number), facts),
                facts.edit_versions[(kind, number)],
            )
            for (slide, kind, number), found in sorted(
                consensus.items(), key=lambda item: (item[0][1], item[0][2])
            )
            if slide == slide_id
        ]
        objects.extend(await added_entries(connection, task.id, slide_id, kept))
        counts: Counter[str] = Counter(str(entry["state"]) for entry in objects)
        totals.update(counts)
        await connection.execute(
            insert(final_layers).values(
                tenant_id=task.tenant_id,
                project_id=task.project_id,
                task_id=task.id,
                slide_id=slide_id,
                build=build,
                task_version=version,
                objects=objects,
                counts=FinalCounts(**counts).model_dump(),
                classes=snapshot,
                built_by_user_id=user_of(principal),
            )
        )
    await record(
        connection,
        actor_of(principal),
        AuditAction.REVIEW_FINAL_LAYER_BUILT,
        AuditTarget.REVIEW_TASK,
        task.id,
        tenant_id=task.tenant_id,
        details={"build": build, "version": version, **FinalCounts(**totals).model_dump()},
    )
    return build


def layer_rows(
    objects: list[dict[str, Any]],
) -> tuple[list[LayerRow], dict[tuple[str, int], str]]:
    rows: list[LayerRow] = []
    left_out: dict[tuple[str, int], str] = {}
    for entry in objects:
        state = FinalState(entry["state"])
        if state in LEFT_OUT_STATES:
            left_out[(entry["kind"], entry["number"])] = state.value
            continue
        rows.append(
            LayerRow(
                id=entry["feature_id"],
                kind=entry["kind"],
                number=entry["number"],
                person=entry["person"],
                origin=(
                    AnnotationOrigin.HUMAN
                    if state is FinalState.ADDED
                    else AnnotationOrigin.AI_CONFIRMED
                    if state is FinalState.CONFIRMED
                    else AnnotationOrigin.AI_EDITED
                ),
                source_number=entry["source_number"],
                class_id=None if entry["class_id"] is None else uuid.UUID(entry["class_id"]),
                version=entry["versions"],
                created_by_user_id=None if entry["author"] is None else uuid.UUID(entry["author"]),
                changed_by_user_id=(
                    None if entry["changed_by"] is None else uuid.UUID(entry["changed_by"])
                ),
                deleted=state is FinalState.REJECTED,
                geojson=None if entry["geometry"] is None else json.dumps(entry["geometry"]),
            )
        )
    return rows, left_out


async def latest_layers(connection: AsyncConnection, task_id: uuid.UUID) -> list[Any]:
    newest = (
        select(func.max(final_layers.c.build))
        .where(final_layers.c.task_id == task_id)
        .scalar_subquery()
    )
    return list(
        await connection.execute(
            select(final_layers).where(
                final_layers.c.task_id == task_id, final_layers.c.build == newest
            )
        )
    )


async def status_of(connection: AsyncConnection, task: Any) -> FinalLayerStatus | None:
    if task.kind != TaskKind.REVIEW:
        return None
    layers = await latest_layers(connection, task.id)
    if not layers:
        return None
    totals: Counter[str] = Counter()
    for layer in layers:
        totals.update(layer.counts)
    first = layers[0]
    current = task.signed_off_at is not None and first.task_version == await signed_version(
        connection, task.id
    )
    return FinalLayerStatus(
        build=first.build,
        task_version=first.task_version,
        current=current,
        built_at=max(layer.built_at for layer in layers),
        counts=FinalCounts(**totals),
    )


async def layer_classes(
    connection: AsyncConnection, task: Any, layers: list[Any]
) -> list[ProjectClass]:
    stored = next((layer.classes for layer in layers if layer.classes is not None), None)
    if stored is None:
        return await classes_of(connection, task.project_id)
    return [ProjectClass.model_validate(item) for item in stored]


async def current_layers(connection: AsyncConnection, task: Any) -> dict[uuid.UUID, Any]:
    status = await status_of(connection, task)
    if status is None or not status.current:
        raise FinalLayerMissingError
    return {layer.slide_id: layer for layer in await latest_layers(connection, task.id)}


@router.post(
    "",
    operation_id="buildFinalLayer",
    **require(Permission.CREATE_CASES, write=True),
)
async def build_task_final_layer(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> FinalLayerStatus:
    task, _ = await readable_task(connection, principal, task_id)
    if task.kind != TaskKind.REVIEW:
        raise NotABuildableTaskError
    if task.signed_off_at is None:
        raise TaskNotSignedOffError
    await build_final_layer(connection, task, principal)
    status = await status_of(connection, task)
    if status is None:
        raise FinalLayerMissingError
    return status
