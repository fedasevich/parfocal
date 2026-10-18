import pytest
from db_support import ApiAs
from workspace_support import make_workspace

from parfocal_api.tables import Role
from parfocal_common.results_schema import template_text

pytestmark = pytest.mark.db

BASE = "/api/result-formats/parfocal-json"


def test_members_download_the_schema_and_template_and_validate_files(
    api: ApiAs, database: str
) -> None:
    member = make_workspace(database, {"reviewer": Role.REVIEWER}).people["reviewer"]
    client = api(member)
    schema = client.get(f"{BASE}/schema").json()
    assert schema["title"] == "Parfocal results, version 1"
    template = client.get(f"{BASE}/template").json()
    assert template["format"] == "parfocal-results"
    valid = client.post(f"{BASE}/validate", json={"content": template_text()}).json()
    assert valid == {"valid": True, "problems": []}
    broken = template_text().replace('"version": 1', '"version": 2')
    found = client.post(f"{BASE}/validate", json={"content": broken}).json()
    assert found["valid"] is False
    assert [(p["code"], p["path"]) for p in found["problems"]] == [("wrong-version", "version")]
    assert found["problems"][0]["line"] == 3
