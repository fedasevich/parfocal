import uuid
from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict, StrictBool, StringConstraints
from sqlalchemy import Row, func, insert, literal_column, select, update
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import AuditAction, AuditTarget, actor_of, record
from parfocal_api.context import CurrentPrincipal, TenantConnection
from parfocal_api.opinion_questions import FormChange
from parfocal_api.permissions import Permission, require
from parfocal_api.principals import MemberPrincipal, Principal
from parfocal_api.problems import ConflictError, NotFoundError
from parfocal_api.review_tasks import Scope, StudyTemplateRetiredError
from parfocal_api.tables import (
    BuiltInTemplate,
    StartMode,
    StudyKind,
    TaskScope,
    TaskSplit,
    review_tasks,
    study_template_versions,
    study_templates,
)
from parfocal_common.db import CURRENT_TENANT
from parfocal_common.report_blocks import (
    BLOCKS,
    ConfusionMatrix,
    DisagreementReasons,
    HeadlineNumbers,
    OpinionAnswers,
    RegionMetrics,
    ReportBlocks,
    ReportFormat,
    ReviewerAgreement,
    SlideFigure,
    SlideTable,
    TextBlock,
    WorstObjects,
)

type TemplateName = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=2, max_length=60)
]


class Presets(BaseModel):
    model_config = ConfigDict(extra="forbid")

    objects_to_check: Scope
    opinion_form: FormChange | None = None
    blinding: StrictBool = True
    first_read: StrictBool = False
    start_mode: StartMode = StartMode.GUIDED
    split: TaskSplit = TaskSplit.EVERYONE


class StudyTemplateDraft(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: TemplateName
    study_kind: StudyKind
    blocks: ReportBlocks
    format: ReportFormat = ReportFormat()
    presets: Presets


class StudyTemplate(StudyTemplateDraft):
    model_config = ConfigDict(extra="ignore")

    id: uuid.UUID
    version: int
    built_in: BuiltInTemplate | None
    retired_at: datetime | None
    created_at: datetime
    version_created_at: datetime


class StudyTemplateSummary(StudyTemplate):
    task_count: int


class StudyTemplateVersion(BaseModel):
    template_id: uuid.UUID
    version: int
    name: str
    created_at: datetime


class TemplateNameTakenError(ConflictError):
    code = "study-template-name-taken"
    title = "A study template with this name already exists"


def regions(**presets: Any) -> Presets:
    return Presets(objects_to_check=Scope(kind=TaskScope.ALL_REGIONS), **presets)


BUILT_INS: dict[BuiltInTemplate, StudyTemplateDraft] = {
    BuiltInTemplate.SENTINEL_NODE: StudyTemplateDraft(
        name="Sentinel node AI evaluation",
        study_kind=StudyKind.REGIONS_AND_CELLS,
        blocks=[
            HeadlineNumbers(
                kind="headline-numbers",
                title="Results",
                metrics=["sensitivity", "precision", "dice", "kappa", "cell-agreement"],
            ),
            ConfusionMatrix(kind="confusion-matrix", title="Cell types, AI against the consensus"),
            DisagreementReasons(
                kind="disagreement-reasons", title="Why reviewers disagreed", width="half"
            ),
            OpinionAnswers(
                kind="opinion-answers",
                title="Opinion answers",
                questions=["acceptable"],
                width="half",
            ),
            WorstObjects(kind="worst-objects", title="Objects, worst first", rows=6),
        ],
        presets=regions(),
    ),
    BuiltInTemplate.DETECTION: StudyTemplateDraft(
        name="Detection study",
        study_kind=StudyKind.REGIONS,
        blocks=[
            HeadlineNumbers(
                kind="headline-numbers",
                title="Results",
                metrics=["sensitivity", "precision", "dice"],
            ),
            RegionMetrics(
                kind="region-metrics",
                title="Regions on each slide",
                columns=["sensitivity", "precision", "dice"],
            ),
            DisagreementReasons(kind="disagreement-reasons", title="Why reviewers disagreed"),
            WorstObjects(kind="worst-objects", title="Objects, worst first", rows=6),
            SlideFigure(kind="slide-figure", title="An object on its slide"),
        ],
        presets=regions(),
    ),
    BuiltInTemplate.SEGMENTATION: StudyTemplateDraft(
        name="Segmentation study",
        study_kind=StudyKind.OUTLINES,
        blocks=[
            HeadlineNumbers(
                kind="headline-numbers",
                title="Results",
                metrics=["dice", "sensitivity", "precision"],
            ),
            RegionMetrics(
                kind="region-metrics",
                title="Regions on each slide",
                columns=["dice", "sensitivity", "precision"],
            ),
            SlideFigure(kind="slide-figure", title="An object on its slide"),
            DisagreementReasons(kind="disagreement-reasons", title="Why reviewers disagreed"),
            SlideTable(
                kind="slide-table",
                title="Each slide",
                columns=["objects", "disagreements", "time"],
            ),
        ],
        presets=regions(start_mode=StartMode.VIEWER, split=TaskSplit.EVEN),
    ),
    BuiltInTemplate.CELL_TYPING: StudyTemplateDraft(
        name="Cell typing study",
        study_kind=StudyKind.CELLS,
        blocks=[
            HeadlineNumbers(
                kind="headline-numbers", title="Results", metrics=["cell-agreement", "kappa"]
            ),
            ConfusionMatrix(kind="confusion-matrix", title="Cell types, AI against the consensus"),
            ReviewerAgreement(
                kind="reviewer-agreement", title="Agreement between reviewers", parts=["cells"]
            ),
            DisagreementReasons(kind="disagreement-reasons", title="Why reviewers disagreed"),
            WorstObjects(kind="worst-objects", title="Objects, worst first", rows=6),
        ],
        presets=Presets(objects_to_check=Scope(kind=TaskScope.RANDOM_CELLS, count=200)),
    ),
    BuiltInTemplate.READER_STUDY: StudyTemplateDraft(
        name="Reader study, first read without AI",
        study_kind=StudyKind.REVIEWERS_FIRST,
        blocks=[
            HeadlineNumbers(
                kind="headline-numbers",
                title="Results",
                metrics=["kappa", "sensitivity", "precision"],
            ),
            ReviewerAgreement(
                kind="reviewer-agreement",
                title="Agreement between reviewers",
                parts=["regions", "cells", "form"],
            ),
            OpinionAnswers(kind="opinion-answers", title="Opinion answers"),
            SlideTable(
                kind="slide-table",
                title="Each slide",
                columns=["objects", "disagreements", "time"],
            ),
            TextBlock(kind="text", title="Methods"),
        ],
        presets=regions(first_read=True, start_mode=StartMode.VIEWER),
    ),
}


def content(draft: StudyTemplateDraft) -> dict[str, Any]:
    return {
        "name": draft.name,
        "study_kind": draft.study_kind.value,
        "blocks": [block.model_dump(mode="json") for block in draft.blocks],
        "format": draft.format.model_dump(mode="json"),
        "presets": draft.presets.model_dump(mode="json"),
    }


def built_in_rows(
    tenant_id: uuid.UUID,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    templates: list[dict[str, Any]] = []
    versions: list[dict[str, Any]] = []
    for key, draft in BUILT_INS.items():
        template_id = uuid.uuid4()
        templates.append(
            {"id": template_id, "tenant_id": tenant_id, "built_in": key.value, "version": 1}
        )
        versions.append(
            {"tenant_id": tenant_id, "template_id": template_id, "version": 1, **content(draft)}
        )
    return templates, versions


async def seed_built_ins(
    connection: AsyncConnection, tenant_id: uuid.UUID
) -> dict[BuiltInTemplate, uuid.UUID]:
    templates, versions = built_in_rows(tenant_id)
    await connection.execute(insert(study_templates), templates)
    await connection.execute(insert(study_template_versions), versions)
    return {BuiltInTemplate(row["built_in"]): row["id"] for row in templates}


router = APIRouter(prefix="/api/study-templates", tags=["study-templates"])


def joined() -> Any:
    return select(
        study_templates.c.id,
        study_templates.c.built_in,
        study_templates.c.retired_at,
        study_templates.c.created_at,
        study_template_versions.c.version,
        study_template_versions.c.name,
        study_template_versions.c.study_kind,
        study_template_versions.c.blocks,
        study_template_versions.c.format,
        study_template_versions.c.presets,
        study_template_versions.c.created_at.label("version_created_at"),
    ).join(
        study_template_versions,
        study_template_versions.c.template_id == study_templates.c.id,
    )


def template_of(row: Row[Any]) -> StudyTemplate:
    return StudyTemplate(
        id=row.id,
        version=row.version,
        built_in=None if row.built_in is None else BuiltInTemplate(row.built_in),
        retired_at=row.retired_at,
        created_at=row.created_at,
        version_created_at=row.version_created_at,
        name=row.name,
        study_kind=StudyKind(row.study_kind),
        blocks=BLOCKS.validate_python(row.blocks),
        format=ReportFormat.model_validate(row.format),
        presets=Presets.model_validate(row.presets),
    )


async def template_at(
    connection: AsyncConnection, template_id: uuid.UUID, version: int | None = None
) -> StudyTemplate:
    statement = joined().where(study_templates.c.id == template_id)
    if version is None:
        statement = statement.where(study_template_versions.c.version == study_templates.c.version)
    else:
        statement = statement.where(study_template_versions.c.version == version)
    row = (await connection.execute(statement)).one_or_none()
    if row is None:
        raise NotFoundError("Study template not found")
    return template_of(row)


async def check_name(
    connection: AsyncConnection, name: str, template_id: uuid.UUID | None = None
) -> None:
    statement = (
        select(study_templates.c.id)
        .join(
            study_template_versions,
            (study_template_versions.c.template_id == study_templates.c.id)
            & (study_template_versions.c.version == study_templates.c.version),
        )
        .where(func.lower(study_template_versions.c.name) == name.casefold())
    )
    if template_id is not None:
        statement = statement.where(study_templates.c.id != template_id)
    if await connection.scalar(select(statement.exists())):
        raise TemplateNameTakenError(f"A template called {name} already exists")


def user_of(principal: Principal) -> uuid.UUID | None:
    return principal.user_id if isinstance(principal, MemberPrincipal) else None


async def audit(
    connection: AsyncConnection,
    principal: Principal,
    action: AuditAction,
    tenant_id: uuid.UUID,
    template_id: uuid.UUID,
    details: dict[str, Any],
) -> None:
    await record(
        connection,
        actor_of(principal),
        action,
        AuditTarget.STUDY_TEMPLATE,
        template_id,
        tenant_id=tenant_id,
        details=details,
    )


@router.get("", operation_id="listStudyTemplates", **require(Permission.REPORT_TEMPLATES))
async def list_study_templates(connection: TenantConnection) -> list[StudyTemplateSummary]:
    rows = (
        await connection.execute(
            joined()
            .where(study_template_versions.c.version == study_templates.c.version)
            .order_by(
                study_templates.c.built_in.is_(None),
                study_templates.c.created_at,
                study_template_versions.c.name,
            )
        )
    ).all()
    counts: dict[uuid.UUID, int] = {
        row[0]: int(row[1])
        for row in await connection.execute(
            select(review_tasks.c.study_template_id, func.count())
            .where(
                review_tasks.c.study_template_id.is_not(None),
                review_tasks.c.archived_at.is_(None),
            )
            .group_by(review_tasks.c.study_template_id)
        )
    }
    return [
        StudyTemplateSummary(**template_of(row).model_dump(), task_count=counts.get(row.id, 0))
        for row in rows
    ]


@router.get(
    "/{template_id}", operation_id="getStudyTemplate", **require(Permission.REPORT_TEMPLATES)
)
async def get_study_template(template_id: uuid.UUID, connection: TenantConnection) -> StudyTemplate:
    return await template_at(connection, template_id)


@router.get(
    "/{template_id}/versions",
    operation_id="listStudyTemplateVersions",
    **require(Permission.REPORT_TEMPLATES),
)
async def list_study_template_versions(
    template_id: uuid.UUID, connection: TenantConnection
) -> list[StudyTemplateVersion]:
    await template_at(connection, template_id)
    rows = await connection.execute(
        select(
            study_template_versions.c.template_id,
            study_template_versions.c.version,
            study_template_versions.c.name,
            study_template_versions.c.created_at,
        )
        .where(study_template_versions.c.template_id == template_id)
        .order_by(study_template_versions.c.version)
    )
    return [StudyTemplateVersion.model_validate(row, from_attributes=True) for row in rows]


@router.get(
    "/{template_id}/versions/{version}",
    operation_id="getStudyTemplateVersion",
    **require(Permission.REPORT_TEMPLATES),
)
async def get_study_template_version(
    template_id: uuid.UUID, version: int, connection: TenantConnection
) -> StudyTemplate:
    return await template_at(connection, template_id, version)


@router.post(
    "",
    operation_id="createStudyTemplate",
    status_code=201,
    **require(Permission.REPORT_TEMPLATES, write=True),
)
async def create_study_template(
    draft: StudyTemplateDraft, principal: CurrentPrincipal, connection: TenantConnection
) -> StudyTemplate:
    await check_name(connection, draft.name)
    tenant_id = await connection.scalar(select(literal_column(CURRENT_TENANT)))
    assert isinstance(tenant_id, uuid.UUID)
    template_id = await connection.scalar(
        insert(study_templates)
        .values(tenant_id=tenant_id, version=1, created_by_user_id=user_of(principal))
        .returning(study_templates.c.id)
    )
    assert isinstance(template_id, uuid.UUID)
    await connection.execute(
        insert(study_template_versions).values(
            tenant_id=tenant_id,
            template_id=template_id,
            version=1,
            created_by_user_id=user_of(principal),
            **content(draft),
        )
    )
    await audit(
        connection,
        principal,
        AuditAction.STUDY_TEMPLATE_CREATED,
        tenant_id,
        template_id,
        {"version": 1, "blocks": len(draft.blocks)},
    )
    return await template_at(connection, template_id)


async def current_row(connection: AsyncConnection, template_id: uuid.UUID) -> Row[Any]:
    row = (
        await connection.execute(select(study_templates).where(study_templates.c.id == template_id))
    ).one_or_none()
    if row is None:
        raise NotFoundError("Study template not found")
    return row


@router.put(
    "/{template_id}",
    operation_id="editStudyTemplate",
    **require(Permission.REPORT_TEMPLATES, write=True),
)
async def edit_study_template(
    template_id: uuid.UUID,
    draft: StudyTemplateDraft,
    principal: CurrentPrincipal,
    connection: TenantConnection,
) -> StudyTemplate:
    row = await current_row(connection, template_id)
    if row.retired_at is not None:
        raise StudyTemplateRetiredError
    current = await template_at(connection, template_id)
    if content(current) == content(draft):
        return current
    await check_name(connection, draft.name, template_id)
    version = row.version + 1
    await connection.execute(
        insert(study_template_versions).values(
            tenant_id=row.tenant_id,
            template_id=template_id,
            version=version,
            created_by_user_id=user_of(principal),
            **content(draft),
        )
    )
    await connection.execute(
        update(study_templates).where(study_templates.c.id == template_id).values(version=version)
    )
    await audit(
        connection,
        principal,
        AuditAction.STUDY_TEMPLATE_EDITED,
        row.tenant_id,
        template_id,
        {"version": version, "blocks": len(draft.blocks)},
    )
    return await template_at(connection, template_id)


async def set_retired(
    connection: AsyncConnection, principal: Principal, template_id: uuid.UUID, retired: bool
) -> StudyTemplate:
    row = await current_row(connection, template_id)
    if (row.retired_at is not None) != retired:
        await connection.execute(
            update(study_templates)
            .where(study_templates.c.id == template_id)
            .values(retired_at=func.now() if retired else None)
        )
        await audit(
            connection,
            principal,
            AuditAction.STUDY_TEMPLATE_RETIRED if retired else AuditAction.STUDY_TEMPLATE_RESTORED,
            row.tenant_id,
            template_id,
            {"version": row.version},
        )
    return await template_at(connection, template_id)


@router.post(
    "/{template_id}/retire",
    operation_id="retireStudyTemplate",
    **require(Permission.REPORT_TEMPLATES, write=True),
)
async def retire_study_template(
    template_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> StudyTemplate:
    return await set_retired(connection, principal, template_id, True)


@router.post(
    "/{template_id}/restore",
    operation_id="restoreStudyTemplate",
    **require(Permission.REPORT_TEMPLATES, write=True),
)
async def restore_study_template(
    template_id: uuid.UUID, principal: CurrentPrincipal, connection: TenantConnection
) -> StudyTemplate:
    return await set_retired(connection, principal, template_id, False)
