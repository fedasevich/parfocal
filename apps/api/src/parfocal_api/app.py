from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx2
from fastapi import FastAPI
from pydantic import BaseModel

from parfocal_api import (
    annotations,
    audit_trail,
    auth,
    availability,
    case_creation,
    cases,
    emergency,
    invitations,
    notifications,
    opinion_forms,
    project_jobs,
    projects,
    result_sets,
    service_accounts,
    sessions_api,
    taxonomy,
    tenants,
    users,
)
from parfocal_api.oidc import OidcClient
from parfocal_api.problems import PROBLEM_RESPONSES, install_problem_handlers
from parfocal_api.request_logging import RequestLogging
from parfocal_api.settings import ApiSettings
from parfocal_common.clients import Clients, ProductionFactories, select_clients
from parfocal_common.db import create_engine
from parfocal_common.envelope import MasterKeyring
from parfocal_common.settings import load_settings
from parfocal_common.structured_logging import configure_logging

PRODUCTION_FACTORIES = ProductionFactories()


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
async def close_clients(app: FastAPI) -> AsyncGenerator[None]:
    yield
    state: auth.AuthState = app.state.auth
    await state.identity.http.aclose()
    await state.engine.dispose()


class ParfocalApi(FastAPI):
    def __init__(self, settings: ApiSettings, clients: Clients, identity: OidcClient) -> None:
        super().__init__(
            title="Parfocal API",
            version="0.0.0",
            responses=PROBLEM_RESPONSES,
            lifespan=close_clients,
        )
        self.settings = settings
        self.clients = clients
        self.keyring = MasterKeyring.from_setting(settings.master_keys.get_secret_value())
        self.state.engine = create_engine(str(settings.database_url))
        self.state.auth = auth.AuthState(
            engine=self.state.engine,
            identity=identity,
            cipher=auth.SessionCipher(settings.session_key.get_secret_value()),
            public_origin=public_origin(settings),
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
    app.add_middleware(RequestLogging)

    @app.get("/api/health", operation_id="getHealth")
    async def health() -> Health:
        return Health(status="ok")

    app.include_router(auth.router)
    app.include_router(sessions_api.router)
    app.include_router(projects.router)
    app.include_router(taxonomy.router)
    app.include_router(opinion_forms.router)
    app.include_router(project_jobs.router)
    app.include_router(notifications.router)
    app.include_router(opinion_forms.template_router)
    app.include_router(taxonomy.templates_router)
    app.include_router(cases.router)
    app.include_router(annotations.router)
    app.include_router(result_sets.slide_router)
    app.include_router(result_sets.project_router)
    app.include_router(result_sets.router)
    app.include_router(case_creation.router)
    app.include_router(emergency.router)
    app.include_router(availability.me_router)
    app.include_router(availability.team_router)
    app.include_router(tenants.platform)
    app.include_router(tenants.tenant)
    app.include_router(users.me_router)
    app.include_router(users.tenant_router)
    app.include_router(users.platform_router)
    app.include_router(audit_trail.router)
    app.include_router(service_accounts.router)
    app.include_router(invitations.tenant_router)
    app.include_router(invitations.platform_router)
    app.include_router(invitations.public_router)

    return app
