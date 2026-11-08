import asyncio
import hashlib
import io
import threading
import uuid
import zipfile
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from enum import Enum, auto
from functools import cache
from typing import Any

import httpx2
import numpy as np
import pytest
from case_support import seed_case
from db_support import APP_URL, OWNER_URL, ApiAs, query, with_database
from link_support import Site
from pypdf import PdfReader
from sqlalchemy import func, insert, select, text, update
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from storage_support import TEST_PART_BYTES, TEST_STORAGE, put_restricted_images, stand_in_images

from parfocal_api.display_settings import DisplaySettings
from parfocal_api.openapi import openapi_schema
from parfocal_api.principals import MemberPrincipal
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
    hidden_models,
    invitations,
    job_steps,
    job_units,
    jobs,
    legal_holds,
    memberships,
    model_tiers,
    notification_mutes,
    notification_preferences,
    notifications,
    opinions,
    organisations,
    personal_settings,
    platform_operators,
    project_classes,
    project_members,
    report_links,
    result_chunks,
    result_objects,
    result_set_classes,
    result_sets,
    resume_states,
    retention_policies,
    review_assignments,
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
    stage_throughput,
    study_template_versions,
    study_templates,
    task_nudges,
    task_reassignments,
    tenants,
    thread_messages,
    threads,
    uploads,
    users,
    verdicts,
    workspace_settings,
)
from parfocal_common.chunk_store import Cell, build_cells, write_cells
from parfocal_common.db import DatabaseScope, async_database_url, scoped_transaction
from parfocal_common.ingest import RestrictedImage, slide_prefix
from parfocal_common.model_runs import RunScopeKind, RunSettings, enqueue_model_run
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.result_store import ObjectResultStore
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


BASE_TABLES = {"organisations", "tenants", "users", "memberships"}
CASE_TABLES = {
    "opinions",
    "disagreement_decisions",
    "verdicts",
    "review_skips",
    "review_edits",
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
AUTH_TABLES = {"platform_operators", "auth_logins", "sessions", "rate_counters"}


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
            values={"lock_after_minutes": 5},
            locked=[],
            security_contact=f"security-{target}@example.test",
        )
    )
    seeded.markers.add(str(target))


async def seed_cases(connection: AsyncConnection, seeded: Seeded) -> None:
    case = await seed_case(connection, seeded.tenant_id)
    seeded.ids["case"] = case.case_id
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
        .values(restricted_images=[RestrictedImage.LABEL.value], width=4096, height=2048)
    )
    async with httpx2.AsyncClient(timeout=30) as http:
        await put_restricted_images(
            ObjectStore(TEST_STORAGE, http),
            seeded.tenant_id,
            case.loose_slide_id,
            {RestrictedImage.LABEL: stand_in_images(str(seeded.tenant_id))[RestrictedImage.LABEL]},
        )
        await ObjectStore(TEST_STORAGE, http).put_object(
            f"{slide_prefix(seeded.tenant_id, case.loose_slide_id)}{TISSUE_FILE}",
            TissueMask(64, 20, np.ones((16, 32), dtype=bool), None).png(),
            "image/png",
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
    summary_set = await connection.scalar(
        insert(result_sets)
        .values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            slide_id=case.loose_slide_id,
            name=f"Cells {uuid.uuid4().hex[:8]}",
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
        entries = await write_cells(ObjectResultStore(ObjectStore(TEST_STORAGE, http)), built)
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
    verdict_note = f"Verdict note {uuid.uuid4().hex[:8]}"
    await connection.execute(
        insert(verdicts).values(
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
            note=verdict_note,
        )
    )
    seeded.markers.add(verdict_note)
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
        insert(memberships).values(tenant_id=seeded.tenant_id, user_id=colleague, role="researcher")
    )
    await connection.execute(
        insert(project_members).values(
            tenant_id=seeded.tenant_id,
            project_id=case.project_id,
            user_id=colleague,
            role="viewer",
        )
    )
    seeded.markers.add(colleague_name)
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
        )
    )
    seeded.ids["annotate_task"] = annotate_id
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
    "slide_coverage": seed_slide_coverage,
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
    "listStudyTemplates": Route(Exposure.TENANT, lambda _: "/api/study-templates"),
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
    "getMe": Route(Exposure.TENANT, lambda _: "/api/me"),
    "listTenantMembers": Route(Exposure.TENANT, lambda _: "/api/tenant/members"),
    "listMemberActivity": Route(
        Exposure.TENANT, lambda _: "/api/tenant/members/activity", admin_rights=True
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
    "listLegalHolds": Route(
        Exposure.TENANT, lambda _: "/api/tenant/legal-holds", admin_rights=True
    ),
    "exportMyPersonalData": Route(Exposure.TENANT, lambda _: "/api/me/personal-data"),
    "exportPatientData": Route(
        Exposure.TENANT,
        lambda a: f"/api/projects/{a.ids['project']}/patients/{a.ids['patient']}/personal-data",
    ),
    "listProjects": Route(Exposure.TENANT, lambda _: "/api/projects"),
    "getProject": Route(Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}"),
    "listTaxonomyTemplates": Route(Exposure.PUBLIC, lambda _: "/api/taxonomy-templates"),
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
    "getCase": Route(Exposure.TENANT, lambda a: f"/api/cases/{a.ids['case']}"),
    "getCaseReport": Route(Exposure.TENANT, lambda a: case_report(a)),
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
    "getSlideCoverage": Route(Exposure.TENANT, lambda a: f"/api/slides/{a.ids['slide']}/coverage"),
    "getRoomAccess": Route(Exposure.TENANT, lambda a: f"/api/rooms/slide:{a.ids['slide']}/access"),
    "listCases": Route(Exposure.TENANT, lambda _: "/api/cases"),
    "listReviewTasks": Route(
        Exposure.TENANT, lambda a: f"/api/projects/{a.ids['project']}/review-tasks"
    ),
    "listMyReviewTasks": Route(Exposure.TENANT, lambda _: "/api/me/review-tasks"),
    "listTasksAssignedByMe": Route(Exposure.TENANT, lambda _: "/api/me/assigned-tasks"),
    "listMySlides": Route(Exposure.TENANT, lambda _: "/api/me/slides"),
    "getTaskEvaluation": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation"
    ),
    "getSignOffSummary": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/sign-off-summary"
    ),
    "listEvaluationChanges": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation-changes"
    ),
    "exportTaskEvaluation": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation/exports/objects.csv",
    ),
    "exportTrainingDataset": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['annotate_task']}/training-dataset",
    ),
    "getTaskAiChanges": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['annotate_task']}/evaluation/ai-changes",
    ),
    "listReportLinks": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/evaluation/links"
    ),
    "getSharedReport": Route(Exposure.PUBLIC, lambda a: f"/api/shared-reports/{shared_token(a)}"),
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
    "listVerdicts": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/verdicts",
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
    "getReviewOrder": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/order",
    ),
    "getReviewTaskStates": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/states"
    ),
    "getReviewedLayer": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/slides/{a.ids['slide']}/layer",
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
    "listProjectModels": Route(
        Exposure.PUBLIC, lambda a: f"/api/projects/{a.ids['project']}/models"
    ),
    "getResultSet": Route(Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['result_set']}"),
    "getCellSummary": Route(
        Exposure.TENANT, lambda a: f"/api/result-sets/{a.ids['summary_set']}/cell-summary"
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
    "getMyAvailability": Route(Exposure.TENANT, lambda _: "/api/me/availability"),
    "listAvailability": Route(Exposure.TENANT, lambda _: "/api/tenant/availability"),
    "listSessions": Route(Exposure.PUBLIC, lambda _: "/api/auth/sessions"),
    "getMyEmailSchedule": Route(Exposure.PUBLIC, lambda _: "/api/me/email-schedule"),
    "getMyDisplay": Route(
        Exposure.TENANT, lambda a: f"/api/review-tasks/{a.ids['task']}/my-display"
    ),
    "listDisplayPresets": Route(Exposure.TENANT, lambda _: "/api/display-presets"),
    "listAdjudicatorCandidates": Route(
        Exposure.TENANT,
        lambda a: f"/api/review-tasks/{a.ids['task']}/disagreements/adjudicators",
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
        markers={str(organisation_id), str(tenant_id), str(user_id), slug, name, member_name},
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
