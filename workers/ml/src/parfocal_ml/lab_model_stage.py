import asyncio
import uuid
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncConnection

from parfocal_common.envelope import EnvelopeError, MasterKeyring
from parfocal_common.jobs import StepFailedError, StepFunction, StepRun
from parfocal_common.lab_model_call import Endpoint, SignIn
from parfocal_common.link_fetch import LinkPolicy
from parfocal_common.model_runs import Area, mark_area
from parfocal_common.result_store import ResultStore
from parfocal_common.sealed_fields import open_sealed
from parfocal_common.structured_logging import bind, log_context, register_sensitive
from parfocal_common.taxonomies import TaxonomyTemplate, class_names
from parfocal_ml.lab_detector import CHANGED, LabDetector, LabModelSpec, Region, lab_tile_core
from parfocal_ml.nuclei import RegionReader
from parfocal_ml.whole_slide import Tile, TilePlan, Window, plan_tiles, run_tiles

TABLE = "lab_models"
SECRET_FIELD = "secret"
NOT_ALLOWED = "lab-model-not-allowed"
UNCONFIRMED = "lab-model-tiles-unconfirmed"
SEALED = "lab-model-sealed"
NO_RESULT_SET = "lab-model-result-set"
CLINICAL = "clinical"

RUN = text("SELECT detector, detector_version FROM model_runs WHERE job_id = :job_id")
MODEL = text(
    "SELECT id, address, sign_in, header_name, secret_ciphertext, tile_size, magnification, "
    "taxonomy, class_map FROM lab_models WHERE name = :name AND version = :version"
)
SHARING = text(
    "SELECT lab_model_projects.tiles_confirmed_at, projects.privacy_mode "
    "FROM lab_model_projects JOIN projects ON projects.id = lab_model_projects.project_id "
    "WHERE lab_model_projects.lab_model_id = :model_id "
    "AND lab_model_projects.project_id = :project_id AND projects.deleted_at IS NULL"
)
RESULT_SET = text(
    "SELECT id FROM result_sets WHERE job_id = :job_id AND status = 'importing' "
    "AND deleted_at IS NULL"
)
LAST_REGION = text(
    "SELECT coalesce(max(number), 0) FROM result_objects "
    "WHERE result_set_id = :result_set_id AND kind = 'region'"
)
ADD_REGION = text(
    "INSERT INTO result_objects (tenant_id, result_set_id, kind, number, geometry, class_index) "
    "SELECT :tenant_id, :result_set_id, 'region', :number, shape, :class_index "
    "FROM (SELECT ST_GeomFromEWKT(:shape) AS shape) AS drawn WHERE ST_IsValid(shape) "
    "RETURNING number"
)


@dataclass(frozen=True)
class LabSlide:
    reader: RegionReader
    bounds: Window
    prefix: str


type SlideOf = Callable[[StepRun], Awaitable[LabSlide]]


def class_map_of(stored: Sequence[Mapping[str, Any]]) -> dict[str, str | None]:
    return {str(match["sent"]): match.get("becomes") for match in stored}


async def opened_secret(
    connection: AsyncConnection, keyring: MasterKeyring | None, tenant_id: uuid.UUID, row: Any
) -> str | None:
    if row.secret_ciphertext is None:
        return None
    if keyring is None:
        raise StepFailedError(SEALED)
    try:
        secret = await open_sealed(
            connection, keyring, tenant_id, TABLE, row.id, SECRET_FIELD, row.secret_ciphertext
        )
    except EnvelopeError as error:
        raise StepFailedError(SEALED) from error
    register_sensitive(secret)
    return secret


async def check_sharing(
    connection: AsyncConnection, model_id: uuid.UUID, project_id: uuid.UUID | None
) -> None:
    shared = (
        await connection.execute(SHARING, {"model_id": model_id, "project_id": project_id})
    ).first()
    if shared is None:
        raise StepFailedError(NOT_ALLOWED)
    if shared.privacy_mode == CLINICAL and shared.tiles_confirmed_at is None:
        raise StepFailedError(UNCONFIRMED)


async def lab_spec_of(
    connection: AsyncConnection, keyring: MasterKeyring | None, step: StepRun
) -> LabModelSpec:
    run = (await connection.execute(RUN, {"job_id": step.job_id})).one()
    row = (
        await connection.execute(MODEL, {"name": run.detector, "version": run.detector_version})
    ).first()
    if row is None:
        raise StepFailedError(CHANGED)
    await check_sharing(connection, row.id, step.project_id)
    secret = await opened_secret(connection, keyring, step.tenant_id, row)
    return LabModelSpec(
        name=run.detector,
        version=run.detector_version,
        endpoint=Endpoint(row.address, SignIn(row.sign_in), secret, row.header_name),
        tile_size=row.tile_size,
        magnification=row.magnification,
        class_map=class_map_of(row.class_map),
        classes=class_names(TaxonomyTemplate(row.taxonomy)),
    )


def shape_of(ring: Sequence[float]) -> str:
    points = [f"{ring[index]} {ring[index + 1]}" for index in range(0, len(ring), 2)]
    return f"SRID=0;POLYGON(({', '.join([*points, points[0]])}))"


async def add_regions(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    result_set_id: uuid.UUID,
    regions: Sequence[Region],
) -> int:
    number = int(await connection.scalar(LAST_REGION, {"result_set_id": result_set_id}) or 0)
    stored = 0
    for region in regions:
        added = await connection.scalar(
            ADD_REGION,
            {
                "tenant_id": tenant_id,
                "result_set_id": result_set_id,
                "number": number + 1,
                "shape": shape_of(region.ring),
                "class_index": region.class_index,
            },
        )
        if added is not None:
            number += 1
            stored += 1
    return stored


@dataclass
class LabProgress:
    step: StepRun
    plan: TilePlan
    detector: LabDetector
    result_set_id: uuid.UUID
    regions: int = 0

    async def done(self) -> frozenset[int]:
        return await self.step.done_units()

    async def total(self, count: int) -> None:
        await self.step.set_total(count)

    async def mark(self, tile: Tile, objects: int) -> None:
        found = self.detector.take_regions(self.plan.window_of(tile))
        core = tile.core
        async with self.step.transaction() as connection:
            stored = await add_regions(connection, self.step.tenant_id, self.result_set_id, found)
            area = Area(core.x, core.y, core.width, core.height, objects + stored)
            await mark_area(self.step, connection, tile.index, area)
        self.regions += stored

    async def should_stop(self) -> bool:
        return await self.step.should_stop()


async def result_set_of(connection: AsyncConnection, step: StepRun) -> uuid.UUID:
    found = await connection.scalar(RESULT_SET, {"job_id": step.job_id})
    if found is None:
        raise StepFailedError(NO_RESULT_SET)
    return found


def lab_model_running(
    slide_of: SlideOf,
    keyring: MasterKeyring | None,
    policy: LinkPolicy,
    store: ResultStore,
    pause: Callable[[float], Awaitable[None]] = asyncio.sleep,
) -> StepFunction:
    async def run(step: StepRun) -> Mapping[str, Any]:
        with log_context(step.job_id.hex):
            bind(tenant_id=step.tenant_id)
            return await stage(step)

    async def stage(step: StepRun) -> Mapping[str, Any]:
        async with step.transaction() as connection:
            spec = await lab_spec_of(connection, keyring, step)
            result_set_id = await result_set_of(connection, step)
        slide = await slide_of(step)
        detector = LabDetector(spec, slide.reader, policy, pause=pause)
        core = lab_tile_core(slide.reader.mpp, spec)
        plan = plan_tiles(slide.bounds, slide.bounds, core, 0)
        progress = LabProgress(step, plan, detector, result_set_id)
        ran = await run_tiles(plan, plan.tiles, detector, store, slide.prefix, progress)
        return {
            "tiles": len(plan.tiles),
            "ran": ran,
            "regions": progress.regions,
            "classes": list(spec.classes),
            "regions_left_out": detector.regions_left_out,
            "classes_left_out": detector.classes_left_out,
        }

    return run
