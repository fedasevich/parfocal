import argparse
import asyncio
import json
import os
import re
import sys
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Protocol

from parfocal_deploy import neon
from parfocal_deploy.bootstrap import bootstrap, new_key, storage_endpoint
from parfocal_deploy.deploy import WebUrl, deploy, modal_web_url
from parfocal_deploy.environments import Environment
from parfocal_deploy.modal_app import KEYS_SECRET, LOGIN_SECRET
from parfocal_deploy.reset import SEED
from parfocal_deploy.tools import (
    MODAL,
    Tools,
    fetch,
    modal_secret_names,
    read,
    required,
    run,
    sql,
    write_modal_secret,
)

MAX_PREVIEWS = 5
EXPIRY_DAYS = 7
SLIDE_BUCKET = "parfocal-dev-eu"
SLIDE_JURISDICTION = "eu"
PREVIEW_MODULES = ("parfocal_deploy.modal_app",)
NUMBER = re.compile(r"[1-9][0-9]{0,6}")
SLUG = re.compile(r"pr-[1-9][0-9]{0,6}")
WORKER = re.compile(r"parfocal-edge-pr-[1-9][0-9]{0,6}")
PREFIX = re.compile(r"previews/pr-[1-9][0-9]{0,6}/")
PREVIEWS_ROOT = "previews/"
PROTECTED = frozenset(
    {"", "main", "dev", "base", "parfocal-edge", "parfocal-edge-dev", "fixtures/", PREVIEWS_ROOT}
)
CLOUDFLARE_API = "https://api.cloudflare.com/client/v4"
TIMEOUT_SECONDS = 60

CREATE_SETTINGS = (
    "NEON_API_KEY",
    "NEON_PROJECT_ID",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "MODAL_TOKEN_ID",
    "MODAL_TOKEN_SECRET",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "MODAL_PROXY_TOKEN_ID",
    "MODAL_PROXY_TOKEN_SECRET",
    "WORKERS_SUBDOMAIN",
    "PREVIEW_ZITADEL_ISSUER",
    "PREVIEW_ZITADEL_CLIENT_ID",
    "PREVIEW_ZITADEL_CLIENT_SECRET",
    "PREVIEW_ZITADEL_LOGIN_TOKEN",
)
TEARDOWN_SETTINGS = (
    "NEON_API_KEY",
    "NEON_PROJECT_ID",
    "CLOUDFLARE_ACCOUNT_ID",
    "CLOUDFLARE_API_TOKEN",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
)

Cloudflare = Callable[[str, str], tuple[int, dict[str, Any]]]


class Bucket(Protocol):
    def list_keys(self, prefix: str) -> list[str]: ...

    def delete(self, key: str) -> None: ...


class RefusedError(Exception):
    def __init__(self, kind: str, name: str, number: int) -> None:
        super().__init__(
            f"refusing to delete the {kind} {name!r}, it is not the preview of #{number}"
        )


class PreviewLimitError(Exception):
    def __init__(self, open_previews: Sequence[str]) -> None:
        super().__init__(
            f"{len(open_previews)} previews already run ({', '.join(open_previews)}), "
            f"the cap is {MAX_PREVIEWS}. Close a pull request or wait for its teardown"
        )


class NoParentError(Exception):
    def __init__(self, parent: str) -> None:
        super().__init__(f"the preview Neon project has no branch {parent or 'marked default'}")


class BadNumberError(Exception):
    def __init__(self, raw: object) -> None:
        super().__init__(f"{raw!r} is not a pull request number")


@dataclass(frozen=True)
class Names:
    number: int

    @property
    def slug(self) -> str:
        return f"pr-{self.number}"

    @property
    def worker(self) -> str:
        return f"parfocal-edge-{self.slug}"

    @property
    def modal_environment(self) -> str:
        return self.slug

    @property
    def neon_branch(self) -> str:
        return self.slug

    @property
    def storage_prefix(self) -> str:
        return f"{PREVIEWS_ROOT}{self.slug}/"


def names(number: object) -> Names:
    if isinstance(number, bool) or not isinstance(number, int | str):
        raise BadNumberError(number)
    if NUMBER.fullmatch(str(number)) is None:
        raise BadNumberError(number)
    return Names(int(number))


def guard(kind: str, name: str, expected: str, pattern: re.Pattern[str], number: int) -> str:
    if name in PROTECTED or name != expected or pattern.fullmatch(name) is None:
        raise RefusedError(kind, name, number)
    return name


def guard_worker(name: str, number: int) -> str:
    return guard("Worker", name, names(number).worker, WORKER, number)


def guard_modal_environment(name: str, number: int) -> str:
    return guard("Modal environment", name, names(number).modal_environment, SLUG, number)


def guard_neon_branch(branch: Mapping[str, Any], number: int) -> str:
    name = str(branch.get("name", ""))
    if branch.get("default") or branch.get("primary") or branch.get("protected"):
        raise RefusedError("Neon branch", name, number)
    guard("Neon branch", name, names(number).neon_branch, SLUG, number)
    return str(branch["id"])


def guard_prefix(prefix: str, number: int) -> str:
    return guard("bucket prefix", prefix, names(number).storage_prefix, PREFIX, number)


def guard_key(key: str, prefix: str, number: int) -> str:
    if not key.startswith(guard_prefix(prefix, number)) or key == prefix:
        raise RefusedError("object", key, number)
    return key


def preview_environment(number: int, subdomain: str) -> Environment:
    chosen = names(number)
    return Environment(
        name=f"preview-{chosen.slug}",
        app_env="preview",
        wrangler_env="",
        worker=chosen.worker,
        hostname=f"{chosen.worker}.{subdomain}.workers.dev",
        modal_environment=chosen.modal_environment,
        neon_branch=chosen.neon_branch,
        tofu_root="",
        slide_bucket=SLIDE_BUCKET,
        storage_jurisdiction=SLIDE_JURISDICTION,
        storage_prefix=chosen.storage_prefix,
    )


def neon_branches(send: neon.Transport, project: str) -> list[dict[str, Any]]:
    return list(send("GET", f"/projects/{project}/branches", None)["branches"])


def preview_number(name: str, pattern: re.Pattern[str], prefix: str) -> int | None:
    if pattern.fullmatch(name) is None:
        return None
    return int(name.removeprefix(prefix).removesuffix("/"))


def expiry(now: datetime) -> str:
    return (now + timedelta(days=EXPIRY_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")


def parent_branch(branches: Iterable[Mapping[str, Any]], parent: str) -> str:
    for branch in branches:
        if (parent and branch["name"] == parent) or (not parent and branch.get("default")):
            return str(branch["id"])
    raise NoParentError(parent)


def ensure_preview_branch(
    send: neon.Transport, project: str, number: int, parent: str, now: datetime
) -> bool:
    chosen = names(number)
    branches = neon_branches(send, project)
    running = sorted(
        str(branch["name"])
        for branch in branches
        if SLUG.fullmatch(str(branch["name"])) and branch["name"] != chosen.neon_branch
    )
    for branch in branches:
        if branch["name"] == chosen.neon_branch:
            send(
                "PATCH",
                f"/projects/{project}/branches/{branch['id']}",
                {"branch": {"expires_at": expiry(now)}},
            )
            return False
    if len(running) >= MAX_PREVIEWS:
        raise PreviewLimitError(running)
    send(
        "POST",
        f"/projects/{project}/branches",
        {
            "branch": {
                "name": chosen.neon_branch,
                "parent_id": parent_branch(branches, parent),
                "expires_at": expiry(now),
            },
            "endpoints": [{"type": "read_write"}],
        },
    )
    return True


def modal_environments(tools: Tools) -> list[str]:
    listed = json.loads(tools.read([*MODAL, "environment", "list", "--json"]))
    return [str(item.get("name") or item.get("Name")) for item in listed]


def ensure_modal_environment(tools: Tools, number: int) -> None:
    name = names(number).modal_environment
    if name not in modal_environments(tools):
        tools.run([*MODAL, "environment", "create", name], None, None)


def login_values(local: Mapping[str, str]) -> dict[str, str]:
    return {"ZITADEL_LOGIN_TOKEN": local["PREVIEW_ZITADEL_LOGIN_TOKEN"]}


def preview_outputs(local: Mapping[str, str]) -> str:
    return json.dumps(
        {
            "zitadel_issuer": {"value": local["PREVIEW_ZITADEL_ISSUER"]},
            "zitadel_client_id": {"value": local["PREVIEW_ZITADEL_CLIENT_ID"]},
            "zitadel_client_secret": {"value": local["PREVIEW_ZITADEL_CLIENT_SECRET"]},
        }
    )


def seed(target: Environment, tools: Tools, settings: Mapping[str, str]) -> None:
    project = settings["NEON_PROJECT_ID"]
    branch = neon.ensure_branch(tools.neon, project, target.neon_branch)
    database = neon.first_database(tools.neon, project, branch)
    direct = neon.owner_uri(tools.neon, project, branch, database, pooled=False)
    tools.run(
        SEED,
        None,
        {
            "DATABASE_URL": neon.engine_uri(direct),
            "APP_ENV": target.app_env,
            "STORAGE_ENDPOINT": storage_endpoint(
                settings["CLOUDFLARE_ACCOUNT_ID"], target.storage_jurisdiction
            ),
            "STORAGE_REGION": "auto",
            "STORAGE_BUCKET": target.slide_bucket,
            "STORAGE_KEY_PREFIX": target.storage_prefix,
            "STORAGE_ACCESS_KEY_ID": settings["R2_ACCESS_KEY_ID"],
            "STORAGE_SECRET_ACCESS_KEY": settings["R2_SECRET_ACCESS_KEY"],
        },
    )


def create(
    number: int,
    tools: Tools,
    local: Mapping[str, str],
    *,
    web_url: WebUrl = modal_web_url,
    make: Callable[[], str] = new_key,
    now: datetime | None = None,
) -> Environment:
    settings = required(local, CREATE_SETTINGS)
    target = preview_environment(number, settings["WORKERS_SUBDOMAIN"])
    fresh = ensure_preview_branch(
        tools.neon,
        settings["NEON_PROJECT_ID"],
        number,
        local.get("PREVIEW_NEON_PARENT", ""),
        now or datetime.now(UTC),
    )
    ensure_modal_environment(tools, number)
    if fresh:
        forget_keys_of_an_old_branch(tools, number)
    bootstrap(target, tools, local, preview_outputs(settings), reset=True, make=make)
    write_modal_secret(
        tools, target.modal_environment, LOGIN_SECRET, login_values(settings), overwrite=True
    )
    deploy(target, tools, local, web_url, modules=PREVIEW_MODULES)
    seed(target, tools, settings)
    return target


def forget_keys_of_an_old_branch(tools: Tools, number: int) -> None:
    environment = guard_modal_environment(names(number).modal_environment, number)
    if KEYS_SECRET in modal_secret_names(tools, environment):
        tools.run([*MODAL, "secret", "delete", KEYS_SECRET, "-e", environment, "--yes"], None, None)


def delete_worker(cloudflare: Cloudflare, account: str, number: int) -> bool:
    name = guard_worker(names(number).worker, number)
    status, _ = cloudflare("DELETE", f"/accounts/{account}/workers/scripts/{name}?force=true")
    if status == 404:
        return False
    if status >= 300:
        raise RuntimeError(f"Cloudflare answered {status} when deleting the Worker {name}")
    return True


def delete_modal_environment(tools: Tools, number: int) -> bool:
    name = guard_modal_environment(names(number).modal_environment, number)
    if name not in modal_environments(tools):
        return False
    tools.run([*MODAL, "environment", "delete", name, "--yes"], None, None)
    return True


def delete_neon_branch(send: neon.Transport, project: str, number: int) -> bool:
    wanted = names(number).neon_branch
    for branch in neon_branches(send, project):
        if branch["name"] == wanted:
            send(
                "DELETE", f"/projects/{project}/branches/{guard_neon_branch(branch, number)}", None
            )
            return True
    return False


def delete_prefix(bucket: Bucket, number: int) -> int:
    prefix = guard_prefix(names(number).storage_prefix, number)
    keys = [guard_key(key, prefix, number) for key in bucket.list_keys(prefix)]
    for key in keys:
        bucket.delete(key)
    return len(keys)


@dataclass(frozen=True)
class Removed:
    worker: bool
    modal_environment: bool
    neon_branch: bool
    objects: int


def teardown(
    number: int, tools: Tools, cloudflare: Cloudflare, bucket: Bucket, local: Mapping[str, str]
) -> Removed:
    settings = required(local, TEARDOWN_SETTINGS)
    return Removed(
        worker=delete_worker(cloudflare, settings["CLOUDFLARE_ACCOUNT_ID"], number),
        modal_environment=delete_modal_environment(tools, number),
        neon_branch=delete_neon_branch(tools.neon, settings["NEON_PROJECT_ID"], number),
        objects=delete_prefix(bucket, number),
    )


def open_pull_requests(tools: Tools) -> set[int]:
    listed = json.loads(
        tools.read(["gh", "pr", "list", "--state", "open", "--json", "number", "--limit", "1000"])
    )
    return {names(item["number"]).number for item in listed}


def leftover_numbers(
    tools: Tools, cloudflare: Cloudflare, bucket: Bucket, local: Mapping[str, str]
) -> set[int]:
    status, body = cloudflare("GET", f"/accounts/{local['CLOUDFLARE_ACCOUNT_ID']}/workers/scripts")
    if status >= 300:
        raise RuntimeError(f"Cloudflare answered {status} when listing Workers")
    found = [
        preview_number(str(script["id"]), WORKER, "parfocal-edge-pr-")
        for script in body.get("result", [])
    ]
    found += [preview_number(name, SLUG, "pr-") for name in modal_environments(tools)]
    found += [
        preview_number(str(branch["name"]), SLUG, "pr-")
        for branch in neon_branches(tools.neon, local["NEON_PROJECT_ID"])
    ]
    found += [
        preview_number("/".join(key.split("/")[:2]) + "/", PREFIX, "previews/pr-")
        for key in bucket.list_keys(PREVIEWS_ROOT)
    ]
    return {number for number in found if number is not None}


def sweep(
    tools: Tools, cloudflare: Cloudflare, bucket: Bucket, local: Mapping[str, str]
) -> dict[int, Removed]:
    settings = required(local, TEARDOWN_SETTINGS)
    still_open = open_pull_requests(tools)
    closed = leftover_numbers(tools, cloudflare, bucket, settings) - still_open
    return {
        number: teardown(number, tools, cloudflare, bucket, settings) for number in sorted(closed)
    }


def cloudflare_transport(token: str) -> Cloudflare:
    def send(method: str, path: str) -> tuple[int, dict[str, Any]]:
        request = urllib.request.Request(
            f"{CLOUDFLARE_API}{path}",
            method=method,
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        )
        try:
            with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
                return response.status, json.loads(response.read() or b"{}")
        except urllib.error.HTTPError as error:
            return error.code, {}

    return send


class R2Bucket:
    def __init__(self, local: Mapping[str, str]) -> None:
        from parfocal_common.object_store import StorageLocation

        self.location = StorageLocation(
            endpoint=storage_endpoint(local["CLOUDFLARE_ACCOUNT_ID"], SLIDE_JURISDICTION),
            region="auto",
            bucket=SLIDE_BUCKET,
            access_key_id=local["R2_ACCESS_KEY_ID"],
            secret_access_key=local["R2_SECRET_ACCESS_KEY"],
        )

    def call(self, method: str, key: str) -> Any:
        import httpx2

        from parfocal_common.object_store import ObjectStore

        async def go() -> Any:
            async with httpx2.AsyncClient(timeout=TIMEOUT_SECONDS) as http:
                store = ObjectStore(self.location, http)
                if method == "list":
                    return await store.list_keys(key)
                return await store.delete_object(key)

        return asyncio.run(go())

    def list_keys(self, prefix: str) -> list[str]:
        return list(self.call("list", prefix))

    def delete(self, key: str) -> None:
        self.call("delete", key)


def live_tools() -> Tools:
    api_key = required(os.environ, ["NEON_API_KEY"])["NEON_API_KEY"]
    return Tools(run=run, read=read, sql=sql, neon=neon.http_transport(api_key), fetch=fetch)


def main(argv: Sequence[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog="parfocal_deploy.preview")
    parser.add_argument("action", choices=["create", "teardown", "sweep"])
    parser.add_argument("--pr", default="")
    arguments = parser.parse_args(argv)
    tools = live_tools()
    if arguments.action == "create":
        target = create(names(arguments.pr).number, tools, os.environ)
        sys.stdout.write(f"{target.origin}\n")
        return
    settings = required(os.environ, TEARDOWN_SETTINGS)
    cloudflare = cloudflare_transport(settings["CLOUDFLARE_API_TOKEN"])
    bucket = R2Bucket(settings)
    if arguments.action == "teardown":
        removed = teardown(names(arguments.pr).number, tools, cloudflare, bucket, settings)
        sys.stdout.write(f"#{arguments.pr}: {removed}\n")
        return
    for number, removed in sweep(tools, cloudflare, bucket, settings).items():
        sys.stdout.write(f"#{number}: {removed}\n")


if __name__ == "__main__":
    main()
