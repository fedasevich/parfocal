import asyncio
import gzip
import hashlib
import io
import json
import threading
import uuid
import zipfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import UTC, date, datetime
from enum import Enum, auto
from functools import cache
from typing import Any

import httpx2
import numpy as np
import pytest
from case_support import TEST_KEYRING, seed_case, seed_project
from db_support import APP_URL, OWNER_URL, ApiAs, query, with_database
from link_support import Site
from pypdf import PdfReader
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from storage_support import TEST_PART_BYTES, TEST_STORAGE, put_restricted_images, stand_in_images

from parfocal_api.display_settings import DisplaySettings
from parfocal_api.identifiers import ensure_keys, seal_field
from parfocal_api.openapi import openapi_schema
from parfocal_api.patch_exports import PATCH_KIND, patch_export_key
from parfocal_api.principals import MemberPrincipal
from parfocal_api.slide_thumbnail import THUMBNAIL_FILE
from parfocal_api.slide_tissue import TISSUE_FILE
from parfocal_api.study_templates import BUILT_INS, content, seed_built_ins
from parfocal_api.tables import (
    Role,
    adjudication_objects,
    adjudications,
    annotation_versions,
    annotations,
    announcements,
    api_tokens,
    audit_events,
    audit_people,
    case_requests,
    class_mappings,
    clinical_deposits,
    clinical_report_versions,
    clinical_reports,
    disagreement_decisions,
    display_choices,
    display_presets,
    emergency_grants,
    evaluation_changes,
    evaluation_versions,
    event_attempts,
    event_outbox,
    event_targets,
    gpu_usage,
    hidden_models,
    import_sources,
    invitations,
    job_steps,
    job_units,
    jobs,
    lab_model_projects,
    lab_models,
    legal_holds,
    linked_subjects,
    memberships,
    model_tiers,
    notification_mutes,
    notification_preferences,
    notifications,
    opinions,
    organisations,
    painted_map_versions,
    painted_maps,
    personal_settings,
    platform_operators,
    project_classes,
    project_members,
    project_webhooks,
    projects,
    report_links,
    result_chunks,
    result_objects,
    result_set_classes,
    result_sets,
    resume_states,
    retention_policies,
    review_assignments,
    review_decisions,
    review_edit_versions,
    review_edits,
    review_order,
    review_skips,
    review_task_slides,
    review_tasks,
    service_accounts,
    session_policies,
    site_validations,
    slide_counters,
    slide_coverage,
    slides,
    source_watches,
    sso_connections,
    stage_throughput,
    study_template_versions,
    study_templates,
    task_nudges,
    task_reassignments,
    template_offers,
    tenants,
    thread_messages,
    threads,
    timing_events,
    uploads,
    users,
    watched_files,
    webhook_calls,
    workspace_access_requests,
    workspace_settings,
)
from parfocal_common.cell_crops import crop_key
from parfocal_common.chunk_store import Cell, build_cells, cells_in, chunk_of, packed, write_cells
from parfocal_common.db import SET_SCOPE, DatabaseScope, async_database_url, scoped_transaction
from parfocal_common.embedding_cache import (
    EMBEDDING_BYTES,
    SERVER_ENCODER,
    EmbeddingManifest,
    bitset,
    manifest_key,
)
from parfocal_common.embedding_cache import tile_key as embedding_tile_key
from parfocal_common.ingest import RestrictedImage, slide_prefix
from parfocal_common.model_runs import (
    MODEL_STAGE,
    STAGES,
    RunScopeKind,
    RunSettings,
    enqueue_model_run,
    run_prefix,
    tile_key,
)
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.result_imports import result_set_prefix
from parfocal_common.result_store import ObjectResultStore
from parfocal_common.warm_gate import WarmGate
from parfocal_ingest.tissue import TissueMask

pytestmark = pytest.mark.db

SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}


@dataclass(frozen=True)
class Seeded:
    tenant_id: uuid.UUID
    subject: str
    ids: dict[str, uuid.UUID] = field(default_factory=dict[str, uuid.UUID])
    markers: set[str] = field(default_factory=set[str])

    def member(self, admin_rights: bool = False) -> MemberPrincipal:
        return MemberPrincipal(
            self.subject, self.tenant_id, self.ids["user"], Role.RESEARCHER, admin_rights
        )


type Seeder = Callable[[AsyncConnection, Seeded], Awaitable[None]]


class Exposure(Enum):
    PUBLIC = auto()
    PLATFORM = auto()
    TENANT = auto()


def text_of(response: httpx2.Response) -> str:
    if response.headers.get("content-type") == "application/pdf":
        pages = PdfReader(io.BytesIO(response.content)).pages
        return " ".join(page.extract_text() for page in pages)
    if response.headers.get("content-type") == "application/zip":
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            return " ".join(archive.read(name).decode() for name in archive.namelist())
    if response.headers.get("content-type") == "application/vnd.parfocal.cell-chunk":
        return " ".join(str(cell.number) for cell in cells_in(*chunk_of(response.content)))
    return response.text


@dataclass(frozen=True)
class Route:
    exposure: Exposure
    path: Callable[[Seeded], str]
    admin_rights: bool = False
    linked: bool = False


LINK_SITE = Site()


@cache
def link_site_serving() -> threading.Thread:
    thread = threading.Thread(target=LINK_SITE.server.serve_forever, daemon=True)
    thread.start()
    return thread


def slug_of(seeded: Seeded) -> str:
    return seeded.subject.removeprefix("subject-")


def source_address(seeded: Seeded) -> str:
    return LINK_SITE.url(f"/{slug_of(seeded)}/")


def serve_link_files(seeded: Seeded) -> None:
    name = f"{slug_of(seeded)}.svs"
    LINK_SITE.index(f"/{slug_of(seeded)}/", [name])
    LINK_SITE.file(f"/{slug_of(seeded)}/{name}", b"slide-bytes")


def prepared(api: ApiAs, route: Route, monkeypatch: pytest.MonkeyPatch) -> ApiAs:
    if route.linked:
        link_site_serving()
        trusted = api.app.settings.model_copy(update={"link_trusted_origins": [LINK_SITE.origin]})
        monkeypatch.setattr(api.app, "settings", trusted)
    return api


BASE_TABLES = {
    "organisations",
    "tenants",
    "users",
    "memberships",
    "registered_models",
    "maintenance",
}
CASE_TABLES = {
    "opinions",
    "disagreement_decisions",
    "review_decisions",
    "review_skips",
    "review_edits",
    "review_edit_versions",
    "review_order",
    "review_tasks",
    "review_task_slides",
    "review_assignments",
    "task_nudges",
    "task_reassignments",
    "threads",
    "thread_messages",
    "result_sets",
    "result_set_classes",
    "result_objects",
    "result_chunks",
    "annotations",
    "annotation_versions",
    "slide_counters",
    "jobs",
    "job_steps",
    "job_units",
    "stage_throughput",
    "gpu_usage",
    "notification_preferences",
    "personal_settings",
    "workspace_settings",
    "projects",
    "project_members",
    "opinion_forms",
    "project_classes",
    "class_mappings",
    "tenant_keys",
    "patients",
    "specimens",
    "blocks",
    "slides",
    "case_requests",
    "emergency_grants",
}
AUTH_TABLES = {
    "platform_operators",
    "auth_logins",
    "sessions",
    "rate_counters",
    "linked_subjects",
}


async def seed_audit_people(connection: AsyncConnection, seeded: Seeded) -> None:
    subject = await connection.scalar(
        select(users.c.subject).where(users.c.id == seeded.ids["user"])
    )
    pseudonym = await connection.scalar(
        insert(audit_people).values(subject=subject).returning(audit_people.c.id)
    )
    assert isinstance(pseudonym, uuid.UUID)
    seeded.ids["audit_person"] = pseudonym
    seeded.markers.add(str(subject))


async def seed_audit_events(connection: AsyncConnection, seeded: Seeded) -> None:
    marker = f"audit-{uuid.uuid4().hex}"
    await connection.execute(
        insert(audit_events).values(
            tenant_id=seeded.tenant_id,
            actor_kind="member",
            actor_id=seeded.ids["audit_person"],
            action="case.opened",
            target_type="case",
            details=f'{{"marker":"{marker}"}}',
        )
    )
    seeded.markers.add(marker)


async def seed_service_accounts(connection: AsyncConnection, seeded: Seeded) -> None:
    name = f"Service {uuid.uuid4().hex}"
    account = await connection.scalar(
        insert(service_accounts)
        .values(tenant_id=seeded.tenant_id, name=name, scopes=["see-people"])
        .returning(service_accounts.c.id)
    )
    assert isinstance(account, uuid.UUID)
    seeded.ids["service_account"] = account
    seeded.markers.update({name, str(account)})


async def seed_api_tokens(connection: AsyncConnection, seeded: Seeded) -> None:
    token = await connection.scalar(
        insert(api_tokens)
        .values(
            tenant_id=seeded.tenant_id,
            service_account_id=seeded.ids["service_account"],
            token_hash=uuid.uuid4().bytes,
            expires_at=text("now() + interval '1 day'"),
        )
        .returning(api_tokens.c.id)
    )
    seeded.markers.add(str(token))


async def seed_invitations(connection: AsyncConnection, seeded: Seeded) -> None:
    email = f"invited-{uuid.uuid4().hex[:12]}@example.test"
    await connection.execute(
        insert(invitations).values(
            tenant_id=seeded.tenant_id,
            email=email,
            role="researcher",
            token_hash=uuid.uuid4().bytes,
            expires_at=text("now() + interval '1 day'"),
        )
    )
    seeded.markers.add(email)


async def seed_announcements(connection: AsyncConnection, seeded: Seeded) -> None:
    text_ = f"Announcement {uuid.uuid4().hex[:12]}"
    await connection.execute(
        insert(announcements).values(tenant_id=seeded.tenant_id, kind="change", text=text_)
    )
    seeded.markers.add(text_)


async def seed_retention_policies(connection: AsyncConnection, seeded: Seeded) -> None:
    days = 100_000 + uuid.uuid4().int % 900_000
    await connection.execute(
        insert(retention_policies).values(tenant_id=seeded.tenant_id, deleted_after_days=days)
    )
    seeded.markers.add(str(days))


async def seed_legal_holds(connection: AsyncConnection, seeded: Seeded) -> None:
    reason = f"Hold {uuid.uuid4().hex[:12]}"
    await connection.execute(insert(legal_holds).values(tenant_id=seeded.tenant_id, reason=reason))
    seeded.markers.add(reason)


async def seed_session_policies(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(session_policies).values(
            tenant_id=seeded.tenant_id, idle_lock_minutes=20, session_hours=10
        )
    )


async def seed_sso_connections(connection: AsyncConnection, seeded: Seeded) -> None:
    organisation = f"idp-org-{uuid.uuid4().hex[:12]}"
    domain = f"sso-{uuid.uuid4().hex[:10]}.example.test"
    await connection.execute(
        insert(sso_connections).values(
            tenant_id=seeded.tenant_id,
            idp_organisation_id=organisation,
            idp_id=f"idp-{uuid.uuid4().hex[:12]}",
            email_domains=[domain],
        )
    )
    seeded.markers.update({organisation, domain})


async def seed_linked_subjects(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(linked_subjects).values(
            subject=f"sso-subject-{uuid.uuid4().hex[:12]}",
            user_id=seeded.ids["user"],
            sso_tenant_id=seeded.tenant_id,
        )
    )


async def seed_notifications(connection: AsyncConnection, seeded: Seeded) -> None:
    target = uuid.uuid4()
    await connection.execute(
        insert(notifications).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            kind="mention",
            target_type="task",
            target_id=target,
            in_app=True,
            realtime=True,
            email_status="none",
        )
    )
    await connection.execute(
        insert(notification_preferences).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            kind="reply",
            in_app=True,
            email=False,
            realtime=True,
        )
    )
    await connection.execute(
        insert(personal_settings).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            values={"tools": "dock", "marker": str(target)},
        )
    )
    await connection.execute(
        insert(workspace_settings).values(
            tenant_id=seeded.tenant_id,
            values={"decision_cutoff": 60},
            locked=[],
            security_contact=f"security-{target}@example.test",
        )
    )
    seeded.markers.add(str(target))


async def seed_cases(connection: AsyncConnection, seeded: Seeded) -> None:
    case = await seed_case(connection, seeded.tenant_id)
    seeded.ids["case"] = case.case_id
    seeded.ids["case_slide_0"] = case.slide_ids[0]
    seeded.ids["project"] = case.project_id
    seeded.ids["patient"] = case.patient_id
    job_id = await connection.scalar(
        insert(jobs)
        .values(tenant_id=seeded.tenant_id, project_id=case.project_id, kind="isolation-seed")
        .returning(jobs.c.id)
    )
    assert isinstance(job_id, uuid.UUID)
    await connection.execute(
        insert(job_steps).values(tenant_id=seeded.tenant_id, job_id=job_id, ordinal=0, name="scan")
    )
    await connection.execute(
        insert(job_units).values(
            tenant_id=seeded.tenant_id, job_id=job_id, ordinal=0, unit=0, worker="seed"
        )
    )
    await connection.execute(
        insert(stage_throughput).values(
            tenant_id=seeded.tenant_id,
            job_id=job_id,
            ordinal=0,
            run=1,
            kind="isolation-seed",
            stage="scan",
            machine="seed",
            worker="seed",
            units=1,
            seconds=1.0,
        )
    )
    seeded.ids["job"] = job_id
    seeded.markers.add(str(job_id))
    class_name = f"Class {uuid.uuid4().hex[:8]}"
    class_id = await connection.scalar(
        insert(project_classes)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            key=1,
            name=class_name,
            colour="#f87171",
        )
        .returning(project_classes.c.id)
    )
    source = uuid.uuid4()
    source_name = str(source)
    await connection.execute(
        insert(class_mappings).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            source_name=source_name,
            class_id=class_id,
        )
    )
    assert isinstance(class_id, uuid.UUID)
    seeded.ids["source"] = source
    seeded.markers.update({class_name, source_name, str(class_id)})
    await connection.execute(
        insert(project_members).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            user_id=seeded.ids["user"],
            role="owner",
        )
    )
    await seed_deleted_projects(connection, seeded)
    notification_id = await connection.scalar(
        insert(notifications)
        .values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            kind="emergency-access",
            target_type="project",
            target_id=case.project_id,
            in_app=True,
            realtime=True,
            email_status="none",
        )
        .returning(notifications.c.id)
    )
    assert isinstance(notification_id, uuid.UUID)
    seeded.ids["notification"] = notification_id
    await connection.execute(
        insert(case_requests).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            request_key="isolation",
            case_id=case.case_id,
        )
    )
    await connection.execute(
        insert(emergency_grants).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            project_id=case.project_id,
            reason="Isolation suite reason",
            expires_at=text("now() + interval '1 hour'"),
        )
    )
    seeded.markers.update({case.label, str(case.case_id), str(case.project_id)})
    annotation_id = await connection.scalar(
        insert(annotations)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            slide_id=case.loose_slide_id,
            kind="roi",
            number=1,
            class_id=class_id,
            geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
            created_by_user_id=seeded.ids["user"],
        )
        .returning(annotations.c.id)
    )
    assert isinstance(annotation_id, uuid.UUID)
    await connection.execute(
        insert(annotation_versions).values(
            tenant_id=seeded.tenant_id,
            annotation_id=annotation_id,
            version=1,
            change="created",
            geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
            changed_by_user_id=seeded.ids["user"],
        )
    )
    await connection.execute(
        insert(slide_counters).values(
            tenant_id=seeded.tenant_id, slide_id=case.loose_slide_id, letter="R", last=1
        )
    )
    seeded.ids["slide"] = case.loose_slide_id
    await connection.execute(
        update(slides)
        .where(slides.c.id == case.loose_slide_id)
        .values(
            restricted_images=[RestrictedImage.LABEL.value],
            width=4096,
            height=2048,
            layer_groups={
                "groups": [{"id": 1, "name": f"Layer {seeded.tenant_id}"}],
                "members": [],
            },
        )
    )
    seeded.markers.add(f"Layer {seeded.tenant_id}")
    async with httpx2.AsyncClient(timeout=30) as http:
        await put_restricted_images(
            ObjectStore(TEST_STORAGE, http),
            seeded.tenant_id,
            case.loose_slide_id,
            {RestrictedImage.LABEL: stand_in_images(str(seeded.tenant_id))[RestrictedImage.LABEL]},
        )
        crop_marker = f"crop-{uuid.uuid4()}"
        seeded.markers.add(crop_marker)
        await ObjectStore(TEST_STORAGE, http).put_object(
            crop_key(seeded.tenant_id, case.loose_slide_id, 1), crop_marker.encode(), "image/jpeg"
        )
        thumbnail_marker = f"thumbnail-{uuid.uuid4()}"
        seeded.markers.add(thumbnail_marker)
        await ObjectStore(TEST_STORAGE, http).put_object(
            f"{slide_prefix(seeded.tenant_id, case.loose_slide_id)}{THUMBNAIL_FILE}",
            thumbnail_marker.encode(),
            "image/jpeg",
        )
        await ObjectStore(TEST_STORAGE, http).put_object(
            f"{slide_prefix(seeded.tenant_id, case.loose_slide_id)}{TISSUE_FILE}",
            TissueMask(64, 20, np.ones((16, 32), dtype=bool), None).png(),
            "image/png",
        )
        await ObjectStore(TEST_STORAGE, http).put_object(
            manifest_key(seeded.tenant_id, case.loose_slide_id),
            EmbeddingManifest(
                SERVER_ENCODER, 0, 1.0, 512, 4096, 2048, 8, 4, bitset(8, 4, {(0, 0)})
            ).render(),
            "application/json",
        )
        await ObjectStore(TEST_STORAGE, http).put_object(
            embedding_tile_key(seeded.tenant_id, case.loose_slide_id, 0, 0),
            str(seeded.tenant_id).encode().ljust(EMBEDDING_BYTES, b"\0"),
            "application/octet-stream",
        )
    set_name = f"Model {uuid.uuid4().hex[:8]}"
    set_id = await connection.scalar(
        insert(result_sets)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            slide_id=case.loose_slide_id,
            name=set_name,
            source="import",
        )
        .returning(result_sets.c.id)
    )
    assert isinstance(set_id, uuid.UUID)
    await connection.execute(
        insert(result_set_classes).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            result_set_id=set_id,
            position=0,
            source_name="tumor",
            class_id=class_id,
        )
    )
    await connection.execute(
        insert(result_objects).values(
            tenant_id=seeded.tenant_id,
            result_set_id=set_id,
            kind="region",
            number=1,
            geometry="SRID=0;POLYGON((0 0,9 0,9 9,0 9,0 0))",
        )
    )
    await connection.execute(
        insert(result_chunks).values(
            tenant_id=seeded.tenant_id,
            result_set_id=set_id,
            chunk=0,
            x=0,
            y=0,
            width=2048,
            height=2048,
            cell_count=1,
            vertex_count=16,
            object_key=f"cells/{set_id}/chunk-00000.pfc",
        )
    )
    await connection.execute(
        update(result_sets).where(result_sets.c.id == set_id).values(status="ready", region_count=1)
    )
    seeded.ids["result_set"] = set_id
    summary_name = f"Cells {uuid.uuid4().hex[:8]}"
    seeded.markers.add(summary_name)
    summary_set = await connection.scalar(
        insert(result_sets)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            slide_id=case.loose_slide_id,
            name=summary_name,
            source="import",
            cell_count=1,
        )
        .returning(result_sets.c.id)
    )
    assert isinstance(summary_set, uuid.UUID)
    cell_number = 100_000_000 + uuid.uuid4().int % 800_000_000
    seeded.markers.add(str(cell_number))
    built = build_cells(
        seeded.tenant_id,
        case.loose_slide_id,
        summary_set,
        [Cell(cell_number, [0, 0, 9, 0, 9, 9, 0, 9], 0, 100)],
        1,
    )
    async with httpx2.AsyncClient(timeout=30) as http:
        storage = ObjectStore(TEST_STORAGE, http)
        entries = await write_cells(ObjectResultStore(storage), built)
        heat_prefix = result_set_prefix(seeded.tenant_id, case.loose_slide_id, summary_set)
        await ObjectResultStore(storage).put(
            f"{heat_prefix}heatmap.bin", gzip.compress(str(cell_number).encode())
        )
        facts = {"width": 2, "height": 2, "level": 0, "downsample": float(cell_number), "mpp": None}
        await storage.put_object(
            f"{heat_prefix}heatmap.json",
            json.dumps({**facts, "tissue_share": None}).encode(),
            "application/json",
        )
    await connection.execute(
        insert(result_chunks),
        [
            {
                "tenant_id": seeded.tenant_id,
                "result_set_id": summary_set,
                "chunk": entry.chunk,
                "x": entry.x,
                "y": entry.y,
                "width": entry.width,
                "height": entry.height,
                "cell_count": entry.cell_count,
                "vertex_count": entry.vertex_count,
                "object_key": entry.object_key,
            }
            for entry in entries
        ],
    )
    await connection.execute(
        insert(result_objects).values(
            tenant_id=seeded.tenant_id,
            result_set_id=summary_set,
            kind="region",
            number=cell_number,
            geometry="SRID=0;POLYGON((0 0,9 0,9 9,0 9,0 0))",
        )
    )
    await connection.execute(
        update(result_sets).where(result_sets.c.id == summary_set).values(status="ready")
    )
    seeded.ids["summary_set"] = summary_set
    task_name = f"Task {uuid.uuid4().hex[:8]}"
    first_read = f"First read {uuid.uuid4().hex[:8]}"
    task_id = await connection.scalar(
        insert(review_tasks)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            number=1,
            name=task_name,
            split="everyone",
            scope="all-regions",
            opinion_form_version=1,
            start_mode="guided",
            created_by_user_id=seeded.ids["user"],
        )
        .returning(review_tasks.c.id)
    )
    assert isinstance(task_id, uuid.UUID)
    await connection.execute(
        insert(review_task_slides).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            position=0,
            result_set_id=set_id,
        )
    )
    await connection.execute(
        insert(review_assignments).values(
            tenant_id=seeded.tenant_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            user_id=seeded.ids["user"],
            submitted_at=func.now(),
            first_read_at=func.now(),
            first_read={"form_version": 1, "answers": {"comment": first_read}, "added": []},
        )
    )
    seeded.markers.add(first_read)
    seeded.markers.add(str(case.loose_slide_id))
    await connection.execute(
        insert(review_order).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            seed=1,
            count=1,
            objects=b"T\x01\x00\x00\x00",
        )
    )
    await connection.execute(
        insert(review_edits).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            user_id=seeded.ids["user"],
            kind="region",
            number=1,
            deleted=True,
        )
    )
    await connection.execute(
        insert(review_edit_versions).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            user_id=seeded.ids["user"],
            kind="region",
            number=1,
            change="edited",
            deleted=True,
        )
    )
    decision_note = f"Decision note {uuid.uuid4().hex[:8]}"
    await connection.execute(
        insert(review_decisions).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            user_id=seeded.ids["user"],
            kind="region",
            number=1,
            value="disagree",
            style="agree",
            answer="disagree",
            reasons=["not_class"],
            note=decision_note,
        )
    )
    seeded.markers.add(decision_note)
    await connection.execute(
        insert(review_decisions).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            user_id=seeded.ids["user"],
            kind="cell",
            number=1,
            value="agree",
            style="agree",
            answer="agree",
            ai_class_id=class_id,
            ai_score=230,
        )
    )
    await connection.execute(
        insert(review_skips).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            user_id=seeded.ids["user"],
            kind="cell",
            number=1,
            ai_class_id=class_id,
        )
    )
    await connection.execute(
        insert(opinions).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            user_id=seeded.ids["user"],
            form_version=1,
            answers={"acceptable": 4},
        )
    )
    await connection.execute(
        insert(disagreement_decisions).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            kind="region",
            number=1,
            decision="keep-ai",
            value="agree",
        )
    )
    await connection.execute(
        insert(task_nudges).values(
            tenant_id=seeded.tenant_id, task_id=task_id, user_id=seeded.ids["user"]
        )
    )
    thread_title = f"Thread {uuid.uuid4().hex[:8]}"
    thread_id = await connection.scalar(
        insert(threads)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=task_id,
            slide_id=case.loose_slide_id,
            title=thread_title,
            anchor_kind="point",
            geometry={"type": "Point", "coordinates": [1, 2]},
            created_by_user_id=seeded.ids["user"],
        )
        .returning(threads.c.id)
    )
    assert isinstance(thread_id, uuid.UUID)
    seeded.ids["thread"] = thread_id
    message_body = f"Message {uuid.uuid4().hex[:8]}"
    await connection.execute(
        insert(thread_messages).values(
            tenant_id=seeded.tenant_id,
            thread_id=thread_id,
            user_id=seeded.ids["user"],
            body=message_body,
        )
    )
    seeded.markers.update({thread_title, message_body})
    slide_thread_title = f"Slide thread {uuid.uuid4().hex[:8]}"
    slide_thread_id = await connection.scalar(
        insert(threads)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            slide_id=case.loose_slide_id,
            title=slide_thread_title,
            anchor_kind="point",
            geometry={"type": "Point", "coordinates": [3, 4]},
            created_by_user_id=seeded.ids["user"],
        )
        .returning(threads.c.id)
    )
    assert isinstance(slide_thread_id, uuid.UUID)
    seeded.ids["slide_thread"] = slide_thread_id
    seeded.markers.add(slide_thread_title)
    colleague_name = f"Colleague {uuid.uuid4().hex[:8]}"
    colleague = await connection.scalar(
        insert(users)
        .values(
            subject=f"colleague-{task_id}",
            display_name=colleague_name,
            initials="CO",
            avatar_colour=0,
        )
        .returning(users.c.id)
    )
    await connection.execute(
        insert(memberships).values(
            tenant_id=seeded.tenant_id,
            user_id=colleague,
            role="researcher",
            deactivates_on=date(2099, 1, 1),
        )
    )
    assert isinstance(colleague, uuid.UUID)
    seeded.ids["colleague"] = colleague
    await connection.execute(
        insert(project_members).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            user_id=colleague,
            role="viewer",
        )
    )
    seeded.markers.add(colleague_name)
    hidden_project = await seed_project(connection, seeded.tenant_id)
    await connection.execute(
        insert(project_members).values(
            tenant_id=seeded.tenant_id,
            project_id=hidden_project,
            user_id=colleague,
            role="owner",
        )
    )
    seeded.ids["hidden_project"] = hidden_project
    seeded.markers.add(str(colleague))
    taker = await connection.scalar(
        insert(users)
        .values(subject=f"taker-{task_id}", display_name="Taker", initials="TT", avatar_colour=0)
        .returning(users.c.id)
    )
    await connection.execute(
        insert(task_reassignments).values(
            tenant_id=seeded.tenant_id,
            task_id=task_id,
            from_user_id=seeded.ids["user"],
            to_user_id=taker,
            what="all",
            slide_ids=[case.loose_slide_id],
            kept_slide_ids=[],
        )
    )
    seeded.ids["task"] = task_id
    seeded.markers.update({str(task_id), task_name})
    layout_text = f"Layout {uuid.uuid4().hex[:12]}"
    await connection.execute(
        update(review_tasks)
        .where(review_tasks.c.id == task_id)
        .values(
            report_layout={
                "blocks": [{"kind": "text", "title": layout_text, "body": "Arranged"}],
                "format": {},
            }
        )
    )
    seeded.markers.add(layout_text)
    snapshot_class = f"Snapshot class {uuid.uuid4().hex[:8]}"
    annotate_id = await connection.scalar(
        insert(review_tasks)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            number=2,
            name=f"Annotate {uuid.uuid4().hex[:8]}",
            kind="annotate",
            class_snapshot=[
                {"id": str(uuid.uuid4()), "key": 1, "name": snapshot_class, "colour": "#d62728"}
            ],
            split="everyone",
            scope="whole-slide",
            opinion_form_version=1,
            start_mode="guided",
            created_by_user_id=seeded.ids["user"],
        )
        .returning(review_tasks.c.id)
    )
    assert isinstance(annotate_id, uuid.UUID)
    await connection.execute(
        insert(review_task_slides).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            task_id=annotate_id,
            slide_id=case.loose_slide_id,
            position=0,
            kind="annotate",
            result_set_id=None,
            signed_off_at=func.now(),
            layer_groups={
                "groups": [{"id": 1, "name": f"Shared {seeded.tenant_id}"}],
                "members": [],
            },
        )
    )
    seeded.markers.add(f"Shared {seeded.tenant_id}")
    seeded.ids["annotate_task"] = annotate_id
    patch_job = await connection.scalar(
        insert(jobs)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            kind=PATCH_KIND,
            status="done",
            input={"task_id": str(annotate_id), "level": 0, "tile_size": 512},
        )
        .returning(jobs.c.id)
    )
    assert isinstance(patch_job, uuid.UUID)
    seeded.ids["patch_job"] = patch_job
    patches = io.BytesIO()
    with zipfile.ZipFile(patches, "w") as archive:
        archive.writestr("index.csv", f"tile,slide_id\ntiles/a.png,{case.loose_slide_id}\n")
    async with httpx2.AsyncClient(timeout=30) as http:
        await ObjectStore(TEST_STORAGE, http).put_object(
            patch_export_key(seeded.tenant_id, patch_job), patches.getvalue(), "application/zip"
        )
    shared_id = await connection.scalar(
        insert(annotations)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            slide_id=case.loose_slide_id,
            task_id=annotate_id,
            kind="region",
            number=1,
            geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
            origin="ai-edited",
            source_number=1,
            created_by_user_id=seeded.ids["user"],
        )
        .returning(annotations.c.id)
    )
    assert isinstance(shared_id, uuid.UUID)
    await connection.execute(
        insert(annotation_versions).values(
            tenant_id=seeded.tenant_id,
            annotation_id=shared_id,
            version=1,
            change="edited",
            geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
            changed_by_user_id=seeded.ids["user"],
        )
    )
    corrected_month = datetime(
        2100 + uuid.uuid4().int % 7800, 1 + uuid.uuid4().int % 12, 1, tzinfo=UTC
    )
    await connection.execute(
        insert(annotations).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            slide_id=case.loose_slide_id,
            task_id=annotate_id,
            kind="cell",
            number=2,
            geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
            origin="ai-edited",
            source_number=2,
            created_by_user_id=seeded.ids["user"],
            created_at=corrected_month,
        )
    )
    seeded.markers.add(corrected_month.strftime("%Y-%m"))
    seeded.ids["shared_object"] = shared_id
    seeded.markers.add(str(shared_id))
    seeded.markers.add(snapshot_class)
    seeded.markers.update({str(set_id), set_name})
    seeded.ids["annotation"] = annotation_id
    seeded.markers.add(str(annotation_id))


async def seed_notification_mutes(connection: AsyncConnection, seeded: Seeded) -> None:
    subject_id = uuid.uuid4()
    await connection.execute(
        insert(notification_mutes).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            subject="task",
            subject_id=subject_id,
        )
    )
    seeded.markers.add(str(subject_id))


async def seed_study_templates(connection: AsyncConnection, seeded: Seeded) -> None:
    await seed_built_ins(connection, seeded.tenant_id)
    template_id = await connection.scalar(
        insert(study_templates)
        .values(tenant_id=seeded.tenant_id, version=1)
        .returning(study_templates.c.id)
    )
    assert isinstance(template_id, uuid.UUID)
    seeded.ids["study_template"] = template_id
    seeded.markers.add(str(template_id))


async def seed_study_template_versions(connection: AsyncConnection, seeded: Seeded) -> None:
    name = f"Template {uuid.uuid4().hex[:12]}"
    draft = BUILT_INS[next(iter(BUILT_INS))].model_copy(update={"name": name})
    await connection.execute(
        insert(study_template_versions).values(
            tenant_id=seeded.tenant_id,
            template_id=seeded.ids["study_template"],
            version=1,
            **content(draft),
        )
    )
    seeded.markers.add(name)


def upload_key(seeded: Seeded) -> str:
    return f"t/{seeded.tenant_id}/quarantine/{seeded.ids['upload']}/isolation.svs"


def upload_name(seeded: Seeded) -> str:
    return f"Isolation {seeded.tenant_id}.svs"


def sent_name(seeded: Seeded) -> str:
    return f"Sent {seeded.tenant_id}.svs"


def upload_content(seeded: Seeded) -> bytes:
    return f"part of {seeded.tenant_id}".encode()


async def seed_uploads(connection: AsyncConnection, seeded: Seeded) -> None:
    seeded.ids["upload"] = uuid.uuid4()
    key = upload_key(seeded)
    content = upload_content(seeded)
    async with httpx2.AsyncClient(timeout=30) as http:
        store = ObjectStore(TEST_STORAGE, http)
        storage_upload_id = await store.create_multipart_upload(key)
        stored = await http.put(store.presign_part(key, storage_upload_id, 1, 60), content=content)
    await connection.execute(
        insert(uploads).values(
            id=seeded.ids["upload"],
            tenant_id=seeded.tenant_id,
            project_id=seeded.ids["project"],
            created_by_user_id=seeded.ids["user"],
            file_name=upload_name(seeded),
            size_bytes=len(content),
            object_key=key,
            storage_upload_id=storage_upload_id,
            part_bytes=TEST_PART_BYTES,
            part_count=1,
            import_problems={
                "readable": 1,
                "problems": [{"code": "objects-unreadable", "count": 1, "places": ["row 2"]}],
            },
        )
    )
    seeded.markers.update({str(seeded.ids["upload"]), stored.headers["etag"].strip('"')})
    sent_id = uuid.uuid4()
    await connection.execute(
        insert(uploads).values(
            id=sent_id,
            tenant_id=seeded.tenant_id,
            project_id=seeded.ids["project"],
            created_by_user_id=seeded.ids["user"],
            file_name=sent_name(seeded),
            size_bytes=len(content),
            object_key=f"t/{seeded.tenant_id}/quarantine/{sent_id}/sent.svs",
            storage_upload_id=f"sent-{sent_id}",
            part_bytes=TEST_PART_BYTES,
            part_count=1,
            kind="result",
            status="completed",
            closed_at=func.now(),
        )
    )
    seeded.markers.add(str(sent_id))


async def seed_deleted_projects(connection: AsyncConnection, seeded: Seeded) -> None:
    project_id = await seed_project(connection, seeded.tenant_id)
    name = f"Deleted project {uuid.uuid4().hex[:8]}"
    await connection.execute(
        update(projects).where(projects.c.id == project_id).values(name=name, deleted_at=func.now())
    )
    await connection.execute(
        insert(project_members).values(
            tenant_id=seeded.tenant_id,
            project_id=project_id,
            user_id=seeded.ids["user"],
            role="owner",
        )
    )
    seeded.markers.add(name)


async def seed_model_runs(connection: AsyncConnection, seeded: Seeded) -> None:
    detector = f"detector-{uuid.uuid4().hex[:10]}"
    job_id = await enqueue_model_run(
        connection,
        seeded.tenant_id,
        seeded.ids["project"],
        seeded.ids["slide"],
        RunSettings(RunScopeKind.SLIDE, None, detector, "1"),
        batch_id=uuid.uuid4(),
        started_by=seeded.ids["user"],
    )
    seeded.ids["model_run"] = job_id
    seeded.markers.update({str(job_id), detector})
    await connection.execute(
        insert(job_units).values(
            tenant_id=seeded.tenant_id,
            job_id=job_id,
            ordinal=STAGES.index(MODEL_STAGE),
            unit=0,
            worker="seed",
            result={"x": 0, "y": 0, "width": 512, "height": 512, "objects": 1},
        )
    )
    tile = tile_key(run_prefix(seeded.tenant_id, seeded.ids["slide"], job_id), 0)
    async with httpx2.AsyncClient(timeout=30) as http:
        store = ObjectResultStore(ObjectStore(TEST_STORAGE, http))
        await store.put(tile, packed(str(job_id).encode()))
    await connection.execute(
        insert(gpu_usage).values(
            tenant_id=seeded.tenant_id,
            job_id=job_id,
            kind="model-run",
            model=detector,
            model_version="1",
            worker="seed",
            seconds=1.0,
        )
    )


async def seed_site_validations(connection: AsyncConnection, seeded: Seeded) -> None:
    specimen = f"Specimen {uuid.uuid4().hex[:8]}"
    announcement_id = await connection.scalar(
        insert(announcements)
        .values(tenant_id=seeded.tenant_id, kind="model", text=f"Validated on {specimen}")
        .returning(announcements.c.id)
    )
    await connection.execute(
        insert(site_validations).values(
            tenant_id=seeded.tenant_id,
            model_name="isolation-model",
            model_version="1",
            specimen_type=specimen,
            threshold=0.5,
            true_positives=1,
            false_positives=0,
            true_negatives=1,
            false_negatives=0,
            announcement_id=announcement_id,
        )
    )
    seeded.markers.add(specimen)


async def seed_model_tiers(connection: AsyncConnection, seeded: Seeded) -> None:
    version = f"iso-{uuid.uuid4().hex[:8]}"
    await connection.execute(
        insert(model_tiers).values(
            tenant_id=seeded.tenant_id,
            task="outline",
            tier="fast",
            model_name="hovernet",
            model_version=version,
        )
    )
    seeded.markers.add(version)


async def seed_hidden_models(connection: AsyncConnection, seeded: Seeded) -> None:
    user = seeded.ids["user"]
    await connection.execute(
        insert(hidden_models).values(
            tenant_id=seeded.tenant_id, model_name="hovernet", hidden_by_user_id=user
        )
    )
    seeded.markers.add(str(user))


async def seed_lab_models(connection: AsyncConnection, seeded: Seeded) -> None:
    marker = f"lab-model-{uuid.uuid4().hex[:10]}"
    model_id = uuid.uuid5(seeded.tenant_id, "lab-model")
    await connection.execute(
        insert(lab_models).values(
            id=model_id,
            tenant_id=seeded.tenant_id,
            name=marker,
            version="v1",
            address="https://ml.example.org/infer",
            sign_in="none",
            tile_size=512,
            magnification=40,
            taxonomy="sentinel-node",
            class_map=[],
            who_can_run="admins",
        )
    )
    seeded.ids["lab_model"] = model_id
    seeded.markers.add(marker)


async def seed_import_sources(connection: AsyncConnection, seeded: Seeded) -> None:
    marker = f"import-source-{uuid.uuid4().hex[:10]}"
    source_id = uuid.uuid5(seeded.tenant_id, "import-source")
    await connection.execute(
        insert(import_sources).values(
            id=source_id,
            tenant_id=seeded.tenant_id,
            name=marker,
            kind="https",
            address="https://data.example.org/scans/",
        )
    )
    seeded.ids["import_source"] = source_id
    seeded.markers.add(marker)


async def seed_project_webhooks(connection: AsyncConnection, seeded: Seeded) -> None:
    hook_id = uuid.uuid4()
    keys = await ensure_keys(connection, TEST_KEYRING, seeded.tenant_id)
    await connection.execute(
        insert(project_webhooks).values(
            id=hook_id,
            tenant_id=seeded.tenant_id,
            project_id=seeded.ids["project"],
            hook_key=hook_id.hex,
            secret_ciphertext=seal_field(
                keys, "project_webhooks", hook_id, "secret", "seeded-secret"
            ),
            old_secret_ciphertext=seal_field(
                keys, "project_webhooks", hook_id, "old_secret", "older-secret"
            ),
        )
    )
    seeded.ids["webhook"] = hook_id
    seeded.markers.add(hook_id.hex)


async def seed_webhook_calls(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(webhook_calls).values(
            tenant_id=seeded.tenant_id,
            webhook_id=seeded.ids["webhook"],
            idempotency_key=f"call-{uuid.uuid4().hex[:10]}",
            answer={},
        )
    )


async def seed_source_watches(connection: AsyncConnection, seeded: Seeded) -> None:
    watch_id = uuid.uuid4()
    await connection.execute(
        insert(source_watches).values(
            id=watch_id,
            tenant_id=seeded.tenant_id,
            project_id=seeded.ids["project"],
            source_id=seeded.ids["import_source"],
        )
    )
    seeded.ids["source_watch"] = watch_id


async def seed_watched_files(connection: AsyncConnection, seeded: Seeded) -> None:
    marker = f"watched-{uuid.uuid4().hex[:10]}.svs"
    await connection.execute(
        insert(watched_files).values(
            tenant_id=seeded.tenant_id, watch_id=seeded.ids["source_watch"], name=marker
        )
    )
    seeded.markers.add(marker)


async def seed_event_targets(connection: AsyncConnection, seeded: Seeded) -> None:
    marker = f"event-target-{uuid.uuid4().hex[:10]}"
    target_id = uuid.uuid5(seeded.tenant_id, "event-target")
    keys = await ensure_keys(connection, TEST_KEYRING, seeded.tenant_id)
    await connection.execute(
        insert(event_targets).values(
            id=target_id,
            tenant_id=seeded.tenant_id,
            project_id=seeded.ids["project"],
            address=f"https://pipeline.example.org/{marker}",
            events=["review-submitted"],
            secret_ciphertext=seal_field(keys, "event_targets", target_id, "secret", "seeded"),
        )
    )
    seeded.ids["event_target"] = target_id
    seeded.markers.add(marker)


async def seed_event_outbox(connection: AsyncConnection, seeded: Seeded) -> None:
    event_id = uuid.uuid5(seeded.tenant_id, "event")
    await connection.execute(
        insert(event_outbox).values(
            id=event_id,
            tenant_id=seeded.tenant_id,
            project_id=seeded.ids["project"],
            target_id=seeded.ids["event_target"],
            kind="review-submitted",
            body={},
        )
    )
    seeded.ids["event"] = event_id
    seeded.markers.add(str(event_id))


async def seed_timing_events(connection: AsyncConnection, seeded: Seeded) -> None:
    duration = 100_000_000 + uuid.uuid4().int % 400_000_000
    await connection.execute(
        insert(timing_events).values(
            tenant_id=seeded.tenant_id, name="cell_review_timed", duration_ms=duration
        )
    )
    seeded.markers.add(str(duration))


async def seed_event_attempts(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(event_attempts).values(
            tenant_id=seeded.tenant_id,
            event_id=seeded.ids["event"],
            outcome="status",
            status_code=500,
            duration_ms=12,
        )
    )


async def seed_template_offers(connection: AsyncConnection, seeded: Seeded) -> None:
    name = f"Offer {uuid.uuid4().hex[:12]}"
    draft = BUILT_INS[next(iter(BUILT_INS))].model_copy(update={"name": name})
    await connection.execute(
        insert(template_offers).values(
            tenant_id=seeded.tenant_id,
            offered_by_user_id=seeded.ids["user"],
            **content(draft),
        )
    )
    seeded.markers.add(name)


async def seed_workspace_access_requests(connection: AsyncConnection, seeded: Seeded) -> None:
    user = seeded.ids["user"]
    request_id = await connection.scalar(
        insert(workspace_access_requests)
        .values(tenant_id=seeded.tenant_id, user_id=user)
        .returning(workspace_access_requests.c.id)
    )
    assert isinstance(request_id, uuid.UUID)
    seeded.ids["access_request"] = request_id
    seeded.markers.add(str(user))


async def seed_lab_model_projects(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(lab_model_projects).values(
            lab_model_id=seeded.ids["lab_model"],
            project_id=seeded.ids["project"],
            tenant_id=seeded.tenant_id,
        )
    )


async def seed_slide_coverage(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(slide_coverage).values(
            tenant_id=seeded.tenant_id,
            slide_id=seeded.ids["slide"],
            user_id=seeded.ids["user"],
            cell=64,
            columns=64,
            rows=32,
            seen=bytes(256),
            seen_cells=0,
        )
    )
    seeded.markers.add(str(seeded.ids["slide"]))


async def seed_painted_maps(connection: AsyncConnection, seeded: Seeded) -> None:
    name = f"Painted {uuid.uuid4().hex[:8]}"
    project_id = await connection.scalar(
        select(slides.c.project_id).where(slides.c.id == seeded.ids["slide"])
    )
    painted_map_id = await connection.scalar(
        insert(painted_maps)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=project_id,
            slide_id=seeded.ids["slide"],
            name=name,
            cell=256,
            tile_cells=16,
            painted_cells=0,
            created_by_user_id=seeded.ids["user"],
        )
        .returning(painted_maps.c.id)
    )
    assert isinstance(painted_map_id, uuid.UUID)
    seeded.ids["painted_map"] = painted_map_id
    seeded.markers.update({name, str(painted_map_id)})


async def seed_painted_map_versions(connection: AsyncConnection, seeded: Seeded) -> None:
    marker = f"painted-{uuid.uuid4().hex}"
    await connection.execute(
        insert(painted_map_versions).values(
            tenant_id=seeded.tenant_id,
            painted_map_id=seeded.ids["painted_map"],
            version=1,
            content=marker.encode(),
            painted_cells=0,
            saved_by_user_id=seeded.ids["user"],
        )
    )
    seeded.markers.add(marker)


async def seed_display_presets(connection: AsyncConnection, seeded: Seeded) -> None:
    name = f"Preset {uuid.uuid4().hex[:8]}"
    preset_id = await connection.scalar(
        insert(display_presets)
        .values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            task_id=seeded.ids["task"],
            name=name,
            settings=DisplaySettings().model_dump(mode="json"),
        )
        .returning(display_presets.c.id)
    )
    assert isinstance(preset_id, uuid.UUID)
    seeded.ids["display_preset"] = preset_id
    seeded.markers.update({name, str(preset_id)})


async def seed_display_choices(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(display_choices).values(
            tenant_id=seeded.tenant_id,
            task_id=seeded.ids["task"],
            user_id=seeded.ids["user"],
            preset_id=seeded.ids["display_preset"],
            settings=DisplaySettings(width=3).model_dump(mode="json"),
        )
    )


async def seed_adjudications(connection: AsyncConnection, seeded: Seeded) -> None:
    note = f"Adjudication note {uuid.uuid4().hex[:8]}"
    adjudication_id = await connection.scalar(
        insert(adjudications)
        .values(
            tenant_id=seeded.tenant_id,
            task_id=seeded.ids["task"],
            adjudicator_user_id=seeded.ids["user"],
            sent_by_user_id=seeded.ids["user"],
            note=note,
        )
        .returning(adjudications.c.id)
    )
    assert isinstance(adjudication_id, uuid.UUID)
    seeded.ids["adjudication"] = adjudication_id
    seeded.markers.update({note, str(adjudication_id)})


async def seed_adjudication_objects(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(adjudication_objects).values(
            adjudication_id=seeded.ids["adjudication"],
            tenant_id=seeded.tenant_id,
            task_id=seeded.ids["task"],
            slide_id=seeded.ids["slide"],
            kind="region",
            number=1,
        )
    )


async def seed_resume_states(connection: AsyncConnection, seeded: Seeded) -> None:
    await connection.execute(
        insert(resume_states).values(
            tenant_id=seeded.tenant_id,
            user_id=seeded.ids["user"],
            task_id=seeded.ids["task"],
            slide_id=seeded.ids["slide"],
            mode="guided",
            object_id="T1",
        )
    )
    seeded.markers.add(str(seeded.ids["task"]))


def shared_token(seeded: Seeded) -> str:
    return f"shared-{seeded.tenant_id}"


async def seed_report_links(connection: AsyncConnection, seeded: Seeded) -> None:
    link = await connection.scalar(
        insert(report_links)
        .values(
            tenant_id=seeded.tenant_id,
            task_id=seeded.ids["task"],
            token_hash=hashlib.sha256(shared_token(seeded).encode()).digest(),
            expires_at=text("now() + interval '1 day'"),
        )
        .returning(report_links.c.id)
    )
    seeded.markers.add(str(link))


async def seed_evaluation_versions(connection: AsyncConnection, seeded: Seeded) -> None:
    checksum = f"sha256:{uuid.uuid4().hex}"
    await connection.execute(
        insert(evaluation_versions).values(
            tenant_id=seeded.tenant_id,
            task_id=seeded.ids["task"],
            number=7,
            signed_at=func.now(),
            checksum=checksum,
        )
    )
    seeded.markers.add(checksum)


async def seed_evaluation_changes(connection: AsyncConnection, seeded: Seeded) -> None:
    reason = f"Late change {uuid.uuid4()}"
    await connection.execute(
        insert(evaluation_changes).values(
            tenant_id=seeded.tenant_id,
            task_id=seeded.ids["task"],
            version=7,
            slide_id=seeded.ids["slide"],
            object_id="T1",
            change="Decided agree",
            reason=reason,
        )
    )
    seeded.markers.add(reason)


async def seed_clinical_reports(connection: AsyncConnection, seeded: Seeded) -> None:
    specimen = f"Specimen {uuid.uuid4().hex[:12]}"
    report = await connection.scalar(
        insert(clinical_reports)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=seeded.ids["project"],
            case_id=seeded.ids["case"],
            template="sentinel-node",
            template_version=1,
            state="sent",
            specimen=specimen,
            cosigner_user_id=seeded.ids["user"],
            sent_by_user_id=seeded.ids["user"],
            sent_at=func.now(),
            version=1,
        )
        .returning(clinical_reports.c.id)
    )
    assert isinstance(report, uuid.UUID)
    seeded.ids["clinical_report"] = report
    seeded.markers.update({specimen, str(report)})


async def seed_clinical_deposits(connection: AsyncConnection, seeded: Seeded) -> None:
    note = f"Deposit {uuid.uuid4().hex[:12]}"
    await connection.execute(
        insert(clinical_deposits).values(
            tenant_id=seeded.tenant_id,
            report_id=seeded.ids["clinical_report"],
            slide_id=seeded.ids["slide"],
            size_mm=1.5,
            note=note,
        )
    )
    seeded.markers.add(note)


async def seed_clinical_report_versions(connection: AsyncConnection, seeded: Seeded) -> None:
    diagnosis = f"Diagnosis {uuid.uuid4().hex[:12]}"
    values: dict[str, Any] = {
        "specimen": None,
        "category": None,
        "nodes_examined": None,
        "extranodal": None,
        "diagnosis": diagnosis,
        "microscopic": None,
        "comment": None,
        "deposits": [],
    }
    await connection.execute(
        insert(clinical_report_versions).values(
            tenant_id=seeded.tenant_id,
            report_id=seeded.ids["clinical_report"],
            number=1,
            content={"confirmed_with": "sso", "values": values, "staging": None},
            signed_by_user_id=seeded.ids["user"],
        )
    )
    seeded.markers.add(diagnosis)
    serve_link_files(seeded)


SEEDERS: dict[str, Seeder] = {
    "notifications": seed_notifications,
    "notification_mutes": seed_notification_mutes,
    "invitations": seed_invitations,
    "announcements": seed_announcements,
    "retention_policies": seed_retention_policies,
    "legal_holds": seed_legal_holds,
    "cases": seed_cases,
    "session_policies": seed_session_policies,
    "sso_connections": seed_sso_connections,
    "linked_subjects": seed_linked_subjects,
    "audit_people": seed_audit_people,
    "audit_events": seed_audit_events,
    "service_accounts": seed_service_accounts,
    "api_tokens": seed_api_tokens,
    "study_templates": seed_study_templates,
    "study_template_versions": seed_study_template_versions,
    "uploads": seed_uploads,
    "model_runs": seed_model_runs,
    "site_validations": seed_site_validations,
    "model_tiers": seed_model_tiers,
    "hidden_models": seed_hidden_models,
    "lab_models": seed_lab_models,
    "lab_model_projects": seed_lab_model_projects,
    "import_sources": seed_import_sources,
    "project_webhooks": seed_project_webhooks,
    "webhook_calls": seed_webhook_calls,
    "source_watches": seed_source_watches,
    "watched_files": seed_watched_files,
    "event_targets": seed_event_targets,
    "event_outbox": seed_event_outbox,
    "event_attempts": seed_event_attempts,
    "timing_events": seed_timing_events,
    "workspace_access_requests": seed_workspace_access_requests,
    "template_offers": seed_template_offers,
    "slide_coverage": seed_slide_coverage,
    "painted_maps": seed_painted_maps,
    "painted_map_versions": seed_painted_map_versions,
    "display_presets": seed_display_presets,
    "display_choices": seed_display_choices,
    "adjudications": seed_adjudications,
    "adjudication_objects": seed_adjudication_objects,
    "resume_states": seed_resume_states,
    "report_links": seed_report_links,
    "evaluation_versions": seed_evaluation_versions,
    "evaluation_changes": seed_evaluation_changes,
    "clinical_reports": seed_clinical_reports,
    "clinical_deposits": seed_clinical_deposits,
    "clinical_report_versions": seed_clinical_report_versions,
}


def slide_report(seeded: Seeded) -> str:
    project, slide = seeded.ids["project"], seeded.ids["case_slide_0"]
    return f"/api/projects/{project}/slides/{slide}/clinical-report"


def case_report(seeded: Seeded) -> str:
    return f"/api/projects/{seeded.ids['project']}/cases/{seeded.ids['case']}/clinical-report"


GET_ROUTES = {
    "findOpenUpload": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/uploads/open?project_id={a.ids['project']}&name={upload_name(a)}"
            f"&size={len(upload_content(a))}"
        ),
    ),
    "findSentUploads": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/uploads/sent?project_id={a.ids['project']}&name={sent_name(a)}"
            f"&size={len(upload_content(a))}"
        ),
    ),
    "signUploadPart": Route(
        Exposure.TENANT,
        lambda a: f"/api/uploads/s3/multipart/{a.ids['upload']}/1?key={upload_key(a)}",
    ),
    "listUploadParts": Route(
        Exposure.TENANT,
        lambda a: f"/api/uploads/s3/multipart/{a.ids['upload']}?key={upload_key(a)}",
    ),
    "getUploadStatus": Route(Exposure.TENANT, lambda a: f"/api/uploads/{a.ids['upload']}/status"),
    "getImportProblems": Route(
        Exposure.TENANT, lambda a: f"/api/uploads/{a.ids['upload']}/problems"
    ),
    "downloadImportProblems": Route(
        Exposure.TENANT, lambda a: f"/api/uploads/{a.ids['upload']}/problems/report"
    ),
    "getHealth": Route(Exposure.PUBLIC, lambda _: "/api/health"),
    "getPlatformStatus": Route(Exposure.PUBLIC, lambda _: "/api/status"),
    "listStudyTemplates": Route(Exposure.TENANT, lambda _: "/api/study-templates"),
    "listStudyTemplateReviewDefaults": Route(
        Exposure.TENANT, lambda _: "/api/study-templates/review-defaults"
    ),
    "getStudyTemplate": Route(
        Exposure.TENANT, lambda a: f"/api/study-templates/{a.ids['study_template']}"
    ),
    "listStudyTemplateVersions": Route(
        Exposure.TENANT, lambda a: f"/api/study-templates/{a.ids['study_template']}/versions"
    ),
    "getStudyTemplateVersion": Route(
        Exposure.TENANT, lambda a: f"/api/study-templates/{a.ids['study_template']}/versions/1"
    ),
    "listOrganisations": Route(Exposure.PLATFORM, lambda _: "/api/platform/organisations"),
    "listTenants": Route(Exposure.PLATFORM, lambda _: "/api/platform/tenants"),
    "getTenant": Route(Exposure.PLATFORM, lambda a: f"/api/platform/tenants/{a.tenant_id}"),
    "getCurrentTenant": Route(Exposure.TENANT, lambda _: "/api/tenant"),
    "getSession": Route(Exposure.PUBLIC, lambda _: "/api/auth/session"),
    "getPasswordSignIn": Route(Exposure.PUBLIC, lambda _: "/api/auth/password-sign-in"),
    "getMe": Route(Exposure.TENANT, lambda _: "/api/me"),
    "listTenantMembers": Route(Exposure.TENANT, lambda _: "/api/tenant/members"),
    "listMemberActivity": Route(
        Exposure.TENANT, lambda _: "/api/tenant/members/activity", admin_rights=True
    ),
    "getMemberOpenWork": Route(
        Exposure.TENANT,
        lambda s: f"/api/tenant/members/{s.ids['user']}/open-work",
        admin_rights=True,
    ),
    "listAuditEvents": Route(
        Exposure.TENANT, lambda _: "/api/tenant/audit-events", admin_rights=True
    ),
    "exportAuditEvents": Route(
        Exposure.TENANT, lambda _: "/api/tenant/audit-events/export", admin_rights=True
    ),
    "listAuditSigningKeys": Route(
        Exposure.TENANT, lambda _: "/api/tenant/audit-events/signing-keys", admin_rights=True
    ),
    "listServiceAccounts": Route(Exposure.TENANT, lambda _: "/api/tenant/service-accounts"),
    "listInvitations": Route(
        Exposure.TENANT, lambda _: "/api/tenant/invitations", admin_rights=True
    ),
    "getSessionPolicy": Route(Exposure.TENANT, lambda _: "/api/tenant/session-policy"),
    "getSecurityContact": Route(
        Exposure.TENANT, lambda _: "/api/tenant/security-contact", admin_rights=True
    ),
    "listAnnouncements": Route(Exposure.TENANT, lambda _: "/api/announcements"),
    "getMyHome": Route(Exposure.TENANT, lambda _: "/api/me/home"),
    "listMyJobs": Route(Exposure.TENANT, lambda _: "/api/me/jobs"),
    "getMyChecklist": Route(Exposure.TENANT, lambda _: "/api/me/checklist"),
    "listNotifications": Route(Exposure.TENANT, lambda _: "/api/me/notifications"),
    "getNotificationCounts": Route(Exposure.PUBLIC, lambda _: "/api/me/notifications/counts"),
    "listNotificationMutes": Route(Exposure.TENANT, lambda _: "/api/me/notification-mutes"),
    "getNotificationTarget": Route(
        Exposure.TENANT, lambda a: f"/api/me/notifications/{a.ids['notification']}/target"
    ),
    "search": Route(Exposure.TENANT, lambda _: "/api/search?q=A1"),
    "getSlideNeighbours": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/slides/{a.ids['slide']}/neighbours?from=task&task_id={a.ids['task']}"
            "&skip_submitted=false"
        ),
    ),
    "getRetentionPolicy": Route(
        Exposure.TENANT, lambda _: "/api/tenant/retention", admin_rights=True
    ),
    "getAiUsage": Route(Exposure.TENANT, lambda _: "/api/tenant/ai-usage", admin_rights=True),
    "getAiCorrections": Route(
        Exposure.TENANT, lambda _: "/api/tenant/ai-corrections", admin_rights=True
    ),
    "getTaskTiming": Route(Exposure.TENANT, lambda _: "/api/tenant/task-timing", admin_rights=True),
    "listLegalHolds": Route(
        Exposure.TENANT, lambda _: "/api/tenant/legal-holds", admin_rights=True
    ),
    "exportMyPersonalData": Route(Exposure.TENANT, lambda _: "/api/me/personal-data"),
    "exportPatientData": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/patients/{a.ids['patient']}/personal-data",
    ),
    "listProjects": Route(Exposure.TENANT, lambda _: "/api/projects"),
    "listDeletedProjects": Route(Exposure.TENANT, lambda _: "/api/projects/deleted"),
    "getProject": Route(Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}"),
    "getProjectAccess": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['hidden_project']}/access-requests/mine",
    ),
    "listTaxonomyTemplates": Route(Exposure.PUBLIC, lambda _: "/api/taxonomy-templates"),
    "listRegisteredModels": Route(Exposure.PUBLIC, lambda _: "/api/model-registry"),
    "getRegisteredModel": Route(
        Exposure.PUBLIC, lambda _: "/api/model-registry/camelyon-tumor/v1.0"
    ),
    "getOpinionFormTemplate": Route(Exposure.PUBLIC, lambda _: "/api/opinion-form-template"),
    "getResultsSchema": Route(
        Exposure.PUBLIC, lambda _: "/api/result-formats/parfocal-json/schema"
    ),
    "getResultsTemplate": Route(
        Exposure.PUBLIC, lambda _: "/api/result-formats/parfocal-json/template"
    ),
    "listNotificationPreferences": Route(
        Exposure.PUBLIC, lambda _: "/api/me/notification-preferences"
    ),
    "getMySettingLayers": Route(Exposure.PUBLIC, lambda _: "/api/me/setting-layers"),
    "listJoinableWorkspaces": Route(Exposure.PUBLIC, lambda _: "/api/me/joinable-workspaces"),
    "listTemplateOffers": Route(
        Exposure.TENANT, lambda _: "/api/template-offers", admin_rights=True
    ),
    "listWorkspaceAccessRequests": Route(
        Exposure.TENANT, lambda _: "/api/tenant/access-requests", admin_rights=True
    ),
    "getJoinSettings": Route(
        Exposure.TENANT, lambda _: "/api/tenant/join-settings", admin_rights=True
    ),
    "getOpinionForm": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/opinion-form"
    ),
    "listOpinionFormVersions": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/opinion-form/versions"
    ),
    "getOpinionFormVersion": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/opinion-form/versions/1"
    ),
    "listProjectClasses": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/classes"
    ),
    "listClassMappings": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/class-mappings"
    ),
    "resolveClassNames": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/class-mappings/resolve?name={a.ids['source']}",
    ),
    "getProjectJob": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/jobs/{a.ids['job']}"
    ),
    "listModelRuns": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/model-runs"
    ),
    "getModelRun": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/model-runs/{a.ids['model_run']}",
    ),
    "listModelRunAreas": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/model-runs/{a.ids['model_run']}/areas",
    ),
    "getModelRunTile": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/model-runs/{a.ids['model_run']}/tiles/0",
    ),
    "getCase": Route(Exposure.TENANT, lambda a: f"/api/cases/{a.ids['case']}"),
    "getCaseReport": Route(Exposure.TENANT, lambda a: case_report(a)),
    "getClinicalReport": Route(Exposure.TENANT, lambda a: slide_report(a)),
    "getCosignReview": Route(Exposure.TENANT, lambda a: f"{slide_report(a)}/cosign-request"),
    "getCaseReportVersion": Route(Exposure.TENANT, lambda a: f"{case_report(a)}/versions/1"),
    "downloadCaseReportPdf": Route(Exposure.TENANT, lambda a: f"{case_report(a)}/versions/1/pdf"),
    "listMyCosignRequests": Route(Exposure.TENANT, lambda _: "/api/me/cosign-requests"),
    "listSourceFiles": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/source-files?address={source_address(a)}",
        linked=True,
    ),
    "getRestrictedImage": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/restricted-images/label"
    ),
    "getTileAccess": Route(Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/tile-access"),
    "getSlideTissue": Route(Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/tissue"),
    "getSlideThumbnail": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/thumbnail"
    ),
    "getCellCrop": Route(Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/cell-crops/1"),
    "getSlideEmbeddings": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/embeddings"
    ),
    "getSlideEmbeddingTile": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/embeddings/0/0"
    ),
    "getSlideCoverage": Route(Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/coverage"),
    "getRoomAccess": Route(Exposure.TENANT, lambda a: f"/api/rooms/slide:{a.ids['slide']}/access"),
    "listCases": Route(Exposure.TENANT, lambda _: "/api/cases"),
    "listReviewTasks": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/review-tasks"
    ),
    "listMyReviewTasks": Route(Exposure.TENANT, lambda _: "/api/me/review-tasks"),
    "getMyTrackRecord": Route(Exposure.TENANT, lambda _: "/api/me/track-record"),
    "listTasksAssignedByMe": Route(Exposure.TENANT, lambda _: "/api/me/assigned-tasks"),
    "listMySlides": Route(Exposure.TENANT, lambda _: "/api/me/slides"),
    "getTaskEvaluation": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation"
    ),
    "getEvaluationReport": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation-report"
    ),
    "getSignOffSummary": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/sign-off-summary"
    ),
    "listEvaluationChanges": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation-changes"
    ),
    "previewSavedStudyTemplate": Route(
        Exposure.TENANT, lambda a: f"/api/study-templates/{a.ids['study_template']}/preview"
    ),
    "downloadSavedStudyTemplatePreview": Route(
        Exposure.TENANT, lambda a: f"/api/study-templates/{a.ids['study_template']}/preview/pdf"
    ),
    "previewTaskEvaluation": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation/preview"
    ),
    "getTaskReportLayout": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/report-layout"
    ),
    "exportTaskEvaluation": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation/exports/objects.csv",
    ),
    "exportTrainingDataset": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['annotate_task']}/training-dataset",
    ),
    "downloadPatchExport": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['annotate_task']}/patch-exports/{a.ids['patch_job']}",
    ),
    "getTaskAiChanges": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['annotate_task']}/evaluation/ai-changes",
    ),
    "listReportLinks": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation/links"
    ),
    "getSharedReport": Route(Exposure.PUBLIC, lambda a: f"/api/shared-reports/{shared_token(a)}"),
    "getRemoteTile": Route(
        Exposure.PUBLIC, lambda a: f"/api/remote-tiles/{a.ids['slide']}/scan.svs"
    ),
    "getOpinion": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/opinion",
    ),
    "getFirstRead": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/first-read",
    ),
    "listDisagreements": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/disagreements"
    ),
    "listDecisions": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/decisions",
    ),
    "listDecisionNotes": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/decision-notes",
    ),
    "listSkips": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/skips",
    ),
    "listThreads": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/threads",
    ),
    "listMentionableMembers": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/threads/mentionable",
    ),
    "getThread": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/threads/{a.ids['thread']}"
        ),
    ),
    "listThreadsOnSlide": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/slides/{a.ids['slide']}/threads",
    ),
    "listMentionableMembersOnSlide": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/slides/{a.ids['slide']}/threads/mentionable",
    ),
    "getThreadOnSlide": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/projects/{a.ids['project']}/slides/{a.ids['slide']}/threads/"
            f"{a.ids['slide_thread']}"
        ),
    ),
    "listSlideThreads": Route(Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/threads"),
    "getProjectOverview": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/overview"
    ),
    "listProjectSlides": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/slides"
    ),
    "getProjectScopeOptions": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/scope-options"
    ),
    "getReviewTaskDefaults": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/review-tasks/defaults"
    ),
    "getProjectImports": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/imports"
    ),
    "getUploadBatch": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/upload-batch"
    ),
    "listThreadComments": Route(
        Exposure.TENANT, lambda a: f"/api/threads/{a.ids['thread']}/comments"
    ),
    "getSlideAiProgress": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/ai-progress"
    ),
    "listAnnotationLayers": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/annotation-layers"
    ),
    "getResultSetTyper": Route(
        Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['summary_set']}/typer"
    ),
    "getSlideResultStats": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/result-stats",
    ),
    "getReviewOrder": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/order",
    ),
    "listReviewObjects": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/objects",
    ),
    "getSlideAgreement": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/agreement",
    ),
    "getTaskDisplay": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/display"
    ),
    "getDisagreementQueue": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/disagreement-queue"
    ),
    "getMyAdjudication": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/adjudication"
    ),
    "getReviewTaskStates": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/states"
    ),
    "getReviewedLayer": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/layer",
    ),
    "listReviewEditHistory": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/edits/T1/history",
    ),
    "resolveReviewObject": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/objects/T1",
    ),
    "exportReviewedLayer": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/export?format=parfocal"
        ),
    ),
    "getReviewTask": Route(Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}"),
    "listSlideAreas": Route(Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/areas"),
    "listSlideResultSets": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/result-sets"
    ),
    "listProjectResultSets": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/result-sets"
    ),
    "listSiteValidations": Route(Exposure.TENANT, lambda _: "/api/site-validations"),
    "listModelTiers": Route(Exposure.TENANT, lambda _: "/api/tenant/model-tiers"),
    "listModelVisibility": Route(Exposure.TENANT, lambda _: "/api/tenant/hidden-models"),
    "listImportSources": Route(Exposure.TENANT, lambda _: "/api/tenant/import-sources"),
    "getProjectWebhook": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/webhook"
    ),
    "listEventTargets": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/event-targets"
    ),
    "listEventDeliveries": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/event-targets/{a.ids['event_target']}/events",
    ),
    "getLabModel": Route(
        Exposure.TENANT,
        lambda s: f"/api/tenant/models/{s.ids['lab_model']}",
        admin_rights=True,
    ),
    "listProjectModels": Route(
        Exposure.PUBLIC, lambda a: f"/api/projects/{a.ids['project']}/models"
    ),
    "listProjectLabModels": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/lab-models"
    ),
    "getModelRunDefaults": Route(
        Exposure.PUBLIC, lambda a: f"/api/projects/{a.ids['project']}/model-runs/defaults"
    ),
    "listAiModels": Route(Exposure.TENANT, lambda _: "/api/tenant/models", admin_rights=True),
    "getAdminOverview": Route(Exposure.TENANT, lambda _: "/api/tenant/overview", admin_rights=True),
    "getStorageUsage": Route(Exposure.TENANT, lambda _: "/api/tenant/storage", admin_rights=True),
    "getSecuritySettings": Route(
        Exposure.TENANT, lambda _: "/api/tenant/security", admin_rights=True
    ),
    "listWebhooks": Route(Exposure.TENANT, lambda _: "/api/tenant/webhooks", admin_rights=True),
    "getInvitePreview": Route(Exposure.PUBLIC, lambda _: "/api/invitations/unknown/preview"),
    "getLabModelConnection": Route(
        Exposure.TENANT, lambda _: "/api/tenant/models/connection", admin_rights=True
    ),
    "getResultSet": Route(Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['result_set']}"),
    "getCellSummary": Route(
        Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['summary_set']}/cell-summary"
    ),
    "getCellChunk": Route(
        Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['summary_set']}/cell-chunks/0"
    ),
    "listResultSetRegions": Route(
        Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['summary_set']}/regions"
    ),
    "getHeatmap": Route(
        Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['summary_set']}/heatmap"
    ),
    "getHeatmapGrid": Route(
        Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['summary_set']}/heatmap/grid"
    ),
    "getLayerGroups": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/layer-groups"
    ),
    "listAnnotations": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/annotations"
    ),
    "exportSlideObjects": Route(
        Exposure.TENANT,
        lambda a: f"/api/slides/{a.ids['slide']}/export?result_set_id={a.ids['summary_set']}",
    ),
    "getAnnotation": Route(
        Exposure.TENANT,
        lambda a: f"/api/slides/{a.ids['slide']}/annotations/{a.ids['annotation']}",
    ),
    "getSharedLayer": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/review-tasks/{a.ids['annotate_task']}/slides/{a.ids['slide']}/shared-layer"
        ),
    ),
    "getAnnotateSlideStatus": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/review-tasks/{a.ids['annotate_task']}/slides/{a.ids['slide']}/check-status"
        ),
    ),
    "getSharedLayerGroups": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/review-tasks/{a.ids['annotate_task']}/slides/{a.ids['slide']}"
            "/shared-layer/groups"
        ),
    ),
    "listSharedAiObjects": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/review-tasks/{a.ids['annotate_task']}/slides/{a.ids['slide']}/shared-layer/ai"
        ),
    ),
    "listSharedObjectHistory": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/review-tasks/{a.ids['annotate_task']}/slides/{a.ids['slide']}"
            f"/shared-layer/objects/{a.ids['shared_object']}/history"
        ),
    ),
    "listAnnotationHistory": Route(
        Exposure.TENANT,
        lambda a: f"/api/slides/{a.ids['slide']}/annotations/{a.ids['annotation']}/history",
    ),
    "listPaintedMaps": Route(
        Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/painted-maps"
    ),
    "listPaintedMapVersions": Route(
        Exposure.TENANT,
        lambda a: f"/api/slides/{a.ids['slide']}/painted-maps/{a.ids['painted_map']}/versions",
    ),
    "getPaintedMapVersion": Route(
        Exposure.TENANT,
        lambda a: f"/api/slides/{a.ids['slide']}/painted-maps/{a.ids['painted_map']}/versions/1",
    ),
    "exportPaintedMap": Route(
        Exposure.TENANT,
        lambda a: (
            f"/api/slides/{a.ids['slide']}/painted-maps/{a.ids['painted_map']}/versions/1/file"
        ),
    ),
    "getMyAvailability": Route(Exposure.TENANT, lambda _: "/api/me/availability"),
    "listAvailability": Route(Exposure.TENANT, lambda _: "/api/tenant/availability"),
    "listTeamWorkload": Route(Exposure.TENANT, lambda _: "/api/me/team"),
    "listReviewerWorkload": Route(Exposure.TENANT, lambda _: "/api/tenant/workload"),
    "listSessions": Route(Exposure.PUBLIC, lambda _: "/api/auth/sessions"),
    "listPasskeys": Route(Exposure.PUBLIC, lambda _: "/api/auth/passkeys"),
    "getMyEmailSchedule": Route(Exposure.PUBLIC, lambda _: "/api/me/email-schedule"),
    "getMyDisplay": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/my-display"
    ),
    "listDisplayPresets": Route(Exposure.TENANT, lambda _: "/api/display-presets"),
    "listAdjudicatorCandidates": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/disagreements/adjudicators",
    ),
    "listTaskAdjudications": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/disagreements/adjudications",
    ),
    "listAdjudicationObjects": Route(Exposure.TENANT, lambda _: "/api/adjudications/objects"),
    "listMyAdjudications": Route(Exposure.TENANT, lambda _: "/api/adjudications"),
    "listMembers": Route(
        Exposure.PLATFORM, lambda a: f"/api/platform/tenants/{a.tenant_id}/members"
    ),
}
UNOWNED_TABLES = {"alembic_version", "spatial_ref_sys"}


def routes(exposure: Exposure) -> list[str]:
    return [name for name, route in GET_ROUTES.items() if route.exposure is exposure]


async def seed_tenant(connection: AsyncConnection, label: str) -> Seeded:
    slug = f"{label}-{uuid.uuid4().hex[:10]}"
    name = f"Isolation {slug}"
    organisation_id = await connection.scalar(
        insert(organisations).values(slug=slug, name=name).returning(organisations.c.id)
    )
    tenant_id = await connection.scalar(
        insert(tenants)
        .values(
            organisation_id=organisation_id,
            slug=slug,
            name=name,
            kind="diagnostic",
            region="eu",
            plan="pilot",
            email_domain=f"{slug}.example.test",
        )
        .returning(tenants.c.id)
    )
    member_name = f"Member {slug}"
    user_id = await connection.scalar(
        insert(users)
        .values(
            subject=f"subject-{slug}",
            email=f"{slug}@example.test",
            display_name=member_name,
            initials="MM",
            avatar_colour=0,
        )
        .returning(users.c.id)
    )
    await connection.execute(
        insert(memberships).values(tenant_id=tenant_id, user_id=user_id, role="researcher")
    )
    assert isinstance(organisation_id, uuid.UUID)
    assert isinstance(tenant_id, uuid.UUID)
    assert isinstance(user_id, uuid.UUID)
    seeded = Seeded(
        tenant_id=tenant_id,
        subject=f"subject-{slug}",
        ids={"organisation": organisation_id, "tenant": tenant_id, "user": user_id},
        markers={
            str(organisation_id),
            str(tenant_id),
            str(user_id),
            slug,
            name,
            member_name,
            f"{slug}.example.test",
        },
    )
    for seeder in SEEDERS.values():
        await seeder(connection, seeded)
    return seeded


async def seed_both(database: str) -> tuple[Seeded, Seeded]:
    engine = create_async_engine(async_database_url(with_database(OWNER_URL, database)))
    try:
        async with engine.begin() as connection:
            return await seed_tenant(connection, "a"), await seed_tenant(connection, "b")
    finally:
        await engine.dispose()


@pytest.fixture(scope="module")
def seeded(database: str, storage: StorageLocation) -> tuple[Seeded, Seeded]:
    assert storage.bucket
    return asyncio.run(seed_both(database))


def test_every_get_operation_is_in_the_suite() -> None:
    paths: dict[str, dict[str, dict[str, str]]] = openapi_schema()["paths"]
    operations = {
        operation["operationId"]
        for path in paths.values()
        for method, operation in path.items()
        if method == "get"
    }
    assert operations == set(GET_ROUTES)


def test_every_table_is_seeded_by_the_suite(database: str) -> None:
    rows = query(
        with_database(OWNER_URL, database),
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
    )
    known = BASE_TABLES | AUTH_TABLES | CASE_TABLES | set(SEEDERS)
    assert {str(row[0]) for row in rows} - UNOWNED_TABLES == known


@pytest.mark.parametrize("operation", routes(Exposure.TENANT))
def test_tenant_routes_show_a_member_their_own_data(
    api: ApiAs, seeded: tuple[Seeded, Seeded], operation: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    a, _ = seeded
    route = GET_ROUTES[operation]
    response = prepared(api, route, monkeypatch)(a.member(route.admin_rights)).get(route.path(a))
    assert response.status_code == 200, response.text
    assert any(marker in text_of(response) for marker in a.markers)


@pytest.mark.parametrize("operation", routes(Exposure.TENANT))
def test_tenant_routes_show_another_tenant_nothing(
    api: ApiAs, seeded: tuple[Seeded, Seeded], operation: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    a, b = seeded
    route = GET_ROUTES[operation]
    response = prepared(api, route, monkeypatch)(b.member(route.admin_rights)).get(route.path(a))
    assert response.status_code in {200, 404}, response.text
    text = text_of(response)
    assert [marker for marker in a.markers if marker in text] == []


@pytest.mark.parametrize("operation", routes(Exposure.PLATFORM))
def test_platform_routes_refuse_members(
    api: ApiAs, seeded: tuple[Seeded, Seeded], operation: str
) -> None:
    a, b = seeded
    response = api(b.member()).get(GET_ROUTES[operation].path(a))
    assert response.status_code == 403
    assert [marker for marker in a.markers if marker in response.text] == []


async def rows_visible_to_a_member(database: str, tenant_id: uuid.UUID) -> dict[str, int]:
    owner = create_async_engine(async_database_url(with_database(OWNER_URL, database)))
    app = create_async_engine(async_database_url(with_database(APP_URL, database)))
    try:
        async with owner.begin() as connection:
            await connection.execute(
                insert(platform_operators).values(subject=f"operator-{uuid.uuid4()}")
            )
        counts: dict[str, int] = {}
        async with scoped_transaction(app, DatabaseScope(tenant_id=tenant_id)) as connection:
            for table in sorted(AUTH_TABLES):
                counts[table] = int(
                    await connection.scalar(text(f"SELECT count(*) FROM {table}")) or 0
                )
        return counts
    finally:
        await owner.dispose()
        await app.dispose()


TENANT_ID_TABLES = (
    "SELECT table_name FROM information_schema.columns "
    "WHERE table_schema = 'public' AND column_name = 'tenant_id' ORDER BY table_name"
)


async def rows_of_a_tenant(
    url: str, scope: DatabaseScope | None, tables: list[str], tenant_id: uuid.UUID
) -> dict[str, int]:
    engine = create_async_engine(async_database_url(url))
    count = "SELECT count(*) FROM {} WHERE tenant_id = :tenant"
    try:
        async with engine.begin() as connection:
            if scope is not None:
                await connection.execute(SET_SCOPE, scope.parameters())
            return {
                table: int(
                    await connection.scalar(text(count.format(table)), {"tenant": tenant_id}) or 0
                )
                for table in tables
            }
    finally:
        await engine.dispose()


def test_no_table_shows_a_workspace_its_neighbour_or_shows_rows_without_a_scope(
    database: str, seeded: tuple[Seeded, Seeded]
) -> None:
    a, b = seeded
    owner = with_database(OWNER_URL, database)
    app = with_database(APP_URL, database)
    tables = [str(row[0]) for row in query(owner, TENANT_ID_TABLES)]
    stored = asyncio.run(rows_of_a_tenant(owner, None, tables, a.tenant_id))
    assert [table for table in tables if stored[table] == 0] == []
    as_neighbour = DatabaseScope(tenant_id=b.tenant_id, user_id=b.ids["user"])
    for scope in (as_neighbour, DatabaseScope(), DatabaseScope(user_id=b.ids["user"])):
        seen = asyncio.run(rows_of_a_tenant(app, scope, tables, a.tenant_id))
        assert {table: rows for table, rows in seen.items() if rows} == {}


def test_auth_tables_are_hidden_from_tenant_scopes(
    database: str, seeded: tuple[Seeded, Seeded]
) -> None:
    a, _ = seeded
    counts = asyncio.run(rows_visible_to_a_member(database, a.tenant_id))
    assert counts == dict.fromkeys(sorted(AUTH_TABLES), 0)


def test_a_shared_report_shows_only_its_own_workspace(
    api: ApiAs, seeded: tuple[Seeded, Seeded]
) -> None:
    a, b = seeded
    api.principal = None
    response = api.client.get(GET_ROUTES["getSharedReport"].path(a))
    assert response.status_code == 200, response.text
    assert [marker for marker in b.markers if marker in response.text] == []
    assert str(a.ids["task"]) not in response.text


def test_an_annotate_task_and_its_class_snapshot_stay_in_their_workspace(
    api: ApiAs, seeded: tuple[Seeded, Seeded]
) -> None:
    a, b = seeded
    path = f"/api/review-tasks/{a.ids['annotate_task']}"
    mine = api(a.member()).get(path)
    assert mine.status_code == 200, mine.text
    assert (mine.json()["kind"], mine.json()["slides"][0]["result_set_id"]) == ("annotate", None)
    snapshot = mine.json()["classes"][0]["name"]
    assert snapshot in a.markers
    theirs = api(b.member()).get(path)
    assert theirs.status_code == 404
    assert snapshot not in theirs.text
    listed = api(b.member()).get(f"/api/projects/{a.ids['project']}/review-tasks")
    assert snapshot not in listed.text
    layer = f"{path}/slides/{a.ids['slide']}/shared-layer"
    shared = str(a.ids["shared_object"])
    assert shared in api(a.member()).get(layer).text
    for attempt in (
        api(b.member()).get(layer),
        api(b.member()).get(f"{layer}/ai"),
        api(b.member()).post(f"{layer}/objects", json={"kind": "region", "geometry": SQUARE}),
        api(b.member()).put(f"{layer}/ai/T1", json={"deleted": True}),
        api(b.member()).post(f"{layer}/ai/T1/confirm", json={}),
        api(b.member()).delete(f"{layer}/ai/T1/confirm", params={"version": 1}),
        api(b.member()).post(
            f"{path}/slides/{a.ids['slide']}/runs", json={"result_set_id": str(uuid.uuid4())}
        ),
        api(b.member()).patch(f"{layer}/objects/{shared}", json={"version": 1, "class_id": None}),
        api(b.member()).delete(f"{layer}/objects/{shared}", params={"version": 1}),
    ):
        assert attempt.status_code == 404, attempt.text
        assert shared not in attempt.text


def test_another_workspace_cannot_answer_an_ask(api: ApiAs, seeded: tuple[Seeded, Seeded]) -> None:
    a, b = seeded
    path = f"/api/tenant/access-requests/{a.ids['access_request']}"
    for attempt in (
        api(b.member(admin_rights=True)).delete(path),
        api(b.member(admin_rights=True)).post(f"{path}/approval"),
    ):
        assert attempt.status_code == 404, attempt.text
    pending = api(a.member(admin_rights=True)).get("/api/tenant/access-requests").json()
    assert str(a.ids["access_request"]) in [item["id"] for item in pending]


class CountingPools:
    def __init__(self) -> None:
        self.spawned = 0
        self.called = 0

    def spawn(self, function_name: str, call: dict[str, object]) -> None:
        self.spawned += 1

    def call(self, function_name: str, call: dict[str, object]) -> dict[str, object]:
        self.called += 1
        return {}


def test_another_workspace_cannot_warm_the_embedder_for_a_slide(
    api: ApiAs, seeded: tuple[Seeded, Seeded]
) -> None:
    a, b = seeded
    pools = CountingPools()
    api.app.state.warm_gate = WarmGate(pools)
    path = f"/api/slides/{a.ids['slide']}/embeddings/warm"
    try:
        refused = api(b.member()).post(path, json={"device": "slow"})
        assert refused.status_code == 404, refused.text
        assert pools.spawned == 0
        warmed = api(a.member()).post(path, json={"device": "slow"})
        assert warmed.status_code == 204, warmed.text
        assert pools.spawned == 1
    finally:
        del api.app.state.warm_gate


def test_another_workspace_cannot_map_a_view_of_a_slide(
    api: ApiAs, seeded: tuple[Seeded, Seeded]
) -> None:
    a, b = seeded
    pools = CountingPools()
    api.app.state.warm_gate = WarmGate(pools)
    path = f"/api/slides/{a.ids['slide']}/view-map/0/0"
    try:
        refused = api(b.member()).post(path)
        assert refused.status_code == 404, refused.text
        assert pools.called == 0
    finally:
        del api.app.state.warm_gate


KEY_COLUMNS = (
    "(SELECT string_agg(a.attname::text, ',' ORDER BY k.ord) FROM unnest({keys}) "
    "WITH ORDINALITY k(n, ord) JOIN pg_attribute a ON a.attrelid = {table} AND a.attnum = k.n)"
)
KEYS_BETWEEN_TENANT_TABLES = (
    "SELECT c.conname, c.conrelid::regclass::text, c.confrelid::regclass::text, "
    + KEY_COLUMNS.format(keys="c.conkey", table="c.conrelid")
    + ", "
    + KEY_COLUMNS.format(keys="c.confkey", table="c.confrelid")
    + " FROM pg_constraint c WHERE c.contype = 'f' "
    "AND c.connamespace = 'public'::regnamespace AND c.confrelid <> 'tenants'::regclass "
    "AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.conrelid "
    "AND a.attname = 'tenant_id') "
    "AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.confrelid "
    "AND a.attname = 'tenant_id') ORDER BY 1"
)
INSERTABLE_COLUMNS = (
    "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' "
    "AND table_name = :table AND is_generated = 'NEVER' "
    "AND coalesce(identity_generation, '') <> 'ALWAYS' ORDER BY ordinal_position"
)


@dataclass(frozen=True)
class TenantKey:
    name: str
    child: str
    parent: str
    column: str


def keys_between_tenant_tables(owner: str) -> list[tuple[str, str, str, list[str], list[str]]]:
    return [
        (str(name), str(child), str(parent), names_of(columns), names_of(referred))
        for name, child, parent, columns, referred in query(owner, KEYS_BETWEEN_TENANT_TABLES)
    ]


def names_of(joined: object) -> list[str]:
    return str(joined).split(",")


def tenant_keys(owner: str) -> list[TenantKey]:
    return [
        TenantKey(name, child, parent, columns[0])
        for name, child, parent, columns, referred in keys_between_tenant_tables(owner)
        if len(columns) == 2
        and columns[0] != "project_id"
        and columns[1] == "tenant_id"
        and referred == ["id", "tenant_id"]
    ]


CHANGED_IN_A_COPY = {
    "annotation_versions": {"version": "version + 1000"},
    "api_tokens": {"token_hash": "sha256(token_hash)"},
    "clinical_report_versions": {"number": "number + 1000", "reason": "'probe'"},
    "evaluation_versions": {"number": "number + 1000"},
    "job_steps": {"ordinal": "ordinal + 1000"},
    "painted_map_versions": {"version": "version + 1000"},
    "specimens": {"letter": "'ZZ'"},
    "study_template_versions": {"version": "version + 1000"},
    "uploads": {"object_key": "object_key || '.probe'"},
}
CHECKED_WITH_THE_KEY = {
    ("uploads", "created_by_service_id"): {"created_by_user_id": "NULL"},
    ("uploads", "job_id"): {"status": "'completed'", "closed_at": "coalesce(closed_at, now())"},
}
REFUSED_BEFORE_THE_KEY = {
    "result_chunks": "is not importing",
    "result_objects": "is not importing",
}


def copy_pointing_at(key: TenantKey, columns: list[str]) -> str:
    changes = CHANGED_IN_A_COPY.get(key.child, {}) | CHECKED_WITH_THE_KEY.get(
        (key.child, key.column), {}
    )
    values = [
        ":parent"
        if column == key.column
        else "gen_random_uuid()"
        if column == "id"
        else changes.get(column, column)
        for column in columns
    ]
    return (
        f"INSERT INTO {key.child} ({', '.join(columns)}) "
        f"SELECT {', '.join(values)} FROM {key.child} ORDER BY {key.column} IS NULL LIMIT 1"
    )


def move_pointing_at(key: TenantKey) -> str:
    return (
        f"UPDATE {key.child} SET {key.column} = :parent WHERE ctid = "
        f"(SELECT ctid FROM {key.child} ORDER BY {key.column} IS NULL LIMIT 1)"
    )


def refused_by_its_key(key: TenantKey, refusal: str) -> bool:
    before = REFUSED_BEFORE_THE_KEY.get(key.child)
    return f'violates foreign key constraint "{key.name}"' in refusal or (
        before is not None and before in refusal
    )


async def write_pointing_across(
    app: str, key: TenantKey, scope: DatabaseScope, parent: object, statement: str
) -> str:
    engine = create_async_engine(async_database_url(app))
    try:
        async with engine.connect() as connection:
            await connection.execute(SET_SCOPE, scope.parameters())
            columns = [
                str(row[0])
                for row in await connection.execute(text(INSERTABLE_COLUMNS), {"table": key.child})
            ]
            sql = copy_pointing_at(key, columns) if statement == "insert" else move_pointing_at(key)
            written = await connection.execute(text(sql), {"parent": parent})
            return f"{statement} of {written.rowcount} rows accepted"
    except DBAPIError as error:
        return str(error.orig)
    finally:
        await engine.dispose()


def refusal_of(app: str, key: TenantKey, scope: DatabaseScope, parent: object) -> str:
    refusal = asyncio.run(write_pointing_across(app, key, scope, parent, "insert"))
    if refused_by_its_key(key, refusal) or "accepted" in refusal:
        return refusal
    return asyncio.run(write_pointing_across(app, key, scope, parent, "update"))


def test_every_key_between_workspace_tables_carries_the_workspace(database: str) -> None:
    owner = with_database(OWNER_URL, database)
    without_the_workspace = [
        (name, columns, referred)
        for name, _, _, columns, referred in keys_between_tenant_tables(owner)
        if "tenant_id" not in columns or referred[columns.index("tenant_id")] != "tenant_id"
    ]
    assert without_the_workspace == []


def test_a_row_cannot_point_at_a_parent_in_another_workspace(
    database: str, seeded: tuple[Seeded, Seeded]
) -> None:
    a, b = seeded
    owner = with_database(OWNER_URL, database)
    app = with_database(APP_URL, database)
    scope = DatabaseScope(tenant_id=b.tenant_id, user_id=b.ids["user"])
    keys = tenant_keys(owner)
    assert len(keys) >= 35
    accepted: list[str] = []
    for key in keys:
        parent = query(
            owner, f"SELECT id FROM {key.parent} WHERE tenant_id = '{a.tenant_id}' LIMIT 1"
        )[0][0]
        refusal = refusal_of(app, key, scope, parent)
        if not refused_by_its_key(key, refusal):
            accepted.append(f"{key.name}: {refusal}")
    assert not accepted, "\n".join(accepted)


@dataclass(frozen=True)
class CompositeKey:
    name: str
    child: str
    parent: str
    columns: tuple[str, ...]
    referred: tuple[str, ...]


def composite_keys(owner: str) -> list[CompositeKey]:
    return [
        CompositeKey(
            name,
            child,
            parent,
            tuple(column for column in columns if column != "tenant_id"),
            tuple(column for column in referred if column != "tenant_id"),
        )
        for name, child, parent, columns, referred in keys_between_tenant_tables(owner)
        if len([column for column in columns if column != "tenant_id"]) >= 2
    ]


CONSTRAINTS_BESIDE = (
    "SELECT c.conname FROM pg_constraint c, pg_constraint k "
    "WHERE k.conname = :name AND k.conrelid = CAST(:table AS regclass) "
    "AND c.conrelid = k.conrelid AND c.oid <> k.oid AND c.contype IN ('c', 'f', 'p', 'u', 'x') "
    "AND (c.contype IN ('c', 'f') OR c.conindid <> k.conindid)"
)
UNIQUE_INDEXES_BESIDE = (
    "SELECT i.indexrelid::regclass::text FROM pg_index i, pg_constraint k "
    "WHERE k.conname = :name AND k.conrelid = CAST(:table AS regclass) "
    "AND i.indrelid = k.conrelid AND i.indisunique AND i.indexrelid <> k.conindid "
    "AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid "
    "AND c.conrelid = i.indrelid)"
)
COLUMN_TYPES = (
    "SELECT attname, format_type(atttypid, atttypmod) FROM pg_attribute "
    "WHERE attrelid = CAST(:table AS regclass) AND attnum > 0 AND NOT attisdropped"
)


def all_set(columns: tuple[str, ...]) -> str:
    return " AND ".join(f"{column} IS NOT NULL" for column in columns)


def foreign_tuple(owner: str, key: CompositeKey, tenant_id: object) -> tuple[object, ...]:
    own = query(
        owner,
        f"SELECT {', '.join(key.columns)} FROM {key.child} "
        f"WHERE tenant_id = '{tenant_id}' AND {all_set(key.columns)} LIMIT 1",
    )
    if own:
        return own[0]
    return query(
        owner,
        f"SELECT {', '.join(key.referred)} FROM {key.parent} "
        f"WHERE tenant_id = '{tenant_id}' AND {all_set(key.referred)} LIMIT 1",
    )[0]


def composite_copy(key: CompositeKey, columns: list[str], types: dict[str, str]) -> str:
    values = [
        f"CAST(:k{key.columns.index(column)} AS {types[column]})"
        if column in key.columns
        else "gen_random_uuid()"
        if column == "id"
        else column
        for column in columns
    ]
    return (
        f"INSERT INTO {key.child} ({', '.join(columns)}) "
        f"SELECT {', '.join(values)} FROM {key.child} LIMIT 1"
    )


async def leave_only_the_key(connection: AsyncConnection, key: CompositeKey) -> None:
    where = {"table": key.child, "name": key.name}
    for (constraint,) in (await connection.execute(text(CONSTRAINTS_BESIDE), where)).all():
        await connection.execute(
            text(f'ALTER TABLE {key.child} DROP CONSTRAINT IF EXISTS "{constraint}" CASCADE')
        )
    for (index,) in (await connection.execute(text(UNIQUE_INDEXES_BESIDE), where)).all():
        await connection.execute(text(f"DROP INDEX {index}"))
    await connection.execute(text(f"ALTER TABLE {key.child} DISABLE TRIGGER USER"))
    await connection.execute(text(f"GRANT INSERT ON {key.child} TO parfocal_app"))


async def insert_across(
    owner: str, key: CompositeKey, scope: DatabaseScope, values: tuple[object, ...]
) -> str:
    engine = create_async_engine(async_database_url(owner))
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            try:
                await leave_only_the_key(connection, key)
                types = {
                    str(column): str(kind)
                    for column, kind in await connection.execute(
                        text(COLUMN_TYPES), {"table": key.child}
                    )
                }
                columns = [
                    str(row[0])
                    for row in await connection.execute(
                        text(INSERTABLE_COLUMNS), {"table": key.child}
                    )
                ]
                await connection.execute(text("SET LOCAL ROLE parfocal_app"))
                await connection.execute(SET_SCOPE, scope.parameters())
                written = await connection.execute(
                    text(composite_copy(key, columns, types)),
                    {f"k{index}": value for index, value in enumerate(values)},
                )
                return f"insert of {written.rowcount} rows accepted"
            finally:
                await transaction.rollback()
    except DBAPIError as error:
        return str(error.orig)
    finally:
        await engine.dispose()


async def seen_as_the_app(owner: str, scope: DatabaseScope, tenant_id: object) -> tuple[str, int]:
    engine = create_async_engine(async_database_url(owner))
    try:
        async with engine.connect() as connection, connection.begin():
            await connection.execute(text("SET LOCAL ROLE parfocal_app"))
            await connection.execute(SET_SCOPE, scope.parameters())
            role = (await connection.execute(text("SELECT current_user"))).scalar_one()
            hidden = (
                await connection.execute(
                    text("SELECT count(*) FROM slides WHERE tenant_id = :tenant"),
                    {"tenant": tenant_id},
                )
            ).scalar_one()
            return str(role), int(hidden)
    finally:
        await engine.dispose()


def test_a_row_cannot_name_a_parent_pair_in_another_workspace(
    database: str, seeded: tuple[Seeded, Seeded]
) -> None:
    a, b = seeded
    owner = with_database(OWNER_URL, database)
    scope = DatabaseScope(tenant_id=b.tenant_id, user_id=b.ids["user"])
    assert asyncio.run(seen_as_the_app(owner, scope, a.tenant_id)) == ("parfocal_app", 0)
    keys = composite_keys(owner)
    assert len(keys) == 47
    accepted: list[str] = []
    for key in keys:
        refusal = asyncio.run(
            insert_across(owner, key, scope, foreign_tuple(owner, key, a.tenant_id))
        )
        if f'violates foreign key constraint "{key.name}"' not in refusal:
            accepted.append(f"{key.name}: {refusal}")
    assert not accepted, "\n".join(accepted)
