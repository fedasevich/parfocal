import asyncio
import threading
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from functools import cache
from pathlib import Path
from typing import Any
from urllib.parse import quote

import httpx2
import numpy as np
import pytest
from case_support import TEST_KEYRING, seed_case, seed_project
from db_support import OWNER_URL, ApiAs, query, with_database
from link_support import Site
from sqlalchemy import func, insert, update
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine
from storage_support import TEST_PART_BYTES, TEST_STORAGE, put_restricted_images, stand_in_images

from parfocal_api.identifiers import PatientIdentity, add_patient, ensure_keys
from parfocal_api.openapi import openapi_schema
from parfocal_api.permissions import (
    ADMIN_RIGHTS,
    COLUMNS,
    MATRIX,
    Grant,
    Permission,
    grant_for,
)
from parfocal_api.permissions_doc import DOC_PATH, render
from parfocal_api.principals import MemberPrincipal, Principal, SignedInUser
from parfocal_api.slide_tissue import TISSUE_FILE
from parfocal_api.study_templates import seed_built_ins
from parfocal_api.tables import (
    BuiltInTemplate,
    Role,
    adjudication_objects,
    adjudications,
    annotations,
    announcements,
    api_tokens,
    cases,
    clinical_deposits,
    clinical_report_versions,
    clinical_reports,
    display_presets,
    invitations,
    jobs,
    legal_holds,
    memberships,
    organisations,
    project_classes,
    project_members,
    projects,
    report_links,
    result_objects,
    result_sets,
    review_assignments,
    review_edits,
    review_task_slides,
    review_tasks,
    service_accounts,
    slide_counters,
    slides,
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
from parfocal_common.chunk_store import Cell, build_cells
from parfocal_common.db import async_database_url, metadata
from parfocal_common.ingest import RestrictedImage, slide_prefix
from parfocal_common.jobs import enqueue
from parfocal_common.model_runs import RunScopeKind, RunSettings, enqueue_model_run
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.result_store import ObjectResultStore
from parfocal_ingest.tissue import TissueMask
from parfocal_ingest.workflow import INGEST

OPEN_OPERATIONS = {
    "getHealth": "public",
    "getSharedReport": "public",
    "getSession": "signed-in",
    "getMe": "signed-in",
    "updateMe": "signed-in",
    "switchWorkspace": "signed-in",
    "getCurrentTenant": "member",
    "listTaxonomyTemplates": "member",
    "getOpinionFormTemplate": "member",
    "getResultsSchema": "member",
    "getResultsTemplate": "member",
    "validateResultsFile": "member",
    "listNotificationPreferences": "member",
    "setNotificationPreferences": "member",
    "getMySettingLayers": "member",
    "setMySettingLayers": "member",
    "listNotifications": "member",
    "getNotificationCounts": "member",
    "markNotificationsRead": "member",
    "listNotificationMutes": "member",
    "muteNotifications": "own-notification",
    "unmuteNotifications": "member",
    "createOrganisation": "platform",
    "listOrganisations": "platform",
    "createTenant": "platform",
    "listTenants": "platform",
    "getTenant": "platform",
    "suspendTenant": "platform",
    "reactivateTenant": "platform",
    "addMember": "platform",
    "invitePlatformMember": "platform",
    "acceptInvitation": "signed-in",
    "listSessions": "signed-in",
    "recordActivity": "signed-in",
    "endSession": "signed-in",
    "endOtherSessions": "signed-in",
    "getSessionPolicy": "member",
    "listAnnouncements": "member",
    "listSiteValidations": "member",
    "listModelTiers": "member",
    "listModelVisibility": "member",
    "getMyHome": "member",
    "setMyResume": "own-assignment",
    "exportMyPersonalData": "signed-in",
    "getNotificationTarget": "own-notification",
    "getRoomAccess": "room-grant",
    "getMyEmailSchedule": "signed-in",
    "setMyEmailSchedule": "signed-in",
    "erasePerson": "platform",
    "getMyAvailability": "member",
    "setMyAvailability": "member",
    "listMembers": "platform",
}


@dataclass(frozen=True)
class Seat:
    role: Role
    admin_rights: bool = False

    def __str__(self) -> str:
        return f"{self.role}-with-admin-rights" if self.admin_rights else str(self.role)


RESEARCHER = Seat(Role.RESEARCHER)
ADMIN = Seat(Role.RESEARCHER, admin_rights=True)
REVIEWER = Seat(Role.REVIEWER)
SEATS = (RESEARCHER, ADMIN, REVIEWER)


@dataclass(frozen=True)
class SeededUpload:
    id: uuid.UUID = field(default_factory=uuid.uuid4)
    key: str = "t/placeholder"
    etag: str = "0"

    def path(self, suffix: str = "") -> str:
        return f"/api/uploads/s3/multipart/{self.id}{suffix}?key={self.key}"


UPLOAD_NAME = "Matrix slide.svs"
UPLOAD_BYTES = b"0123456789"


@dataclass(frozen=True)
class Workspace:
    tenant_id: uuid.UUID
    users: dict[Seat, uuid.UUID]
    colleague: uuid.UUID
    deputy: uuid.UUID
    lead: uuid.UUID
    slug: str
    account: uuid.UUID
    token: uuid.UUID
    spare_account: uuid.UUID
    invitations: list[uuid.UUID]
    case: uuid.UUID
    project: uuid.UUID
    spare_project: uuid.UUID
    sample_project: uuid.UUID
    outside_project: uuid.UUID
    project_class: uuid.UUID
    job: uuid.UUID
    slide: uuid.UUID
    annotation: uuid.UUID
    doomed_annotation: uuid.UUID
    deleted_annotation: uuid.UUID
    result_set: uuid.UUID
    doomed_result_set: uuid.UUID
    task: uuid.UUID
    submitted_task: uuid.UUID
    ready_task: uuid.UUID
    signed_task: uuid.UUID
    versioned_task: uuid.UUID
    queued_task: uuid.UUID
    hidden_task: uuid.UUID
    first_read_task: uuid.UUID
    nudge: uuid.UUID
    reassign_task: uuid.UUID
    undo_task: uuid.UUID
    reassignment: uuid.UUID
    add_task: uuid.UUID
    announcement: uuid.UUID
    legal_hold: uuid.UUID
    patient: uuid.UUID
    doomed_patient: uuid.UUID
    study_template: uuid.UUID
    spare_template: uuid.UUID
    queued_run: uuid.UUID
    paused_run: uuid.UUID
    failed_run: uuid.UUID
    thread: uuid.UUID
    doomed_thread: uuid.UUID
    open_upload: SeededUpload = field(default_factory=lambda: SeededUpload())
    finished_upload: SeededUpload = field(default_factory=lambda: SeededUpload())
    doomed_upload: SeededUpload = field(default_factory=lambda: SeededUpload())
    result_upload: SeededUpload = field(default_factory=lambda: SeededUpload())
    waiting_result: SeededUpload = field(default_factory=lambda: SeededUpload())
    leftover_result: SeededUpload = field(default_factory=lambda: SeededUpload())
    display_preset: uuid.UUID = field(default_factory=uuid.uuid4)
    doomed_preset: uuid.UUID = field(default_factory=uuid.uuid4)
    declinable: uuid.UUID = field(default_factory=uuid.uuid4)
    adjudicator: uuid.UUID = field(default_factory=uuid.uuid4)
    report_link: uuid.UUID = field(default_factory=uuid.uuid4)
    annotate_task: uuid.UUID = field(default_factory=uuid.uuid4)
    checked_annotate_task: uuid.UUID = field(default_factory=uuid.uuid4)
    ready_annotate_task: uuid.UUID = field(default_factory=uuid.uuid4)
    layer_object: uuid.UUID = field(default_factory=uuid.uuid4)
    doomed_layer_object: uuid.UUID = field(default_factory=uuid.uuid4)

    @property
    def shared_layer(self) -> str:
        return f"/api/review-tasks/{self.annotate_task}/slides/{self.slide}/shared-layer"

    @property
    def annotations(self) -> str:
        return f"/api/slides/{self.slide}/annotations"


@dataclass(frozen=True)
class Call:
    method: str
    path: str
    body: dict[str, Any] | None = None


SQUARE = {"type": "Polygon", "coordinates": [[[0, 0], [9, 0], [9, 9], [0, 9], [0, 0]]]}
NEEDS_A_TASK = frozenset(
    {
        "createCaseReport",
        "updateCaseReport",
        "addCaseReportDeposit",
        "removeCaseReportDeposit",
        "sendCaseReportForCosign",
        "returnCaseReport",
        "withdrawCaseReport",
        "signCaseReport",
        "amendCaseReport",
        "createAnnotation",
        "createAnnotations",
        "changeAnnotation",
        "deleteAnnotation",
        "restoreAnnotation",
        "saveReviewEdit",
        "clearReviewEdit",
        "splitReviewObject",
        "mergeReviewObjects",
        "addReviewObject",
        "submitSlideReview",
        "reopenSlideReview",
        "saveVerdict",
        "clearVerdict",
        "getMyDisplay",
        "chooseMyDisplay",
        "saveOpinion",
        "submitFirstRead",
        "createThread",
        "replyToThread",
        "resolveThread",
        "reopenThread",
        "deleteThread",
        "createSharedObject",
        "importSharedObjects",
        "changeAiObject",
        "confirmAiObject",
        "undoAiConfirm",
        "addRunToTaskSlide",
        "changeSharedObject",
        "deleteSharedObject",
        "checkAnnotateSlide",
        "uncheckAnnotateSlide",
    }
)


def template_body() -> dict[str, Any]:
    return {
        "name": f"Matrix {uuid.uuid4().hex[:8]}",
        "study_kind": "regions",
        "blocks": [{"kind": "text", "title": "Methods"}],
        "presets": {"objects_to_check": {"kind": "all-regions"}},
    }


LINK_SITE = Site()
LINK_SITE.file("/scan.svs", b"slide-bytes")
LINK_OPERATIONS = frozenset({"listSourceFiles", "importFromLink"})


@cache
def link_site_serving() -> threading.Thread:
    thread = threading.Thread(target=LINK_SITE.server.serve_forever, daemon=True)
    thread.start()
    return thread


def trust_link_site(api: ApiAs, monkeypatch: pytest.MonkeyPatch) -> None:
    link_site_serving()
    trusted = api.app.settings.model_copy(update={"link_trusted_origins": [LINK_SITE.origin]})
    monkeypatch.setattr(api.app, "settings", trusted)


def seeded(w: Workspace, name: str) -> uuid.UUID:
    return uuid.uuid5(w.tenant_id, name)


def case_report(w: Workspace, name: str | None = None) -> str:
    case = seeded(w, name) if name else w.case
    return f"/api/projects/{w.project}/cases/{case}/clinical-report"


REPORT_VALUES = {
    "specimen": "Matrix specimen",
    "category": "none",
    "nodes_examined": 1,
    "extranodal": "na",
    "diagnosis": "Matrix diagnosis",
}


async def seed_case_reports(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    case_id: uuid.UUID,
    lead: uuid.UUID,
    cosigner: uuid.UUID,
) -> None:
    def named(name: str) -> uuid.UUID:
        return uuid.uuid5(tenant_id, name)

    await connection.execute(
        update(project_members)
        .where(project_members.c.project_id == project_id, project_members.c.user_id == lead)
        .values(sign_out="any")
    )
    await connection.execute(
        insert(project_members).values(
            tenant_id=tenant_id,
            project_id=project_id,
            user_id=cosigner,
            role="reviewer",
            sign_out="any",
        )
    )
    states = {
        "fresh": None,
        "send": "draft",
        "sign": "draft",
        "sent": "sent",
        "withdraw": "sent",
        "signed": "signed",
    }
    await connection.execute(
        insert(cases),
        [
            {
                "id": named(f"report-{name}"),
                "tenant_id": tenant_id,
                "project_id": project_id,
                "label": f"Matrix report {name}",
                "source": "manual",
            }
            for name in states
        ],
    )
    reports = [(case_id, "draft", None, None, 0)] + [
        (
            named(f"report-{name}"),
            state,
            (cosigner if name == "withdraw" else lead) if state == "sent" else None,
            (lead if name == "withdraw" else cosigner) if state == "sent" else None,
            1 if state == "signed" else 0,
        )
        for name, state in states.items()
        if state
    ]
    for report_case, state, cosigner_id, sent_by, version in reports:
        await connection.execute(
            insert(clinical_reports).values(
                id=named(f"clinical-{report_case}"),
                tenant_id=tenant_id,
                project_id=project_id,
                case_id=report_case,
                template="sentinel-node",
                template_version=1,
                state=state,
                cosigner_user_id=cosigner_id,
                sent_by_user_id=sent_by,
                version=version,
                **REPORT_VALUES,
            )
        )
    await connection.execute(
        insert(slides).values(
            id=named("report-slide"),
            tenant_id=tenant_id,
            project_id=project_id,
            case_id=case_id,
            label="Matrix report slide",
        )
    )
    await connection.execute(
        insert(clinical_deposits).values(
            id=named("report-deposit"),
            tenant_id=tenant_id,
            report_id=named(f"clinical-{case_id}"),
            slide_id=named("report-slide"),
            size_mm=0.1,
        )
    )
    staging = {
        "largest_mm": None,
        "suggested_category": "none",
        "suggested_pn": "pN0(sn)",
        "nodes_positive": 0,
        "contradicts": False,
        "confirmed": True,
    }
    await connection.execute(
        insert(clinical_report_versions).values(
            tenant_id=tenant_id,
            report_id=named(f"clinical-{named('report-signed')}"),
            number=1,
            content={
                "values": {**REPORT_VALUES, "microscopic": None, "comment": None, "deposits": []},
                "staging": staging,
            },
            signed_by_user_id=lead,
        )
    )


GUARDED_CALLS: dict[str, Callable[[Workspace], Call]] = {
    "listStudyTemplates": lambda _: Call("GET", "/api/study-templates"),
    "getStudyTemplate": lambda w: Call("GET", f"/api/study-templates/{w.study_template}"),
    "listStudyTemplateVersions": lambda w: Call(
        "GET", f"/api/study-templates/{w.study_template}/versions"
    ),
    "getStudyTemplateVersion": lambda w: Call(
        "GET", f"/api/study-templates/{w.study_template}/versions/1"
    ),
    "createStudyTemplate": lambda _: Call("POST", "/api/study-templates", template_body()),
    "editStudyTemplate": lambda w: Call(
        "PUT", f"/api/study-templates/{w.study_template}", template_body()
    ),
    "retireStudyTemplate": lambda w: Call(
        "POST", f"/api/study-templates/{w.spare_template}/retire"
    ),
    "restoreStudyTemplate": lambda w: Call(
        "POST", f"/api/study-templates/{w.spare_template}/restore"
    ),
    "createUpload": lambda w: Call(
        "POST",
        "/api/uploads/s3/multipart",
        {"filename": UPLOAD_NAME, "metadata": {"project_id": str(w.project), "size": 10}},
    ),
    "findOpenUpload": lambda w: Call(
        "GET",
        f"/api/uploads/open?project_id={w.project}&name={UPLOAD_NAME}&size=10&last_modified=1",
    ),
    "signUploadPart": lambda w: Call("GET", w.open_upload.path("/1")),
    "listUploadParts": lambda w: Call("GET", w.open_upload.path()),
    "getUploadStatus": lambda w: Call("GET", f"/api/uploads/{w.open_upload.id}/status"),
    "completeUpload": lambda w: Call(
        "POST",
        w.finished_upload.path("/complete"),
        {"parts": [{"PartNumber": 1, "ETag": w.finished_upload.etag}]},
    ),
    "abortUpload": lambda w: Call("DELETE", w.doomed_upload.path()),
    "pairResultFiles": lambda w: Call(
        "POST",
        "/api/uploads/pairings",
        {"project_id": str(w.project), "files": [{"path": "A1.svs"}, {"path": "A1.geojson"}]},
    ),
    "listSourceFiles": lambda w: Call(
        "GET",
        f"/api/projects/{w.project}/source-files?address={quote(LINK_SITE.url('/scan.svs'))}",
    ),
    "importFromLink": lambda w: Call(
        "POST",
        f"/api/projects/{w.project}/link-imports",
        {"address": LINK_SITE.url("/scan.svs"), "names": ["scan.svs"]},
    ),
    "sortDroppedFiles": lambda w: Call(
        "POST",
        "/api/uploads/sorting",
        {"project_id": str(w.project), "files": [{"path": "S26-1/A1.svs"}]},
    ),
    "applyDroppedFiles": lambda w: Call(
        "POST",
        "/api/uploads/sorting/apply",
        {"project_id": str(w.project), "files": [{"path": "A1.svs"}, {"path": "A1.geojson"}]},
    ),
    "pairUploadWithSlide": lambda w: Call(
        "PUT", f"/api/uploads/{w.result_upload.id}/slide", {"slide_id": str(w.slide)}
    ),
    "getImportProblems": lambda w: Call("GET", f"/api/uploads/{w.result_upload.id}/problems"),
    "downloadImportProblems": lambda w: Call(
        "GET", f"/api/uploads/{w.result_upload.id}/problems/report"
    ),
    "chooseHowToImport": lambda w: Call(
        "PUT", f"/api/uploads/{w.waiting_result.id}/import-choices", {}
    ),
    "leaveResultOut": lambda w: Call("POST", f"/api/uploads/{w.leftover_result.id}/leave-out"),
    "createProject": lambda _: Call("POST", "/api/projects", {"name": "Matrix project"}),
    "listProjectClasses": lambda w: Call("GET", f"/api/projects/{w.project}/classes"),
    "getOpinionForm": lambda w: Call("GET", f"/api/projects/{w.project}/opinion-form"),
    "getProjectJob": lambda w: Call("GET", f"/api/projects/{w.project}/jobs/{w.job}"),
    "startModelRuns": lambda w: Call(
        "POST",
        f"/api/projects/{w.project}/model-runs",
        {
            "slide_ids": [str(w.slide)],
            "scope": {"kind": "slide"},
            "parameters": {"detector": {"name": "matrix-detector", "version": "1"}},
        },
    ),
    "listModelRuns": lambda w: Call("GET", f"/api/projects/{w.project}/model-runs"),
    "listProjectModels": lambda w: Call("GET", f"/api/projects/{w.project}/models"),
    "getModelRun": lambda w: Call("GET", f"/api/projects/{w.project}/model-runs/{w.queued_run}"),
    "listModelRunAreas": lambda w: Call(
        "GET", f"/api/projects/{w.project}/model-runs/{w.queued_run}/areas"
    ),
    "cancelModelRun": lambda w: Call(
        "POST", f"/api/projects/{w.project}/model-runs/{w.queued_run}/cancel"
    ),
    "resumeModelRun": lambda w: Call(
        "POST", f"/api/projects/{w.project}/model-runs/{w.paused_run}/resume"
    ),
    "retryModelRun": lambda w: Call(
        "POST", f"/api/projects/{w.project}/model-runs/{w.failed_run}/retry"
    ),
    "listOpinionFormVersions": lambda w: Call(
        "GET", f"/api/projects/{w.project}/opinion-form/versions"
    ),
    "getOpinionFormVersion": lambda w: Call(
        "GET", f"/api/projects/{w.project}/opinion-form/versions/1"
    ),
    "publishOpinionForm": lambda w: Call(
        "PUT",
        f"/api/projects/{w.project}/opinion-form",
        {"questions": [{"kind": "yesno", "key": "fine", "label": "Is it fine?"}]},
    ),
    "setProjectClasses": lambda w: Call(
        "PUT",
        f"/api/projects/{w.project}/classes",
        {"classes": [{"id": str(w.project_class), "key": 1, "name": "Tumor", "colour": "#f87171"}]},
    ),
    "listClassMappings": lambda w: Call("GET", f"/api/projects/{w.project}/class-mappings"),
    "rememberClassMappings": lambda w: Call(
        "PUT",
        f"/api/projects/{w.project}/class-mappings",
        {"mappings": [{"source_name": "Neoplastic", "class_id": str(w.project_class)}]},
    ),
    "resolveClassNames": lambda w: Call(
        "GET", f"/api/projects/{w.project}/class-mappings/resolve?name=Neoplastic"
    ),
    "listProjects": lambda _: Call("GET", "/api/projects"),
    "getProject": lambda w: Call("GET", f"/api/projects/{w.project}"),
    "updateProject": lambda w: Call("PATCH", f"/api/projects/{w.project}", {"colour": 3}),
    "setWorkspaceSettings": lambda _: Call(
        "PUT", "/api/tenant/settings", {"values": {"lock_after_minutes": 20}}
    ),
    "getSecurityContact": lambda _: Call("GET", "/api/tenant/security-contact"),
    "setSecurityContact": lambda _: Call(
        "PUT", "/api/tenant/security-contact", {"email": "security@example.test"}
    ),
    "setModelTier": lambda _: Call(
        "PUT", "/api/tenant/model-tiers/outline/fast", {"name": "hovernet"}
    ),
    "resetModelTier": lambda _: Call("DELETE", "/api/tenant/model-tiers/outline/fast"),
    "hideModel": lambda _: Call("PUT", "/api/tenant/hidden-models/hovernet"),
    "showModel": lambda _: Call("DELETE", "/api/tenant/hidden-models/hovernet"),
    "changeProjectPrivacy": lambda w: Call(
        "POST",
        f"/api/projects/{w.spare_project}/privacy-mode",
        {"privacy_mode": "clinical", "reason": "Matrix check"},
    ),
    "archiveProject": lambda w: Call("POST", f"/api/projects/{w.spare_project}/archive"),
    "restoreProject": lambda w: Call("POST", f"/api/projects/{w.spare_project}/restore"),
    "createSampleProject": lambda _: Call("POST", "/api/projects/sample"),
    "deleteProject": lambda w: Call("DELETE", f"/api/projects/{w.sample_project}"),
    "setProjectMember": lambda w: Call(
        "PUT", f"/api/projects/{w.project}/members/{w.colleague}", {"role": "viewer"}
    ),
    "removeProjectMember": lambda w: Call(
        "DELETE", f"/api/projects/{w.project}/members/{w.colleague}"
    ),
    "setProjectMemberSignOut": lambda w: Call(
        "PUT", f"/api/projects/{w.project}/members/{w.colleague}/sign-out", {"sign_out": "never"}
    ),
    "getCase": lambda w: Call("GET", f"/api/cases/{w.case}"),
    "createCaseReport": lambda w: Call("POST", case_report(w, "report-fresh")),
    "getCaseReport": lambda w: Call("GET", case_report(w)),
    "getCaseReportVersion": lambda w: Call("GET", f"{case_report(w, 'report-signed')}/versions/1"),
    "downloadCaseReportPdf": lambda w: Call(
        "GET", f"{case_report(w, 'report-signed')}/versions/1/pdf"
    ),
    "updateCaseReport": lambda w: Call("PATCH", case_report(w), {"comment": "Matrix"}),
    "addCaseReportDeposit": lambda w: Call(
        "POST",
        f"{case_report(w)}/deposits",
        {"slide_id": str(seeded(w, "report-slide")), "size_mm": 1.0},
    ),
    "removeCaseReportDeposit": lambda w: Call(
        "DELETE", f"{case_report(w)}/deposits/{seeded(w, 'report-deposit')}"
    ),
    "sendCaseReportForCosign": lambda w: Call(
        "POST",
        f"{case_report(w, 'report-send')}/send",
        {"cosigner_user_id": str(w.deputy)},
    ),
    "returnCaseReport": lambda w: Call(
        "POST", f"{case_report(w, 'report-sent')}/return", {"note": "Matrix return note"}
    ),
    "withdrawCaseReport": lambda w: Call("POST", f"{case_report(w, 'report-withdraw')}/withdraw"),
    "signCaseReport": lambda w: Call("POST", f"{case_report(w, 'report-sign')}/sign"),
    "amendCaseReport": lambda w: Call(
        "POST",
        f"{case_report(w, 'report-signed')}/amendments",
        {"reason": "Matrix amendment", "change": {"comment": "Matrix"}},
    ),
    "getRestrictedImage": lambda w: Call("GET", f"/api/slides/{w.slide}/restricted-images/label"),
    "getTileAccess": lambda w: Call("GET", f"/api/slides/{w.slide}/tile-access"),
    "getSlideCoverage": lambda w: Call("GET", f"/api/slides/{w.slide}/coverage"),
    "getSlideTissue": lambda w: Call("GET", f"/api/slides/{w.slide}/tissue"),
    "recordSlideCoverage": lambda w: Call(
        "POST",
        f"/api/slides/{w.slide}/coverage",
        {"grid": {"cell": 64, "columns": 64, "rows": 32}, "cells": [0, 1]},
    ),
    "requestEmergencyAccess": lambda w: Call(
        "POST",
        f"/api/projects/{w.outside_project}/emergency-access",
        {"reason": "Matrix check of access"},
    ),
    "listCases": lambda _: Call("GET", "/api/cases"),
    "listAnnotations": lambda w: Call("GET", w.annotations),
    "getAnnotation": lambda w: Call("GET", f"{w.annotations}/{w.annotation}"),
    "listAnnotationHistory": lambda w: Call("GET", f"{w.annotations}/{w.annotation}/history"),
    "createAnnotation": lambda w: Call("POST", w.annotations, {"kind": "roi", "geometry": SQUARE}),
    "createAnnotations": lambda w: Call(
        "POST", f"{w.annotations}/bulk", {"annotations": [{"kind": "roi", "geometry": SQUARE}]}
    ),
    "changeAnnotation": lambda w: Call(
        "PATCH", f"{w.annotations}/{w.annotation}", {"version": 1, "geometry": SQUARE}
    ),
    "deleteAnnotation": lambda w: Call(
        "DELETE", f"{w.annotations}/{w.doomed_annotation}?version=1"
    ),
    "restoreAnnotation": lambda w: Call(
        "POST", f"{w.annotations}/{w.deleted_annotation}/restore", {"version": 2}
    ),
    "listSlideResultSets": lambda w: Call("GET", f"/api/slides/{w.slide}/result-sets"),
    "listSlideAreas": lambda w: Call("GET", f"/api/slides/{w.slide}/areas"),
    "listProjectResultSets": lambda w: Call("GET", f"/api/projects/{w.project}/result-sets"),
    "getResultSet": lambda w: Call("GET", f"/api/result-sets/{w.result_set}"),
    "getCellSummary": lambda w: Call("GET", f"/api/result-sets/{w.result_set}/cell-summary"),
    "exportSlideObjects": lambda w: Call(
        "GET", f"/api/slides/{w.slide}/export?format=flatgeobuf&result_set_id={w.result_set}"
    ),
    "createResultSet": lambda w: Call(
        "POST", f"/api/slides/{w.slide}/result-sets", {"name": "Matrix model"}
    ),
    "deleteResultSet": lambda w: Call("DELETE", f"/api/result-sets/{w.doomed_result_set}"),
    "listReviewTasks": lambda w: Call("GET", f"/api/projects/{w.project}/review-tasks"),
    "getReviewTask": lambda w: Call("GET", f"/api/review-tasks/{w.task}"),
    "createReviewTask": lambda w: Call(
        "POST",
        f"/api/projects/{w.project}/review-tasks",
        {
            "name": "Matrix task",
            "slide_ids": [str(w.slide)],
            "result_sets": [{"slide_id": str(w.slide), "result_set_id": str(w.result_set)}],
            "reviewer_ids": [str(w.lead)],
            "split": "everyone",
            "scope": {"kind": "all-regions"},
        },
    ),
    "getReviewedLayer": lambda w: Call("GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/layer"),
    "getSharedLayer": lambda w: Call("GET", w.shared_layer),
    "listSharedObjectHistory": lambda w: Call(
        "GET", f"{w.shared_layer}/objects/{w.layer_object}/history"
    ),
    "createSharedObject": lambda w: Call(
        "POST", f"{w.shared_layer}/objects", {"kind": "region", "geometry": SQUARE}
    ),
    "importSharedObjects": lambda w: Call(
        "POST",
        f"{w.shared_layer}/imports",
        {"file_name": "case.geojson", "content": {"type": "Feature", "geometry": SQUARE}},
    ),
    "changeAiObject": lambda w: Call("PUT", f"{w.shared_layer}/ai/T1", {"deleted": True}),
    "confirmAiObject": lambda w: Call("POST", f"{w.shared_layer}/ai/T2/confirm", {}),
    "undoAiConfirm": lambda w: Call("DELETE", f"{w.shared_layer}/ai/T3/confirm?version=1"),
    "addRunToTaskSlide": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.annotate_task}/slides/{w.slide}/runs",
        {"result_set_id": str(w.result_set)},
    ),
    "changeSharedObject": lambda w: Call(
        "PATCH", f"{w.shared_layer}/objects/{w.layer_object}", {"version": 1, "geometry": SQUARE}
    ),
    "deleteSharedObject": lambda w: Call(
        "DELETE", f"{w.shared_layer}/objects/{w.doomed_layer_object}?version=1"
    ),
    "getAnnotateSlideStatus": lambda w: Call(
        "GET", f"/api/review-tasks/{w.annotate_task}/slides/{w.slide}/check-status"
    ),
    "checkAnnotateSlide": lambda w: Call(
        "POST", f"/api/review-tasks/{w.annotate_task}/slides/{w.slide}/check"
    ),
    "uncheckAnnotateSlide": lambda w: Call(
        "POST", f"/api/review-tasks/{w.checked_annotate_task}/slides/{w.slide}/uncheck"
    ),
    "signOffAnnotateSlide": lambda w: Call(
        "POST", f"/api/review-tasks/{w.ready_annotate_task}/slides/{w.slide}/sign-off"
    ),
    "search": lambda _: Call("GET", "/api/search?q=A1"),
    "getSlideNeighbours": lambda w: Call(
        "GET", f"/api/slides/{w.slide}/neighbours?from=task&task_id={w.task}&skip_submitted=false"
    ),
    "exportReviewedLayer": lambda w: Call(
        "GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/export"
    ),
    "saveReviewEdit": lambda w: Call(
        "PUT", f"/api/review-tasks/{w.task}/slides/{w.slide}/edits/T1", {"deleted": True}
    ),
    "clearReviewEdit": lambda w: Call(
        "DELETE", f"/api/review-tasks/{w.task}/slides/{w.slide}/edits/T1"
    ),
    "splitReviewObject": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.task}/slides/{w.slide}/edits/T2/split",
        {"parts": [{"geometry": SQUARE}, {"geometry": SQUARE}]},
    ),
    "mergeReviewObjects": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.task}/slides/{w.slide}/merges",
        {"objects": ["T2", "T3"], "geometry": SQUARE},
    ),
    "resolveReviewObject": lambda w: Call(
        "GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/objects/T1"
    ),
    "addReviewObject": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.task}/slides/{w.slide}/added",
        {"kind": "region", "geometry": SQUARE},
    ),
    "createAnnouncement": lambda _: Call(
        "POST", "/api/announcements", {"kind": "change", "text": "Matrix announcement"}
    ),
    "endAnnouncement": lambda w: Call("POST", f"/api/announcements/{w.announcement}/end"),
    "recordSiteValidation": lambda _: Call(
        "POST",
        "/api/site-validations",
        {
            "model_name": "matrix-model",
            "model_version": "1",
            "specimen_type": "biopsy",
            "items": [{"positive": True, "score": 0.9}, {"positive": False, "score": 0.1}],
        },
    ),
    "getRetentionPolicy": lambda _: Call("GET", "/api/tenant/retention"),
    "setRetentionPolicy": lambda _: Call("PUT", "/api/tenant/retention", {}),
    "listLegalHolds": lambda _: Call("GET", "/api/tenant/legal-holds"),
    "placeLegalHold": lambda _: Call("POST", "/api/tenant/legal-holds", {"reason": "Matrix hold"}),
    "releaseLegalHold": lambda w: Call("POST", f"/api/tenant/legal-holds/{w.legal_hold}/release"),
    "exportPatientData": lambda w: Call(
        "GET", f"/api/projects/{w.project}/patients/{w.patient}/personal-data"
    ),
    "erasePatient": lambda w: Call(
        "DELETE", f"/api/projects/{w.project}/patients/{w.doomed_patient}"
    ),
    "getTaskEvaluation": lambda w: Call("GET", f"/api/review-tasks/{w.task}/evaluation"),
    "getSignOffSummary": lambda w: Call("GET", f"/api/review-tasks/{w.task}/sign-off-summary"),
    "listEvaluationChanges": lambda w: Call(
        "GET", f"/api/review-tasks/{w.task}/evaluation-changes"
    ),
    "exportTaskEvaluation": lambda w: Call(
        "GET", f"/api/review-tasks/{w.task}/evaluation/exports/objects.csv"
    ),
    "createReportLink": lambda w: Call("POST", f"/api/review-tasks/{w.task}/evaluation/links"),
    "listReportLinks": lambda w: Call("GET", f"/api/review-tasks/{w.task}/evaluation/links"),
    "revokeReportLink": lambda w: Call(
        "DELETE", f"/api/review-tasks/{w.task}/evaluation/links/{w.report_link}"
    ),
    "getOpinion": lambda w: Call("GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/opinion"),
    "submitFirstRead": lambda w: Call(
        "POST", f"/api/review-tasks/{w.hidden_task}/slides/{w.slide}/first-read"
    ),
    "getFirstRead": lambda w: Call(
        "GET",
        f"/api/review-tasks/{w.first_read_task}/slides/{w.slide}/first-read?reviewer_id={w.lead}",
    ),
    "saveOpinion": lambda w: Call(
        "PUT",
        f"/api/review-tasks/{w.task}/slides/{w.slide}/opinion",
        {"answers": {"acceptable": 4}},
    ),
    "decideDisagreement": lambda w: Call(
        "PUT",
        f"/api/review-tasks/{w.queued_task}/disagreements/{w.slide}/T1",
        {"answer": "4"},
    ),
    "clearDisagreementDecision": lambda w: Call(
        "DELETE", f"/api/review-tasks/{w.queued_task}/disagreements/{w.slide}/T1"
    ),
    "leaveDisagreementOpen": lambda w: Call(
        "PUT", f"/api/review-tasks/{w.queued_task}/disagreements/{w.slide}/T1/left-open", {}
    ),
    "askReviewersToLookAgain": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.queued_task}/disagreements/{w.slide}/T2/look-again",
        {"note": "Redrawn"},
    ),
    "keepReviewerDecisions": lambda w: Call(
        "POST", f"/api/review-tasks/{w.queued_task}/disagreements/{w.slide}/T3/keep-decisions"
    ),
    "listAdjudicatorCandidates": lambda w: Call(
        "GET", f"/api/review-tasks/{w.queued_task}/disagreements/adjudicators"
    ),
    "sendToAdjudicator": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.queued_task}/disagreements/adjudications",
        {
            "adjudicator_user_id": str(w.adjudicator),
            "objects": [{"slide_id": str(w.slide), "object": "T4"}],
        },
    ),
    "listMyAdjudications": lambda _: Call("GET", "/api/adjudications"),
    "listAdjudicationObjects": lambda _: Call("GET", "/api/adjudications/objects"),
    "decideAsAdjudicator": lambda w: Call(
        "PUT", f"/api/adjudications/{w.queued_task}/{w.slide}/T10", {"answer": "4"}
    ),
    "declineAdjudication": lambda w: Call(
        "POST", f"/api/adjudications/{w.declinable}/decline", {"note": "Not mine"}
    ),
    "importCases": lambda w: Call(
        "POST", f"/api/projects/{w.project}/case-imports", {"csv": "case\nMatrix", "dry_run": True}
    ),
    "listMyReviewTasks": lambda _: Call("GET", "/api/me/review-tasks"),
    "listMyCosignRequests": lambda _: Call("GET", "/api/me/cosign-requests"),
    "listTasksAssignedByMe": lambda _: Call("GET", "/api/me/assigned-tasks"),
    "listMySlides": lambda _: Call("GET", "/api/me/slides"),
    "listDisagreements": lambda w: Call("GET", f"/api/review-tasks/{w.task}/disagreements"),
    "listVerdicts": lambda w: Call("GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/verdicts"),
    "getReviewOrder": lambda w: Call("GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/order"),
    "saveVerdict": lambda w: Call(
        "PUT", f"/api/review-tasks/{w.task}/slides/{w.slide}/verdicts/T1", {"answer": "4"}
    ),
    "clearVerdict": lambda w: Call(
        "DELETE", f"/api/review-tasks/{w.task}/slides/{w.slide}/verdicts/T1"
    ),
    "getReviewTaskStates": lambda w: Call("GET", f"/api/review-tasks/{w.task}/states"),
    "getMyDisplay": lambda w: Call("GET", f"/api/review-tasks/{w.task}/my-display"),
    "chooseMyDisplay": lambda w: Call(
        "PUT", f"/api/review-tasks/{w.task}/my-display", {"settings": {"width": 3}}
    ),
    "listDisplayPresets": lambda _: Call("GET", "/api/display-presets"),
    "saveDisplayPreset": lambda _: Call(
        "POST", "/api/display-presets", {"name": f"Matrix {uuid.uuid4().hex[:8]}", "settings": {}}
    ),
    "changeDisplayPreset": lambda w: Call(
        "PATCH", f"/api/display-presets/{w.display_preset}", {"settings": {"width": 1}}
    ),
    "deleteDisplayPreset": lambda w: Call("DELETE", f"/api/display-presets/{w.doomed_preset}"),
    "listThreads": lambda w: Call("GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/threads"),
    "listMentionableMembers": lambda w: Call(
        "GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/threads/mentionable"
    ),
    "getThread": lambda w: Call(
        "GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/threads/{w.thread}"
    ),
    "createThread": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.task}/slides/{w.slide}/threads",
        {
            "title": "Matrix",
            "body": "Matrix",
            "anchor": {"kind": "point", "geometry": {"type": "Point", "coordinates": [1, 2]}},
        },
    ),
    "replyToThread": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.task}/slides/{w.slide}/threads/{w.thread}/messages",
        {"body": "Matrix reply"},
    ),
    "resolveThread": lambda w: Call(
        "POST", f"/api/review-tasks/{w.task}/slides/{w.slide}/threads/{w.thread}/resolve"
    ),
    "reopenThread": lambda w: Call(
        "POST", f"/api/review-tasks/{w.task}/slides/{w.slide}/threads/{w.thread}/reopen"
    ),
    "deleteThread": lambda w: Call(
        "DELETE", f"/api/review-tasks/{w.task}/slides/{w.slide}/threads/{w.doomed_thread}"
    ),
    "submitSlideReview": lambda w: Call(
        "POST", f"/api/review-tasks/{w.task}/slides/{w.slide}/submit"
    ),
    "reopenSlideReview": lambda w: Call(
        "POST", f"/api/review-tasks/{w.submitted_task}/slides/{w.slide}/reopen"
    ),
    "signOffReviewTask": lambda w: Call("POST", f"/api/review-tasks/{w.ready_task}/sign-off"),
    "reopenReviewTask": lambda w: Call(
        "POST", f"/api/review-tasks/{w.signed_task}/reopen", {"reason": "Measured again on A1"}
    ),
    "startEvaluationVersion": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.versioned_task}/evaluation-versions",
        {"reason": "Measured again on A1"},
    ),
    "changeReviewTask": lambda w: Call("PATCH", f"/api/review-tasks/{w.task}", {"name": "Renamed"}),
    "addTaskReviewer": lambda w: Call(
        "POST", f"/api/review-tasks/{w.add_task}/reviewers", {"user_id": str(w.lead)}
    ),
    "inviteTaskReviewer": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.add_task}/invitations",
        {"email": f"{uuid.uuid4().hex[:8]}@example.test"},
    ),
    "nudgeReviewer": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.task}/nudges",
        {"user_id": str(w.lead), "message": "Could you fit this in?"},
    ),
    "cancelNudge": lambda w: Call("DELETE", f"/api/review-tasks/{w.task}/nudges/{w.nudge}"),
    "reassignSlides": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.reassign_task}/reassignments",
        {"from_user_id": str(w.colleague), "to_user_id": str(w.lead)},
    ),
    "undoReassignment": lambda w: Call(
        "DELETE", f"/api/review-tasks/{w.undo_task}/reassignments/{w.reassignment}"
    ),
    "createCase": lambda w: Call(
        "POST",
        "/api/cases",
        {
            "project_id": str(w.project),
            "label": f"PM-{uuid.uuid4().hex[:8]}",
            "patient": {"name": "Matrix Patient"},
            "specimens": [{"letter": "A"}],
        },
    ),
    "changeSlideDetails": lambda w: Call(
        "PATCH", f"/api/slides/{w.slide}", {"stain": "PAS", "level": 2}
    ),
    "reorderCaseSlides": lambda w: Call(
        "PUT", f"/api/cases/{w.case}/slide-order", {"slide_ids": []}
    ),
    "listAvailability": lambda _: Call("GET", "/api/tenant/availability"),
    "updateSessionPolicy": lambda _: Call(
        "PUT", "/api/tenant/session-policy", {"idle_lock_minutes": 15, "session_hours": 12}
    ),
    "listInvitations": lambda _: Call("GET", "/api/tenant/invitations"),
    "createInvitation": lambda _: Call(
        "POST",
        "/api/tenant/invitations",
        {"email": f"{uuid.uuid4().hex[:8]}@example.test", "role": "researcher"},
    ),
    "revokeInvitation": lambda w: Call("DELETE", f"/api/tenant/invitations/{w.invitations.pop()}"),
    "resendInvitation": lambda w: Call(
        "POST", f"/api/tenant/invitations/{w.invitations.pop()}/resend"
    ),
    "listServiceAccounts": lambda _: Call("GET", "/api/tenant/service-accounts"),
    "createServiceAccount": lambda _: Call(
        "POST",
        "/api/tenant/service-accounts",
        {"name": f"LIS {uuid.uuid4().hex[:8]}", "scopes": ["create-cases"]},
    ),
    "issueApiToken": lambda w: Call("POST", f"/api/tenant/service-accounts/{w.account}/tokens", {}),
    "revokeApiToken": lambda w: Call(
        "DELETE", f"/api/tenant/service-accounts/{w.account}/tokens/{w.token}"
    ),
    "disableServiceAccount": lambda w: Call(
        "POST", f"/api/tenant/service-accounts/{w.spare_account}/disable"
    ),
    "listAuditEvents": lambda _: Call("GET", "/api/tenant/audit-events"),
    "exportAuditEvents": lambda _: Call("GET", "/api/tenant/audit-events/export"),
    "listAuditSigningKeys": lambda _: Call("GET", "/api/tenant/audit-events/signing-keys"),
    "listTenantMembers": lambda _: Call("GET", "/api/tenant/members"),
    "listMemberActivity": lambda _: Call("GET", "/api/tenant/members/activity"),
    "changeMemberRole": lambda w: Call(
        "PUT", f"/api/tenant/members/{w.colleague}/role", {"role": "reviewer"}
    ),
    "setMemberAdminRights": lambda w: Call(
        "PUT", f"/api/tenant/members/{w.deputy}/admin-rights", {"admin_rights": True}
    ),
}
PLACEHOLDER = Workspace(
    uuid.uuid4(),
    {},
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    "",
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    [uuid.uuid4()],
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
    uuid.uuid4(),
)
MEMBER_CALLS: dict[str, Callable[[Workspace], Call]] = {
    "listAnnouncements": lambda _: Call("GET", "/api/announcements"),
    "listSiteValidations": lambda _: Call("GET", "/api/site-validations"),
    "listModelTiers": lambda _: Call("GET", "/api/tenant/model-tiers"),
    "listModelVisibility": lambda _: Call("GET", "/api/tenant/hidden-models"),
    "getMyHome": lambda _: Call("GET", "/api/me/home"),
    "getCurrentTenant": lambda _: Call("GET", "/api/tenant"),
    "listTaxonomyTemplates": lambda _: Call("GET", "/api/taxonomy-templates"),
    "getOpinionFormTemplate": lambda _: Call("GET", "/api/opinion-form-template"),
    "getResultsSchema": lambda _: Call("GET", "/api/result-formats/parfocal-json/schema"),
    "getResultsTemplate": lambda _: Call("GET", "/api/result-formats/parfocal-json/template"),
    "validateResultsFile": lambda _: Call(
        "POST", "/api/result-formats/parfocal-json/validate", {"content": "{}"}
    ),
    "listNotificationPreferences": lambda _: Call("GET", "/api/me/notification-preferences"),
    "getMySettingLayers": lambda _: Call("GET", "/api/me/setting-layers"),
    "setMySettingLayers": lambda _: Call(
        "PUT", "/api/me/setting-layers", {"values": {"density": "compact"}}
    ),
    "setNotificationPreferences": lambda _: Call(
        "PUT",
        "/api/me/notification-preferences",
        {"preferences": [{"kind": "reply", "in_app": True, "email": False, "realtime": True}]},
    ),
    "listNotifications": lambda _: Call("GET", "/api/me/notifications?read=false"),
    "getNotificationCounts": lambda _: Call("GET", "/api/me/notifications/counts"),
    "markNotificationsRead": lambda _: Call(
        "POST", "/api/me/notifications/read", {"ids": [str(uuid.uuid4())]}
    ),
    "listNotificationMutes": lambda _: Call("GET", "/api/me/notification-mutes"),
    "unmuteNotifications": lambda w: Call(
        "DELETE", f"/api/me/notification-mutes/project/{w.project}"
    ),
    "getSessionPolicy": lambda _: Call("GET", "/api/tenant/session-policy"),
    "getMyAvailability": lambda _: Call("GET", "/api/me/availability"),
    "setMyAvailability": lambda _: Call("PUT", "/api/me/availability", {"status": "available"}),
}


@cache
def operations() -> dict[str, dict[str, Any]]:
    schema = openapi_schema()
    return {
        operation["operationId"]: operation
        for path in schema["paths"].values()
        for operation in path.values()
    }


@cache
def guarded_operations() -> dict[str, Permission]:
    return {
        name: Permission(operation["x-permission"])
        for name, operation in operations().items()
        if "x-permission" in operation
    }


WRITES = {
    name
    for name, call in GUARDED_CALLS.items()
    if call(replace(PLACEHOLDER, invitations=[uuid.uuid4()])).method != "GET"
}


def writes() -> set[str]:
    return {name for name, operation in operations().items() if operation.get("x-permission-write")}


def test_the_matrix_covers_every_permission_for_every_role() -> None:
    assert set(COLUMNS) == set(Role) == {Role.RESEARCHER, Role.REVIEWER}
    assert set(MATRIX) == set(Permission)
    for grants in MATRIX.values():
        assert set(grants) == set(Role)
    assert set(Grant) == {Grant.ALL, Grant.ASSIGNED, Grant.VIEW_ONLY, Grant.EMERGENCY, Grant.NONE}


def test_admin_rights_add_only_the_setup_permissions() -> None:
    assert {
        Permission.PRIVACY_MODE,
        Permission.MANAGE_PEOPLE,
        Permission.WORKSPACE_SETTINGS,
        Permission.INTEGRATIONS,
        Permission.REPORT_TEMPLATES,
        Permission.AUDIT_LOG,
    } == ADMIN_RIGHTS
    for permission in Permission:
        plain = grant_for(Role.RESEARCHER, permission)
        held = grant_for(Role.RESEARCHER, permission, admin_rights=True)
        assert held is (Grant.ALL if permission in ADMIN_RIGHTS else plain)
        assert grant_for(Role.REVIEWER, permission, admin_rights=True) is grant_for(
            Role.REVIEWER, permission
        )


def test_admin_rights_add_no_access_to_project_data() -> None:
    for permission in (
        Permission.SEE_SLIDES,
        Permission.EMERGENCY_ACCESS,
        Permission.CREATE_CASES,
        Permission.UPLOAD_SLIDES,
        Permission.MOVE_SLIDES,
        Permission.REVIEW,
    ):
        assert permission not in ADMIN_RIGHTS
    assert grant_for(Role.RESEARCHER, Permission.EMERGENCY_ACCESS, admin_rights=True) is (
        Grant.EMERGENCY
    )


def test_the_permission_page_is_current() -> None:
    assert Path(DOC_PATH).read_text() == render()


def test_every_operation_declares_a_permission_or_why_it_is_open() -> None:
    every = operations()
    guarded = guarded_operations()
    assert set(every) == set(guarded) | set(OPEN_OPERATIONS)
    assert not set(guarded) & set(OPEN_OPERATIONS)
    assert set(guarded) == set(GUARDED_CALLS)
    assert writes() == WRITES
    member_open = {name for name, reason in OPEN_OPERATIONS.items() if reason == "member"}
    assert member_open == set(MEMBER_CALLS)


async def add_person(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    subject: str,
    role: Role,
    *,
    admin_rights: bool = False,
) -> uuid.UUID:
    user_id = await connection.scalar(
        insert(users)
        .values(subject=subject, display_name=subject, initials="PP", avatar_colour=1)
        .returning(users.c.id)
    )
    assert isinstance(user_id, uuid.UUID)
    await connection.execute(
        insert(memberships).values(
            tenant_id=tenant_id, user_id=user_id, role=role, admin_rights=admin_rights
        )
    )
    return user_id


async def seed_annotation(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    number: int,
) -> uuid.UUID:
    annotation_id = await connection.scalar(
        insert(annotations)
        .values(
            tenant_id=tenant_id,
            project_id=project_id,
            slide_id=slide_id,
            kind="roi",
            number=number,
            geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
        )
        .returning(annotations.c.id)
    )
    assert isinstance(annotation_id, uuid.UUID)
    return annotation_id


async def seed_annotate_task(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    result_set_id: uuid.UUID,
    user_id: uuid.UUID,
    number: int = 90,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    task_id = await connection.scalar(
        insert(review_tasks)
        .values(
            tenant_id=tenant_id,
            project_id=project_id,
            number=number,
            name="Seeded annotate task",
            kind="annotate",
            class_snapshot=[],
            split="everyone",
            scope="whole-slide",
            opinion_form_version=1,
            start_mode="guided",
        )
        .returning(review_tasks.c.id)
    )
    assert isinstance(task_id, uuid.UUID)
    await connection.execute(
        insert(review_task_slides).values(
            tenant_id=tenant_id,
            project_id=project_id,
            task_id=task_id,
            slide_id=slide_id,
            position=0,
            kind="annotate",
            result_set_id=result_set_id,
        )
    )
    await connection.execute(
        insert(review_assignments).values(
            tenant_id=tenant_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=user_id,
            submitted_at=None if number == 90 else func.now(),
        )
    )
    kept, doomed = [
        await connection.scalar(
            insert(annotations)
            .values(
                tenant_id=tenant_id,
                project_id=project_id,
                slide_id=slide_id,
                task_id=task_id,
                kind="region",
                number=object_number,
                geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
                created_by_user_id=user_id,
            )
            .returning(annotations.c.id)
        )
        for object_number in (number * 2 - 90, number * 2 - 89)
    ]
    assert isinstance(kept, uuid.UUID)
    assert isinstance(doomed, uuid.UUID)
    await connection.execute(
        insert(annotations).values(
            tenant_id=tenant_id,
            project_id=project_id,
            slide_id=slide_id,
            task_id=task_id,
            kind="region",
            number=5000 + number,
            geometry=func.ST_GeomFromText("POLYGON((0 0,9 0,9 9,0 9,0 0))", 0),
            origin="ai-confirmed",
            source_number=3,
            created_by_user_id=user_id,
        )
    )
    return task_id, kept, doomed


async def seed_thread(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    task_id: uuid.UUID,
    slide_id: uuid.UUID,
    user_id: uuid.UUID,
) -> uuid.UUID:
    thread_id = await connection.scalar(
        insert(threads)
        .values(
            tenant_id=tenant_id,
            project_id=project_id,
            task_id=task_id,
            slide_id=slide_id,
            title="Matrix thread",
            anchor_kind="point",
            geometry={"type": "Point", "coordinates": [1, 2]},
            created_by_user_id=user_id,
        )
        .returning(threads.c.id)
    )
    assert isinstance(thread_id, uuid.UUID)
    await connection.execute(
        insert(thread_messages).values(
            tenant_id=tenant_id, thread_id=thread_id, user_id=user_id, body="Matrix message"
        )
    )
    return thread_id


async def seed_task(
    connection: AsyncConnection,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    slide_id: uuid.UUID,
    result_set_id: uuid.UUID,
    user_id: uuid.UUID,
    number: int,
    *,
    signed: bool,
    hidden: bool = False,
    submitted: bool = True,
    first_read: bool = False,
) -> uuid.UUID:
    task_id = await connection.scalar(
        insert(review_tasks)
        .values(
            tenant_id=tenant_id,
            project_id=project_id,
            number=number,
            name=f"Seeded task {number}",
            split="everyone",
            scope="all-regions",
            opinion_form_version=1,
            start_mode="guided",
            ai_hidden_first_read=hidden,
            signed_off_at=func.now() if signed else None,
        )
        .returning(review_tasks.c.id)
    )
    assert isinstance(task_id, uuid.UUID)
    await connection.execute(
        insert(review_task_slides).values(
            tenant_id=tenant_id,
            project_id=project_id,
            task_id=task_id,
            slide_id=slide_id,
            position=0,
            result_set_id=result_set_id,
        )
    )
    await connection.execute(
        insert(review_assignments).values(
            tenant_id=tenant_id,
            task_id=task_id,
            slide_id=slide_id,
            user_id=user_id,
            submitted_at=func.now() if submitted else None,
            first_read_at=func.now() if first_read else None,
            first_read={"form_version": 1, "answers": {}, "added": []} if first_read else None,
        )
    )
    return task_id


async def seed_presets(
    connection: AsyncConnection, tenant_id: uuid.UUID, user_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID]:
    made = [
        await connection.scalar(
            insert(display_presets)
            .values(tenant_id=tenant_id, user_id=user_id, name=name, settings={})
            .returning(display_presets.c.id)
        )
        for name in ("Matrix kept", "Matrix doomed")
    ]
    kept, doomed = [uuid.UUID(str(made_id)) for made_id in made]
    return kept, doomed


async def seed(database: str, lead: Seat = RESEARCHER, presets_for: Seat = RESEARCHER) -> Workspace:
    engine = create_async_engine(async_database_url(with_database(OWNER_URL, database)))
    slug = f"perm-{uuid.uuid4().hex[:10]}"
    try:
        async with engine.begin() as connection:
            organisation_id = await connection.scalar(
                insert(organisations).values(slug=slug, name=slug).returning(organisations.c.id)
            )
            tenant_id = await connection.scalar(
                insert(tenants)
                .values(
                    organisation_id=organisation_id,
                    slug=slug,
                    name=slug,
                    kind="diagnostic",
                    region="eu",
                    plan="pilot",
                )
                .returning(tenants.c.id)
            )
            assert isinstance(tenant_id, uuid.UUID)
            people = {
                seat: await add_person(
                    connection,
                    tenant_id,
                    f"{slug}-{seat}",
                    seat.role,
                    admin_rights=seat.admin_rights,
                )
                for seat in SEATS
            }
            colleague = await add_person(connection, tenant_id, f"{slug}-colleague", Role.REVIEWER)
            deputy = await add_person(connection, tenant_id, f"{slug}-deputy", Role.RESEARCHER)
            adjudicator = await add_person(
                connection, tenant_id, f"{slug}-adjudicator", Role.REVIEWER
            )
            account, spare_account = [
                await connection.scalar(
                    insert(service_accounts)
                    .values(tenant_id=tenant_id, name=name, scopes=["create-cases"])
                    .returning(service_accounts.c.id)
                )
                for name in ("Permission check", "Spare")
            ]
            token = await connection.scalar(
                insert(api_tokens)
                .values(
                    tenant_id=tenant_id,
                    service_account_id=account,
                    token_hash=uuid.uuid4().bytes,
                    expires_at=func.now(),
                )
                .returning(api_tokens.c.id)
            )
            pending = [
                await connection.scalar(
                    insert(invitations)
                    .values(
                        tenant_id=tenant_id,
                        email=f"pending-{index}@example.test",
                        role="researcher",
                        token_hash=uuid.uuid4().bytes,
                        expires_at=func.now(),
                    )
                    .returning(invitations.c.id)
                )
                for index in range(2 * len(SEATS))
            ]
            case = await seed_case(connection, tenant_id)
            doomed_patient = await add_patient(
                connection,
                await ensure_keys(connection, TEST_KEYRING, tenant_id),
                case.project_id,
                PatientIdentity("Doomed Patient"),
            )
            spare_project = await seed_project(connection, tenant_id)
            await connection.execute(
                insert(workspace_settings).values(
                    tenant_id=tenant_id, security_contact="security@example.test"
                )
            )
            sample_project = await seed_project(connection, tenant_id)
            await connection.execute(
                update(projects).where(projects.c.id == sample_project).values(sample=True)
            )
            outside_project = await seed_project(connection, tenant_id)
            project_class = await connection.scalar(
                insert(project_classes)
                .values(
                    tenant_id=tenant_id,
                    project_id=case.project_id,
                    key=1,
                    name="Tumor",
                    colour="#f87171",
                )
                .returning(project_classes.c.id)
            )
            assert isinstance(project_class, uuid.UUID)
            job = await enqueue(connection, INGEST, tenant_id, case.project_id)
            annotation, doomed_annotation, deleted_annotation = [
                await seed_annotation(
                    connection, tenant_id, case.project_id, case.loose_slide_id, n
                )
                for n in (1, 2, 3)
            ]
            result_set, doomed_result_set = [
                await connection.scalar(
                    insert(result_sets)
                    .values(
                        tenant_id=tenant_id,
                        project_id=case.project_id,
                        slide_id=case.loose_slide_id,
                        name=name,
                        source="import",
                    )
                    .returning(result_sets.c.id)
                )
                for name in ("Matrix set", "Doomed set")
            ]
            await connection.execute(
                insert(result_objects),
                [
                    {
                        "tenant_id": tenant_id,
                        "result_set_id": result_set,
                        "kind": "region",
                        "number": number,
                        "geometry": "SRID=0;POLYGON((0 0,9 0,9 9,0 9,0 0))",
                    }
                    for number in (1, 2, 3)
                ],
            )
            await connection.execute(
                update(result_sets).where(result_sets.c.id == result_set).values(cell_count=1)
            )
            await connection.execute(
                update(result_sets)
                .where(result_sets.c.id.in_([result_set, doomed_result_set]))
                .values(status="ready", region_count=1)
            )
            task = await connection.scalar(
                insert(review_tasks)
                .values(
                    tenant_id=tenant_id,
                    project_id=case.project_id,
                    number=1,
                    name="Seeded task",
                    split="everyone",
                    scope="all-regions",
                    opinion_form_version=1,
                    start_mode="guided",
                )
                .returning(review_tasks.c.id)
            )
            await connection.execute(
                insert(review_task_slides).values(
                    tenant_id=tenant_id,
                    project_id=case.project_id,
                    task_id=task,
                    slide_id=case.loose_slide_id,
                    position=0,
                    result_set_id=result_set,
                )
            )
            await connection.execute(
                insert(review_assignments).values(
                    tenant_id=tenant_id,
                    task_id=task,
                    slide_id=case.loose_slide_id,
                    user_id=people[lead],
                )
            )
            assert isinstance(result_set, uuid.UUID)
            annotate_task, layer_object, doomed_layer_object = await seed_annotate_task(
                connection,
                tenant_id,
                case.project_id,
                case.loose_slide_id,
                result_set,
                people[lead],
            )
            checked_annotate_task, ready_annotate_task = [
                (
                    await seed_annotate_task(
                        connection,
                        tenant_id,
                        case.project_id,
                        case.loose_slide_id,
                        result_set,
                        people[lead],
                        number,
                    )
                )[0]
                for number in (91, 92)
            ]
            submitted_task, ready_task, signed_task, versioned_task = [
                await seed_task(
                    connection,
                    tenant_id,
                    case.project_id,
                    case.loose_slide_id,
                    result_set,
                    people[lead],
                    number,
                    signed=number in (4, 11),
                )
                for number in (2, 3, 4, 11)
            ]
            queued_task = await seed_task(
                connection,
                tenant_id,
                case.project_id,
                case.loose_slide_id,
                result_set,
                people[lead],
                5,
                signed=False,
            )
            hidden_task, first_read_task = [
                await seed_task(
                    connection,
                    tenant_id,
                    case.project_id,
                    case.loose_slide_id,
                    result_set,
                    people[lead],
                    number,
                    signed=False,
                    hidden=True,
                    submitted=False,
                    first_read=number == 7,
                )
                for number in (6, 7)
            ]
            reassign_task, undo_task, add_task = [
                await seed_task(
                    connection,
                    tenant_id,
                    case.project_id,
                    case.loose_slide_id,
                    result_set,
                    people[lead] if number == 9 else colleague,
                    number,
                    signed=False,
                    submitted=False,
                )
                for number in (8, 9, 10)
            ]
            reassignment = await connection.scalar(
                insert(task_reassignments)
                .values(
                    tenant_id=tenant_id,
                    task_id=undo_task,
                    from_user_id=colleague,
                    to_user_id=people[lead],
                    what="not-started",
                    slide_ids=[case.loose_slide_id],
                    kept_slide_ids=[],
                )
                .returning(task_reassignments.c.id)
            )
            nudge = await connection.scalar(
                insert(task_nudges)
                .values(tenant_id=tenant_id, task_id=task, user_id=people[lead])
                .returning(task_nudges.c.id)
            )
            thread, doomed_thread = [
                await seed_thread(
                    connection,
                    tenant_id,
                    case.project_id,
                    uuid.UUID(str(task)),
                    case.loose_slide_id,
                    people[lead],
                )
                for _ in range(2)
            ]
            kept_preset, doomed_preset = await seed_presets(
                connection, tenant_id, people[presets_for]
            )
            report_link = await connection.scalar(
                insert(report_links)
                .values(
                    tenant_id=tenant_id,
                    task_id=task,
                    token_hash=uuid.uuid4().bytes,
                    expires_at=func.now(),
                )
                .returning(report_links.c.id)
            )
            assert isinstance(report_link, uuid.UUID)
            assert isinstance(reassignment, uuid.UUID)
            assert isinstance(nudge, uuid.UUID)
            await connection.execute(
                insert(verdicts),
                [
                    {
                        "tenant_id": tenant_id,
                        "project_id": case.project_id,
                        "task_id": queued_task,
                        "slide_id": case.loose_slide_id,
                        "user_id": people[lead],
                        "kind": "region",
                        "number": number,
                        "value": "disagree",
                        "style": "certainty",
                        "answer": "1",
                        "reasons": ["not_class"],
                    }
                    for number in (1, 2, 3, 4, 10, 11)
                ],
            )
            sends = [
                await connection.scalar(
                    insert(adjudications)
                    .values(
                        tenant_id=tenant_id,
                        task_id=queued_task,
                        adjudicator_user_id=people[presets_for],
                    )
                    .returning(adjudications.c.id)
                )
                for _ in (10, 11)
            ]
            await connection.execute(
                insert(adjudication_objects),
                [
                    {
                        "adjudication_id": send,
                        "tenant_id": tenant_id,
                        "task_id": queued_task,
                        "slide_id": case.loose_slide_id,
                        "kind": "region",
                        "number": number,
                    }
                    for send, number in zip(sends, (10, 11), strict=True)
                ],
            )
            declinable = sends[1]
            assert isinstance(declinable, uuid.UUID)
            await connection.execute(
                insert(review_edits),
                [
                    {
                        "tenant_id": tenant_id,
                        "project_id": case.project_id,
                        "task_id": queued_task,
                        "slide_id": case.loose_slide_id,
                        "user_id": people[lead],
                        "kind": "region",
                        "number": number,
                        "geometry": "SRID=0;POLYGON((0 0,8 0,8 8,0 8,0 0))",
                        "updated_at": datetime(2999, 1, 1, tzinfo=UTC),
                    }
                    for number in (2, 3)
                ],
            )
            await connection.execute(
                insert(slide_counters).values(
                    tenant_id=tenant_id, slide_id=case.loose_slide_id, letter="R", last=3
                )
            )
            announcement = await connection.scalar(
                insert(announcements)
                .values(tenant_id=tenant_id, kind="change", text="Matrix announcement")
                .returning(announcements.c.id)
            )
            templates = await seed_built_ins(connection, tenant_id)
            legal_hold = await connection.scalar(
                insert(legal_holds)
                .values(tenant_id=tenant_id, project_id=spare_project, reason="Matrix hold")
                .returning(legal_holds.c.id)
            )
            await connection.execute(
                update(annotations)
                .where(annotations.c.id == deleted_annotation)
                .values(version=2, deleted_at=func.now())
            )
            await connection.execute(
                insert(project_members),
                [
                    {
                        "tenant_id": tenant_id,
                        "project_id": project,
                        "user_id": people[lead],
                        "role": "owner",
                    }
                    for project in (case.project_id, spare_project, sample_project)
                ]
                + [
                    {
                        "tenant_id": tenant_id,
                        "project_id": case.project_id,
                        "user_id": user,
                        "role": role,
                    }
                    for user, role in (
                        (people[REVIEWER], "viewer"),
                        (colleague, "viewer"),
                        (adjudicator, "viewer"),
                    )
                ],
            )
            await seed_case_reports(
                connection, tenant_id, case.project_id, case.case_id, people[lead], deputy
            )
            queued_run, paused_run, failed_run = await seed_runs(
                connection, tenant_id, case.project_id, case.loose_slide_id
            )
            await connection.execute(
                update(slides)
                .where(slides.c.id == case.loose_slide_id)
                .values(restricted_images=[RestrictedImage.LABEL.value], width=4096, height=2048)
            )
            async with httpx2.AsyncClient(timeout=30) as http:
                store = ObjectStore(TEST_STORAGE, http)
                matrix_cells = build_cells(
                    tenant_id,
                    case.loose_slide_id,
                    result_set,
                    [Cell(1, [0, 0, 9, 0, 9, 9, 0, 9], 0, 100)],
                    1,
                )
                await ObjectResultStore(store).put(
                    matrix_cells.summary.key, matrix_cells.summary.data
                )
                await put_restricted_images(
                    store,
                    tenant_id,
                    case.loose_slide_id,
                    {RestrictedImage.LABEL: stand_in_images(slug)[RestrictedImage.LABEL]},
                )
                await store.put_object(
                    f"{slide_prefix(tenant_id, case.loose_slide_id)}{TISSUE_FILE}",
                    TissueMask(64, 20, np.ones((16, 32), dtype=bool), None).png(),
                    "image/png",
                )
                uploads_made = [
                    await seed_upload(
                        connection,
                        store,
                        tenant_id,
                        case.project_id,
                        people[lead],
                        with_part=with_part,
                        kind=kind,
                    )
                    for with_part, kind in (
                        (False, "slide"),
                        (True, "slide"),
                        (False, "slide"),
                        (False, "result"),
                        (False, "result"),
                        (False, "result"),
                    )
                ]
                waiting: dict[str, list[object]] = {"problems": []}
                for finished, problems in ((uploads_made[4], waiting), (uploads_made[5], None)):
                    await connection.execute(
                        update(uploads)
                        .where(uploads.c.id == finished.id)
                        .values(status="completed", closed_at=func.now(), import_problems=problems)
                    )
        assert isinstance(tenant_id, uuid.UUID)
        assert isinstance(account, uuid.UUID)
        assert isinstance(token, uuid.UUID)
        assert isinstance(spare_account, uuid.UUID)
        assert isinstance(result_set, uuid.UUID)
        assert isinstance(doomed_result_set, uuid.UUID)
        assert isinstance(task, uuid.UUID)
        assert isinstance(announcement, uuid.UUID)
        assert isinstance(legal_hold, uuid.UUID)
        ids = [invitation for invitation in pending if isinstance(invitation, uuid.UUID)]
        return Workspace(
            tenant_id,
            people,
            colleague,
            deputy,
            people[lead],
            slug,
            account,
            token,
            spare_account,
            ids,
            case.case_id,
            case.project_id,
            spare_project,
            sample_project,
            outside_project,
            project_class,
            job,
            case.loose_slide_id,
            annotation,
            doomed_annotation,
            deleted_annotation,
            result_set,
            doomed_result_set,
            task,
            submitted_task,
            ready_task,
            signed_task,
            versioned_task,
            queued_task,
            hidden_task,
            first_read_task,
            nudge,
            reassign_task,
            undo_task,
            reassignment,
            add_task,
            announcement,
            legal_hold,
            case.patient_id,
            doomed_patient,
            templates[BuiltInTemplate.DETECTION],
            templates[BuiltInTemplate.SEGMENTATION],
            queued_run,
            paused_run,
            failed_run,
            thread,
            doomed_thread,
            *uploads_made,
            display_preset=kept_preset,
            doomed_preset=doomed_preset,
            declinable=declinable,
            adjudicator=adjudicator,
            report_link=report_link,
            annotate_task=annotate_task,
            checked_annotate_task=checked_annotate_task,
            ready_annotate_task=ready_annotate_task,
            layer_object=layer_object,
            doomed_layer_object=doomed_layer_object,
        )
    finally:
        await engine.dispose()


async def seed_runs(
    connection: AsyncConnection, tenant_id: uuid.UUID, project_id: uuid.UUID, slide_id: uuid.UUID
) -> list[uuid.UUID]:
    settings = RunSettings(RunScopeKind.SLIDE, None, "matrix-detector", "1")
    runs = [
        await enqueue_model_run(
            connection, tenant_id, project_id, slide_id, settings, batch_id=uuid.uuid4()
        )
        for _ in range(3)
    ]
    await connection.execute(
        update(jobs).where(jobs.c.id == runs[1]).values(status="paused", pause_reason="matrix")
    )
    await connection.execute(
        update(jobs).where(jobs.c.id == runs[2]).values(status="failed", error_code="matrix")
    )
    return runs


async def seed_upload(
    connection: AsyncConnection,
    store: ObjectStore,
    tenant_id: uuid.UUID,
    project_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    with_part: bool,
    kind: str,
) -> SeededUpload:
    upload_id = uuid.uuid4()
    key = f"t/{tenant_id}/quarantine/{upload_id}/Matrix_slide.svs"
    storage_upload_id = await store.create_multipart_upload(key)
    etag = "0"
    if with_part:
        stored = await store.http.put(
            store.presign_part(key, storage_upload_id, 1, 60), content=UPLOAD_BYTES
        )
        etag = stored.headers["etag"].strip('"')
    await connection.execute(
        insert(uploads).values(
            id=upload_id,
            tenant_id=tenant_id,
            project_id=project_id,
            created_by_user_id=user_id,
            file_name=UPLOAD_NAME,
            size_bytes=len(UPLOAD_BYTES),
            last_modified_ms=1,
            object_key=key,
            storage_upload_id=storage_upload_id,
            part_bytes=TEST_PART_BYTES,
            part_count=1,
            kind=kind,
            result_format="geojson" if kind == "result" else None,
        )
    )
    return SeededUpload(upload_id, key, etag)


@pytest.fixture(scope="module")
def workspaces(database: str, storage: StorageLocation) -> dict[Seat, Workspace]:
    assert storage.bucket
    return {
        seat: asyncio.run(
            seed(database, seat if seat.role is Role.RESEARCHER else RESEARCHER, seat)
        )
        for seat in SEATS
    }


@pytest.fixture(scope="module")
def workspace(workspaces: dict[Seat, Workspace]) -> Workspace:
    return workspaces[RESEARCHER]


def principal_for(workspace: Workspace, seat: Seat) -> Principal:
    subject = f"{workspace.slug}-{seat}"
    return MemberPrincipal(
        subject, workspace.tenant_id, workspace.users[seat], seat.role, seat.admin_rights
    )


def send(api: ApiAs, principal: Principal, call: Call) -> int:
    response = api(principal).request(call.method, call.path, json=call.body)
    return response.status_code


GUARDED_CASES = [(operation, seat) for operation in sorted(GUARDED_CALLS) for seat in SEATS]


@pytest.mark.db
@pytest.mark.parametrize(("operation", "seat"), GUARDED_CASES, ids=str)
def test_every_guarded_endpoint_follows_the_matrix_for_every_role(
    api: ApiAs,
    workspaces: dict[Seat, Workspace],
    operation: str,
    seat: Seat,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    if operation in LINK_OPERATIONS:
        trust_link_site(api, monkeypatch)
    permission = guarded_operations()[operation]
    workspace = workspaces[seat]
    status = send(api, principal_for(workspace, seat), GUARDED_CALLS[operation](workspace))
    grant = grant_for(seat.role, permission, admin_rights=seat.admin_rights)
    if (
        (grant is Grant.ASSIGNED and operation in NEEDS_A_TASK)
        or grant is Grant.NONE
        or (operation in WRITES and grant is Grant.VIEW_ONLY)
    ):
        assert status == 403
    else:
        assert 200 <= status < 300


@pytest.mark.db
@pytest.mark.parametrize(
    ("operation", "seat"),
    [(name, seat) for name in sorted(MEMBER_CALLS) for seat in SEATS],
    ids=str,
)
def test_every_member_endpoint_is_open_to_every_member_role(
    api: ApiAs, workspace: Workspace, operation: str, seat: Seat
) -> None:
    assert send(api, principal_for(workspace, seat), MEMBER_CALLS[operation](workspace)) == 200


@pytest.mark.db
def test_nobody_changes_their_own_role(api: ApiAs, workspace: Workspace) -> None:
    admin = principal_for(workspace, ADMIN)
    response = api(admin).put(
        f"/api/tenant/members/{workspace.users[ADMIN]}/role", json={"role": "reviewer"}
    )
    assert (response.status_code, response.json()["code"]) == (409, "own-role")


@pytest.mark.db
def test_a_role_change_takes_effect_and_rejects_unknown_roles(
    api: ApiAs, workspace: Workspace
) -> None:
    admin = principal_for(workspace, ADMIN)
    path = f"/api/tenant/members/{workspace.colleague}/role"
    changed = api(admin).put(path, json={"role": "researcher"})
    assert (changed.status_code, changed.json()["role"]) == (200, "researcher")
    assert api(admin).put(path, json={"role": "outside-consultant"}).status_code == 422
    unknown = api(admin).put(
        f"/api/tenant/members/{uuid.uuid4()}/role", json={"role": "researcher"}
    )
    assert unknown.status_code == 404
    api(admin).put(path, json={"role": "reviewer"})


WORKSPACE_CALLS = GUARDED_CALLS | MEMBER_CALLS


@pytest.mark.db
@pytest.mark.parametrize("operation", sorted(WORKSPACE_CALLS))
def test_workspace_routes_refuse_people_without_a_membership(api: ApiAs, operation: str) -> None:
    outsider = SignedInUser("outsider", uuid.uuid4())
    placeholder = replace(PLACEHOLDER, invitations=[uuid.uuid4()])
    assert send(api, outsider, WORKSPACE_CALLS[operation](placeholder)) == 403


def tenant_fingerprint(database: str, tenant_id: uuid.UUID) -> dict[str, str]:
    tables = [table.name for table in metadata.sorted_tables if "tenant_id" in table.c]
    return {
        name: str(
            query(
                with_database(OWNER_URL, database),
                f"SELECT md5(coalesce(string_agg(t::text, ',' ORDER BY t::text), '')) "
                f"FROM {name} t WHERE tenant_id = '{tenant_id}'",
            )[0][0]
        )
        for name in tables
    }


@pytest.mark.db
@pytest.mark.usefixtures("storage")
def test_no_call_from_another_workspace_changes_this_one(api: ApiAs, database: str) -> None:
    mine = asyncio.run(seed(database))
    theirs = asyncio.run(seed(database))
    before = tenant_fingerprint(database, mine.tenant_id)
    for operation in sorted(WORKSPACE_CALLS):
        for seat in SEATS:
            call = WORKSPACE_CALLS[operation](replace(mine, invitations=list(mine.invitations)))
            status = send(api, principal_for(theirs, seat), call)
            assert status < 500, (operation, seat, status)
    changed = {
        name
        for name, value in tenant_fingerprint(database, mine.tenant_id).items()
        if value != before[name]
    }
    assert changed == set()
