import secrets
import uuid
from collections.abc import Mapping, Sequence
from datetime import UTC, date, datetime
from typing import Annotated, Any, cast

from fastapi import APIRouter, BackgroundTasks, Request
from pydantic import BaseModel, Field, StringConstraints, model_validator
from sqlalchemy import ColumnElement, Select, func, insert, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.blinding import FirstReadStartedError, task_started
from parfocal_api.check_options import (
    CheckChange,
    CheckOptions,
    CheckPreset,
    check_of,
    check_scopes,
    least_sure,
    overlaid,
    resolved,
    shown_score,
    stored_check,
    stored_score,
)
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.decision_styles import DecisionSettings
from parfocal_api.display_settings import (
    DisplaySettings,
    TaskDisplaySettings,
    display_of,
    stored_display,
)
from parfocal_api.notifications import deliver_after_commit
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import BadRequestError, ConflictError, NotFoundError
from parfocal_api.project_access import project_grant, reads_whole
from parfocal_api.projects import ProjectArchivedError, owned, visible
from parfocal_api.review_order import Results, clear_order, store_order, stored_seeds
from parfocal_api.tables import (
    AnalysisTemplate,
    DecisionStyle,
    ProjectRole,
    ResultStatus,
    StartMode,
    TaskKind,
    TaskScope,
    TaskSplit,
    cases,
    opinion_forms,
    project_members,
    projects,
    result_sets,
    review_assignments,
    review_task_slides,
    review_tasks,
    slides,
    study_template_versions,
    study_templates,
    verdicts,
)
from parfocal_api.task_notices import tell_due_changed
from parfocal_api.taxonomy import ProjectClass, classes_of
from parfocal_api.verdicts import recount
from parfocal_common.scope import Scope as SamplingScope
from parfocal_common.scope import ScopeKind

MAX_SLIDES = 500
MAX_REVIEWERS = 50
REVIEWING_ROLES = frozenset({ProjectRole.OWNER, ProjectRole.REVIEWER})

type TaskName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)
]
type Reminders = Annotated[list[Annotated[int, Field(ge=0, le=60)]], Field(max_length=3)]


class Scope(BaseModel):
    kind: TaskScope
    count: Annotated[int, Field(ge=1, le=10_000)] | None = None
    score: Annotated[float, Field(ge=0, le=1)] | None = None

    @model_validator(mode="after")
    def parameters_fit(self) -> Scope:
        if (self.kind is TaskScope.RANDOM_CELLS) != (self.count is not None):
            raise ValueError("A random sample of cells needs a count, and only it has one")
        if (self.kind is TaskScope.CELLS_BELOW_SCORE) != (self.score is not None):
            raise ValueError("Cells below a score need a score, and only they have one")
        return self


MAX_SCOPE_PARTS = 4
type ExtraScopes = Annotated[list[Scope], Field(max_length=MAX_SCOPE_PARTS - 1)]


def distinct_kinds(first: Scope, extra: Sequence[Scope]) -> None:
    kinds = [first.kind, *(part.kind for part in extra)]
    if len(set(kinds)) != len(kinds):
        raise ValueError("Each part of the scope is a different kind")


def scope_fits(kind: TaskKind, first: Scope | None, extra: Sequence[Scope]) -> None:
    if kind is TaskKind.ANNOTATE:
        if (first is not None and first.kind is not TaskScope.WHOLE_SLIDE) or extra:
            raise ValueError("An annotate task takes the whole slide as its scope")
        return
    if first is None:
        raise ValueError("A review task needs a scope")
    if TaskScope.WHOLE_SLIDE in {first.kind, *(part.kind for part in extra)}:
        raise ValueError("Only an annotate task takes the whole slide as its scope")
    distinct_kinds(first, extra)


class ScopeKindsRepeatedError(BadRequestError):
    code = "scope-kinds-repeated"
    title = "Each part of the scope is a different kind"


class SlideSet(BaseModel):
    slide_id: uuid.UUID
    result_set_id: uuid.UUID


class Pair(BaseModel):
    slide_id: uuid.UUID
    user_id: uuid.UUID


class TaskDraft(BaseModel):
    name: TaskName
    kind: TaskKind = TaskKind.REVIEW
    slide_ids: Annotated[list[uuid.UUID], Field(max_length=MAX_SLIDES)] = []
    case_ids: Annotated[list[uuid.UUID], Field(max_length=MAX_SLIDES)] = []
    result_sets: Annotated[list[SlideSet], Field(max_length=MAX_SLIDES)] = []
    model_name: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
        | None
    ) = None
    reviewer_ids: Annotated[list[uuid.UUID], Field(min_length=1, max_length=MAX_REVIEWERS)]
    split: TaskSplit
    pairs: Annotated[list[Pair], Field(max_length=MAX_SLIDES * MAX_REVIEWERS)] = []
    scope: Scope | None = None
    extra_scopes: ExtraScopes = []
    opinion_form_version: Annotated[int, Field(ge=1)] | None = None
    blinded: bool = True
    ai_hidden_first_read: bool = False
    start_mode: StartMode = StartMode.GUIDED
    due_on: date | None = None
    reminder_days: Reminders = []
    study_template_id: uuid.UUID | None = None
    study_template_version: Annotated[int, Field(ge=1)] | None = None
    decision: DecisionSettings | None = None
    display: TaskDisplaySettings | None = None
    preset: CheckPreset | None = None
    check: CheckChange | None = None

    @model_validator(mode="after")
    def consistent(self) -> TaskDraft:
        if not self.slide_ids and not self.case_ids:
            raise ValueError("Name slides or cases")
        if self.kind is TaskKind.ANNOTATE:
            if self.model_name is not None and self.result_sets:
                raise ValueError("Pick a result set per slide or a model name, not both")
        elif (self.model_name is None) == (not self.result_sets):
            raise ValueError("Pick a result set per slide or a model name, not both")
        scope_fits(self.kind, self.scope, self.extra_scopes)
        if self.kind is TaskKind.REVIEW and (self.preset is not None or self.check is not None):
            raise ValueError("Only an annotate task has check options")
        if len(set(self.reviewer_ids)) != len(self.reviewer_ids):
            raise ValueError("A reviewer appears twice")
        if (self.split is TaskSplit.CHOSEN) != bool(self.pairs):
            raise ValueError("Only a chosen split lists slide and reviewer pairs, and it must")
        if self.study_template_version is not None and self.study_template_id is None:
            raise ValueError("A template version needs its template")
        return self

    def task_scope(self) -> Scope:
        return self.scope or Scope(kind=TaskScope.WHOLE_SLIDE)


class TaskChange(BaseModel):
    name: TaskName | None = None
    scope: Scope | None = None
    extra_scopes: ExtraScopes | None = None
    blinded: bool | None = None
    ai_hidden_first_read: bool | None = None
    start_mode: StartMode | None = None
    due_on: date | None = None
    reminder_days: Reminders | None = None
    decision: DecisionSettings | None = None
    display: TaskDisplaySettings | None = None
    check: CheckChange | None = None

    @model_validator(mode="after")
    def has_change(self) -> TaskChange:
        if not self.model_fields_set:
            raise ValueError("Change at least one thing")
        return self


class TaskSlide(BaseModel):
    slide_id: uuid.UUID
    result_set_id: uuid.UUID | None
    run_set_ids: list[uuid.UUID] = []
    reviewer_ids: list[uuid.UUID]


class CountsAsChange(BaseModel):
    changed_at: datetime
    changed_by_user_id: uuid.UUID | None
    before: list[str]
    after: list[str]
    recounted: int
    reasons_dropped: int


class ReviewTask(BaseModel):
    id: uuid.UUID
    project_id: uuid.UUID
    number: int
    code: str
    name: str
    kind: TaskKind
    classes: list[ProjectClass] | None
    split: TaskSplit
    scope: Scope
    scopes: list[Scope]
    opinion_form_version: int
    blinded: bool
    ai_hidden_first_read: bool
    start_mode: StartMode
    due_on: date | None
    reminder_days: list[int]
    study_template_id: uuid.UUID | None
    study_template_version: int | None
    analysis_template: AnalysisTemplate
    decision: DecisionSettings
    display: TaskDisplaySettings
    check: CheckOptions | None = None
    counts_as_changes: list[CountsAsChange]
    created_by_user_id: uuid.UUID | None
    created_at: datetime
    slide_count: int
    reviewer_count: int


class ReviewTaskDetail(ReviewTask):
    slides: list[TaskSlide]


class ScopeNotForKindError(BadRequestError):
    code = "scope-not-for-task-kind"
    title = "Only an annotate task takes the whole slide, and it takes nothing else"


class TaskNeedsSlidesError(BadRequestError):
    code = "task-needs-slides"
    title = "A task needs at least one slide of this project"


class UnknownSlideError(BadRequestError):
    code = "unknown-slide"
    title = "A slide or case is not in this project"


class NoResultSetError(BadRequestError):
    code = "no-result-set"
    title = "A slide has no finished result set to review"


class NotAReviewerError(BadRequestError):
    code = "not-a-project-reviewer"
    title = "Every reviewer must be an owner or reviewer of this project"


class BadPairsError(BadRequestError):
    code = "bad-pairs"
    title = "Each pair needs a task slide and a task reviewer, and every slide a reviewer"


class UnknownFormVersionError(BadRequestError):
    code = "unknown-opinion-form-version"
    title = "This project has no such opinion form version"


class UnknownStudyTemplateError(BadRequestError):
    code = "unknown-study-template"
    title = "This workspace has no such study template version"


class UnknownResultSetError(BadRequestError):
    code = "unknown-result-set"
    title = "This project has no such result set"


class StyleLockedError(ConflictError):
    code = "decision-style-locked"
    title = "The decision style cannot change once a decision exists"


class CountsAsSignedOffError(ConflictError):
    code = "counts-as-signed-off"
    title = "Counts as cannot change after sign-off"


class CheckNotForKindError(BadRequestError):
    code = "check-not-for-task-kind"
    title = "Only an annotate task has check options"


class StudyTemplateRetiredError(ConflictError):
    code = "study-template-retired"
    title = "This study template is retired"


project_router = APIRouter(prefix="/api/projects/{project_id}/review-tasks", tags=["review-tasks"])
router = APIRouter(prefix="/api/review-tasks", tags=["review-tasks"])


def own_assignments(principal: Principal) -> ColumnElement[bool]:
    user_id = principal.user_id if isinstance(principal, MemberPrincipal) else None
    return (review_assignments.c.user_id == user_id) & review_assignments.c.released_at.is_(None)


def code_of(number: int) -> str:
    return f"RT-{number}"


def ordering_scopes(row: Any) -> list[SamplingScope]:
    if row.kind == TaskKind.ANNOTATE:
        return check_scopes(row.check_options)
    return sampling_scopes(row)


def stored_options(row: Any) -> dict[str, Any]:
    return cast(dict[str, Any], row.check_options or {})


def by_least_sure(row: Any) -> bool:
    return least_sure(row.check_options) if row.kind == TaskKind.ANNOTATE else True


def sampling_scopes(row: Any) -> list[SamplingScope]:
    first = SamplingScope(
        ScopeKind(row.scope), count=row.scope_count, seed=row.scope_seed, score=row.scope_score
    )
    return [
        first,
        *(
            SamplingScope(
                ScopeKind(part["kind"]),
                count=part.get("count"),
                seed=part.get("seed"),
                score=part.get("score"),
            )
            for part in row.extra_scopes
        ),
    ]


def stored_part(part: Scope, seed: int | None) -> dict[str, Any]:
    return {
        "kind": part.kind.value,
        "count": part.count,
        "seed": (seed or secrets.randbits(62)) if part.kind is TaskScope.RANDOM_CELLS else None,
        "score": None if part.score is None else stored_score(part.score),
    }


def stored_parts(extra: Sequence[Scope], kept: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    seeds = {item["kind"]: item.get("seed") for item in kept}
    return [stored_part(part, seeds.get(part.kind.value)) for part in extra]


async def task_sets(
    connection: AsyncConnection, task_id: uuid.UUID
) -> dict[uuid.UUID, list[uuid.UUID]]:
    rows = await connection.execute(
        select(
            review_task_slides.c.slide_id,
            review_task_slides.c.result_set_id,
            review_task_slides.c.run_set_ids,
        ).where(
            review_task_slides.c.task_id == task_id,
            review_task_slides.c.result_set_id.is_not(None),
        )
    )
    return {row[0]: [row[1], *row[2]] for row in rows if row[1] is not None}


def scope_of(row: Any) -> Scope:
    return Scope(
        kind=TaskScope(row.scope), count=row.scope_count, score=shown_score(row.scope_score)
    )


def scopes_of(row: Any) -> list[Scope]:
    return [
        scope_of(row),
        *(
            Scope(
                kind=TaskScope(part["kind"]),
                count=part.get("count"),
                score=shown_score(part.get("score")),
            )
            for part in row.extra_scopes
        ),
    ]


async def task_slides_of(
    connection: AsyncConnection, principal: Principal, row: Any, whole: bool
) -> list[TaskSlide]:
    statement = select(review_task_slides).where(review_task_slides.c.task_id == row.id)
    if not whole:
        statement = statement.where(
            review_task_slides.c.slide_id.in_(
                select(review_assignments.c.slide_id).where(
                    review_assignments.c.task_id == row.id, own_assignments(principal)
                )
            )
        )
    slide_rows = (await connection.execute(statement.order_by(review_task_slides.c.position))).all()
    reviewers: dict[uuid.UUID, list[uuid.UUID]] = {}
    for slide_id, user_id in await connection.execute(
        select(review_assignments.c.slide_id, review_assignments.c.user_id)
        .where(review_assignments.c.task_id == row.id, review_assignments.c.released_at.is_(None))
        .order_by(review_assignments.c.assigned_at, review_assignments.c.user_id)
    ):
        reviewers.setdefault(slide_id, []).append(user_id)
    return [
        TaskSlide(
            slide_id=slide.slide_id,
            result_set_id=slide.result_set_id,
            run_set_ids=list(slide.run_set_ids),
            reviewer_ids=reviewers.get(slide.slide_id, []),
        )
        for slide in slide_rows
    ]


def decision_of(row: Any) -> DecisionSettings:
    return DecisionSettings.model_construct(
        style=DecisionStyle(row.decision_style),
        counts_as=list(row.counts_as),
        question=row.question,
    )


def task_of(row: Any, slide_count: int, reviewer_count: int) -> ReviewTask:
    return ReviewTask(
        id=row.id,
        project_id=row.project_id,
        number=row.number,
        code=code_of(row.number),
        name=row.name,
        kind=TaskKind(row.kind),
        classes=(
            None
            if row.class_snapshot is None
            else [ProjectClass.model_validate(item) for item in row.class_snapshot]
        ),
        split=TaskSplit(row.split),
        scope=scope_of(row),
        scopes=scopes_of(row),
        opinion_form_version=row.opinion_form_version,
        blinded=row.blinded,
        ai_hidden_first_read=row.ai_hidden_first_read,
        start_mode=StartMode(row.start_mode),
        due_on=row.due_on,
        reminder_days=list(row.reminder_days),
        study_template_id=row.study_template_id,
        study_template_version=row.study_template_version,
        analysis_template=AnalysisTemplate(row.analysis_template),
        decision=decision_of(row),
        display=display_of(row.display),
        check=check_of(row.check_options) if row.kind == TaskKind.ANNOTATE else None,
        counts_as_changes=[CountsAsChange.model_validate(item) for item in row.counts_as_changes],
        created_by_user_id=row.created_by_user_id,
        created_at=row.created_at,
        slide_count=slide_count,
        reviewer_count=reviewer_count,
    )


async def detail_of(
    connection: AsyncConnection, principal: Principal, row: Any, whole: bool
) -> ReviewTaskDetail:
    task_slides = await task_slides_of(connection, principal, row, whole)
    people = {user for slide in task_slides for user in slide.reviewer_ids}
    return ReviewTaskDetail(
        **task_of(row, len(task_slides), len(people)).model_dump(), slides=task_slides
    )


async def slides_named(
    connection: AsyncConnection, project_id: uuid.UUID, draft: TaskDraft
) -> list[Any]:
    wanted = list(dict.fromkeys(draft.slide_ids))
    chosen = {
        row.id: row
        for row in await connection.execute(
            select(slides.c.id, slides.c.label, slides.c.case_id).where(
                slides.c.project_id == project_id,
                slides.c.deleted_at.is_(None),
                slides.c.id.in_(wanted),
            )
        )
    }
    if len(chosen) != len(wanted):
        raise UnknownSlideError
    ordered = [chosen[slide_id] for slide_id in wanted]
    if draft.case_ids:
        found_cases = set(
            await connection.scalars(
                select(cases.c.id).where(
                    cases.c.project_id == project_id,
                    cases.c.deleted_at.is_(None),
                    cases.c.id.in_(draft.case_ids),
                )
            )
        )
        if found_cases != set(draft.case_ids):
            raise UnknownSlideError
        for case_id in dict.fromkeys(draft.case_ids):
            ordered.extend(
                await connection.execute(
                    select(slides.c.id, slides.c.label, slides.c.case_id)
                    .where(slides.c.case_id == case_id, slides.c.deleted_at.is_(None))
                    .order_by(slides.c.created_at, slides.c.label)
                )
            )
    unique = list({row.id: row for row in ordered}.values())
    if not unique:
        raise TaskNeedsSlidesError
    return unique


async def sets_for(
    connection: AsyncConnection, task_slides: Sequence[Any], draft: TaskDraft
) -> dict[uuid.UUID, uuid.UUID]:
    usable = (
        select(result_sets.c.id, result_sets.c.slide_id, result_sets.c.name)
        .where(
            result_sets.c.slide_id.in_([slide.id for slide in task_slides]),
            result_sets.c.status == ResultStatus.READY,
            result_sets.c.deleted_at.is_(None),
        )
        .order_by(result_sets.c.created_at)
    )
    rows = (await connection.execute(usable)).all()
    picked: dict[uuid.UUID, uuid.UUID] = {}
    if draft.model_name is not None:
        for row in rows:
            if row.name.casefold() == draft.model_name.casefold():
                picked[row.slide_id] = row.id
    else:
        valid = {(row.slide_id, row.id) for row in rows}
        for choice in draft.result_sets:
            if (choice.slide_id, choice.result_set_id) in valid:
                picked[choice.slide_id] = choice.result_set_id
    if draft.kind is TaskKind.ANNOTATE:
        unknown = {choice.slide_id for choice in draft.result_sets} - set(picked)
        if unknown:
            raise NoResultSetError("Pin only a finished result set of the same slide")
        return picked
    missing = [slide.label for slide in task_slides if slide.id not in picked]
    if missing:
        raise NoResultSetError(f"No finished result set for {', '.join(missing[:5])}")
    return picked


async def check_reviewers(
    connection: AsyncConnection, project_id: uuid.UUID, reviewer_ids: Sequence[uuid.UUID]
) -> None:
    members = set(
        await connection.scalars(
            select(project_members.c.user_id).where(
                project_members.c.project_id == project_id,
                project_members.c.user_id.in_(reviewer_ids),
                project_members.c.role.in_(REVIEWING_ROLES),
            )
        )
    )
    if members != set(reviewer_ids):
        raise NotAReviewerError


def assignments_for(
    draft: TaskDraft, slide_ids: Sequence[uuid.UUID]
) -> list[tuple[uuid.UUID, uuid.UUID]]:
    reviewers = draft.reviewer_ids
    match draft.split:
        case TaskSplit.EVERYONE:
            return [(slide, person) for slide in slide_ids for person in reviewers]
        case TaskSplit.EVEN:
            return [
                (slide, reviewers[index % len(reviewers)]) for index, slide in enumerate(slide_ids)
            ]
        case TaskSplit.CHOSEN:
            pairs = list(dict.fromkeys((pair.slide_id, pair.user_id) for pair in draft.pairs))
            known_slides, known_people = set(slide_ids), set(reviewers)
            if any(
                slide not in known_slides or person not in known_people for slide, person in pairs
            ):
                raise BadPairsError
            if {slide for slide, _ in pairs} != known_slides:
                raise BadPairsError
            order = {slide: index for index, slide in enumerate(slide_ids)}
            return sorted(pairs, key=lambda pair: (order[pair[0]], reviewers.index(pair[1])))


async def form_version(
    connection: AsyncConnection, project_id: uuid.UUID, wanted: int | None
) -> int:
    statement = select(func.max(opinion_forms.c.version)).where(
        opinion_forms.c.project_id == project_id
    )
    if wanted is not None:
        statement = statement.where(opinion_forms.c.version == wanted)
    version = await connection.scalar(statement)
    if version is None:
        raise UnknownFormVersionError
    return int(version)


async def live_default(
    connection: AsyncConnection, template_id: uuid.UUID | None
) -> uuid.UUID | None:
    if template_id is None:
        return None
    return await connection.scalar(
        select(study_templates.c.id).where(
            study_templates.c.id == template_id, study_templates.c.retired_at.is_(None)
        )
    )


async def pinned_template(
    connection: AsyncConnection, template_id: uuid.UUID | None, wanted: int | None
) -> int | None:
    if template_id is None:
        return None
    template = (
        await connection.execute(
            select(study_templates.c.version, study_templates.c.retired_at).where(
                study_templates.c.id == template_id
            )
        )
    ).one_or_none()
    if template is None:
        raise UnknownStudyTemplateError
    if template.retired_at is not None:
        raise StudyTemplateRetiredError
    if wanted is None:
        return int(template.version)
    found = await connection.scalar(
        select(study_template_versions.c.version).where(
            study_template_versions.c.template_id == template_id,
            study_template_versions.c.version == wanted,
        )
    )
    if found is None:
        raise UnknownStudyTemplateError
    return wanted


async def preset_decision(
    connection: AsyncConnection, template_id: uuid.UUID | None, version: int | None
) -> DecisionSettings:
    if template_id is None or version is None:
        return DecisionSettings()
    presets = await connection.scalar(
        select(study_template_versions.c.presets).where(
            study_template_versions.c.template_id == template_id,
            study_template_versions.c.version == version,
        )
    )
    stored = cast(dict[str, Any], presets or {})
    return DecisionSettings.model_validate(stored.get("decision", {}))


async def preset_display(
    connection: AsyncConnection, template_id: uuid.UUID | None, version: int | None
) -> TaskDisplaySettings:
    if template_id is None or version is None:
        return TaskDisplaySettings()
    presets = await connection.scalar(
        select(study_template_versions.c.presets).where(
            study_template_versions.c.template_id == template_id,
            study_template_versions.c.version == version,
        )
    )
    stored = cast(dict[str, Any], presets or {})
    return TaskDisplaySettings(defaults=DisplaySettings.model_validate(stored.get("display", {})))


async def check_sets(
    connection: AsyncConnection, project_id: uuid.UUID, settings: DisplaySettings
) -> None:
    wanted = set(settings.other_sets.result_set_ids)
    if not wanted:
        return
    found = await connection.scalar(
        select(func.count()).where(
            result_sets.c.project_id == project_id, result_sets.c.id.in_(wanted)
        )
    )
    if found != len(wanted):
        raise UnknownResultSetError("Show only result sets of this project")


def lock_details(old: TaskDisplaySettings, after: TaskDisplaySettings) -> dict[str, Any]:
    changed = [
        key
        for key in DisplaySettings.model_fields
        if getattr(old.defaults, key) != getattr(after.defaults, key)
    ]
    return {
        "defaults_changed": sorted(changed),
        "locked": sorted(after.locks),
        "unlocked": sorted(set(old.locks) - set(after.locks)),
    }


def decision_values(decision: DecisionSettings) -> dict[str, Any]:
    return {
        "decision_style": decision.style,
        "counts_as": [value.value for value in decision.counts_as],
        "question": decision.question,
    }


async def has_decisions(connection: AsyncConnection, task_id: uuid.UUID) -> bool:
    given = select(verdicts.c.task_id).where(verdicts.c.task_id == task_id)
    return bool(await connection.scalar(select(given.exists())))


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    tenant_id: uuid.UUID,
    task_id: uuid.UUID,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.REVIEW_TASK,
        task_id,
        tenant_id=tenant_id,
        details=details,
    )


def with_template() -> Select[Any]:
    return select(review_tasks, projects.c.template.label("analysis_template")).join(
        projects, projects.c.id == review_tasks.c.project_id
    )


async def task_row(connection: AsyncConnection, task_id: uuid.UUID) -> Any:
    row = (
        await connection.execute(
            with_template().where(
                review_tasks.c.id == task_id, review_tasks.c.archived_at.is_(None)
            )
        )
    ).one_or_none()
    if row is None:
        raise NotFoundError("Review task not found")
    return row


async def readable_task(
    connection: AsyncConnection, principal: Principal, task_id: uuid.UUID
) -> tuple[Any, bool]:
    row = await task_row(connection, task_id)
    await visible(connection, principal, row.project_id)
    whole = reads_whole(
        await project_grant(connection, principal, row.project_id, Permission.SEE_SLIDES)
    )
    if not whole:
        mine = select(review_assignments.c.slide_id).where(
            review_assignments.c.task_id == task_id, own_assignments(principal)
        )
        if not await connection.scalar(select(mine.exists())):
            raise NotFoundError("Review task not found")
    return row, whole


async def decision_change(
    connection: AsyncConnection, principal: Principal, row: Any, decision: DecisionSettings
) -> dict[str, Any]:
    given = await has_decisions(connection, row.id)
    if decision.style != row.decision_style and given:
        raise StyleLockedError
    values = decision_values(decision)
    before, after = list(row.counts_as), values["counts_as"]
    if before == after:
        return values
    if row.signed_off_at is not None:
        raise CountsAsSignedOffError
    if not given or decision.style is not DecisionStyle.CERTAINTY:
        return values
    recounted, dropped = await recount(connection, row, after)
    entry = {
        "changed_at": datetime.now(UTC).isoformat(),
        "changed_by_user_id": (
            str(principal.user_id) if isinstance(principal, MemberPrincipal) else None
        ),
        "before": before,
        "after": after,
        "recounted": recounted,
        "reasons_dropped": dropped,
    }
    await audit(
        connection,
        principal,
        AuditAction.TASK_COUNTS_AS_CHANGED,
        row.tenant_id,
        row.id,
        {key: value for key, value in entry.items() if key != "changed_by_user_id"},
    )
    return values | {"counts_as_changes": [*row.counts_as_changes, entry]}


@project_router.post(
    "",
    operation_id="createReviewTask",
    status_code=201,
    **require(Permission.CREATE_CASES, write=True),
)
async def create_review_task(
    project_id: uuid.UUID,
    draft: TaskDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
) -> ReviewTaskDetail:
    project = await owned(connection, principal, project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    task_slides = await slides_named(connection, project_id, draft)
    picked = await sets_for(connection, task_slides, draft)
    await check_reviewers(connection, project_id, draft.reviewer_ids)
    slide_ids = [slide.id for slide in task_slides]
    pairs = assignments_for(draft, slide_ids)
    version = await form_version(connection, project_id, draft.opinion_form_version)
    given = draft.model_fields_set
    template_id = (
        draft.study_template_id
        if "study_template_id" in given
        else await live_default(connection, project.study_template_id)
    )
    template_version = await pinned_template(connection, template_id, draft.study_template_version)
    decision = draft.decision or await preset_decision(connection, template_id, template_version)
    display = draft.display or await preset_display(connection, template_id, template_version)
    await check_sets(connection, project_id, display.defaults)
    annotating = draft.kind is TaskKind.ANNOTATE
    snapshot = (
        [item.model_dump(mode="json") for item in await classes_of(connection, project_id)]
        if annotating
        else None
    )
    number = select(func.coalesce(func.max(review_tasks.c.number), 0) + 1).where(
        review_tasks.c.project_id == project_id
    )
    check = stored_check(resolved(draft.preset, draft.check), None) if annotating else None
    scope = draft.task_scope()
    seed = secrets.randbits(62)
    task_id = await connection.scalar(
        insert(review_tasks)
        .values(
            tenant_id=project.tenant_id,
            project_id=project_id,
            number=number.scalar_subquery(),
            name=draft.name,
            kind=draft.kind,
            class_snapshot=snapshot,
            split=draft.split,
            scope=scope.kind,
            scope_count=scope.count,
            scope_seed=seed if scope.kind is TaskScope.RANDOM_CELLS else None,
            scope_score=None if scope.score is None else stored_score(scope.score),
            extra_scopes=stored_parts(draft.extra_scopes, []),
            opinion_form_version=version,
            blinded=draft.blinded if "blinded" in given else project.blinded,
            ai_hidden_first_read=(
                draft.ai_hidden_first_read
                if "ai_hidden_first_read" in given
                else project.ai_hidden_first_read
            ),
            start_mode=draft.start_mode,
            due_on=draft.due_on,
            reminder_days=sorted(set(draft.reminder_days), reverse=True),
            study_template_id=template_id,
            study_template_version=template_version,
            **decision_values(decision),
            display=stored_display(display),
            check_options=check,
            created_by_user_id=(
                principal.user_id if isinstance(principal, MemberPrincipal) else None
            ),
        )
        .returning(review_tasks.c.id)
    )
    assert isinstance(task_id, uuid.UUID)
    await connection.execute(
        insert(review_task_slides),
        [
            {
                "tenant_id": project.tenant_id,
                "project_id": project_id,
                "task_id": task_id,
                "slide_id": slide_id,
                "position": position,
                "kind": draft.kind,
                "result_set_id": picked.get(slide_id),
            }
            for position, slide_id in enumerate(slide_ids)
        ],
    )
    await connection.execute(
        insert(review_assignments),
        [
            {"tenant_id": project.tenant_id, "task_id": task_id, "slide_id": slide, "user_id": user}
            for slide, user in pairs
        ],
    )
    made = await task_row(connection, task_id)
    scopes = ordering_scopes(made)
    if scopes:
        ordered = [slide_id for slide_id in slide_ids if slide_id in picked]
        await store_order(
            connection,
            results,
            project.tenant_id,
            project_id,
            task_id,
            scopes,
            {slide_id: [picked[slide_id]] for slide_id in ordered},
            dict.fromkeys(ordered, seed),
            by_least_sure(made),
        )
    await audit(
        connection,
        principal,
        AuditAction.TASK_CREATED,
        project.tenant_id,
        task_id,
        {
            "project_id": str(project_id),
            "kind": draft.kind.value,
            "slides": len(slide_ids),
            "pinned_result_sets": len(picked),
            "reviewers": len(draft.reviewer_ids),
            "split": draft.split.value,
            "decision_style": decision.style.value,
            "display_locks": sorted(display.locks),
        }
        | ({} if snapshot is None else {"classes": len(snapshot)})
        | (
            {}
            if check is None
            else {
                "preset": check["preset"],
                "check_kinds": [part["kind"] for part in check["scope"]],
                "check_order": check["order"],
                "sign_off": check["sign_off"],
                "unchecked_export": check["unchecked_export"],
            }
        )
        | (
            {}
            if template_id is None
            else {
                "study_template_id": str(template_id),
                "study_template_version": template_version,
            }
        ),
    )
    return await detail_of(connection, principal, await task_row(connection, task_id), True)


@project_router.get(
    "", operation_id="listReviewTasks", **require(Permission.SEE_SLIDES, emergency=True)
)
async def list_review_tasks(
    project_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> list[ReviewTask]:
    await visible(connection, principal, project_id)
    whole = reads_whole(
        await project_grant(connection, principal, project_id, Permission.SEE_SLIDES)
    )
    statement = with_template().where(
        review_tasks.c.project_id == project_id, review_tasks.c.archived_at.is_(None)
    )
    if not whole:
        mine = select(review_assignments.c.task_id).where(own_assignments(principal))
        statement = statement.where(review_tasks.c.id.in_(mine))
    rows = (await connection.execute(statement.order_by(review_tasks.c.number))).all()
    counts = {
        task_id: (slides_count, people)
        for task_id, slides_count, people in await connection.execute(
            select(
                review_assignments.c.task_id,
                func.count(func.distinct(review_assignments.c.slide_id)),
                func.count(func.distinct(review_assignments.c.user_id)),
            )
            .where(
                review_assignments.c.task_id.in_([row.id for row in rows]),
                review_assignments.c.released_at.is_(None),
            )
            .group_by(review_assignments.c.task_id)
        )
    }
    return [task_of(row, *counts.get(row.id, (0, 0))) for row in rows]


@router.get(
    "/{task_id}", operation_id="getReviewTask", **require(Permission.SEE_SLIDES, emergency=True)
)
async def get_review_task(
    task_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> ReviewTaskDetail:
    row, whole = await readable_task(connection, principal, task_id)
    return await detail_of(connection, principal, row, whole)


@router.patch(
    "/{task_id}", operation_id="changeReviewTask", **require(Permission.CREATE_CASES, write=True)
)
async def change_review_task(
    task_id: uuid.UUID,
    change: TaskChange,
    principal: CurrentPrincipal,
    connection: TenantConnection,
    results: Results,
    http: Request,
    background: BackgroundTasks,
) -> ReviewTaskDetail:
    row = await task_row(connection, task_id)
    project = await owned(connection, principal, row.project_id)
    if project.archived_at is not None:
        raise ProjectArchivedError
    values: dict[str, Any] = {}
    for field in ("name", "blinded", "ai_hidden_first_read", "start_mode", "due_on"):
        if field in change.model_fields_set:
            value = getattr(change, field)
            if value is None and field != "due_on":
                raise BadRequestError(f"{field} cannot be empty")
            values[field] = value
    switching = values.get("ai_hidden_first_read", row.ai_hidden_first_read)
    if switching != row.ai_hidden_first_read and await task_started(connection, task_id):
        raise FirstReadStartedError
    if change.decision is not None:
        values |= await decision_change(connection, principal, row, change.decision)
    display_change = None
    if change.display is not None:
        before = display_of(row.display)
        if change.display != before:
            await check_sets(connection, row.project_id, change.display.defaults)
            values["display"] = stored_display(change.display)
            display_change = lock_details(before, change.display)
    if "reminder_days" in change.model_fields_set:
        values["reminder_days"] = sorted(set(change.reminder_days or []), reverse=True)
    first = change.scope or scope_of(row)
    extra = change.extra_scopes if change.extra_scopes is not None else scopes_of(row)[1:]
    if (TaskKind(row.kind) is TaskKind.ANNOTATE) != (first.kind is TaskScope.WHOLE_SLIDE) or (
        TaskScope.WHOLE_SLIDE in {part.kind for part in extra}
    ):
        raise ScopeNotForKindError
    try:
        distinct_kinds(first, extra)
    except ValueError as error:
        raise ScopeKindsRepeatedError(str(error)) from error
    rescoped = (change.scope is not None or change.extra_scopes is not None) and [
        (part.kind, part.count, part.score) for part in [first, *extra]
    ] != [(part.kind, part.count, part.score) for part in scopes_of(row)]
    if change.check is not None:
        if TaskKind(row.kind) is not TaskKind.ANNOTATE:
            raise CheckNotForKindError
        before = check_of(row.check_options)
        values["check_options"] = stored_check(overlaid(before, change.check), row.check_options)
        rescoped = rescoped or (
            [values["check_options"][key] for key in ("scope", "order")]
            != [stored_options(row).get(key) for key in ("scope", "order")]
        )
    if change.extra_scopes is not None:
        values["extra_scopes"] = stored_parts(change.extra_scopes, row.extra_scopes)
    if change.scope is not None:
        scope = change.scope
        values |= {
            "scope": scope.kind,
            "scope_count": scope.count,
            "scope_seed": row.scope_seed
            if scope.kind is TaskScope.RANDOM_CELLS and row.scope_seed is not None
            else secrets.randbits(62)
            if scope.kind is TaskScope.RANDOM_CELLS
            else None,
            "scope_score": None if scope.score is None else stored_score(scope.score),
        }
    await connection.execute(
        update(review_tasks).where(review_tasks.c.id == task_id).values(**values)
    )
    if rescoped:
        changed = await task_row(connection, task_id)
        sets = await task_sets(connection, task_id)
        known = await stored_seeds(connection, task_id, list(sets))
        fallback = changed.scope_seed or secrets.randbits(62)
        scopes = ordering_scopes(changed)
        if scopes:
            await store_order(
                connection,
                results,
                row.tenant_id,
                row.project_id,
                task_id,
                scopes,
                sets,
                {slide_id: known.get(slide_id, fallback) for slide_id in sets},
                by_least_sure(changed),
            )
        else:
            await clear_order(connection, task_id)
    await audit(
        connection,
        principal,
        AuditAction.TASK_CHANGED,
        row.tenant_id,
        task_id,
        {"fields": sorted(change.model_fields_set)},
    )
    if display_change is not None:
        await audit(
            connection,
            principal,
            AuditAction.TASK_DISPLAY_CHANGED,
            row.tenant_id,
            task_id,
            display_change,
        )
    if "due_on" in values and values["due_on"] != row.due_on:
        await tell_due_changed(connection, row, values["due_on"])
        background.add_task(deliver_after_commit, http.app, row.tenant_id)
    return await detail_of(connection, principal, await task_row(connection, task_id), True)
