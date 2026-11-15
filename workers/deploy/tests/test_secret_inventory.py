import json
import re

from pydantic import SecretStr

from parfocal_api.settings import ApiSettings
from parfocal_deploy.bootstrap import (
    LOCAL_SETTINGS,
    PROXY_TOKEN,
    config_values,
    generated_keys,
    worker_secrets,
)
from parfocal_deploy.environments import environment
from parfocal_deploy.modal_app import SECRETS
from parfocal_deploy.tools import REPOSITORY

INVENTORY = REPOSITORY / "docs/knowledge/secrets.md"
WORKFLOWS = REPOSITORY / ".github/workflows"
WRANGLER = REPOSITORY / "apps/edge/wrangler.jsonc"
ROW = re.compile(r"^\| `([A-Z0-9_]+)` \| (.+?) \| (.+?) \| (.+?) \|$")
WORKFLOW_SECRET = re.compile(r"secrets\.([A-Z0-9_]+)")
NOT_SECRET = {"GITHUB_TOKEN"}
PLAIN_SETTINGS = {"NEON_PROJECT_ID", "CLOUDFLARE_ACCOUNT_ID"}
SECRET_CONFIG = {"ZITADEL_CLIENT_SECRET", "STORAGE_SECRET_ACCESS_KEY"}


def inventory() -> dict[str, tuple[str, str, str]]:
    rows: dict[str, tuple[str, str, str]] = {}
    for line in INVENTORY.read_text().splitlines():
        match = ROW.match(line)
        if match:
            name, store, writer, rotation = match.groups()
            rows[name] = (store.strip(), writer.strip(), rotation.strip())
    return rows


def secret_settings() -> set[str]:
    return {
        name.upper()
        for name, field in ApiSettings.model_fields.items()
        if SecretStr in (field.annotation, *getattr(field.annotation, "__args__", ()))
    }


def workflow_secrets() -> set[str]:
    found: set[str] = set()
    for workflow in WORKFLOWS.glob("*.yml"):
        found |= set(WORKFLOW_SECRET.findall(workflow.read_text()))
    return found - NOT_SECRET


def bootstrap_secrets() -> set[str]:
    local: dict[str, str] = dict.fromkeys((*LOCAL_SETTINGS, "TURNSTILE_SECRET_KEY"), "made-up")
    outputs = {"zitadel_issuer": "", "zitadel_client_id": "", "zitadel_client_secret": ""}
    config = config_values(environment("production"), outputs, local)
    keys = generated_keys(lambda: "made-up")
    shell = set(LOCAL_SETTINGS) - PLAIN_SETTINGS
    return {*keys, "DATABASE_URL", *worker_secrets(keys, local), *PROXY_TOKEN, *shell} | (
        SECRET_CONFIG & set(config)
    )


def test_every_secret_has_a_row_with_a_store_a_writer_and_a_rotation() -> None:
    rows = inventory()
    expected = secret_settings() | workflow_secrets() | bootstrap_secrets()
    assert sorted(expected - set(rows)) == []
    assert all(all(cell for cell in row) for row in rows.values())


def test_the_inventory_names_the_settings_it_must_cover() -> None:
    covered = {"SESSION_KEY", "MASTER_KEYS", "STORAGE_SECRET_ACCESS_KEY", "ZITADEL_LOGIN_TOKEN"}
    assert covered <= secret_settings()
    assert {"MASTER_KEYS", "DATABASE_URL", "MODAL_PROXY_TOKEN_SECRET"} <= bootstrap_secrets()
    assert {"NEON_API_KEY", "MODAL_TOKEN_SECRET"} <= workflow_secrets()


def test_every_modal_secret_the_app_mounts_is_in_the_inventory() -> None:
    stores = " ".join(store for store, _, _ in inventory().values())
    assert [name for name in SECRETS if f"`{name}`" not in stores] == []


def test_the_worker_config_holds_no_secret_value() -> None:
    text = "\n".join(
        line for line in WRANGLER.read_text().splitlines() if not line.lstrip().startswith("//")
    )
    config = json.loads(re.sub(r",(\s*[}\]])", r"\1", text))
    blocks = [config, *config.get("env", {}).values()]
    named = {name for block in blocks for name in block.get("vars", {})}
    assert named & set(inventory()) == set()


def test_no_workflow_sets_a_secret_to_a_literal() -> None:
    names = "|".join(inventory())
    literal = re.compile(rf"^\s+({names}):\s+(?!\$\{{\{{)\S")
    found = [
        f"{workflow.name}: {line.strip()}"
        for workflow in WORKFLOWS.glob("*.yml")
        for line in workflow.read_text().splitlines()
        if literal.match(line)
    ]
    assert found == []
