from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx2
from fastapi import FastAPI
from pydantic import BaseModel

from parfocal_api import (
    adjudications,
    admin_console,
    ai_changes,
    ai_corrections,
    ai_usage,
    annotate_import,
    annotate_layer,
    annotate_sign_off,
    annotation_exports,
    annotations,
    announcements,
    audit_trail,
    auth,
    availability,
    case_creation,
    case_imports,
    case_sorting,
    cases,
    cell_crops,
    checklist,
    clinical_notes,
    clinical_report_views,
    clinical_reports,
    deactivation,
    decision_notes,
    disagreement_queue,
    disagreements,
    display,
    emergency,
    evaluation,
    evaluation_exports,
    evaluation_report,
    evaluation_versions,
    events_out,
    feedback,
    first_reads,
    gpu_calls,
    hidden_models,
    home,
    import_checks,
    import_sources,
    inbox,
    invitations,
    invite_preview,
    lab_models,
    layer_groups,
    link_imports,
    maintenance,
    model_area,
    model_registry,
    model_run_progress,
    model_runs,
    model_tiers,
    my_jobs,
    my_work,
    neighbours,
    notification_targets,
    notifications,
    opinion_forms,
    opinions,
    outline_types,
    own_workspaces,
    painted_maps,
    passkeys,
    password_login,
    patch_exports,
    personal_data,
    project_jobs,
    project_overview,
    project_uploads,
    project_webhooks,
    projects,
    remote_copies,
    remote_slides,
    report_links,
    report_preview,
    restricted_images,
    result_formats,
    result_pairing,
    result_sets,
    retention,
    review_decisions,
    review_objects,
    review_order,
    review_skips,
    review_states,
    review_tasks,
    reviewed_export,
    reviewed_layer,
    room_access,
    sample_project,
    search,
    security_contact,
    service_accounts,
    sessions_api,
    settings_api,
    sign_out,
    site_validations,
    slide_areas,
    slide_copies,
    slide_coverage,
    slide_details,
    slide_embeddings,
    slide_moves,
    slide_result_stats,
    slide_threads,
    slide_thumbnail,
    slide_tissue,
    slide_viewer,
    source_watches,
    study_templates,
    task_changes,
    task_report_layout,
    task_runs,
    task_timing,
    task_withdrawal,
    taxonomy,
    team_workload,
    template_offers,
    template_review_defaults,
    tenants,
    threads,
    tile_access,
    track_record,
    training_exports,
    tumor_maps,
    uploads,
    users,
    view_maps,
    workspace_access,
)
from parfocal_api.observability import SliMiddleware, drill_router, rum_router, sli_emitter
from parfocal_api.oidc import OidcClient
from parfocal_api.origin_check import OriginCheck
from parfocal_api.problems import PROBLEM_RESPONSES, install_problem_handlers
from parfocal_api.rate_limits import RateLimits
from parfocal_api.realtime import realtime_for
from parfocal_api.request_logging import RequestLogging
from parfocal_api.settings import ApiSettings
from parfocal_api.zitadel_login import login_client
from parfocal_common.clients import Clients, ProductionFactories, select_clients
from parfocal_common.db import create_engine, require_row_security
from parfocal_common.envelope import MasterKeyring
from parfocal_common.object_store import ObjectStore
from parfocal_common.otlp import otlp_exporter
from parfocal_common.result_store import ObjectResultStore, ResultStore
from parfocal_common.settings import load_settings
from parfocal_common.structured_logging import configure_logging

PRODUCTION_FACTORIES = ProductionFactories(telemetry=otlp_exporter)


class Health(BaseModel):
    status: str


def zitadel_client(settings: ApiSettings) -> OidcClient:
    return OidcClient(
        issuer=str(settings.zitadel_issuer),
        client_id=settings.zitadel_client_id,
        client_secret=settings.zitadel_client_secret.get_secret_value(),
        redirect_uri=f"{public_origin(settings)}/api/auth/callback",
        http=httpx2.AsyncClient(timeout=10),
    )


def public_origin(settings: ApiSettings) -> str:
    return str(settings.public_origin).rstrip("/")


@asynccontextmanager
async def checked_role_then_closed_clients(app: FastAPI) -> AsyncGenerator[None]:
    state: auth.AuthState = app.state.auth
    try:
        await require_row_security(state.engine)
        yield
    finally:
        await app.state.sli.settle()
        await app.state.sli.flush()
        await state.identity.http.aclose()
        storage: ObjectStore = app.state.storage
        await storage.http.aclose()
        await app.state.realtime_http.aclose()
        await state.engine.dispose()


class ParfocalApi(FastAPI):
    def __init__(self, settings: ApiSettings, clients: Clients, identity: OidcClient) -> None:
        super().__init__(
            title="Parfocal API",
            version="0.0.0",
            responses=PROBLEM_RESPONSES,
            lifespan=checked_role_then_closed_clients,
        )
        self.settings = settings
        self.clients = clients
        self.state.storage = ObjectStore(settings.storage(), httpx2.AsyncClient(timeout=30))
        self.results: ResultStore = ObjectResultStore(self.state.storage)
        self.keyring = MasterKeyring.from_setting(settings.master_keys.get_secret_value())
        self.state.engine = create_engine(str(settings.database_url))
        self.state.maintenance = maintenance.MaintenanceState(self.state.engine)
        self.state.realtime_http = httpx2.AsyncClient(timeout=5)
        self.state.sli = sli_emitter(settings, clients, self.state.storage)
        self.state.realtime = realtime_for(settings, self.state.realtime_http, self.state.sli)
        self.state.auth = auth.AuthState(
            engine=self.state.engine,
            identity=identity,
            cipher=auth.SessionCipher(settings.session_key.get_secret_value()),
            public_origin=public_origin(settings),
            limits=RateLimits(
                settings.rate_limit_person_per_minute,
                settings.rate_limit_tenant_per_minute,
                settings.rate_limit_report_link_per_minute,
            ),
            login=login_client(settings, identity.http),
        )


def create_app(
    settings: ApiSettings | None = None,
    production: ProductionFactories = PRODUCTION_FACTORIES,
    identity: OidcClient | None = None,
) -> ParfocalApi:
    resolved = settings or load_settings(ApiSettings)
    app = ParfocalApi(
        resolved, select_clients(resolved, production), identity or zitadel_client(resolved)
    )
    install_problem_handlers(app, app.clients.errors)
    configure_logging("api", resolved.app_env)
    app.add_middleware(maintenance.MaintenanceGate, state=app.state.maintenance)
    app.add_middleware(OriginCheck, origin=public_origin(resolved))
    app.add_middleware(RequestLogging)
    app.add_middleware(SliMiddleware, emitter=app.state.sli)

    @app.get("/api/health", operation_id="getHealth")
    async def health() -> Health:
        return Health(status="ok")

    app.include_router(maintenance.router)
    app.include_router(maintenance.platform_router)
    app.include_router(drill_router)
    app.include_router(rum_router)
    app.include_router(auth.router)
    app.include_router(password_login.router)
    app.include_router(passkeys.router)
    app.include_router(sessions_api.router)
    app.include_router(projects.router)
    app.include_router(project_overview.router)
    app.include_router(project_uploads.router)
    app.include_router(sample_project.router)
    app.include_router(sign_out.router)
    app.include_router(clinical_reports.router)
    app.include_router(clinical_reports.me_router)
    app.include_router(clinical_report_views.router)
    app.include_router(taxonomy.router)
    app.include_router(opinion_forms.router)
    app.include_router(project_jobs.router)
    app.include_router(model_area.project_router)
    app.include_router(model_area.tenant_router)
    app.include_router(admin_console.router)
    app.include_router(invite_preview.router)
    app.include_router(model_runs.router)
    app.include_router(tumor_maps.router)
    app.include_router(model_tiers.router)
    app.include_router(hidden_models.router)
    app.include_router(model_registry.router)
    app.include_router(model_registry.platform_router)
    app.include_router(lab_models.router)
    app.include_router(lab_models.project_router)
    app.include_router(model_run_progress.router)
    app.include_router(notifications.router)
    app.include_router(opinion_forms.template_router)
    app.include_router(taxonomy.templates_router)
    app.include_router(cases.router)
    app.include_router(slide_details.router)
    app.include_router(clinical_notes.router)
    app.include_router(slide_moves.router)
    app.include_router(slide_copies.router)
    app.include_router(annotations.router)
    app.include_router(layer_groups.router)
    app.include_router(layer_groups.shared_router)
    app.include_router(painted_maps.router)
    app.include_router(result_sets.slide_router)
    app.include_router(result_sets.project_router)
    app.include_router(result_sets.router)
    app.include_router(result_formats.router)
    app.include_router(uploads.router)
    app.include_router(result_pairing.router)
    app.include_router(import_checks.router)
    app.include_router(case_sorting.router)
    app.include_router(link_imports.router)
    app.include_router(import_sources.router)
    app.include_router(project_webhooks.router)
    app.include_router(project_webhooks.public_router)
    app.include_router(source_watches.router)
    app.include_router(events_out.router)
    app.include_router(remote_slides.router)
    app.include_router(remote_slides.public_router)
    app.include_router(remote_copies.router)
    app.include_router(review_tasks.project_router)
    app.include_router(review_tasks.router)
    app.include_router(task_changes.router)
    app.include_router(task_withdrawal.router)
    app.include_router(reviewed_layer.router)
    app.include_router(annotate_layer.router)
    app.include_router(annotate_import.router)
    app.include_router(annotate_sign_off.router)
    app.include_router(task_runs.router)
    app.include_router(review_order.router)
    app.include_router(review_objects.router)
    app.include_router(slide_result_stats.router)
    app.include_router(slide_viewer.slide_router)
    app.include_router(slide_viewer.result_set_router)
    app.include_router(disagreement_queue.router)
    app.include_router(disagreement_queue.adjudication_router)
    app.include_router(reviewed_export.router)
    app.include_router(annotation_exports.router)
    app.include_router(announcements.router)
    app.include_router(feedback.router)
    app.include_router(site_validations.router)
    app.include_router(home.router)
    app.include_router(my_jobs.router)
    app.include_router(checklist.router)
    app.include_router(retention.router)
    app.include_router(personal_data.me_router)
    app.include_router(personal_data.project_router)
    app.include_router(personal_data.platform_router)
    app.include_router(neighbours.router)
    app.include_router(restricted_images.router)
    app.include_router(tile_access.router)
    app.include_router(room_access.router)
    app.include_router(inbox.router)
    app.include_router(notification_targets.router)
    app.include_router(notifications.schedule_router)
    app.include_router(search.router)
    app.include_router(review_states.router)
    app.include_router(review_decisions.router)
    app.include_router(decision_notes.router)
    app.include_router(review_skips.router)
    app.include_router(display.router)
    app.include_router(display.presets_router)
    app.include_router(threads.router)
    app.include_router(threads.slide_router)
    app.include_router(slide_threads.slide_router)
    app.include_router(slide_threads.thread_router)
    app.include_router(opinions.router)
    app.include_router(first_reads.router)
    app.include_router(disagreements.router)
    app.include_router(adjudications.task_router)
    app.include_router(adjudications.router)
    app.include_router(evaluation.router)
    app.include_router(evaluation_exports.router)
    app.include_router(evaluation_report.router)
    app.include_router(report_preview.router)
    app.include_router(task_report_layout.router)
    app.include_router(training_exports.router)
    app.include_router(patch_exports.router)
    app.include_router(ai_changes.router)
    app.include_router(ai_corrections.router)
    app.include_router(task_timing.me_router)
    app.include_router(task_timing.tenant_router)
    app.include_router(ai_usage.router)
    app.include_router(evaluation_versions.router)
    app.include_router(report_links.router)
    app.include_router(report_links.public_router)
    app.include_router(template_review_defaults.router)
    app.include_router(study_templates.router)
    app.include_router(template_offers.router)
    app.include_router(my_work.router)
    app.include_router(track_record.router)
    app.include_router(case_creation.router)
    app.include_router(case_imports.router)
    app.include_router(emergency.router)
    app.include_router(availability.me_router)
    app.include_router(team_workload.me_router)
    app.include_router(team_workload.tenant_router)
    app.include_router(availability.team_router)
    app.include_router(tenants.platform)
    app.include_router(tenants.tenant)
    app.include_router(users.me_router)
    app.include_router(own_workspaces.router)
    app.include_router(workspace_access.me_router)
    app.include_router(workspace_access.tenant_router)
    app.include_router(users.tenant_router)
    app.include_router(deactivation.router)
    app.include_router(users.platform_router)
    app.include_router(audit_trail.router)
    app.include_router(service_accounts.router)
    app.include_router(invitations.tenant_router)
    app.include_router(invitations.platform_router)
    app.include_router(invitations.public_router)
    app.include_router(invitations.task_router)
    app.include_router(settings_api.me_router)
    app.include_router(settings_api.tenant_router)
    app.include_router(security_contact.router)
    app.include_router(slide_coverage.router)
    app.include_router(slide_tissue.router)
    app.include_router(slide_thumbnail.router)
    app.include_router(cell_crops.router)
    app.include_router(slide_embeddings.router)
    app.include_router(view_maps.router)
    app.include_router(gpu_calls.router)
    app.include_router(outline_types.router)
    app.include_router(slide_areas.router)

    return app
