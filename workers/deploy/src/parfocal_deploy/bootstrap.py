import argparse
import json
import os
import secrets
import sys
from collections.abc import Callable, Mapping

from parfocal_deploy import neon
from parfocal_deploy.environments import Environment, environment
from parfocal_deploy.modal_app import CONFIG_SECRET, KEYS_SECRET
from parfocal_deploy.tools import (
    Tools,
    fetch,
    modal_secret_names,
    read,
    required,
    run,
    sql,
    write_modal_secret,
    write_worker_secrets,
)

LOCAL_SETTINGS = (
    "NEON_API_KEY",
    "NEON_PROJECT_ID",
    "CLOUDFLARE_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "MODAL_PROXY_TOKEN_ID",
    "MODAL_PROXY_TOKEN_SECRET",
)
PROXY_TOKEN = ("MODAL_PROXY_TOKEN_ID", "MODAL_PROXY_TOKEN_SECRET")
OUTPUTS = ("zitadel_issuer", "zitadel_client_id", "zitadel_client_secret")
PASSED_THROUGH = (
    "EMAIL_BACKEND",
    "ERROR_BACKEND",
    "TELEMETRY_EXPORT",
    "ANALYTICS_BACKEND",
    "FLAG_BACKEND",
)
MASTER_KEY_ID = "k1"
KEY_BYTES = 32

WORKER_SECRETS = "worker-secrets"
CREATE_ROLE = "create-role"
RESET_ROLE = "reset-role"
KEYS = "keys-secret"
CONFIG = "config-secret"


class RoleWithoutKeysError(Exception):
    def __init__(self) -> None:
        super().__init__(
            f"the role {neon.APP_ROLE} exists but the Modal secret {KEYS_SECRET} does not. "
            "Its password is lost. Run again with --reset-app-role-password after the owner agrees"
        )


class MissingOutputError(Exception):
    def __init__(self, name: str) -> None:
        super().__init__(f"the OpenTofu root has no output {name}")


def output_values(raw: str) -> dict[str, str]:
    parsed = json.loads(raw)
    for name in OUTPUTS:
        if name not in parsed:
            raise MissingOutputError(name)
    return {name: str(parsed[name]["value"]) for name in OUTPUTS}


def storage_endpoint(account: str) -> str:
    return f"https://{account}.r2.cloudflarestorage.com"


def config_values(
    target: Environment, outputs: Mapping[str, str], local: Mapping[str, str]
) -> dict[str, str]:
    values = {
        "APP_ENV": target.app_env,
        "PUBLIC_ORIGIN": target.origin,
        "REALTIME_INTERNAL_URL": target.origin,
        "ZITADEL_ISSUER": outputs["zitadel_issuer"],
        "ZITADEL_CLIENT_ID": outputs["zitadel_client_id"],
        "ZITADEL_CLIENT_SECRET": outputs["zitadel_client_secret"],
        "STORAGE_ENDPOINT": storage_endpoint(local["CLOUDFLARE_ACCOUNT_ID"]),
        "STORAGE_REGION": "auto",
        "STORAGE_BUCKET": target.slide_bucket,
        "STORAGE_ACCESS_KEY_ID": local["R2_ACCESS_KEY_ID"],
        "STORAGE_SECRET_ACCESS_KEY": local["R2_SECRET_ACCESS_KEY"],
    }
    return values | {name: local[name] for name in PASSED_THROUGH if local.get(name)}


def new_key() -> str:
    return secrets.token_urlsafe(KEY_BYTES)


def generated_keys(make: Callable[[], str] = new_key) -> dict[str, str]:
    return {
        "SESSION_KEY": make(),
        "MASTER_KEYS": f"{MASTER_KEY_ID}:{make()}",
        "TILE_TOKEN_KEY": make(),
        "ROOM_TOKEN_KEY": make(),
    }


def worker_secrets(keys: Mapping[str, str], local: Mapping[str, str]) -> dict[str, str]:
    shared = {name: keys[name] for name in ("TILE_TOKEN_KEY", "ROOM_TOKEN_KEY")}
    shared |= {name: local[name] for name in PROXY_TOKEN}
    turnstile = local.get("TURNSTILE_SECRET_KEY")
    return shared | ({"TURNSTILE_SECRET_KEY": turnstile} if turnstile else {})


def steps(*, keys_secret: bool, app_role: bool, reset: bool) -> list[str]:
    if keys_secret:
        return [CONFIG]
    if not app_role:
        return [WORKER_SECRETS, CREATE_ROLE, KEYS, CONFIG]
    if not reset:
        raise RoleWithoutKeysError
    return [WORKER_SECRETS, RESET_ROLE, KEYS, CONFIG]


def bootstrap(
    target: Environment,
    tools: Tools,
    local: Mapping[str, str],
    raw_outputs: str,
    *,
    reset: bool = False,
    make: Callable[[], str] = new_key,
) -> list[str]:
    settings = required(local, LOCAL_SETTINGS)
    outputs = output_values(raw_outputs)
    project = settings["NEON_PROJECT_ID"]
    branch = neon.ensure_branch(tools.neon, project, target.neon_branch)
    database = neon.first_database(tools.neon, project, branch)
    direct = neon.owner_uri(tools.neon, project, branch, database, pooled=False)
    planned = steps(
        keys_secret=KEYS_SECRET in modal_secret_names(tools, target.modal_environment),
        app_role=bool(tools.sql(direct, neon.ROLE_EXISTS)),
        reset=reset,
    )
    if KEYS in planned:
        keys = generated_keys(make)
        password = make()
        pooled = neon.owner_uri(tools.neon, project, branch, database, pooled=True)
        write_worker_secrets(tools, target.wrangler_env, worker_secrets(keys, local))
        statements = (
            neon.create_role_statements(database.name, password)
            if CREATE_ROLE in planned
            else [neon.reset_password_statement(password)]
        )
        for statement in statements:
            tools.sql(direct, statement)
        write_modal_secret(
            tools,
            target.modal_environment,
            KEYS_SECRET,
            keys | {"DATABASE_URL": neon.app_uri(pooled, password)},
            overwrite=False,
        )
    write_modal_secret(
        tools,
        target.modal_environment,
        CONFIG_SECRET,
        config_values(target, outputs, settings | dict(local)),
        overwrite=True,
    )
    return planned


def main() -> None:
    parser = argparse.ArgumentParser(prog="parfocal_deploy.bootstrap")
    parser.add_argument("--env", default="production")
    parser.add_argument("--reset-app-role-password", action="store_true")
    arguments = parser.parse_args()
    target = environment(arguments.env)
    api_key = required(os.environ, ["NEON_API_KEY"])["NEON_API_KEY"]
    tools = Tools(run=run, read=read, sql=sql, neon=neon.http_transport(api_key), fetch=fetch)
    raw_outputs = read(["infra/tofu/tofu.sh", target.tofu_root, "output", "-json"])
    done = bootstrap(
        target, tools, os.environ, raw_outputs, reset=arguments.reset_app_role_password
    )
    sys.stdout.write(f"{target.name}: {', '.join(done)}\n")


if __name__ == "__main__":
    main()
