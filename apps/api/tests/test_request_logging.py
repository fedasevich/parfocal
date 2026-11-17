import io
import json
import logging
import uuid
from collections.abc import Generator
from typing import Any

import pytest
from db_support import ApiAs
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from workspace_support import join_project, make_project, make_workspace

from parfocal_api.request_logging import RequestLogging
from parfocal_api.tables import Role
from parfocal_common.db_timing import time_queries, timed_transaction
from parfocal_common.structured_logging import configure_logging, register_sensitive


@pytest.fixture
def output() -> Generator[io.StringIO]:
    stream = io.StringIO()
    handler = configure_logging("api", "test", stream=stream)
    yield stream
    logging.getLogger().removeHandler(handler)


def lines(stream: io.StringIO) -> list[dict[str, Any]]:
    return [json.loads(line) for line in stream.getvalue().splitlines()]


def finished(stream: io.StringIO) -> list[dict[str, Any]]:
    return [line for line in lines(stream) if line["message"] == "request finished"]


@pytest.mark.db
def test_each_request_logs_its_route_status_and_context(
    api: ApiAs, database: str, output: io.StringIO
) -> None:
    people = make_workspace(database, {"lead": Role.RESEARCHER}).people
    lead = people["lead"]
    project = make_project(database, lead.tenant_id)
    join_project(database, project, lead, "owner")
    response = api(lead).get(f"/api/projects/{project}", headers={"X-Request-Id": "trace-abcdef12"})
    assert response.status_code == 200, response.text
    assert response.headers["x-request-id"] == "trace-abcdef12"
    (line,) = finished(output)
    assert {key: line[key] for key in ("route", "method", "status_code", "request_id")} == {
        "route": "/api/projects/{project_id}",
        "method": "GET",
        "status_code": 200,
        "request_id": "trace-abcdef12",
    }
    assert (line["tenant_id"], line["user_id"]) == (str(lead.tenant_id), str(lead.user_id))
    assert line["queries"] > line["transactions"] > 0
    assert 'queries;desc="' in response.headers["server-timing"]
    assert str(project) not in json.dumps(line)


@pytest.mark.db
def test_a_bad_request_id_is_replaced(api: ApiAs, database: str, output: io.StringIO) -> None:
    lead = make_workspace(database, {"lead": Role.RESEARCHER}).people["lead"]
    response = api(lead).get(f"/api/projects/{uuid.uuid4()}", headers={"X-Request-Id": "bad id!"})
    assert response.status_code == 404
    issued = response.headers["x-request-id"]
    assert issued != "bad id!"
    assert finished(output)[0]["request_id"] == issued


def test_a_patient_name_logged_during_a_request_is_redacted(output: io.StringIO) -> None:
    app = FastAPI()

    @app.get("/opened")
    async def opened() -> dict[str, str]:
        register_sensitive("Eva Testová")
        logging.getLogger("parfocal.test").warning("Opened the case of Eva Testová")
        return {}

    app.add_middleware(RequestLogging)
    assert TestClient(app).get("/opened").status_code == 200
    messages = [line["message"] for line in lines(output) if line["logger"].startswith("parfocal")]
    assert messages == ["Opened the case of [redacted]", "request finished"]


def test_every_answer_carries_server_timing_with_its_database_work(output: io.StringIO) -> None:
    engine = create_engine("sqlite://")
    time_queries(engine)
    app = FastAPI()

    @app.get("/counted")
    async def counted() -> dict[str, str]:
        with timed_transaction(), engine.connect() as connection:
            connection.execute(text("SELECT 1"))
            connection.execute(text("SELECT 2"))
        return {}

    app.add_middleware(RequestLogging)
    response = TestClient(app).get("/counted")
    parts = [part.strip().partition(";") for part in response.headers["server-timing"].split(",")]
    timing = {name: value for name, _, value in parts}
    assert set(timing) == {"app", "db", "sql", "queries", "transactions"}
    assert (timing["queries"], timing["transactions"]) == ('desc="2"', 'desc="1"')
    assert float(timing["app"].removeprefix("dur=")) >= float(timing["db"].removeprefix("dur="))
    (line,) = finished(output)
    assert (line["queries"], line["transactions"]) == (2, 1)
    assert line["db_ms"] >= line["sql_ms"] >= 0
