from fastapi import FastAPI
from pydantic import BaseModel

from parfocal_api.problems import PROBLEM_RESPONSES, install_problem_handlers
from parfocal_api.settings import ApiSettings
from parfocal_common.clients import Clients, ProductionFactories, select_clients
from parfocal_common.settings import load_settings

PRODUCTION_FACTORIES = ProductionFactories()


class Health(BaseModel):
    status: str


class ParfocalApi(FastAPI):
    def __init__(self, settings: ApiSettings, clients: Clients) -> None:
        super().__init__(title="Parfocal API", version="0.0.0", responses=PROBLEM_RESPONSES)
        self.settings = settings
        self.clients = clients


def create_app(
    settings: ApiSettings | None = None,
    production: ProductionFactories = PRODUCTION_FACTORIES,
) -> ParfocalApi:
    resolved = settings or load_settings(ApiSettings)
    app = ParfocalApi(resolved, select_clients(resolved, production))
    install_problem_handlers(app, app.clients.errors)

    @app.get("/api/health", operation_id="getHealth")
    async def health() -> Health:
        return Health(status="ok")

    return app
