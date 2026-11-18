import math
import uuid
from datetime import date, datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import AfterValidator, BaseModel, ConfigDict, Field
from sqlalchemy import (
    Boolean,
    DateTime,
    Integer,
    String,
    cast,
    exists,
    func,
    literal,
    literal_column,
    null,
    select,
    union_all,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.announcements import Announcement, announcements_from_json, current_as_json
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.disagreements import open_disagreements as count_open_disagreements
from parfocal_api.my_work import Assigned, MyStatus, MyTask, ProjectRef, my_review_tasks_with_slides
from parfocal_api.notifications import member_of
from parfocal_api.permissions import Grant, Permission, grant_of, in_project
from parfocal_api.principals import MemberPrincipal
from parfocal_api.problems import NotFoundError
from parfocal_api.project_access import assigned_slides, reads_whole
from parfocal_api.projects import LIVE, NOT_SAMPLE
from parfocal_api.projects import code_of as project_code
from parfocal_api.reviewed_export import LETTERS
from parfocal_api.tables import (
    DecisionValue,
    PrivacyMode,
    ProjectRole,
    ResumeMode,
    annotations,
    cases,
    project_members,
    projects,
    result_sets,
    resume_states,
    review_assignments,
    review_decisions,
    review_edits,
    review_tasks,
    slides,
)
from parfocal_common.db import CURRENT_TENANT
from parfocal_common.object_ids import ObjectId

STRIP = 4
WEEK = timedelta(days=7)
OPEN = (MyStatus.IN_REVIEW, MyStatus.NOT_STARTED)


def finite(value: float) -> float:
    if not math.isfinite(value):
        raise ValueError("must be a finite number")
    return value


Coordinate = Annotated[float, AfterValidator(finite)]


class ResumeCamera(BaseModel):
    model_config = ConfigDict(extra="forbid")

    x: Coordinate
    y: Coordinate
    z: Coordinate


class ResumeChange(BaseModel):
    model_config = ConfigDict(extra="forbid")

    task_id: uuid.UUID
    slide_id: uuid.UUID
    mode: ResumeMode
    object_id: Annotated[str, Field(min_length=1, max_length=40)] | None = None
    camera: ResumeCamera | None = None


class ResumeState(ResumeChange):
    updated_at: datetime


class ResumeTarget(BaseModel):
    task_id: uuid.UUID
    task_code: str
    task_name: str
    project: ProjectRef
    slide_id: uuid.UUID
    slide_label: str
    case_label: str | None
    position: int
    slides_assigned: int
    object_id: str | None
    decisions_on_slide: int
    due_on: date | None
    blinded: bool
    mode: ResumeMode
    camera: ResumeCamera | None


class StripSlide(BaseModel):
    id: uuid.UUID
    label: str
    reviewed: bool


class HomeProject(BaseModel):
    id: uuid.UUID
    code: str
    name: str
    colour: int
    privacy_mode: PrivacyMode
    my_role: ProjectRole
    members: int
    slides: int
    result_sets: int
    reviewed_slides: int
    strip: list[StripSlide]


class Week(BaseModel):
    since: datetime
    objects_checked: int
    agreed: int
    agree_share: float | None
    open_disagreements: int | None


class Home(BaseModel):
    resume: ResumeTarget | None
    tasks: list[MyTask]
    projects: list[HomeProject]
    slides_without_results: int
    week: Week
    announcements: list[Announcement]


router = APIRouter(prefix="/api/me", tags=["me"])


def open_tasks(tasks: list[MyTask]) -> list[MyTask]:
    return sorted(
        (task for task in tasks if task.status in OPEN),
        key=lambda task: (task.due_on is None, task.due_on or date.max, task.code),
    )


LAST = "last"
STORED = "stored"
NEXT = "next"


def slide_facts(task_id: Any, slide_id: Any, me: uuid.UUID) -> tuple[Any, ...]:
    return (
        select(slides.c.label)
        .where(slides.c.id == slide_id)
        .scalar_subquery()
        .label("slide_label"),
        select(cases.c.label)
        .select_from(slides)
        .join(cases, cases.c.id == slides.c.case_id)
        .where(slides.c.id == slide_id)
        .scalar_subquery()
        .label("case_label"),
        select(func.count())
        .where(
            review_decisions.c.task_id == task_id,
            review_decisions.c.slide_id == slide_id,
            review_decisions.c.user_id == me,
        )
        .scalar_subquery()
        .label("decisions"),
    )


def nothing(kind: Any) -> Any:
    return cast(null(), kind)


def last_activity_query(me: uuid.UUID) -> Any:
    touched = union_all(
        select(
            review_decisions.c.task_id,
            review_decisions.c.slide_id,
            review_decisions.c.kind,
            review_decisions.c.number,
            literal(False).label("person"),
            review_decisions.c.updated_at.label("at"),
        ).where(review_decisions.c.user_id == me),
        select(
            review_edits.c.task_id,
            review_edits.c.slide_id,
            review_edits.c.kind,
            review_edits.c.number,
            literal(False).label("person"),
            review_edits.c.updated_at.label("at"),
        ).where(review_edits.c.user_id == me),
        select(
            annotations.c.task_id,
            annotations.c.slide_id,
            annotations.c.kind,
            annotations.c.number,
            literal(True).label("person"),
            annotations.c.updated_at.label("at"),
        ).where(
            annotations.c.created_by_user_id == me,
            annotations.c.task_id.is_not(None),
            annotations.c.deleted_at.is_(None),
            annotations.c.kind.in_(list(LETTERS)),
        ),
    ).subquery()
    return (
        still_open(
            select(
                touched.c.task_id,
                touched.c.slide_id,
                touched.c.kind,
                touched.c.number,
                touched.c.person,
                touched.c.at,
                literal(LAST).label("source"),
                nothing(String).label("mode"),
                nothing(String).label("object_id"),
                nothing(JSONB).label("camera"),
            ),
            touched.c.task_id,
            touched.c.slide_id,
            me,
        )
        .order_by(touched.c.at.desc())
        .limit(1)
    )


def still_open(query: Any, task_column: Any, slide_column: Any, me: uuid.UUID) -> Any:
    return (
        query.join(
            review_assignments,
            (review_assignments.c.task_id == task_column)
            & (review_assignments.c.slide_id == slide_column)
            & (review_assignments.c.user_id == me),
        )
        .join(review_tasks, review_tasks.c.id == task_column)
        .where(
            review_assignments.c.submitted_at.is_(None),
            review_assignments.c.released_at.is_(None),
            review_tasks.c.archived_at.is_(None),
            review_tasks.c.signed_off_at.is_(None),
        )
    )


def stored_resume_query(me: uuid.UUID) -> Any:
    return still_open(
        select(
            resume_states.c.task_id,
            resume_states.c.slide_id,
            nothing(String).label("kind"),
            nothing(Integer).label("number"),
            nothing(Boolean).label("person"),
            resume_states.c.updated_at.label("at"),
            literal(STORED).label("source"),
            resume_states.c.mode,
            resume_states.c.object_id,
            resume_states.c.camera,
        ),
        resume_states.c.task_id,
        resume_states.c.slide_id,
        me,
    ).where(
        resume_states.c.tenant_id == literal_column(CURRENT_TENANT),
        resume_states.c.user_id == me,
    )


def next_slide_query(task: MyTask) -> Any:
    return select(
        literal(task.id).label("task_id"),
        literal(task.next_slide_id).label("slide_id"),
        nothing(String).label("kind"),
        nothing(Integer).label("number"),
        nothing(Boolean).label("person"),
        nothing(DateTime(timezone=True)).label("at"),
        literal(NEXT).label("source"),
        nothing(String).label("mode"),
        nothing(String).label("object_id"),
        nothing(JSONB).label("camera"),
    )


async def resume_rows(
    connection: AsyncConnection, me: uuid.UUID, next_task: MyTask | None
) -> dict[str, Any]:
    arms = [last_activity_query(me).subquery().select(), stored_resume_query(me)]
    if next_task is not None:
        arms.append(next_slide_query(next_task))
    found = union_all(*arms).subquery()
    rows = await connection.execute(
        select(found, *slide_facts(found.c.task_id, found.c.slide_id, me))
    )
    return {row.source: row for row in rows}


async def resume_of(
    connection: AsyncConnection, me: uuid.UUID, tasks: list[MyTask], assigned: Assigned
) -> ResumeTarget | None:
    by_id = {task.id: task for task in tasks}
    next_task = next((task for task in tasks if task.status in OPEN and task.next_slide_id), None)
    rows = await resume_rows(connection, me, next_task)
    last, stored = rows.get(LAST), rows.get(STORED)
    mode, camera = ResumeMode.GUIDED, None
    object_id: str | None
    if (
        stored is not None
        and stored.task_id in by_id
        and (last is None or last.task_id not in by_id or stored.at > last.at)
    ):
        task, slide_id, object_id = by_id[stored.task_id], stored.slide_id, stored.object_id
        facts = stored
        mode = ResumeMode(stored.mode)
        camera = None if stored.camera is None else ResumeCamera.model_validate(stored.camera)
    elif last is not None and last.task_id in by_id:
        task, slide_id = by_id[last.task_id], last.slide_id
        facts = last
        object_id = ObjectId(LETTERS[last.kind], last.number, person=last.person).text(ascii=True)
    else:
        if next_task is None or next_task.next_slide_id is None:
            return None
        task, slide_id, object_id = next_task, next_task.next_slide_id, None
        facts = rows[NEXT]
    mine = [slide for slide, _, _ in assigned.get(task.id, [])]
    return ResumeTarget(
        task_id=task.id,
        task_code=task.code,
        task_name=task.name,
        project=task.project,
        slide_id=slide_id,
        slide_label=facts.slide_label,
        case_label=facts.case_label,
        position=mine.index(slide_id) + 1,
        slides_assigned=len(mine),
        object_id=object_id,
        decisions_on_slide=int(facts.decisions or 0),
        due_on=task.due_on,
        blinded=task.blinded,
        mode=mode,
        camera=camera,
    )


def reviewed(slide_column: Any) -> Any:
    return exists().where(
        review_assignments.c.slide_id == slide_column,
        review_assignments.c.submitted_at.is_not(None),
    )


async def projects_of(
    connection: AsyncConnection, principal: MemberPrincipal, workspace: Grant
) -> tuple[list[HomeProject], int, list[uuid.UUID]]:
    reads_all = [
        role.value
        for role in ProjectRole
        if reads_whole(in_project(workspace, Permission.SEE_SLIDES, role))
    ]
    everyone = project_members.alias("everyone")
    mine = (
        select(
            projects,
            project_members.c.role.label("my_role"),
            select(func.count())
            .select_from(everyone)
            .where(everyone.c.project_id == projects.c.id)
            .scalar_subquery()
            .label("members"),
        )
        .join(project_members, project_members.c.project_id == projects.c.id)
        .where(
            project_members.c.user_id == principal.user_id,
            projects.c.archived_at.is_(None),
            LIVE,
        )
        .cte("mine")
    )
    has_set = exists().where(
        result_sets.c.slide_id == slides.c.id, result_sets.c.deleted_at.is_(None)
    )
    sets_on_slide = (
        select(func.count())
        .where(result_sets.c.slide_id == slides.c.id, result_sets.c.deleted_at.is_(None))
        .scalar_subquery()
    )
    ranked = (
        select(
            mine,
            slides.c.id.label("slide_id"),
            slides.c.label.label("slide_label"),
            reviewed(slides.c.id).label("slide_reviewed"),
            func.count(slides.c.id).over(partition_by=mine.c.id).label("slides"),
            func.count(slides.c.id)
            .filter(reviewed(slides.c.id))
            .over(partition_by=mine.c.id)
            .label("done"),
            func.count(slides.c.id)
            .filter(~has_set)
            .over(partition_by=mine.c.id)
            .label("without_results"),
            func.coalesce(func.sum(sets_on_slide).over(partition_by=mine.c.id), 0).label("sets"),
            func.row_number()
            .over(partition_by=mine.c.id, order_by=(slides.c.created_at, slides.c.id))
            .label("place"),
        )
        .select_from(mine)
        .outerjoin(
            slides,
            (slides.c.project_id == mine.c.id)
            & slides.c.deleted_at.is_(None)
            & (mine.c.my_role.in_(reads_all) | slides.c.id.in_(assigned_slides(principal))),
        )
        .subquery()
    )
    rows = (
        await connection.execute(
            select(ranked).where(ranked.c.place <= STRIP).order_by(ranked.c.number, ranked.c.place)
        )
    ).all()
    found: dict[uuid.UUID, HomeProject] = {}
    for row in rows:
        project = found.get(row.id)
        if project is None:
            project = found[row.id] = HomeProject(
                id=row.id,
                code=project_code(row.number),
                name=row.name,
                colour=row.colour,
                privacy_mode=PrivacyMode(row.privacy_mode),
                my_role=ProjectRole(row.my_role),
                members=int(row.members or 0),
                slides=row.slides,
                result_sets=int(row.sets),
                reviewed_slides=row.done,
                strip=[],
            )
        if row.slide_id is not None:
            project.strip.append(
                StripSlide(id=row.slide_id, label=row.slide_label, reviewed=row.slide_reviewed)
            )
    without_results = sum(row.without_results for row in {row.id: row for row in rows}.values())
    adjudicated = [row.id for row in rows if row.my_role in reads_all and row.place == 1]
    return list(found.values()), without_results, adjudicated


async def week_of(
    connection: AsyncConnection, me: uuid.UUID, adjudicated: list[uuid.UUID]
) -> tuple[Week, list[Announcement]]:
    since_column = (func.now() - WEEK).label("since")
    since, checked, agreed, announced = (
        await connection.execute(
            select(
                since_column,
                func.count(),
                func.count().filter(review_decisions.c.value == DecisionValue.AGREE),
                current_as_json().label("announcements"),
            )
            .join(projects, projects.c.id == review_decisions.c.project_id)
            .where(
                review_decisions.c.user_id == me,
                review_decisions.c.updated_at >= func.now() - WEEK,
                NOT_SAMPLE,
            )
        )
    ).one()
    open_disagreements: int | None = None
    if adjudicated:
        open_disagreements = await count_open_disagreements(
            connection,
            select(review_tasks.c.id).where(
                review_tasks.c.project_id.in_(adjudicated),
                review_tasks.c.archived_at.is_(None),
                review_tasks.c.signed_off_at.is_(None),
            ),
        )
    week = Week(
        since=since,
        objects_checked=checked,
        agreed=agreed,
        agree_share=agreed / checked if checked else None,
        open_disagreements=open_disagreements,
    )
    return week, announcements_from_json(announced)


@router.get("/home", operation_id="getMyHome")
async def get_my_home(principal: CurrentPrincipal, connection: TenantConnection) -> Home:
    person = member_of(principal)
    workspace = grant_of(person, Permission.SEE_SLIDES)
    tasks: list[MyTask] = []
    found: list[HomeProject] = []
    without_results = 0
    adjudicated: list[uuid.UUID] = []
    assigned: Assigned = {}
    if workspace is not Grant.NONE:
        tasks, assigned = await my_review_tasks_with_slides(connection, person.user_id)
        found, without_results, adjudicated = await projects_of(connection, person, workspace)
    resume = await resume_of(connection, person.user_id, tasks, assigned) if tasks else None
    week, announcements = await week_of(connection, person.user_id, adjudicated)
    return Home(
        resume=resume,
        tasks=open_tasks(tasks),
        projects=found,
        slides_without_results=without_results,
        week=week,
        announcements=announcements,
    )


async def assigned_to_me(
    connection: AsyncConnection, me: uuid.UUID, task_id: uuid.UUID, slide_id: uuid.UUID
) -> bool:
    found = await connection.scalar(
        select(review_assignments.c.task_id)
        .join(review_tasks, review_tasks.c.id == review_assignments.c.task_id)
        .where(
            review_assignments.c.task_id == task_id,
            review_assignments.c.slide_id == slide_id,
            review_assignments.c.user_id == me,
            review_assignments.c.released_at.is_(None),
            review_tasks.c.archived_at.is_(None),
        )
    )
    return found is not None


@router.put("/resume", operation_id="setMyResume")
async def set_my_resume(
    change: ResumeChange, principal: CurrentPrincipal, connection: TenantConnection
) -> ResumeState:
    person = member_of(principal)
    if not await assigned_to_me(connection, person.user_id, change.task_id, change.slide_id):
        raise NotFoundError("Task slide not found")
    values = {
        "task_id": change.task_id,
        "slide_id": change.slide_id,
        "mode": change.mode.value,
        "object_id": change.object_id,
        "camera": None if change.camera is None else change.camera.model_dump(),
    }
    updated_at = (
        await connection.execute(
            upsert(resume_states)
            .values(tenant_id=person.tenant_id, user_id=person.user_id, **values)
            .on_conflict_do_update(
                index_elements=[resume_states.c.tenant_id, resume_states.c.user_id],
                set_=values,
            )
            .returning(resume_states.c.updated_at)
        )
    ).scalar_one()
    return ResumeState(**change.model_dump(), updated_at=updated_at)
