import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field

from sqlalchemy import Table, exists, select
from sqlalchemy.ext.asyncio import AsyncEngine

from parfocal_api.audit import AuditAction, AuditTarget
from parfocal_api.tables import (
    ActorKind,
    annotations,
    audit_events,
    cases,
    clinical_reports,
    display_presets,
    event_targets,
    import_sources,
    invitations,
    lab_models,
    legal_holds,
    patients,
    project_webhooks,
    projects,
    report_links,
    result_sets,
    review_tasks,
    service_accounts,
    site_validations,
    slides,
    study_templates,
    tenants,
    threads,
    uploads,
)
from parfocal_common.alerting import Alert, OnCall, Severity
from parfocal_common.db import DatabaseScope, scoped_transaction, tenant_transaction
from parfocal_common.jobs import jobs

TARGET_TABLES: Mapping[AuditTarget, Table] = {
    AuditTarget.CASE: cases,
    AuditTarget.PROJECT: projects,
    AuditTarget.SLIDE: slides,
    AuditTarget.PATIENT: patients,
    AuditTarget.RESULT_SET: result_sets,
    AuditTarget.UPLOAD: uploads,
    AuditTarget.MODEL_RUN: jobs,
    AuditTarget.REVIEW_TASK: review_tasks,
    AuditTarget.ANNOTATION: annotations,
    AuditTarget.THREAD: threads,
    AuditTarget.CLINICAL_REPORT: clinical_reports,
    AuditTarget.LEGAL_HOLD: legal_holds,
    AuditTarget.SERVICE_ACCOUNT: service_accounts,
    AuditTarget.INVITATION: invitations,
    AuditTarget.STUDY_TEMPLATE: study_templates,
    AuditTarget.DISPLAY_PRESET: display_presets,
    AuditTarget.REPORT_LINK: report_links,
    AuditTarget.SITE_VALIDATION: site_validations,
    AuditTarget.LAB_MODEL: lab_models,
    AuditTarget.IMPORT_SOURCE: import_sources,
    AuditTarget.WEBHOOK: project_webhooks,
    AuditTarget.EVENT_TARGET: event_targets,
}

UNCHECKED_TARGETS: Mapping[AuditTarget, str] = {
    AuditTarget.ORGANISATION: "an organisation holds several workspaces by design",
    AuditTarget.TENANT: "the target is the workspace itself",
    AuditTarget.PERSON: "the target is a pseudonym, which belongs to no workspace",
    AuditTarget.TEMPLATE_OFFER: "an offer goes from one workspace to another by design",
    AuditTarget.ACCESS_REQUEST: "a request to join comes from outside the workspace by design",
    AuditTarget.REGISTERED_MODEL: "registered models are platform rows",
    AuditTarget.MAINTENANCE: "maintenance windows are platform rows",
    AuditTarget.ANNOUNCEMENT: "site validations also record announcements under this target",
    AuditTarget.FEEDBACK: "feedback is sent on to the platform and has no workspace row to check",
}

UNCHECKED_ACTORS = (ActorKind.OPERATOR,)

REMOVAL_ACTIONS = frozenset(
    {
        AuditAction.RETENTION_PURGED,
        AuditAction.THREAD_DELETED,
        AuditAction.PATIENT_ERASED,
        AuditAction.DISPLAY_PRESET_DELETED,
        AuditAction.EVENT_TARGET_DELETED,
    }
)


@dataclass(frozen=True)
class CrossWorkspaceEvent:
    tenant_id: uuid.UUID
    seq: int
    action: str
    target_type: str
    target_id: uuid.UUID

    def alert(self) -> Alert:
        return Alert(
            key=f"security:cross-workspace:{self.tenant_id}:{self.seq}",
            severity=Severity.PAGE,
            summary=(
                f"Audit event {self.seq} of workspace {self.tenant_id} ({self.action}) "
                f"targets a {self.target_type} that is not in that workspace"
            ),
            labels={"tenant_id": str(self.tenant_id), "target_type": self.target_type},
        )


async def workspaces(engine: AsyncEngine) -> list[uuid.UUID]:
    async with scoped_transaction(engine, DatabaseScope(platform=True)) as connection:
        return list((await connection.scalars(select(tenants.c.id))).all())


async def events_outside(
    engine: AsyncEngine, tenant_id: uuid.UUID, after_seq: int
) -> list[CrossWorkspaceEvent]:
    found: list[CrossWorkspaceEvent] = []
    removal = audit_events.alias("removal")
    async with tenant_transaction(engine, tenant_id) as connection:
        for target, table in TARGET_TABLES.items():
            rows = await connection.execute(
                select(
                    audit_events.c.seq,
                    audit_events.c.action,
                    audit_events.c.target_type,
                    audit_events.c.target_id,
                )
                .where(
                    audit_events.c.tenant_id == tenant_id,
                    audit_events.c.seq > after_seq,
                    audit_events.c.target_type == target.value,
                    audit_events.c.target_id.is_not(None),
                    audit_events.c.actor_kind.not_in([kind.value for kind in UNCHECKED_ACTORS]),
                    ~exists().where(table.c.id == audit_events.c.target_id),
                    ~exists().where(
                        removal.c.tenant_id == audit_events.c.tenant_id,
                        removal.c.target_type == audit_events.c.target_type,
                        removal.c.target_id == audit_events.c.target_id,
                        removal.c.action.in_([action.value for action in REMOVAL_ACTIONS]),
                    ),
                )
                .order_by(audit_events.c.seq)
            )
            found.extend(
                CrossWorkspaceEvent(tenant_id, row.seq, row.action, row.target_type, row.target_id)
                for row in rows
            )
    return sorted(found, key=lambda event: event.seq)


async def latest_seq(engine: AsyncEngine, tenant_id: uuid.UUID) -> int:
    async with tenant_transaction(engine, tenant_id) as connection:
        latest = await connection.scalar(
            select(audit_events.c.seq)
            .where(audit_events.c.tenant_id == tenant_id)
            .order_by(audit_events.c.seq.desc())
            .limit(1)
        )
    return int(latest or 0)


@dataclass
class CrossWorkspaceWatch:
    engine: AsyncEngine
    on_call: OnCall
    watermarks: dict[uuid.UUID, int] = field(default_factory=dict[uuid.UUID, int])

    async def check(self) -> list[CrossWorkspaceEvent]:
        raised: list[CrossWorkspaceEvent] = []
        for tenant_id in await workspaces(self.engine):
            after = self.watermarks.get(tenant_id, 0)
            through = await latest_seq(self.engine, tenant_id)
            for event in await events_outside(self.engine, tenant_id, after):
                if event.seq <= through:
                    self.on_call.fired(event.alert())
                    raised.append(event)
            self.watermarks[tenant_id] = through
        return raised
