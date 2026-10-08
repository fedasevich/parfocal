import json
import sys
from pathlib import Path
from typing import Any

from parfocal_api.app import create_app
from parfocal_api.settings import ApiSettings

SCHEMA_PATH = Path(__file__).resolve().parents[4] / "packages" / "api-client" / "openapi.json"

PLACEHOLDER_SETTINGS = ApiSettings.model_validate(
    {
        "app_env": "test",
        "database_url": "postgresql://schema@localhost/schema",
        "zitadel_issuer": "https://issuer.invalid",
        "zitadel_client_id": "schema",
        "zitadel_client_secret": "schema",
    }
)


def openapi_schema() -> dict[str, Any]:
    return create_app(PLACEHOLDER_SETTINGS).openapi()


def render(schema: dict[str, Any]) -> str:
    return json.dumps(schema, indent=2, ensure_ascii=False) + "\n"


def main() -> None:
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else SCHEMA_PATH
    target.write_text(render(openapi_schema()))


if __name__ == "__main__":
    main()
