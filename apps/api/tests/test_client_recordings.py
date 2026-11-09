import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

import pytest
from db_support import ApiAs
from fastapi.testclient import TestClient
from workspace_support import make_workspace

from parfocal_api.tables import Role

pytestmark = pytest.mark.db

RECORDED = Path(__file__).resolve().parents[3] / "packages" / "api-client" / "test" / "recorded"
UUID_PATTERN = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")
TIMESTAMP_PATTERN = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})")


def stable(text: str) -> str:
    seen: dict[str, str] = {}

    def replace(match: re.Match[str]) -> str:
        return seen.setdefault(match.group(0), str(uuid.UUID(int=len(seen) + 1)))

    return TIMESTAMP_PATTERN.sub("2026-01-01T00:00:00Z", UUID_PATTERN.sub(replace, text))


def check_recording(name: str, method: str, path: str, response: Any) -> None:
    body = json.loads(stable(response.text))
    entry = {"method": method, "path": stable(path), "status": response.status_code, "body": body}
    rendered = json.dumps(entry, indent=2, ensure_ascii=False) + "\n"
    target = RECORDED / f"{name}.json"
    if os.environ.get("PARFOCAL_RECORD") == "1":
        target.write_text(rendered)
    assert json.loads(target.read_text()) == entry, (
        f"{target.name} is stale, run: PARFOCAL_RECORD=1 pnpm test:db, then biome format it"
    )


def test_the_recorded_responses_match_what_the_api_returns(api: ApiAs, database: str) -> None:
    owner = make_workspace(database, {"owner": Role.RESEARCHER}).people["owner"]
    client: TestClient = api(owner)

    check_recording("health", "GET", "/api/health", client.get("/api/health"))

    created = client.post("/api/projects", json={"name": "Contract colon", "template": "none"})
    check_recording("project-created", "POST", "/api/projects", created)
    project_id = created.json()["id"]
    check_recording("project-list", "GET", "/api/projects", client.get("/api/projects"))
    read_path = f"/api/projects/{project_id}"
    check_recording("project-read", "GET", read_path, client.get(read_path))
    missing = f"/api/projects/{uuid.UUID(int=999)}"
    check_recording("project-missing", "GET", missing, client.get(missing))
    check_recording(
        "taxonomy-templates",
        "GET",
        "/api/taxonomy-templates",
        client.get("/api/taxonomy-templates"),
    )
