import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from parfocal_deploy import neon
from parfocal_deploy.bootstrap import (
    CONFIG,
    CREATE_ROLE,
    KEYS,
    RESET_ROLE,
    WORKER_SECRETS,
    RoleWithoutKeysError,
    bootstrap,
    steps,
)
from parfocal_deploy.deploy import (
    ISOLATION_HEADERS,
    NotBootstrappedError,
    SmokeCheckError,
    deploy,
)
from parfocal_deploy.environments import ENVIRONMENTS, UnknownEnvironmentError, environment
from parfocal_deploy.modal_app import CONFIG_SECRET, KEYS_SECRET
from parfocal_deploy.tools import MissingSettingsError, Tools

PRODUCTION = environment("production")
OWNER_HOST = "ep-quiet.us-east-1.aws.neon.tech"
LOCAL = {
    "NEON_API_KEY": "neon-key",
    "NEON_PROJECT_ID": "project-1",
    "CLOUDFLARE_ACCOUNT_ID": "account-1",
    "CLOUDFLARE_API_TOKEN": "cloudflare-token",
    "MODAL_TOKEN_ID": "modal-id",
    "MODAL_TOKEN_SECRET": "modal-secret",
    "R2_ACCESS_KEY_ID": "r2-id",
    "R2_SECRET_ACCESS_KEY": "r2-secret",
}
OUTPUTS = json.dumps(
    {
        "app_origin": {"value": "https://app.parfocal.eu"},
        "slide_bucket": {"value": "parfocal-prod"},
        "zitadel_issuer": {"value": "https://issuer.example"},
        "zitadel_client_id": {"value": "client-1"},
        "zitadel_client_secret": {"value": "client-secret", "sensitive": True},
    }
)


def owner_uri(host: str) -> str:
    login = ":".join(["neondb_owner", "owner-word"])
    return f"postgresql://{login}@{host}/neondb?sslmode=require&channel_binding=require"


@dataclass
class Cloud:
    branches: list[str] = field(default_factory=lambda: ["main"])
    modal_secrets: dict[str, dict[str, str]] = field(default_factory=dict)
    worker_secrets: dict[str, str] = field(default_factory=dict)
    roles: set[str] = field(default_factory=set)
    neon_writes: list[str] = field(default_factory=list)
    statements: list[str] = field(default_factory=list)
    commands: list[tuple[tuple[str, ...], dict[str, str]]] = field(default_factory=list)
    health: int = 200
    headers: dict[str, str] = field(default_factory=lambda: dict(ISOLATION_HEADERS))

    def neon(self, method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
        if method == "POST" and body is not None:
            self.neon_writes.append(path)
            self.branches.append(body["branch"]["name"])
            name = body["branch"]["name"]
            return {"branch": {"id": f"br-{name}", "name": name}}
        if path.endswith("/branches"):
            return {"branches": [{"id": f"br-{name}", "name": name} for name in self.branches]}
        if path.endswith("/databases"):
            return {"databases": [{"name": "neondb", "owner_name": "neondb_owner"}]}
        suffix = "-pooler" if "pooled=true" in path else ""
        return {"uri": owner_uri(f"ep-quiet{suffix}.us-east-1.aws.neon.tech")}

    def sql(self, uri: str, statement: str) -> list[Any]:
        assert OWNER_HOST in uri
        if statement == neon.ROLE_EXISTS:
            return [1] if neon.APP_ROLE in self.roles else []
        self.statements.append(statement)
        if statement.startswith("CREATE ROLE"):
            self.roles.add(neon.APP_ROLE)
        return []

    def read(self, argv: Sequence[str]) -> str:
        assert "list" in argv
        return json.dumps([{"Name": name} for name in self.modal_secrets])

    def run(self, argv: Sequence[str], stdin: str | None, extra: Mapping[str, str] | None) -> None:
        self.commands.append((tuple(argv), dict(extra or {})))
        if "bulk" in argv:
            assert stdin is not None
            self.worker_secrets = json.loads(stdin)
        if "create" in argv:
            name = argv[argv.index("create") + 1]
            path = Path(argv[argv.index("--from-json") + 1])
            assert path.stat().st_mode & 0o077 == 0
            assert name not in self.modal_secrets or "--force" in argv
            self.modal_secrets[name] = json.loads(path.read_text())

    def fetch(self, url: str) -> tuple[int, Mapping[str, str]]:
        return (self.health, {}) if url.endswith("/api/health") else (200, self.headers)

    def tools(self) -> Tools:
        return Tools(run=self.run, read=self.read, sql=self.sql, neon=self.neon, fetch=self.fetch)


def test_an_unknown_environment_is_refused_and_production_is_the_only_live_target() -> None:
    assert sorted(ENVIRONMENTS) == ["production", "staging"]
    assert (PRODUCTION.modal_environment, PRODUCTION.neon_branch, PRODUCTION.tofu_root) == (
        "main",
        "main",
        "prod",
    )
    assert PRODUCTION.slide_bucket == "parfocal-dev"
    with pytest.raises(UnknownEnvironmentError):
        environment("preview")


def test_the_branch_is_created_only_when_missing_and_never_twice() -> None:
    cloud = Cloud(branches=["main"])
    first = neon.ensure_branch(cloud.neon, "project-1", "staging")
    second = neon.ensure_branch(cloud.neon, "project-1", "staging")
    assert first == second
    assert cloud.neon_writes == ["/projects/project-1/branches"]
    neon.ensure_branch(cloud.neon, "project-1", "main")
    assert len(cloud.neon_writes) == 1


def test_the_app_role_cannot_bypass_row_security_and_its_password_is_checked() -> None:
    password = "p" * 43
    statements = neon.create_role_statements("neondb", password)
    assert "NOBYPASSRLS" in statements[0]
    assert "NOSUPERUSER" in statements[0]
    with pytest.raises(neon.UnsafePasswordError):
        neon.create_role_statements("neondb", "x'; DROP ROLE neondb_owner; --")
    uri = neon.app_uri(owner_uri("host-pooler.neon.tech"), password)
    assert uri == f"postgresql://parfocal_app:{password}@host-pooler.neon.tech/neondb?ssl=require"


def test_the_first_bootstrap_writes_keys_once_and_the_second_only_the_config() -> None:
    cloud = Cloud()
    made = iter(f"{index:02d}" + "k" * 41 for index in range(100))
    first = bootstrap(PRODUCTION, cloud.tools(), LOCAL, OUTPUTS, make=lambda: next(made))
    assert first == [WORKER_SECRETS, CREATE_ROLE, KEYS, CONFIG]
    keys = dict(cloud.modal_secrets[KEYS_SECRET])
    assert sorted(keys) == [
        "DATABASE_URL",
        "MASTER_KEYS",
        "ROOM_TOKEN_KEY",
        "SESSION_KEY",
        "TILE_TOKEN_KEY",
    ]
    assert keys["DATABASE_URL"].startswith("postgresql://parfocal_app:")
    assert "-pooler" in keys["DATABASE_URL"]
    assert keys["DATABASE_URL"].endswith("/neondb?ssl=require")
    assert cloud.worker_secrets == {
        "TILE_TOKEN_KEY": keys["TILE_TOKEN_KEY"],
        "ROOM_TOKEN_KEY": keys["ROOM_TOKEN_KEY"],
    }
    config = cloud.modal_secrets[CONFIG_SECRET]
    assert config["APP_ENV"] == "prod"
    assert config["PUBLIC_ORIGIN"] == "https://app.parfocal.eu"
    assert config["STORAGE_BUCKET"] == "parfocal-dev"
    assert config["STORAGE_ENDPOINT"] == "https://account-1.r2.cloudflarestorage.com"
    assert config["ZITADEL_CLIENT_ID"] == "client-1"
    statements = len(cloud.statements)

    second = bootstrap(PRODUCTION, cloud.tools(), LOCAL, OUTPUTS, make=lambda: next(made))
    assert second == [CONFIG]
    assert cloud.modal_secrets[KEYS_SECRET] == keys
    assert len(cloud.statements) == statements
    assert cloud.neon_writes == []


def test_no_secret_value_is_passed_as_a_command_argument() -> None:
    cloud = Cloud()
    bootstrap(PRODUCTION, cloud.tools(), LOCAL, OUTPUTS)
    secret_values = {
        *cloud.modal_secrets[KEYS_SECRET].values(),
        "client-secret",
        "r2-secret",
    }
    for argv, _ in cloud.commands:
        assert not secret_values.intersection(argv)


def test_a_role_without_its_keys_secret_stops_until_the_reset_is_named() -> None:
    with pytest.raises(RoleWithoutKeysError):
        steps(keys_secret=False, app_role=True, reset=False)
    assert steps(keys_secret=False, app_role=True, reset=True) == [
        WORKER_SECRETS,
        RESET_ROLE,
        KEYS,
        CONFIG,
    ]
    cloud = Cloud(roles={neon.APP_ROLE})
    with pytest.raises(RoleWithoutKeysError):
        bootstrap(PRODUCTION, cloud.tools(), LOCAL, OUTPUTS)
    assert cloud.commands == []
    assert cloud.statements == []


def test_bootstrap_and_deploy_name_every_missing_setting_before_touching_anything() -> None:
    cloud = Cloud()
    with pytest.raises(MissingSettingsError, match="NEON_PROJECT_ID, R2_ACCESS_KEY_ID"):
        bootstrap(
            PRODUCTION,
            cloud.tools(),
            {k: v for k, v in LOCAL.items() if k not in ("NEON_PROJECT_ID", "R2_ACCESS_KEY_ID")},
            OUTPUTS,
        )
    with pytest.raises(MissingSettingsError, match="MODAL_TOKEN_ID"):
        deploy(PRODUCTION, cloud.tools(), {k: v for k, v in LOCAL.items() if k != "MODAL_TOKEN_ID"})
    assert cloud.commands == []


def test_deploy_refuses_an_environment_that_was_never_bootstrapped() -> None:
    cloud = Cloud()
    with pytest.raises(NotBootstrappedError, match=KEYS_SECRET):
        deploy(PRODUCTION, cloud.tools(), LOCAL)
    assert cloud.commands == []


def test_deploy_migrates_then_ships_modal_then_the_worker_and_checks_it() -> None:
    cloud = Cloud(modal_secrets={KEYS_SECRET: {}, CONFIG_SECRET: {}})
    deploy(PRODUCTION, cloud.tools(), LOCAL, web_url=lambda _: "https://api.modal.example")
    lines = [" ".join(argv) for argv, _ in cloud.commands]
    assert [
        line.split(" ", 4)[-1] if line.startswith("uv run --package") else line for line in lines
    ] == [
        "alembic -c apps/api/alembic.ini upgrade head",
        "modal deploy -e main -m parfocal_deploy.modal_app",
        "modal deploy -e main -m parfocal_ml.modal_pool",
        "pnpm --filter @parfocal/web build",
        "pnpm --filter @parfocal/edge exec wrangler deploy --env production "
        "--var API_ORIGIN:https://api.modal.example "
        "--var UPLOAD_ORIGIN:https://account-1.r2.cloudflarestorage.com",
    ]
    migration = cloud.commands[0][1]["MIGRATION_DATABASE_URL"]
    assert "neondb_owner" in migration
    assert "-pooler" not in migration
    assert migration.endswith("/neondb?ssl=require")
    assert cloud.commands[3][1] == {"PARFOCAL_PUBLIC_APP_ENV": "prod"}
    assert cloud.neon_writes == []


def test_deploy_fails_when_health_or_the_isolation_headers_are_wrong() -> None:
    ready = {KEYS_SECRET: {}, CONFIG_SECRET: {}}
    with pytest.raises(SmokeCheckError, match="503"):
        deploy(
            PRODUCTION,
            Cloud(modal_secrets=dict(ready), health=503).tools(),
            LOCAL,
            lambda _: "https://a",
        )
    with pytest.raises(SmokeCheckError, match="cross-origin-embedder-policy"):
        deploy(
            PRODUCTION,
            Cloud(
                modal_secrets=dict(ready),
                headers={"cross-origin-opener-policy": "same-origin"},
            ).tools(),
            LOCAL,
            lambda _: "https://a",
        )
