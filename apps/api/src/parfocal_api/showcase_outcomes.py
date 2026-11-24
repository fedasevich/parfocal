import uuid
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from fastapi import BackgroundTasks
from sqlalchemy import func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.adjudications import (
    AdjudicationDraft,
    ObjectRef,
    decide_as_adjudicator,
    send_to_adjudicator,
)
from parfocal_api.annotations import AnnotationDraft, add, drawable_slide
from parfocal_api.dataset_versions import FreezeRequest, freeze_dataset_version
from parfocal_api.decision_styles import DecisionSettings
from parfocal_api.disagreement_queue import (
    QueueAction,
    QueuedObjectUpdate,
    settle_queued_outline,
    update_queued_object,
)
from parfocal_api.disagreements import DecisionDraft, OutlineDraft, decide_disagreement
from parfocal_api.evaluation_versions import SignOffConfirmation
from parfocal_api.final_layers import build_task_final_layer
from parfocal_api.mentions import token_for
from parfocal_api.patch_exports import PatchExportRequest, start_patch_export
from parfocal_api.principals import MemberPrincipal
from parfocal_api.realtime import NoRealtime
from parfocal_api.review_decisions import ReviewDecisionDraft, ai_class_of, save_decision
from parfocal_api.review_states import sign_off_review_task
from parfocal_api.review_tasks import Scope, SlideSet, TaskDraft, create_review_task
from parfocal_api.reviewed_layer import AddedDraft, EditDraft, add_review_object, save_review_edit
from parfocal_api.seed_request import seed_request
from parfocal_api.showcase_case import seed_http
from parfocal_api.showcase_demo import order_now
from parfocal_api.showcase_reviews import box
from parfocal_api.tables import (
    AnchorKind,
    AnnotationKind,
    DecisionReason,
    DecisionStyle,
    ResultObjectKind,
    TaskScope,
    TaskSplit,
    project_classes,
    result_objects,
    review_assignments,
    review_decisions,
    slides,
)
from parfocal_api.threads import Anchor, ThreadCreate, create_thread
from parfocal_common.jobs import JobStatus, jobs
from parfocal_common.object_ids import Letter, ObjectId
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_store import ResultStore

OUTCOME_TASK = "Every outcome review"
CLASS_TASK = "Class decision queue example"
OUTCOME_SLIDES = ("Case outcomes 1", "Case outcomes 2", "Case outcomes 3")
LOOK_AGAIN_SLIDE = "Case look again"
CLASS_SLIDE = "Case class decision"
SLIDE_LABELS = (*OUTCOME_SLIDES, LOOK_AGAIN_SLIDE, CLASS_SLIDE)
LEFT_OPEN_NOTE = "Left open on purpose, the border needs a deeper level"
LOOK_AGAIN_NOTE = "The outline moved, please look again"
ADJUDICATOR_NOTE = "The capsule is intact here"
DATASET_NOTE = "First frozen training set"
LATE_REASON = "A pathologist meeting found tumour on the deeper level"
SUBMITTED_EARLIER = timedelta(minutes=5)
CASES_PER_TASK = 6


@dataclass(frozen=True)
class Crew:
    owner: MemberPrincipal
    first: MemberPrincipal
    second: MemberPrincipal
    adjudicator: MemberPrincipal


@dataclass(frozen=True)
class Placed:
    slide_id: uuid.UUID
    set_id: uuid.UUID
    number: int

    @property
    def object(self) -> str:
        return ObjectId(Letter.REGION, self.number).text(ascii=True)


@dataclass(frozen=True)
class Outcomes:
    task_id: uuid.UUID
    class_task_id: uuid.UUID
    dataset_version: int
    export_job_id: uuid.UUID


async def regions_of(connection: AsyncConnection, set_id: uuid.UUID) -> list[int]:
    return list(
        await connection.scalars(
            select(result_objects.c.number)
            .where(
                result_objects.c.result_set_id == set_id,
                result_objects.c.kind == ResultObjectKind.REGION,
            )
            .order_by(result_objects.c.number)
        )
    )


async def placed_on(
    connection: AsyncConnection, sets: Sequence[tuple[uuid.UUID, uuid.UUID]]
) -> list[Placed]:
    return [
        Placed(slide_id, set_id, number)
        for slide_id, set_id in sets
        for number in await regions_of(connection, set_id)
    ]


async def classes_of(connection: AsyncConnection, project_id: uuid.UUID) -> dict[uuid.UUID, str]:
    rows = await connection.execute(
        select(project_classes.c.id, project_classes.c.name)
        .where(project_classes.c.project_id == project_id)
        .order_by(project_classes.c.key)
    )
    return {row.id: row.name for row in rows}


async def other_class(
    connection: AsyncConnection,
    results: ResultStore,
    classes: dict[uuid.UUID, str],
    placed: Placed,
) -> uuid.UUID:
    ai = await ai_class_of(connection, results, placed.set_id, AnnotationKind.REGION, placed.number)
    return next(class_id for class_id in classes if class_id != ai)


async def answer(
    connection: AsyncConnection,
    results: ResultStore,
    reviewer: MemberPrincipal,
    task_id: uuid.UUID,
    placed: Placed,
    draft: ReviewDecisionDraft,
) -> None:
    await save_decision(
        task_id, placed.slide_id, placed.object, draft, reviewer, connection, results
    )


def agree() -> ReviewDecisionDraft:
    return ReviewDecisionDraft(answer="agree")


def disagree(*reasons: DecisionReason) -> ReviewDecisionDraft:
    return ReviewDecisionDraft(answer="disagree", reasons=list(reasons))


async def agree_on_everything_else(
    connection: AsyncConnection,
    crew: Crew,
    task_id: uuid.UUID,
    project_id: uuid.UUID,
    everything: Sequence[Placed],
) -> None:
    answered = {
        (row.slide_id, row.number)
        for row in await connection.execute(
            select(review_decisions.c.slide_id, review_decisions.c.number).where(
                review_decisions.c.task_id == task_id
            )
        )
    }
    rest = [placed for placed in everything if (placed.slide_id, placed.number) not in answered]
    if not rest:
        return
    await connection.execute(
        insert(review_decisions),
        [
            {
                "tenant_id": crew.owner.tenant_id,
                "project_id": project_id,
                "task_id": task_id,
                "slide_id": placed.slide_id,
                "user_id": reviewer.user_id,
                "kind": "region",
                "number": placed.number,
                "value": "agree",
                "style": DecisionStyle.AGREE,
                "answer": "agree",
                "reasons": [],
            }
            for placed in rest
            for reviewer in (crew.first, crew.second)
        ],
    )


async def submit_all(
    connection: AsyncConnection, task_id: uuid.UUID, slide_id: uuid.UUID, earlier: bool = False
) -> None:
    at = func.now() - SUBMITTED_EARLIER if earlier else func.now()
    await connection.execute(
        update(review_assignments)
        .where(review_assignments.c.task_id == task_id, review_assignments.c.slide_id == slide_id)
        .values(submitted_at=at)
    )


async def new_task(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    project_id: uuid.UUID,
    name: str,
    sets: Sequence[tuple[uuid.UUID, uuid.UUID]],
    style: DecisionStyle,
) -> uuid.UUID:
    task = await create_review_task(
        project_id,
        TaskDraft(
            name=name,
            slide_ids=[slide_id for slide_id, _ in sets],
            result_sets=[
                SlideSet(slide_id=slide_id, result_set_id=set_id) for slide_id, set_id in sets
            ],
            reviewer_ids=[crew.first.user_id, crew.second.user_id],
            split=TaskSplit.EVERYONE,
            scope=Scope(kind=TaskScope.ALL_REGIONS),
            blinded=False,
            decision=DecisionSettings(style=style),
        ),
        crew.owner,
        connection,
        results,
        NoRealtime(),
        BackgroundTasks(),
        seed_request(),
    )
    return task.id


async def owner_says(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    task_id: uuid.UUID,
    placed: Placed,
    update_: QueuedObjectUpdate,
) -> None:
    await update_queued_object(
        task_id, placed.slide_id, placed.object, update_, crew.owner, connection, results
    )


async def seed_reviewer_answers(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    task_id: uuid.UUID,
    cases: Sequence[Placed],
    classes: dict[uuid.UUID, str],
) -> uuid.UUID:
    differ, against_ai, second_look, outlines, retyped, adjudicated = cases
    await answer(connection, results, crew.first, task_id, differ, agree())
    await answer(
        connection,
        results,
        crew.second,
        task_id,
        differ,
        disagree(DecisionReason.NOT_CLASS),
    )
    for reviewer in (crew.first, crew.second):
        await answer(
            connection,
            results,
            reviewer,
            task_id,
            against_ai,
            disagree(DecisionReason.BOUNDARY_OFF),
        )
    await answer(
        connection,
        results,
        crew.first,
        task_id,
        second_look,
        ReviewDecisionDraft(
            answer="unsure",
            reasons=[DecisionReason.NEED_SECOND_LOOK, DecisionReason.BORDER_UNCLEAR],
        ),
    )
    await answer(connection, results, crew.second, task_id, second_look, agree())
    await redraw_both(connection, crew, results, task_id, outlines)
    for reviewer in (crew.first, crew.second):
        await answer(connection, results, reviewer, task_id, outlines, agree())
    kept = await other_class(connection, results, classes, retyped)
    await answer(connection, results, crew.first, task_id, retyped, agree())
    await answer(
        connection,
        results,
        crew.second,
        task_id,
        retyped,
        disagree(DecisionReason.NOT_CLASS),
    )
    await save_review_edit(
        task_id,
        retyped.slide_id,
        retyped.object,
        EditDraft(class_id=kept),
        crew.second,
        connection,
        seed_http(results),
    )
    await answer(connection, results, crew.first, task_id, adjudicated, agree())
    await answer(
        connection,
        results,
        crew.second,
        task_id,
        adjudicated,
        disagree(DecisionReason.BOUNDARY_OFF),
    )
    return kept


async def outline_of(connection: AsyncConnection, placed: Placed) -> tuple[float, ...]:
    bounds = (
        await connection.execute(
            select(
                func.ST_XMin(result_objects.c.geometry),
                func.ST_YMin(result_objects.c.geometry),
                func.ST_XMax(result_objects.c.geometry),
                func.ST_YMax(result_objects.c.geometry),
            ).where(
                result_objects.c.result_set_id == placed.set_id,
                result_objects.c.kind == ResultObjectKind.REGION,
                result_objects.c.number == placed.number,
            )
        )
    ).one()
    return tuple(float(value) for value in bounds)


async def redraw_both(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    task_id: uuid.UUID,
    placed: Placed,
) -> None:
    left, top, right, bottom = await outline_of(connection, placed)
    shift = (right - left) * 0.6
    for index, reviewer in enumerate((crew.first, crew.second)):
        moved = shift * index
        await save_review_edit(
            task_id,
            placed.slide_id,
            placed.object,
            EditDraft(geometry=box(left + moved, top, right + moved, bottom)),
            reviewer,
            connection,
            seed_http(results),
        )


async def add_missed_object(
    connection: AsyncConnection, crew: Crew, task_id: uuid.UUID, placed: Placed, class_id: uuid.UUID
) -> None:
    left, top, right, _ = await outline_of(connection, placed)
    side = max(right - left, 40.0) / 2
    await add_review_object(
        task_id,
        placed.slide_id,
        AddedDraft(
            kind=AnnotationKind.REGION,
            geometry=box(right + side, top, right + 2 * side, top + side),
            class_id=class_id,
        ),
        crew.first,
        connection,
    )


async def settle_queue(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    task_id: uuid.UUID,
    cases: Sequence[Placed],
    classes: dict[uuid.UUID, str],
    kept: uuid.UUID,
) -> None:
    differ, against_ai, second_look, outlines, retyped, adjudicated = cases
    decide = QueueAction.DECIDE
    await owner_says(
        connection,
        crew,
        results,
        task_id,
        differ,
        QueuedObjectUpdate(action=decide, raw="disagree"),
    )
    await owner_says(
        connection,
        crew,
        results,
        task_id,
        against_ai,
        QueuedObjectUpdate(action=decide, raw="agree"),
    )
    await owner_says(
        connection,
        crew,
        results,
        task_id,
        second_look,
        QueuedObjectUpdate(action=QueueAction.LEAVE_OPEN, note=LEFT_OPEN_NOTE),
    )
    await settle_queued_outline(
        task_id,
        outlines.slide_id,
        outlines.object,
        OutlineDraft(from_user_id=crew.first.user_id),
        crew.owner,
        connection,
        results,
    )
    await owner_says(
        connection, crew, results, task_id, outlines, QueuedObjectUpdate(action=decide, raw="agree")
    )
    await owner_says(
        connection,
        crew,
        results,
        task_id,
        retyped,
        QueuedObjectUpdate(action=QueueAction.KEEP_TYPE, raw=classes[kept]),
    )
    await send_to_adjudicator(
        task_id,
        AdjudicationDraft(
            adjudicator_user_id=crew.adjudicator.user_id,
            objects=[ObjectRef(slide_id=adjudicated.slide_id, object=adjudicated.object)],
        ),
        crew.owner,
        connection,
        seed_request(),
        BackgroundTasks(),
    )
    await decide_as_adjudicator(
        task_id,
        adjudicated.slide_id,
        adjudicated.object,
        DecisionDraft(answer="agree", note=ADJUDICATOR_NOTE),
        crew.adjudicator,
        connection,
        results,
    )


async def look_again(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    task_id: uuid.UUID,
    placed: Placed,
) -> None:
    await answer(connection, results, crew.first, task_id, placed, agree())
    await answer(
        connection, results, crew.second, task_id, placed, disagree(DecisionReason.BOUNDARY_OFF)
    )
    await submit_all(connection, task_id, placed.slide_id, earlier=True)
    left, top, right, bottom = await outline_of(connection, placed)
    await save_review_edit(
        task_id,
        placed.slide_id,
        placed.object,
        EditDraft(geometry=box(left, top, right + (right - left) * 0.3, bottom)),
        crew.first,
        connection,
        seed_http(results),
    )
    await owner_says(
        connection,
        crew,
        results,
        task_id,
        placed,
        QueuedObjectUpdate(action=QueueAction.LOOK_AGAIN, note=LOOK_AGAIN_NOTE),
    )
    await answer(connection, results, crew.first, task_id, placed, agree())
    await answer(
        connection, results, crew.second, task_id, placed, disagree(DecisionReason.BOUNDARY_OFF)
    )
    await owner_says(
        connection,
        crew,
        results,
        task_id,
        placed,
        QueuedObjectUpdate(action=QueueAction.DECIDE, raw="agree"),
    )


async def after_sign_off(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    store: ObjectStore,
    task_id: uuid.UUID,
    changed: Placed,
) -> tuple[int, uuid.UUID]:
    version = await freeze_dataset_version(
        task_id, FreezeRequest(note=DATASET_NOTE), crew.owner, connection, results, store
    )
    started = await start_patch_export(
        task_id,
        PatchExportRequest(dataset_version=version.number, format="coco"),
        crew.owner,
        connection,
    )
    await connection.execute(
        update(jobs)
        .where(jobs.c.id == started.job_id)
        .values(status=JobStatus.DONE, finished_at=func.now())
    )
    await decide_disagreement(
        task_id,
        changed.slide_id,
        changed.object,
        DecisionDraft(answer="disagree", reason=LATE_REASON),
        crew.owner,
        connection,
        results,
    )
    await build_task_final_layer(task_id, crew.owner, connection)
    return version.number, started.job_id


async def seed_class_decision(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    project_id: uuid.UUID,
    slide: tuple[uuid.UUID, uuid.UUID],
    classes: dict[uuid.UUID, str],
) -> uuid.UUID:
    task_id = await new_task(
        connection, crew, results, project_id, CLASS_TASK, [slide], DecisionStyle.BLIND
    )
    everything = await placed_on(connection, [slide])
    first = everything[0]
    ai = await ai_class_of(connection, results, first.set_id, AnnotationKind.REGION, first.number)
    picked = await other_class(connection, results, classes, first)
    matched = ai or next(class_id for class_id in classes if class_id != picked)
    for reviewer, class_id in ((crew.first, matched), (crew.second, picked)):
        await answer(
            connection,
            results,
            reviewer,
            task_id,
            first,
            ReviewDecisionDraft(answer="class", answer_class_id=class_id),
        )
    for placed in everything[1:]:
        ai_rest = await ai_class_of(
            connection, results, placed.set_id, AnnotationKind.REGION, placed.number
        )
        for reviewer in (crew.first, crew.second):
            await answer(
                connection,
                results,
                reviewer,
                task_id,
                placed,
                ReviewDecisionDraft(answer="class", answer_class_id=ai_rest or picked),
            )
    await submit_all(connection, task_id, first.slide_id)
    await owner_says(
        connection,
        crew,
        results,
        task_id,
        first,
        QueuedObjectUpdate(action=QueueAction.DECIDE, raw=classes[picked]),
    )
    return task_id


async def seed_outcomes(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    store: ObjectStore,
    project_id: uuid.UUID,
    made: Sequence[tuple[uuid.UUID, uuid.UUID]],
) -> Outcomes | None:
    *sets, look_again_set, class_set = made
    classes = await classes_of(connection, project_id)
    everything = await placed_on(connection, sets)
    again = await placed_on(connection, [look_again_set])
    if len(everything) < CASES_PER_TASK or not again or len(classes) < 2:
        return None
    cases = everything[:CASES_PER_TASK]
    task_id = await new_task(
        connection,
        crew,
        results,
        project_id,
        OUTCOME_TASK,
        [*sets, look_again_set],
        DecisionStyle.AGREE,
    )
    kept = await seed_reviewer_answers(connection, crew, results, task_id, cases, classes)
    await add_missed_object(connection, crew, task_id, cases[0], kept)
    await agree_on_everything_else(connection, crew, task_id, project_id, everything + again[1:])
    await seed_object_thread(connection, crew, results, task_id, cases[0])
    for slide_id, _ in sets:
        await submit_all(connection, task_id, slide_id)
    await look_again(connection, crew, results, task_id, again[0])
    await settle_queue(connection, crew, results, task_id, cases, classes, kept)
    await sign_off_review_task(
        task_id,
        crew.owner,
        connection,
        seed_request(),
        BackgroundTasks(),
        NoRealtime(),
        results=results,
        signed_in=datetime.now(UTC),
        confirmation=SignOffConfirmation(confirmed_with="password"),
    )
    version, job_id = await after_sign_off(connection, crew, results, store, task_id, cases[1])
    class_task_id = await seed_class_decision(
        connection, crew, results, project_id, class_set, classes
    )
    return Outcomes(task_id, class_task_id, version, job_id)


SCOPED_TASK = "Scoped cells review"
SCOPE_SCORE = 0.6
THREAD_TITLE = "Is this the same tumour as the next region"
THREAD_BODY = "please compare it with the region below before we sign off"


async def seed_object_thread(
    connection: AsyncConnection,
    crew: Crew,
    results: ResultStore,
    task_id: uuid.UUID,
    placed: Placed,
) -> None:
    await create_thread(
        task_id,
        placed.slide_id,
        ThreadCreate(
            title=THREAD_TITLE,
            body=f"{token_for(crew.first.user_id)} {THREAD_BODY}",
            anchor=Anchor(kind=AnchorKind.OBJECT, object_id=placed.object),
        ),
        crew.owner,
        connection,
        seed_http(results),
        BackgroundTasks(),
    )


async def seed_scoped_review(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    reviewer: uuid.UUID,
    results: ResultStore,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    set_id: uuid.UUID,
    template_id: uuid.UUID,
) -> uuid.UUID:
    size = (
        await connection.execute(
            select(slides.c.width, slides.c.height).where(slides.c.id == slide_id)
        )
    ).one()
    width, height = float(size.width or 4000), float(size.height or 4000)
    slide = await drawable_slide(connection, creator, slide_id)
    await add(
        connection,
        creator,
        slide,
        [
            AnnotationDraft(
                kind=AnnotationKind.ROI,
                geometry=box(width * 0.25, height * 0.25, width * 0.75, height * 0.75),
            )
        ],
    )
    task = await create_review_task(
        project_id,
        TaskDraft(
            name=SCOPED_TASK,
            study_template_id=template_id,
            slide_ids=[slide_id],
            result_sets=[SlideSet(slide_id=slide_id, result_set_id=set_id)],
            reviewer_ids=[reviewer],
            split=TaskSplit.EVERYONE,
            scope=Scope(kind=TaskScope.CELLS_BELOW_SCORE, score=SCOPE_SCORE),
            extra_scopes=[Scope(kind=TaskScope.INSIDE_ROIS), Scope(kind=TaskScope.UNSURE_ZONES)],
            blinded=False,
            decision=DecisionSettings(style=DecisionStyle.AGREE),
        ),
        creator,
        connection,
        results,
        NoRealtime(),
        BackgroundTasks(),
        seed_request(),
    )
    await order_now(connection, results, task.id, [slide_id])
    return task.id
