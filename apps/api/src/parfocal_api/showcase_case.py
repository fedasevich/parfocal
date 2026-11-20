import os
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from types import SimpleNamespace
from typing import Any, cast

from fastapi import BackgroundTasks, Response
from sqlalchemy import func, insert, select, update
from sqlalchemy.dialects.postgresql import insert as upsert
from sqlalchemy.ext.asyncio import AsyncConnection
from starlette.requests import Request

from parfocal_api.case_creation import BlockDraft, CaseDraft, SpecimenDraft, create_case
from parfocal_api.clinical_reports import (
    CaseReportChange,
    CaseReportCosign,
    CaseReportSignOut,
    create_clinical_report,
    send_clinical_report,
    sign_clinical_report,
    update_clinical_report,
)
from parfocal_api.decision_styles import DecisionSettings
from parfocal_api.principals import MemberPrincipal
from parfocal_api.realtime import NoRealtime
from parfocal_api.report_links import create_report_link
from parfocal_api.review_tasks import Scope, SlideSet, TaskDraft, create_review_task
from parfocal_api.showcase_demo import DemoSets, add_demo_sets, built_in_templates, decide_all
from parfocal_api.sign_out import SignOutChange, set_project_member_sign_out
from parfocal_api.slide_moves import SlideMove, move_slide
from parfocal_api.tables import (
    BuiltInTemplate,
    DecisionStyle,
    Extranodal,
    NodeCategory,
    ProjectRole,
    SignOutRight,
    TaskKind,
    TaskScope,
    TaskSplit,
    UploadStatus,
    cases,
    memberships,
    project_members,
    projects,
    slides,
    uploads,
    users,
)
from parfocal_api.threads import Anchor, MessageCreate, ThreadCreate, create_thread, reply_to_thread
from parfocal_api.uploads import UploadDraft, UploadMetadata, create_upload
from parfocal_common.db import DatabaseScope, scoped_transaction
from parfocal_common.ingest import KIND as INGEST_KIND
from parfocal_common.ingest import job_input
from parfocal_common.jobs import JobStatus, jobs
from parfocal_common.result_store import ResultStore

SHOWCASE_CASE = "Showcase case"
DRAFT_CASE = "Showcase draft report"
COSIGN_CASE = "Showcase co-sign"
SHOWCASE_TASK = "Showcase case review"
MOVED_FILES = ("CMU-1-Small-Region.svs", "CMU-1.ndpi")
UPLOADED_FILE = "Philips-4.tiff"
CASE_FILES = (*MOVED_FILES, UPLOADED_FILE)
MOVE_REASON = "Seeded into the showcase case"
THREAD_TITLE = "Margin on the first block"
THREAD_BODY = "Is the tumour border here clear enough to measure?"
THREAD_REPLY = "Yes, measure from the inked edge."
SPECIMEN = "Sentinel lymph nodes, left axilla, excision"
DIAGNOSIS = "Two sentinel lymph nodes, no metastatic carcinoma (0/2)."
SEED_PART_BYTES = 5 * 1024 * 1024
SEED_MAX_BYTES = 50 * 1024 * 1024 * 1024


@dataclass(frozen=True)
class SeededCase:
    case_id: uuid.UUID
    draft_case_id: uuid.UUID
    cosign_case_id: uuid.UUID
    task_id: uuid.UUID
    thread_id: uuid.UUID
    upload_id: uuid.UUID
    shared_url: str


class NoMultipart:
    async def create_multipart_upload(self, key: str) -> str:
        return f"seeded-{uuid.uuid5(uuid.NAMESPACE_URL, key)}"


def public_origin() -> str:
    return os.environ.get("PUBLIC_ORIGIN", "http://localhost:5173").rstrip("/")


def seed_http(results: ResultStore | None = None) -> Request:
    app = SimpleNamespace(
        keyring=None,
        results=results,
        state=SimpleNamespace(auth=SimpleNamespace(public_origin=public_origin())),
    )
    return Request({"type": "http", "app": app, "headers": []})


async def members_named(
    engine: Any, tenant_id: uuid.UUID, emails: Sequence[str]
) -> list[uuid.UUID]:
    if not emails:
        return []
    async with scoped_transaction(engine, DatabaseScope(platform=True, auth=True)) as connection:
        found = await connection.scalars(
            select(users.c.id)
            .join(memberships, memberships.c.user_id == users.c.id)
            .where(
                memberships.c.tenant_id == tenant_id,
                func.lower(users.c.email).in_([email.strip().lower() for email in emails]),
            )
            .order_by(users.c.email)
        )
        return list(found.all())


async def clinical_project(
    connection: AsyncConnection, tenant_id: uuid.UUID, name: str
) -> uuid.UUID | None:
    return await connection.scalar(
        select(projects.c.id).where(projects.c.tenant_id == tenant_id, projects.c.name == name)
    )


async def case_named(
    connection: AsyncConnection, project_id: uuid.UUID, label: str
) -> uuid.UUID | None:
    return await connection.scalar(
        select(cases.c.id).where(cases.c.project_id == project_id, cases.c.label == label)
    )


async def new_case(
    connection: AsyncConnection, creator: MemberPrincipal, project_id: uuid.UUID, label: str
) -> uuid.UUID:
    made = await create_case(
        CaseDraft(
            project_id=project_id,
            label=label,
            specimens=[SpecimenDraft(letter="A", site=SPECIMEN, blocks=[BlockDraft(number=1)])],
        ),
        seed_http(),
        Response(),
        creator,
        connection,
    )
    return made.id


async def add_case_slide(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    project_id: uuid.UUID,
    file: str,
    facts: Mapping[str, Any],
    **extra: Any,
) -> uuid.UUID:
    slide_id = await connection.scalar(
        insert(slides)
        .values(tenant_id=creator.tenant_id, project_id=project_id, label=file, **facts, **extra)
        .returning(slides.c.id)
    )
    assert isinstance(slide_id, uuid.UUID)
    return slide_id


async def upload_into(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    facts: Mapping[str, Any],
) -> tuple[uuid.UUID, uuid.UUID]:
    created = await create_upload(
        UploadDraft(
            filename=UPLOADED_FILE,
            metadata=UploadMetadata(
                project_id=project_id, case_id=case_id, size=int(facts["file_bytes"])
            ),
        ),
        creator,
        connection,
        cast(
            "Any",
            SimpleNamespace(
                upload_max_bytes=SEED_MAX_BYTES,
                upload_part_bytes=SEED_PART_BYTES,
                project_storage_allowance_bytes=None,
            ),
        ),
        cast("Any", NoMultipart()),
    )
    ingested = await connection.scalar(
        insert(jobs)
        .values(
            tenant_id=creator.tenant_id,
            project_id=project_id,
            kind=INGEST_KIND,
            status=JobStatus.DONE,
            input=job_input(created.upload_id),
            finished_at=func.now(),
        )
        .returning(jobs.c.id)
    )
    await connection.execute(
        update(uploads)
        .where(uploads.c.id == created.upload_id)
        .values(status=UploadStatus.COMPLETED, closed_at=func.now(), job_id=ingested)
    )
    slide_id = await add_case_slide(
        connection,
        creator,
        project_id,
        UPLOADED_FILE,
        facts,
        case_id=case_id,
        upload_id=created.upload_id,
    )
    return created.upload_id, slide_id


async def seat_owner(
    connection: AsyncConnection, tenant_id: uuid.UUID, project_id: uuid.UUID, owner: uuid.UUID
) -> None:
    await connection.execute(
        upsert(project_members)
        .values(tenant_id=tenant_id, project_id=project_id, user_id=owner, role=ProjectRole.OWNER)
        .on_conflict_do_nothing()
    )


async def case_task(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    results: ResultStore,
    project_id: uuid.UUID,
    regions: Mapping[uuid.UUID, uuid.UUID | None],
    reviewers: Sequence[uuid.UUID],
) -> uuid.UUID:
    templates = await built_in_templates(connection, creator.tenant_id)
    task = await create_review_task(
        project_id,
        TaskDraft(
            name=SHOWCASE_TASK,
            kind=TaskKind.REVIEW,
            slide_ids=list(regions),
            result_sets=[
                SlideSet(slide_id=slide_id, result_set_id=set_id)
                for slide_id, set_id in regions.items()
                if set_id is not None
            ],
            reviewer_ids=list(dict.fromkeys(reviewers)),
            split=TaskSplit.EVERYONE,
            scope=Scope(kind=TaskScope.ALL_REGIONS),
            blinded=False,
            decision=DecisionSettings(style=DecisionStyle.AGREE),
            study_template_id=templates[BuiltInTemplate.DETECTION],
        ),
        creator,
        connection,
        results,
        NoRealtime(),
        BackgroundTasks(),
        seed_http(),
    )
    return task.id


async def comment_thread(
    connection: AsyncConnection,
    owner: MemberPrincipal,
    creator: MemberPrincipal,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    results: ResultStore,
) -> uuid.UUID:
    http = seed_http(results)
    thread = await create_thread(
        task_id,
        slide_id,
        ThreadCreate(
            title=THREAD_TITLE,
            body=THREAD_BODY,
            anchor=Anchor.model_validate(
                {"kind": "point", "geometry": {"type": "Point", "coordinates": [1200, 900]}}
            ),
        ),
        owner,
        connection,
        http,
        BackgroundTasks(),
    )
    await reply_to_thread(
        task_id,
        slide_id,
        thread.id,
        MessageCreate(body=THREAD_REPLY),
        creator,
        connection,
        http,
        BackgroundTasks(),
    )
    return thread.id


def finished_report() -> CaseReportChange:
    return CaseReportChange(
        specimen=SPECIMEN,
        category=NodeCategory.NONE,
        nodes_examined=2,
        extranodal=Extranodal.NOT_APPLICABLE,
        diagnosis=DIAGNOSIS,
    )


async def reports(
    connection: AsyncConnection,
    owner: MemberPrincipal,
    creator: MemberPrincipal,
    project_id: uuid.UUID,
    seeded: SeededCase,
) -> None:
    await set_project_member_sign_out(
        project_id,
        owner.user_id,
        SignOutChange(sign_out=SignOutRight.ANY_CASE),
        creator,
        connection,
    )
    await create_clinical_report(project_id, seeded.case_id, owner, connection)
    await update_clinical_report(project_id, seeded.case_id, finished_report(), owner, connection)
    await sign_clinical_report(
        project_id, seeded.case_id, owner, connection, CaseReportSignOut(confirmed_with="password")
    )
    await create_clinical_report(project_id, seeded.draft_case_id, owner, connection)
    await update_clinical_report(
        project_id, seeded.draft_case_id, CaseReportChange(specimen=SPECIMEN), owner, connection
    )
    await create_clinical_report(project_id, seeded.cosign_case_id, creator, connection)
    await update_clinical_report(
        project_id, seeded.cosign_case_id, finished_report(), creator, connection
    )
    await send_clinical_report(
        project_id,
        seeded.cosign_case_id,
        CaseReportCosign(cosigner_user_id=owner.user_id),
        creator,
        connection,
    )


async def seed_showcase_case(
    connection: AsyncConnection,
    creator: MemberPrincipal,
    owner: MemberPrincipal,
    results: ResultStore,
    clinical_study: str,
    facts: Mapping[str, Mapping[str, Any]],
    experts: Sequence[uuid.UUID],
) -> SeededCase | None:
    project_id = await clinical_project(connection, creator.tenant_id, clinical_study)
    if project_id is None or await case_named(connection, project_id, SHOWCASE_CASE) is not None:
        return None
    await seat_owner(connection, creator.tenant_id, project_id, owner.user_id)
    case_id = await new_case(connection, creator, project_id, SHOWCASE_CASE)
    draft_case_id = await new_case(connection, creator, project_id, DRAFT_CASE)
    cosign_case_id = await new_case(connection, creator, project_id, COSIGN_CASE)
    slide_ids: list[uuid.UUID] = []
    for file in MOVED_FILES:
        slide_id = await add_case_slide(connection, creator, project_id, file, facts[file])
        await move_slide(
            slide_id,
            SlideMove(case_id=case_id, reason=MOVE_REASON),
            seed_http(),
            BackgroundTasks(),
            creator,
            connection,
        )
        slide_ids.append(slide_id)
    upload_id, uploaded = await upload_into(
        connection, creator, project_id, case_id, facts[UPLOADED_FILE]
    )
    slide_ids.append(uploaded)
    demo = DemoSets({}, {})
    for slide_id in slide_ids:
        await add_demo_sets(connection, creator, results, slide_id, demo)
    task_id = await case_task(
        connection, creator, results, project_id, demo.regions, [owner.user_id, *experts]
    )
    first = next(iter(demo.regions))
    await decide_all(connection, owner, results, task_id, [first], submit=True)
    thread_id = await comment_thread(connection, owner, creator, task_id, first, results)
    link = await create_report_link(task_id, seed_http(), creator, connection)
    seeded = SeededCase(
        case_id, draft_case_id, cosign_case_id, task_id, thread_id, upload_id, link.url
    )
    await reports(connection, owner, creator, project_id, seeded)
    return seeded
