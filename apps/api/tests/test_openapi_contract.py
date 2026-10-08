from fastapi.testclient import TestClient

from parfocal_api.app import create_app
from parfocal_api.openapi import PLACEHOLDER_SETTINGS, SCHEMA_PATH, openapi_schema, render


def test_served_schema_equals_the_committed_schema() -> None:
    served = TestClient(create_app(PLACEHOLDER_SETTINGS)).get("/openapi.json").json()
    assert render(served) == SCHEMA_PATH.read_text(), (
        "packages/api-client/openapi.json is stale, run: pnpm api:generate"
    )


def test_schema_is_openapi_3_1_with_stable_operation_ids() -> None:
    schema = openapi_schema()
    assert schema["openapi"].startswith("3.1")
    operation_ids = [
        operation["operationId"] for path in schema["paths"].values() for operation in path.values()
    ]
    assert operation_ids == sorted(set(operation_ids), key=operation_ids.index)
    assert all(not operation_id.endswith("_get") for operation_id in operation_ids)
