from typing import Annotated

import pytest
from fastapi import Query
from fastapi.testclient import TestClient
from pydantic import BaseModel

from parfocal_api.app import create_app
from parfocal_api.problems import (
    PROBLEM_MEDIA_TYPE,
    BadRequestError,
    ConflictError,
    ForbiddenError,
    NotFoundError,
    UnauthenticatedError,
)
from parfocal_api.settings import ApiSettings
from parfocal_common.clients import ConsoleErrorReporter, ProductionFactories

SETTINGS = ApiSettings.model_validate(
    {
        "app_env": "test",
        "database_url": "postgresql://parfocal@localhost:5432/parfocal",
        "zitadel_issuer": "https://parfocal-iqcyh5.eu1.zitadel.cloud",
        "zitadel_client_id": "client",
        "zitadel_client_secret": "zitadel-client-secret-value",
    }
)
PATIENT_NAME = "Jane Testpatient"


class CaseDraft(BaseModel):
    accession: str
    priority: int


class RecordingErrors(ConsoleErrorReporter):
    def __init__(self) -> None:
        self.captured: list[BaseException] = []

    def capture(self, error: BaseException) -> None:
        self.captured.append(error)


@pytest.fixture
def client() -> TestClient:
    app = create_app(SETTINGS)
    raising = {
        "bad-request": BadRequestError("Accession must not be empty"),
        "unauthenticated": UnauthenticatedError(),
        "forbidden": ForbiddenError(),
        "not-found": NotFoundError("Case S26-0001 does not exist"),
        "conflict": ConflictError(),
    }

    @app.get("/api/test/raise/{name}")
    async def raise_problem(name: str) -> None:
        raise raising[name]

    @app.post("/api/test/cases")
    async def create_case(draft: CaseDraft, limit: Annotated[int, Query(gt=0)] = 10) -> CaseDraft:
        return draft

    return TestClient(app, raise_server_exceptions=False)


def assert_problem(response_json: dict[str, object], status: int, code: str) -> None:
    assert response_json["status"] == status
    assert response_json["code"] == code
    assert response_json["type"] == f"https://parfocal.eu/problems/{code}"
    assert isinstance(response_json["title"], str)
    assert set(response_json) <= {"type", "title", "status", "code", "detail", "errors"}


@pytest.mark.parametrize(
    ("name", "status"),
    [
        ("bad-request", 400),
        ("unauthenticated", 401),
        ("forbidden", 403),
        ("not-found", 404),
        ("conflict", 409),
    ],
)
def test_problem_shapes(client: TestClient, name: str, status: int) -> None:
    response = client.get(f"/api/test/raise/{name}")
    assert response.status_code == status
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    assert_problem(response.json(), status, name)


def test_detail_is_kept(client: TestClient) -> None:
    body = client.get("/api/test/raise/not-found").json()
    assert body["detail"] == "Case S26-0001 does not exist"


def test_validation_lists_fields_without_echoing_input(client: TestClient) -> None:
    response = client.post(
        "/api/test/cases?limit=0", json={"accession": PATIENT_NAME, "priority": "urgent"}
    )
    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM_MEDIA_TYPE
    body = response.json()
    assert_problem(body, 422, "validation")
    locations = sorted(tuple(error["location"]) for error in body["errors"])
    assert locations == [("body", "priority"), ("query", "limit")]
    assert PATIENT_NAME not in response.text
    assert "urgent" not in response.text


def test_unknown_route_is_a_problem(client: TestClient) -> None:
    response = client.get("/api/nothing-here")
    assert response.status_code == 404
    assert_problem(response.json(), 404, "not-found")


def test_unexpected_errors_hide_details_and_are_reported() -> None:
    errors = RecordingErrors()
    settings = SETTINGS.model_copy(update={"error_backend": "sentry"})
    app = create_app(settings, ProductionFactories(errors=lambda _: errors))

    @app.get("/api/test/crash")
    async def crash() -> None:
        raise RuntimeError(f"database row for {PATIENT_NAME}")

    response = TestClient(app, raise_server_exceptions=False).get("/api/test/crash")
    assert response.status_code == 500
    assert_problem(response.json(), 500, "internal")
    assert PATIENT_NAME not in response.text
    assert "Traceback" not in response.text
    assert len(errors.captured) == 1


def test_openapi_documents_problem_responses(client: TestClient) -> None:
    schema = client.get("/openapi.json").json()
    responses = schema["paths"]["/api/health"]["get"]["responses"]
    for status in ("400", "401", "403", "404", "409", "422", "500"):
        assert PROBLEM_MEDIA_TYPE in responses[status]["content"], status
    assert "Problem" in schema["components"]["schemas"]
