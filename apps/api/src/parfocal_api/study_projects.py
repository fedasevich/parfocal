import re
import uuid
from collections.abc import Iterable
from dataclasses import asdict, dataclass
from typing import Any

from fastapi import Response
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import actor_of
from parfocal_api.case_creation import BlockDraft, CaseDraft, SpecimenDraft, create_case
from parfocal_api.class_templates import TaxonomyTemplate
from parfocal_api.principals import MemberPrincipal
from parfocal_api.projects import ProjectDeletion, ProjectDraft, create_project, delete_project
from parfocal_api.result_sets import (
    ResultSetDraft,
    insert_result_set,
)
from parfocal_api.review_order import cancel_order_jobs
from parfocal_api.review_order_job import order_one_slide
from parfocal_api.review_tasks import Scope
from parfocal_api.sample_files import stored_facts
from parfocal_api.showcase import (
    FORMAT_GALLERY,
    PEOPLE,
    Workspace,
    add_slide,
    join,
    lock,
    new_tenant,
    organisation,
    principal_of,
    pseudonymise,
    ready_set,
    sample_facts,
    shared_actors,
)
from parfocal_api.showcase_accounts import SeededAccount, add_account, add_member
from parfocal_api.showcase_case import SPECIMEN, seed_http
from parfocal_api.showcase_demo import built_in_templates, store_seeded_cells
from parfocal_api.showcase_results import CELLS_FILE, CELLS_MODEL, model_cells, model_regions
from parfocal_api.showcase_reviews import (
    Seeded,
    agree_on_the_rest,
    decide,
    redraw_apart,
    review_task,
    submit,
)
from parfocal_api.showcase_samples import PoolSlide, SamplePool, sample_pool
from parfocal_api.study_seats import STUDY_SEAT_DOMAIN, STUDY_SEAT_PREFIX
from parfocal_api.tables import (
    BuiltInTemplate,
    DecisionReason,
    DecisionStyle,
    DecisionValue,
    PrivacyMode,
    ProjectRole,
    ResultSource,
    Role,
    TaskKind,
    TaskScope,
    memberships,
    projects,
    review_tasks,
    tenants,
    users,
)
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
from parfocal_common.ingest import fixture_folder
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_store import ResultStore

STUDY_WORKSPACE = Workspace("cvut-study", "ČVUT · Usability study", "", "", "")
PROJECT_PREFIX = "Study "
REVIEW_TASK = "Study review"
QUEUE_TASK = "Study disagreement queue"
ANNOTATE_TASK = "Study annotation"
REVIEW_SLIDES = ("Study review 1", "Study review 2")
QUEUE_SLIDES = ("Study queue 1", "Study queue 2")
ANNOTATE_SLIDE = "Study annotate"
CASE_LABEL = "Study case"
REQUESTED_BY = "Dr. Jana Horáková, surgery"
CELL_TASK = "Study cell review"
CELL_SLIDE = "Study cells"
CELL_FILES = ("CMU-1.tiff", "CMU-1-JP2K-33005.svs", "CMU-1.ndpi")
CELLS_CHECKED = 12
ORDER_SEED = 20261123
STUDY_LOCK = "study-seed"
CODE_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,32}$")
PARTICIPANT_SEAT = SeededAccount(
    "Study participant", "SP", Role.RESEARCHER, True, ProjectRole.OWNER
)
MODERATOR = SeededAccount("Study moderator", "SM", Role.RESEARCHER, True, ProjectRole.OWNER)


class BadParticipantCodeError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(f"a participant code is 1 to 32 letters, digits or dashes, not {code!r}")


class NoCellResultError(RuntimeError):
    def __init__(self, file: str) -> None:
        super().__init__(f"the fixture slide {file} has no model cells result")


class NoOutlineDisagreementError(RuntimeError):
    def __init__(self) -> None:
        super().__init__("no queue slide has two outlined regions to redraw apart")


@dataclass(frozen=True)
class StudyProject:
    code: str
    tenant_id: uuid.UUID
    project_id: uuid.UUID
    seat_id: uuid.UUID
    review_task_id: uuid.UUID
    review_slide_id: uuid.UUID
    case_id: uuid.UUID
    queue_task_id: uuid.UUID
    queue_slide_id: uuid.UUID
    annotate_task_id: uuid.UUID
    annotate_slide_id: uuid.UUID
    cell_task_id: uuid.UUID
    cell_slide_id: uuid.UUID

    def as_json(self) -> dict[str, str]:
        return {key: str(value) for key, value in asdict(self).items()}


def checked_code(code: str) -> str:
    if not CODE_PATTERN.match(code):
        raise BadParticipantCodeError(code)
    return code.upper()


def project_name(code: str) -> str:
    return f"{PROJECT_PREFIX}{checked_code(code)}"


def seat_subject(code: str) -> str:
    return f"{STUDY_SEAT_PREFIX}{checked_code(code).lower()}{STUDY_SEAT_DOMAIN}"


async def study_lock(connection: AsyncConnection) -> None:
    await connection.execute(
        select(func.pg_advisory_xact_lock(func.hashtextextended(STUDY_LOCK, 0)))
    )


async def study_workspace(connection: AsyncConnection) -> uuid.UUID:
    found = await connection.scalar(
        select(tenants.c.id).where(tenants.c.slug == STUDY_WORKSPACE.slug)
    )
    if found is not None:
        return found
    await lock(connection)
    tenant_id = await new_tenant(connection, await organisation(connection), STUDY_WORKSPACE)
    for person in PEOPLE:
        await add_member(
            connection,
            tenant_id,
            person.subject,
            person.name,
            person.initials,
            person.role,
            admin_rights=person.admin_rights,
        )
    return tenant_id


async def add_seat(
    connection: AsyncConnection, tenant_id: uuid.UUID, code: str, seat_email: str | None
) -> uuid.UUID:
    if seat_email:
        return await add_account(connection, tenant_id, seat_email, PARTICIPANT_SEAT)
    seat_id = await add_member(
        connection,
        tenant_id,
        seat_subject(code),
        f"Participant {checked_code(code)}",
        "PT",
        Role.STUDY_PARTICIPANT,
        admin_rights=False,
    )
    await connection.execute(
        update(memberships)
        .where(memberships.c.tenant_id == tenant_id, memberships.c.user_id == seat_id)
        .values(role=Role.STUDY_PARTICIPANT, admin_rights=False)
    )
    return seat_id


async def people_in(connection: AsyncConnection) -> dict[str, uuid.UUID]:
    rows = await connection.execute(
        select(users.c.id, users.c.subject).where(
            users.c.subject.in_([person.subject for person in PEOPLE])
        )
    )
    by_subject = {row.subject: row.id for row in rows}
    return {person.key: by_subject[person.subject] for person in PEOPLE}


async def live_projects(connection: AsyncConnection, code: str) -> list[uuid.UUID]:
    found = await connection.scalars(
        select(projects.c.id).where(
            projects.c.name == project_name(code), projects.c.deleted_at.is_(None)
        )
    )
    return list(found)


async def remove_live(connection: AsyncConnection, creator: MemberPrincipal, code: str) -> int:
    removed = await live_projects(connection, code)
    for project_id in removed:
        await delete_project(
            project_id, ProjectDeletion(name=project_name(code)), creator, connection
        )
    return len(removed)


async def seed_queue(
    connection: AsyncConnection,
    seeded: Seeded,
    creator: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    sets: dict[uuid.UUID, uuid.UUID],
) -> uuid.UUID:
    task_id = await review_task(
        connection,
        creator,
        results,
        project_id,
        QUEUE_TASK,
        sets,
        [seeded.people["rhea"], seeded.people["remy"]],
        DecisionStyle.AGREE,
    )
    reviewers = [principal_of(seeded, key, Role.REVIEWER, False) for key in ("rhea", "remy")]
    decided: dict[uuid.UUID, set[int]] = {}
    outlined = False
    for slide_id in sets:
        redrawn = (
            None
            if outlined
            else await redraw_apart(connection, reviewers, results, task_id, slide_id)
        )
        if redrawn is not None:
            outlined = True
            for key in ("rhea", "remy"):
                await decide(
                    connection,
                    seeded,
                    project_id,
                    task_id,
                    slide_id,
                    key,
                    DecisionValue.AGREE,
                    number=redrawn,
                )
        await decide(connection, seeded, project_id, task_id, slide_id, "rhea", DecisionValue.AGREE)
        await decide(
            connection,
            seeded,
            project_id,
            task_id,
            slide_id,
            "remy",
            DecisionValue.DISAGREE,
            [DecisionReason.BOUNDARY_OFF],
        )
        decided[slide_id] = {1} if redrawn is None else {1, redrawn}
    if not outlined:
        raise NoOutlineDisagreementError
    await agree_on_the_rest(connection, seeded, project_id, task_id, decided)
    for slide_id in sets:
        await submit(connection, task_id, slide_id)
    return task_id


async def cell_set(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    results: ResultStore,
    slide: Any,
    file: str,
) -> uuid.UUID:
    found = model_cells(file)
    if found is None:
        raise NoCellResultError(file)
    set_id = await insert_result_set(
        connection,
        creator.tenant_id,
        slide,
        ResultSetDraft(
            name="Cell typer v1",
            model_version=CELLS_MODEL,
            classes=found.classes,
            source_file=CELLS_FILE,
        ),
        ResultSource.IMPORT,
        actor_of(creator),
        creator.user_id,
    )
    await store_seeded_cells(
        connection, results, creator.tenant_id, slide.id, set_id, found.cells, len(found.classes)
    )
    return set_id


async def seed_cell_review(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    set_id: uuid.UUID,
    seat_id: uuid.UUID,
    template_id: uuid.UUID,
) -> uuid.UUID:
    task_id = await review_task(
        connection,
        creator,
        results,
        project_id,
        CELL_TASK,
        {slide_id: set_id},
        [seat_id],
        DecisionStyle.AGREE,
        template_id=template_id,
        scope=Scope(kind=TaskScope.RANDOM_CELLS, count=CELLS_CHECKED),
    )
    await connection.execute(
        update(review_tasks).where(review_tasks.c.id == task_id).values(scope_seed=ORDER_SEED)
    )
    await fixed_order(connection, results, task_id, [slide_id])
    return task_id


async def fixed_order(
    connection: AsyncConnection,
    results: ResultStore,
    task_id: uuid.UUID,
    slide_ids: Iterable[uuid.UUID],
) -> None:
    for slide_id in slide_ids:
        await order_one_slide(connection, results, task_id, slide_id, ORDER_SEED)
    await cancel_order_jobs(connection, task_id)


async def cell_pick(store: ObjectStore, pool: SamplePool) -> PoolSlide:
    for file in CELL_FILES:
        stored = await stored_facts(store, fixture_folder(file))
        if stored is not None:
            return PoolSlide(file, stored)
    return pool.next()


async def study_case(
    connection: AsyncConnection, creator: MemberPrincipal, project_id: uuid.UUID
) -> uuid.UUID:
    made = await create_case(
        CaseDraft(
            project_id=project_id,
            label=CASE_LABEL,
            requested_by=REQUESTED_BY,
            specimens=[SpecimenDraft(letter="A", site=SPECIMEN, blocks=[BlockDraft(number=1)])],
        ),
        seed_http(),
        Response(),
        creator,
        connection,
    )
    return made.id


async def seed_study_project(
    connection: AsyncConnection,
    seeded: Seeded,
    store: ObjectStore,
    results: ResultStore,
    code: str,
    seat_id: uuid.UUID,
) -> StudyProject:
    creator = principal_of(seeded, "ada", Role.RESEARCHER, True)
    await remove_live(connection, creator, code)
    project = await create_project(
        ProjectDraft(
            name=project_name(code),
            privacy_mode=PrivacyMode.DE_IDENTIFIED,
            taxonomy=TaxonomyTemplate.SENTINEL_NODE,
        ),
        creator,
        connection,
    )
    templates = await built_in_templates(connection, seeded.tenant_id)
    await connection.execute(
        update(projects)
        .where(projects.c.id == project.id)
        .values(study_template_id=templates[BuiltInTemplate.DETECTION])
    )
    await join(
        connection,
        Seeded(seeded.tenant_id, {**seeded.people, "seat": seat_id}),
        project.id,
        {"seat": ProjectRole.OWNER, "rhea": ProjectRole.REVIEWER, "remy": ProjectRole.REVIEWER},
    )
    pool = await sample_pool(
        store, [slide.file for slide in FORMAT_GALLERY if model_regions(slide.file) is not None]
    )

    async def with_result(
        label: str, case_id: uuid.UUID | None = None
    ) -> tuple[uuid.UUID, uuid.UUID]:
        taken = pool.next()
        facts = sample_facts(taken.stored)
        if case_id is not None:
            facts["case_id"] = case_id
        slide = await add_slide(connection, seeded, project.id, label, facts)
        return slide.id, await ready_set(
            connection, creator, slide, taken.file, "regions.parfocal.json"
        )

    queued = dict([await with_result(label) for label in QUEUE_SLIDES])
    queue_id = await seed_queue(connection, seeded, creator, results, project.id, queued)
    case_id = await study_case(connection, creator, project.id)
    reviewed = dict([await with_result(label, case_id) for label in REVIEW_SLIDES])
    review_id = await review_task(
        connection,
        creator,
        results,
        project.id,
        REVIEW_TASK,
        reviewed,
        [seat_id],
        DecisionStyle.AGREE,
    )
    await fixed_order(connection, results, queue_id, queued)
    await fixed_order(connection, results, review_id, reviewed)
    annotated = await add_slide(
        connection, seeded, project.id, ANNOTATE_SLIDE, sample_facts(pool.next().stored)
    )
    annotate_id = await review_task(
        connection,
        creator,
        results,
        project.id,
        ANNOTATE_TASK,
        {annotated.id: None},
        [seat_id],
        DecisionStyle.CERTAINTY,
        TaskKind.ANNOTATE,
    )
    typed = await cell_pick(store, pool)
    cell_slide = await add_slide(
        connection, seeded, project.id, CELL_SLIDE, sample_facts(typed.stored)
    )
    cell_id = await seed_cell_review(
        connection,
        creator,
        results,
        project.id,
        cell_slide.id,
        await cell_set(connection, creator, results, cell_slide, typed.file),
        seat_id,
        templates[BuiltInTemplate.CELL_TYPING],
    )
    return StudyProject(
        code=checked_code(code),
        tenant_id=seeded.tenant_id,
        project_id=project.id,
        seat_id=seat_id,
        review_task_id=review_id,
        review_slide_id=next(iter(reviewed)),
        case_id=case_id,
        queue_task_id=queue_id,
        queue_slide_id=next(iter(queued)),
        annotate_task_id=annotate_id,
        annotate_slide_id=annotated.id,
        cell_task_id=cell_id,
        cell_slide_id=cell_slide.id,
    )


async def seed_participant(
    database_url: str,
    store: ObjectStore,
    results: ResultStore,
    code: str,
    seat_email: str | None = None,
    moderator_email: str | None = None,
) -> StudyProject:
    checked_code(code)
    engine = create_engine(database_url)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(platform=True, auth=True)
        ) as connection:
            await study_lock(connection)
            tenant_id = await study_workspace(connection)
            seat_id = await add_seat(connection, tenant_id, code, seat_email)
            if moderator_email:
                await add_account(connection, tenant_id, moderator_email, MODERATOR)
            people = await people_in(connection)
            await pseudonymise(connection, shared_actors(False))
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=tenant_id, user_id=people["ada"])
        ) as connection:
            await study_lock(connection)
            return await seed_study_project(
                connection, Seeded(tenant_id, people), store, results, code, seat_id
            )
    finally:
        await engine.dispose()


async def remove_participant(database_url: str, code: str) -> int:
    checked_code(code)
    engine = create_engine(database_url)
    try:
        async with scoped_transaction(
            engine, DatabaseScope(platform=True, auth=True)
        ) as connection:
            tenant_id = await connection.scalar(
                select(tenants.c.id).where(tenants.c.slug == STUDY_WORKSPACE.slug)
            )
            if tenant_id is None:
                return 0
            people = await people_in(connection)
        async with scoped_transaction(
            engine, DatabaseScope(tenant_id=tenant_id, user_id=people["ada"])
        ) as connection:
            creator = principal_of(Seeded(tenant_id, people), "ada", Role.RESEARCHER, True)
            return await remove_live(connection, creator, code)
    finally:
        await engine.dispose()
