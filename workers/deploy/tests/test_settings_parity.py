import re
from pathlib import Path

from parfocal_api.settings import ApiSettings
from parfocal_deploy.bootstrap import config_values, generated_keys
from parfocal_deploy.environments import environment
from parfocal_deploy.tools import REPOSITORY

ROOT = Path(REPOSITORY)
STACK_COMPOSE = ROOT / "infra/local/stack.compose.yaml"
ZITADEL_UP = ROOT / "infra/local/zitadel-up.sh"
ENV_LINE = re.compile(r"^ {2,6}([A-Z][A-Z0-9_]*):", re.MULTILINE)
ZITADEL_LINE = re.compile(r'^\s*echo "([A-Z][A-Z0-9_]*)=', re.MULTILINE)
LOCAL = {
    "CLOUDFLARE_ACCOUNT_ID": "account",
    "R2_ACCESS_KEY_ID": "id",
    "R2_SECRET_ACCESS_KEY": "secret",
}
OUTPUTS = {
    "zitadel_issuer": "https://issuer.example",
    "zitadel_client_id": "client",
    "zitadel_client_secret": "secret",
}


def required_settings() -> set[str]:
    return {name.upper() for name, field in ApiSettings.model_fields.items() if field.is_required()}


def block(text: str, start: str, end: str) -> str:
    begin = text.index(start)
    return text[begin : text.index(end, begin + len(start))]


def stack_env() -> set[str]:
    compose = STACK_COMPOSE.read_text()
    shared = block(compose, "x-stack-env:", "\nservices:")
    server = block(compose, "\n  server:", "\n  loopback:")
    identity = ZITADEL_UP.read_text()
    return set(ENV_LINE.findall(shared + server)) | set(ZITADEL_LINE.findall(identity))


def production_secret_keys() -> set[str]:
    configured = config_values(environment("production"), OUTPUTS, LOCAL)
    return set(generated_keys(lambda: "key")) | {"DATABASE_URL"} | set(configured)


def test_the_required_settings_are_found() -> None:
    assert {"DATABASE_URL", "SESSION_KEY", "ZITADEL_ISSUER"} <= required_settings()


def test_the_stack_env_carries_every_required_setting() -> None:
    assert required_settings() - stack_env() == set()


def test_the_production_secrets_carry_every_required_setting() -> None:
    assert required_settings() - production_secret_keys() == set()
