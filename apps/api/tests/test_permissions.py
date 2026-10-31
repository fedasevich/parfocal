import asyncio
import uuid
from collections.abc import Callable
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

import pytest
from case_support import TEST_KEYRING, seed_case, seed_project
from db_support import OWNER_URL, ApiAs, query, with_database
from sqlalchemy import func, insert, update
from sqlalchemy.ext.asyncio import AsyncConnection, create_async_engine

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
from parfocal_api.tables import (
    Role,
    annotations,
    announcements,
    api_tokens,
    invitations,
    legal_holds,
    memberships,
    organisations,
    project_classes,
    project_members,
    result_objects,
    result_sets,
    review_assignments,
    review_task_slides,
    review_tasks,
    service_accounts,
    slide_counters,
    tenants,
    users,
    verdicts,
)
from parfocal_common.db import async_database_url, metadata
from parfocal_common.jobs import enqueue
from parfocal_ingest.workflow import INGEST

OPEN_OPERATIONS = {
    "getHealth": "public",
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
    "getMyHome": "member",
    "exportMyPersonalData": "signed-in",
    "getNotificationTarget": "own-notification",
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
    queued_task: uuid.UUID
    hidden_task: uuid.UUID
    first_read_task: uuid.UUID
    announcement: uuid.UUID
    legal_hold: uuid.UUID
    patient: uuid.UUID
    doomed_patient: uuid.UUID

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
        "createAnnotation",
        "createAnnotations",
        "changeAnnotation",
        "deleteAnnotation",
        "restoreAnnotation",
        "saveReviewEdit",
        "clearReviewEdit",
        "addReviewObject",
        "submitSlideReview",
        "reopenSlideReview",
        "saveVerdict",
        "clearVerdict",
        "saveOpinion",
        "submitFirstRead",
    }
)
GUARDED_CALLS: dict[str, Callable[[Workspace], Call]] = {
    "createProject": lambda _: Call("POST", "/api/projects", {"name": "Matrix project"}),
    "listProjectClasses": lambda w: Call("GET", f"/api/projects/{w.project}/classes"),
    "getOpinionForm": lambda w: Call("GET", f"/api/projects/{w.project}/opinion-form"),
    "getProjectJob": lambda w: Call("GET", f"/api/projects/{w.project}/jobs/{w.job}"),
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
    "archiveProject": lambda w: Call("POST", f"/api/projects/{w.spare_project}/archive"),
    "restoreProject": lambda w: Call("POST", f"/api/projects/{w.spare_project}/restore"),
    "setProjectMember": lambda w: Call(
        "PUT", f"/api/projects/{w.project}/members/{w.colleague}", {"role": "viewer"}
    ),
    "removeProjectMember": lambda w: Call(
        "DELETE", f"/api/projects/{w.project}/members/{w.colleague}"
    ),
    "getCase": lambda w: Call("GET", f"/api/cases/{w.case}"),
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
    "listProjectResultSets": lambda w: Call("GET", f"/api/projects/{w.project}/result-sets"),
    "getResultSet": lambda w: Call("GET", f"/api/result-sets/{w.result_set}"),
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
    "addReviewObject": lambda w: Call(
        "POST",
        f"/api/review-tasks/{w.task}/slides/{w.slide}/added",
        {"kind": "region", "geometry": SQUARE},
    ),
    "createAnnouncement": lambda _: Call(
        "POST", "/api/announcements", {"kind": "change", "text": "Matrix announcement"}
    ),
    "endAnnouncement": lambda w: Call("POST", f"/api/announcements/{w.announcement}/end"),
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
        {"decision": "keep-ai"},
    ),
    "clearDisagreementDecision": lambda w: Call(
        "DELETE", f"/api/review-tasks/{w.queued_task}/disagreements/{w.slide}/T1"
    ),
    "importCases": lambda w: Call(
        "POST", f"/api/projects/{w.project}/case-imports", {"csv": "case\nMatrix", "dry_run": True}
    ),
    "listMyReviewTasks": lambda _: Call("GET", "/api/me/review-tasks"),
    "listTasksAssignedByMe": lambda _: Call("GET", "/api/me/assigned-tasks"),
    "listMySlides": lambda _: Call("GET", "/api/me/slides"),
    "listDisagreements": lambda w: Call("GET", f"/api/review-tasks/{w.task}/disagreements"),
    "listVerdicts": lambda w: Call("GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/verdicts"),
    "getReviewOrder": lambda w: Call("GET", f"/api/review-tasks/{w.task}/slides/{w.slide}/order"),
    "saveVerdict": lambda w: Call(
        "PUT", f"/api/review-tasks/{w.task}/slides/{w.slide}/verdicts/T1", {"value": "agree"}
    ),
    "clearVerdict": lambda w: Call(
        "DELETE", f"/api/review-tasks/{w.task}/slides/{w.slide}/verdicts/T1"
    ),
    "getReviewTaskStates": lambda w: Call("GET", f"/api/review-tasks/{w.task}/states"),
    "submitSlideReview": lambda w: Call(
        "POST", f"/api/review-tasks/{w.task}/slides/{w.slide}/submit"
    ),
    "reopenSlideReview": lambda w: Call(
        "POST", f"/api/review-tasks/{w.submitted_task}/slides/{w.slide}/reopen"
    ),
    "signOffReviewTask": lambda w: Call("POST", f"/api/review-tasks/{w.ready_task}/sign-off"),
    "reopenReviewTask": lambda w: Call("POST", f"/api/review-tasks/{w.signed_task}/reopen"),
    "changeReviewTask": lambda w: Call("PATCH", f"/api/review-tasks/{w.task}", {"name": "Renamed"}),
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
)
MEMBER_CALLS: dict[str, Callable[[Workspace], Call]] = {
    "listAnnouncements": lambda _: Call("GET", "/api/announcements"),
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


def operations() -> dict[str, dict[str, Any]]:
    schema = openapi_schema()
    return {
        operation["operationId"]: operation
        for path in schema["paths"].values()
        for operation in path.values()
    }


def guarded_operations() -> dict[str, Permission]:
    return {
        name: Permission(operation["x-permission"])
        for name, operation in operations().items()
        if "x-permission" in operation
    }


WRITES = {name for name, call in GUARDED_CALLS.items() if call(PLACEHOLDER).method != "GET"}


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


async def seed(database: str, lead: Seat = RESEARCHER) -> Workspace:
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
                for index in range(len(SEATS))
            ]
            case = await seed_case(connection, tenant_id)
            doomed_patient = await add_patient(
                connection,
                await ensure_keys(connection, TEST_KEYRING, tenant_id),
                case.project_id,
                PatientIdentity("Doomed Patient"),
            )
            spare_project = await seed_project(connection, tenant_id)
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
                insert(result_objects).values(
                    tenant_id=tenant_id,
                    result_set_id=result_set,
                    kind="region",
                    number=1,
                    geometry="SRID=0;POLYGON((0 0,9 0,9 9,0 9,0 0))",
                )
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
            submitted_task, ready_task, signed_task = [
                await seed_task(
                    connection,
                    tenant_id,
                    case.project_id,
                    case.loose_slide_id,
                    result_set,
                    people[lead],
                    number,
                    signed=number == 4,
                )
                for number in (2, 3, 4)
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
            await connection.execute(
                insert(verdicts).values(
                    tenant_id=tenant_id,
                    project_id=case.project_id,
                    task_id=queued_task,
                    slide_id=case.loose_slide_id,
                    user_id=people[lead],
                    kind="region",
                    number=1,
                    value="disagree",
                    reason="not_class",
                )
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
                    for project in (case.project_id, spare_project)
                ]
                + [
                    {
                        "tenant_id": tenant_id,
                        "project_id": case.project_id,
                        "user_id": user,
                        "role": role,
                    }
                    for user, role in ((people[REVIEWER], "viewer"), (colleague, "viewer"))
                ],
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
            queued_task,
            hidden_task,
            first_read_task,
            announcement,
            legal_hold,
            case.patient_id,
            doomed_patient,
        )
    finally:
        await engine.dispose()


@pytest.fixture(scope="module")
def workspaces(database: str) -> dict[Seat, Workspace]:
    return {
        seat: asyncio.run(seed(database, seat if seat.role is Role.RESEARCHER else RESEARCHER))
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
    api: ApiAs, workspaces: dict[Seat, Workspace], operation: str, seat: Seat
) -> None:
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
