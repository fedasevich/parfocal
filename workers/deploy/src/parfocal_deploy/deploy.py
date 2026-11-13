import argparse
import os
import sys
from collections.abc import Callable, Collection, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from parfocal_deploy import migrations, neon
from parfocal_deploy.bootstrap import storage_endpoint
from parfocal_deploy.environments import Environment, environment
from parfocal_deploy.modal_app import APP_NAME, SECRETS, WEB_FUNCTION
from parfocal_deploy.tools import (
    MODAL,
    WRANGLER,
    Read,
    Tools,
    fetch,
    modal_secret_names,
    read,
    required,
    run,
    sql,
)

CI_SETTINGS = (
    "CLOUDFLARE_API_TOKEN",
    "CLOUDFLARE_ACCOUNT_ID",
    "MODAL_TOKEN_ID",
    "MODAL_TOKEN_SECRET",
    "NEON_API_KEY",
    "NEON_PROJECT_ID",
)
MODAL_MODULES = ("parfocal_deploy.modal_app", "parfocal_ml.modal_pool")
MIGRATE = (
    "uv",
    "run",
    "--package",
    "parfocal-api",
    "alembic",
    "-c",
    "apps/api/alembic.ini",
    "upgrade",
    "head",
)
BUILD_WEB = ("pnpm", "--filter", "@parfocal/web", "build")
ISOLATION_HEADERS = {
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "credentialless",
}

WebUrl = Callable[[Environment], str]


@dataclass(frozen=True)
class Command:
    argv: tuple[str, ...]
    extra: Mapping[str, str] | None = None


class NotBootstrappedError(Exception):
    def __init__(self, target: Environment, names: Sequence[str]) -> None:
        super().__init__(
            f"the Modal environment {target.modal_environment} has no secret {', '.join(names)}. "
            f"Run pnpm --filter @parfocal/deploy bootstrap --env {target.name} once"
        )


class SmokeCheckError(Exception):
    pass


def modal_commands(target: Environment) -> list[Command]:
    return [
        Command((*MODAL, "deploy", "-e", target.modal_environment, "-m", module))
        for module in MODAL_MODULES
    ]


def edge_commands(target: Environment, account: str, api_origin: str) -> list[Command]:
    return [
        Command(BUILD_WEB, {"PARFOCAL_PUBLIC_APP_ENV": target.app_env}),
        Command(
            (
                *WRANGLER,
                "deploy",
                "--env",
                target.wrangler_env,
                "--var",
                f"API_ORIGIN:{api_origin}",
                "--var",
                f"UPLOAD_ORIGIN:{storage_endpoint(account)}",
            )
        ),
    ]


def smoke_check(target: Environment, tools: Tools) -> None:
    status, _ = tools.fetch(f"{target.origin}/api/health")
    if status != 200:
        raise SmokeCheckError(f"{target.origin}/api/health answered {status}")
    status, headers = tools.fetch(f"{target.origin}/")
    wrong = [name for name, value in ISOLATION_HEADERS.items() if headers.get(name) != value]
    if status != 200 or wrong:
        raise SmokeCheckError(
            f"{target.origin}/ answered {status}, wrong headers {', '.join(wrong)}"
        )


def modal_web_url(target: Environment) -> str:
    import modal

    function = modal.Function.from_name(
        APP_NAME, WEB_FUNCTION, environment_name=target.modal_environment
    )
    url = function.get_web_url()
    if url is None:
        raise SmokeCheckError(f"the Modal function {WEB_FUNCTION} has no web URL")
    return url.rstrip("/")


def is_head_of(read_output: Read, branch: str) -> bool:
    checked_out = read_output(["git", "rev-parse", "HEAD"]).strip()
    remote = read_output(["git", "ls-remote", "origin", f"refs/heads/{branch}"]).split()
    return bool(remote) and remote[0] == checked_out


def revisions(text: str) -> frozenset[str]:
    return frozenset(name.strip() for name in text.split(",") if name.strip())


def deploy(
    target: Environment,
    tools: Tools,
    local: Mapping[str, str],
    web_url: WebUrl = modal_web_url,
    *,
    migrate: bool = True,
    allow_destructive: Collection[str] = (),
    versions: Path = migrations.VERSIONS,
) -> None:
    settings = required(local, CI_SETTINGS)
    found = modal_secret_names(tools, target.modal_environment)
    absent = [name for name in SECRETS if name not in found]
    if absent:
        raise NotBootstrappedError(target, absent)
    if migrate:
        project = settings["NEON_PROJECT_ID"]
        branch = neon.ensure_branch(tools.neon, project, target.neon_branch)
        database = neon.first_database(tools.neon, project, branch)
        direct = neon.owner_uri(tools.neon, project, branch, database, pooled=False)
        migrations.check(migrations.current_revision(tools, direct), allow_destructive, versions)
        tools.run(MIGRATE, None, {"MIGRATION_DATABASE_URL": neon.engine_uri(direct)})
    for command in modal_commands(target):
        tools.run(command.argv, None, command.extra)
    for command in edge_commands(target, settings["CLOUDFLARE_ACCOUNT_ID"], web_url(target)):
        tools.run(command.argv, None, command.extra)
    smoke_check(target, tools)


def main() -> None:
    parser = argparse.ArgumentParser(prog="parfocal_deploy.deploy")
    parser.add_argument("--env", default="production")
    parser.add_argument("--skip-migrations", action="store_true")
    parser.add_argument("--allow-destructive", default="")
    parser.add_argument("--only-head-of", default="")
    arguments = parser.parse_args()
    target = environment(arguments.env)
    if arguments.only_head_of and not is_head_of(read, arguments.only_head_of):
        sys.stdout.write(
            f"this commit is no longer the head of {arguments.only_head_of}, "
            "a newer deploy replaces it and nothing was run\n"
        )
        return
    api_key = required(os.environ, ["NEON_API_KEY"])["NEON_API_KEY"]
    tools = Tools(run=run, read=read, sql=sql, neon=neon.http_transport(api_key), fetch=fetch)
    try:
        deploy(
            target,
            tools,
            os.environ,
            migrate=not arguments.skip_migrations,
            allow_destructive=revisions(arguments.allow_destructive),
        )
    except (migrations.DestructiveMigrationError, migrations.MigrationHistoryError) as error:
        sys.exit(str(error))
    sys.stdout.write(f"{target.name} is deployed at {target.origin}\n")


if __name__ == "__main__":
    main()
