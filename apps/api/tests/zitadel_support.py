from pathlib import Path

import httpx2
import pytest
from db_support import APP_URL, TEST_MASTER_KEYS, with_database
from storage_support import TEST_STORAGE

from parfocal_api.tenant_command import ProvisioningSettings, main

LOCAL_ZITADEL = Path(__file__).resolve().parents[3] / ".zitadel/e2e.env"


def local_zitadel() -> dict[str, str]:
    if not LOCAL_ZITADEL.is_file():
        return {}
    lines = LOCAL_ZITADEL.read_text().splitlines()
    return dict(line.split("=", 1) for line in lines if "=" in line)


def settings_for(database: str, zitadel: dict[str, str]) -> ProvisioningSettings:
    return ProvisioningSettings.model_validate(
        {
            "app_env": "test",
            "database_url": with_database(APP_URL, database),
            "master_keys": TEST_MASTER_KEYS,
            "zitadel_issuer": zitadel["ZITADEL_ISSUER"],
            "zitadel_admin_token": zitadel["ZITADEL_ADMIN_TOKEN"],
            "storage_endpoint": TEST_STORAGE.endpoint,
            "storage_region": TEST_STORAGE.region,
            "storage_bucket": TEST_STORAGE.bucket,
            "storage_access_key_id": TEST_STORAGE.access_key_id,
            "storage_secret_access_key": TEST_STORAGE.secret_access_key,
        }
    )


def organisations_named(zitadel: dict[str, str], name: str) -> list[str]:
    response = httpx2.post(
        f"{zitadel['ZITADEL_ISSUER']}/v2/organizations/_search",
        json={"queries": [{"nameQuery": {"name": name, "method": "TEXT_QUERY_METHOD_EQUALS"}}]},
        headers={"authorization": f"Bearer {zitadel['ZITADEL_ADMIN_TOKEN']}"},
    )
    response.raise_for_status()
    return [str(o["id"]) for o in response.json().get("result", [])]


def command(
    argv: list[str], settings: ProvisioningSettings, capsys: pytest.CaptureFixture[str]
) -> str:
    main(argv, settings)
    return capsys.readouterr().out.strip()


SCIM_USER = "urn:ietf:params:scim:schemas:core:2.0:User"
PATCH_OP = "urn:ietf:params:scim:api:messages:2.0:PatchOp"


def scim_patch(endpoint: str, headers: dict[str, str], user_id: str, operation: object) -> int:
    response = httpx2.patch(
        f"{endpoint}/Users/{user_id}",
        headers=headers,
        json={"schemas": [PATCH_OP], "Operations": [operation]},
    )
    return response.status_code
