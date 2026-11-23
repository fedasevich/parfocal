import re
import uuid
from dataclasses import asdict, dataclass

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.class_templates import TaxonomyTemplate
from parfocal_api.principals import MemberPrincipal
from parfocal_api.projects import ProjectDeletion, ProjectDraft, create_project, delete_project
from parfocal_api.showcase import (
    FORMAT_GALLERY,
    PEOPLE,
    PLACEHOLDER_PREFIX,
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
from parfocal_api.showcase_demo import built_in_templates
from parfocal_api.showcase_results import model_regions
from parfocal_api.showcase_reviews import (
    Seeded,
    agree_on_the_rest,
    decide,
    redraw_apart,
    review_task,
    submit,
)
from parfocal_api.showcase_samples import sample_pool
from parfocal_api.tables import (
    BuiltInTemplate,
    DecisionReason,
    DecisionStyle,
    DecisionValue,
    PrivacyMode,
    ProjectRole,
    Role,
    TaskKind,
    projects,
    tenants,
    users,
)
from parfocal_common.db import DatabaseScope, create_engine, scoped_transaction
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
STUDY_LOCK = "study-seed"
CODE_PATTERN = re.compile(r"^[A-Za-z0-9-]{1,32}$")
PARTICIPANT_SEAT = SeededAccount(
    "Study participant", "SP", Role.RESEARCHER, False, ProjectRole.OWNER
)


class BadParticipantCodeError(ValueError):
    def __init__(self, code: str) -> None:
        super().__init__(f"a participant code is 1 to 32 letters, digits or dashes, not {code!r}")


@dataclass(frozen=True)
class StudyProject:
    code: str
    tenant_id: uuid.UUID
    project_id: uuid.UUID
    seat_id: uuid.UUID
    review_task_id: uuid.UUID
    review_slide_id: uuid.UUID
    queue_task_id: uuid.UUID
    queue_slide_id: uuid.UUID
    annotate_task_id: uuid.UUID
    annotate_slide_id: uuid.UUID

    def as_json(self) -> dict[str, str]:
        return {key: str(value) for key, value in asdict(self).items()}


def checked_code(code: str) -> str:
    if not CODE_PATTERN.match(code):
        raise BadParticipantCodeError(code)
    return code.upper()


def project_name(code: str) -> str:
    return f"{PROJECT_PREFIX}{checked_code(code)}"


def seat_subject(code: str) -> str:
    return f"{PLACEHOLDER_PREFIX}study-{checked_code(code).lower()}@showcase.invalid"


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
    return await add_member(
        connection,
        tenant_id,
        seat_subject(code),
        f"Participant {checked_code(code)}",
        "PT",
        PARTICIPANT_SEAT.role,
        admin_rights=False,
    )


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
    for index, slide_id in enumerate(sets):
        redrawn = (
            await redraw_apart(connection, reviewers, results, task_id, slide_id)
            if index == 0
            else None
        )
        if redrawn is not None:
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
    await agree_on_the_rest(connection, seeded, project_id, task_id, decided)
    for slide_id in sets:
        await submit(connection, task_id, slide_id)
    return task_id


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
    detection = (await built_in_templates(connection, seeded.tenant_id))[BuiltInTemplate.DETECTION]
    await connection.execute(
        update(projects).where(projects.c.id == project.id).values(study_template_id=detection)
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

    async def with_result(label: str) -> tuple[uuid.UUID, uuid.UUID]:
        taken = pool.next()
        slide = await add_slide(connection, seeded, project.id, label, sample_facts(taken.stored))
        return slide.id, await ready_set(
            connection, creator, slide, taken.file, "regions.parfocal.json"
        )

    reviewed = dict([await with_result(label) for label in REVIEW_SLIDES])
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
    queued = dict([await with_result(label) for label in QUEUE_SLIDES])
    queue_id = await seed_queue(connection, seeded, creator, results, project.id, queued)
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
    return StudyProject(
        code=checked_code(code),
        tenant_id=seeded.tenant_id,
        project_id=project.id,
        seat_id=seat_id,
        review_task_id=review_id,
        review_slide_id=next(iter(reviewed)),
        queue_task_id=queue_id,
        queue_slide_id=next(iter(queued)),
        annotate_task_id=annotate_id,
        annotate_slide_id=annotated.id,
    )


async def seed_participant(
    database_url: str,
    store: ObjectStore,
    results: ResultStore,
    code: str,
    seat_email: str | None = None,
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
