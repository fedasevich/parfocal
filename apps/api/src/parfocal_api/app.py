from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

import httpx2
from fastapi import FastAPI
from pydantic import BaseModel

from parfocal_api import (
    accessions,
    audit_trail,
    auth,
    case_creation,
    case_states,
    cases,
    emergency,
    folders,
    invitations,
    service_accounts,
    sessions_api,
    signing,
    tenants,
    users,
)
from parfocal_api.oidc import OidcClient
from parfocal_api.problems import PROBLEM_RESPONSES, install_problem_handlers
from parfocal_api.settings import ApiSettings
from parfocal_common.clients import Clients, ProductionFactories, select_clients
from parfocal_common.db import create_engine
from parfocal_common.envelope import MasterKeyring
from parfocal_common.settings import load_settings

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

    @app.get("/api/health", operation_id="getHealth")
    async def health() -> Health:
        return Health(status="ok")

    app.include_router(auth.router)
    app.include_router(sessions_api.router)
    app.include_router(cases.router)
    app.include_router(case_creation.router)
    app.include_router(emergency.router)
    app.include_router(folders.router)
    app.include_router(folders.case_router)
    app.include_router(folders.member_router)
    app.include_router(case_states.router)
    app.include_router(accessions.router)
    app.include_router(signing.tenant_router)
    app.include_router(signing.me_router)
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
