import uuid
from dataclasses import dataclass

from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_api.audit import actor_of
from parfocal_api.opinions import OpinionChange, save_opinion
from parfocal_api.principals import MemberPrincipal
from parfocal_api.realtime import NoRealtime
from parfocal_api.result_sets import (
    ChunkRow,
    ResultSetDraft,
    add_chunks,
    add_regions,
    cells_per_class,
    finish,
    insert_result_set,
)
from parfocal_api.review_decisions import ReviewDecisionDraft, save_decision
from parfocal_api.review_objects import list_review_objects
from parfocal_api.review_order import cancel_order_jobs, stored_seeds
from parfocal_api.review_order_job import order_one_slide
from parfocal_api.review_states import submit_slide_review
from parfocal_api.showcase_results import (
    CELLS_FILE,
    CELLS_MODEL,
    REGIONS_FILE,
    REGIONS_MODEL,
    model_cells,
    model_regions,
)
from parfocal_api.tables import (
    BuiltInTemplate,
    DecisionReason,
    DecisionValue,
    ResultSource,
    slides,
    study_templates,
)
from parfocal_common.chunk_store import build_cells, write_cells
from parfocal_common.result_store import ResultStore

DEMO_OPINION = {"acceptable": 4}


@dataclass
class DemoSets:
    regions: dict[uuid.UUID, uuid.UUID | None]
    cells: dict[uuid.UUID, uuid.UUID | None]


async def built_in_templates(
    connection: AsyncConnection, tenant_id: uuid.UUID
) -> dict[BuiltInTemplate, uuid.UUID]:
    rows = await connection.execute(
        select(study_templates.c.built_in, study_templates.c.id).where(
            study_templates.c.tenant_id == tenant_id, study_templates.c.built_in.is_not(None)
        )
    )
    return {BuiltInTemplate(built_in): template_id for built_in, template_id in rows}


async def add_demo_sets(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    results: ResultStore,
    slide_id: uuid.UUID,
    demo: DemoSets,
) -> None:
    slide = (
        await connection.execute(
            select(slides.c.id, slides.c.project_id, slides.c.label).where(slides.c.id == slide_id)
        )
    ).one()
    real_regions = model_regions(slide.label)
    real_cells = model_cells(slide.label)
    if real_regions is not None:
        regions_id = await insert_result_set(
            connection,
            principal.tenant_id,
            slide,
            ResultSetDraft(
                name="Tumour detector v1",
                model_version=REGIONS_MODEL,
                classes=real_regions.classes,
                source_file=REGIONS_FILE,
            ),
            ResultSource.IMPORT,
            actor_of(principal),
            principal.user_id,
        )
        await add_regions(connection, regions_id, real_regions.rows)
        await finish(connection, regions_id)
        demo.regions[slide_id] = regions_id
    if real_cells is not None:
        cells_id = await insert_result_set(
            connection,
            principal.tenant_id,
            slide,
            ResultSetDraft(
                name="Cell typer v1",
                model_version=CELLS_MODEL,
                classes=real_cells.classes,
                source_file=CELLS_FILE,
            ),
            ResultSource.IMPORT,
            actor_of(principal),
            principal.user_id,
        )
        built = build_cells(
            principal.tenant_id, slide_id, cells_id, real_cells.cells, len(real_cells.classes)
        )
        entries = await write_cells(results, built)
        await add_chunks(connection, cells_id, [ChunkRow.of(entry) for entry in entries])
        await finish(connection, cells_id, cells_per_class(entries))
        demo.cells[slide_id] = cells_id


async def order_now(
    connection: AsyncConnection,
    results: ResultStore,
    task_id: uuid.UUID,
    slide_ids: list[uuid.UUID],
) -> None:
    seeds = await stored_seeds(connection, task_id, slide_ids)
    for slide_id, seed in seeds.items():
        await order_one_slide(connection, results, task_id, slide_id, seed)
    await cancel_order_jobs(connection, task_id)


async def decide_all(
    connection: AsyncConnection,
    principal: MemberPrincipal,
    results: ResultStore,
    task_id: uuid.UUID,
    slide_ids: list[uuid.UUID],
    *,
    submit: bool,
) -> None:
    for slide_id in slide_ids:
        listed = await list_review_objects(task_id, slide_id, principal, connection, results)
        for position, found in enumerate(listed.objects):
            draft = (
                ReviewDecisionDraft(
                    value=DecisionValue.DISAGREE, reasons=[DecisionReason.BOUNDARY_OFF]
                )
                if position == len(listed.objects) - 1
                else ReviewDecisionDraft(value=DecisionValue.AGREE)
            )
            await save_decision(
                task_id, slide_id, found.object, draft, principal, connection, results
            )
        await save_opinion(
            task_id, slide_id, OpinionChange(answers=DEMO_OPINION), principal, connection
        )
        if submit:
            await submit_slide_review(
                task_id, slide_id, principal, connection, BackgroundTasks(), NoRealtime()
            )
