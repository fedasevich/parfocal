import argparse
import os
import re
import sys
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Protocol

from parfocal_api.key_rotation import KeyringStatus, check_retire
from parfocal_common.envelope import MasterKeyring
from parfocal_deploy import neon
from parfocal_deploy.bootstrap import new_key
from parfocal_deploy.environments import Environment, environment
from parfocal_deploy.modal_app import KEYS_SECRET
from parfocal_deploy.tools import (
    Tools,
    fetch,
    modal_secret_names,
    read,
    required,
    run,
    sql,
    write_worker_secrets,
)

MASTER_KEYS = "MASTER_KEYS"
DATABASE_URL = "DATABASE_URL"
SESSION_KEY = "SESSION_KEY"
SHARED_TOKEN_KEYS = ("TILE_TOKEN_KEY", "ROOM_TOKEN_KEY")
REPLACEABLE = (SESSION_KEY, *SHARED_TOKEN_KEYS)
NEON_SETTINGS = ("NEON_API_KEY", "NEON_PROJECT_ID")
MASTER_ID = re.compile(r"k(\d+)")


@dataclass(frozen=True)
class MasterState:
    stored: str
    wrapped_by: dict[str, int]


class KeysStore(Protocol):
    def exists(self) -> bool: ...

    def keyring(self, action: str) -> MasterState: ...

    def merge(self, values: Mapping[str, str]) -> None: ...


class RotationRefusedError(Exception):
    pass


class MissingKeysSecretError(RotationRefusedError):
    def __init__(self) -> None:
        super().__init__(
            f"the Modal secret {KEYS_SECRET} does not exist. Run bootstrap, which creates it whole"
        )


def next_master_id(listed: list[str]) -> str:
    numbers = [int(match.group(1)) for key_id in listed if (match := MASTER_ID.fullmatch(key_id))]
    return f"k{max(numbers, default=0) + 1}"


def pairs(stored: str) -> list[tuple[str, str]]:
    MasterKeyring.from_setting(stored)
    return [
        (key_id, encoded)
        for key_id, _, encoded in (
            item.strip().partition(":") for item in stored.split(",") if item.strip()
        )
    ]


def joined(kept: list[tuple[str, str]]) -> str:
    value = ",".join(f"{key_id}:{encoded}" for key_id, encoded in kept)
    MasterKeyring.from_setting(value)
    return value


def checked_store(store: KeysStore) -> KeysStore:
    if not store.exists():
        raise MissingKeysSecretError
    return store


def add_master_key(store: KeysStore, make: Callable[[], str] = new_key) -> str:
    current = pairs(checked_store(store).keyring("status").stored)
    key_id = next_master_id([key_id for key_id, _ in current])
    store.merge({MASTER_KEYS: joined([(key_id, make()), *current])})
    return key_id


def rewrap(store: KeysStore) -> dict[str, int]:
    return checked_store(store).keyring("rewrap").wrapped_by


def retire_master_key(store: KeysStore, key_id: str) -> None:
    state = checked_store(store).keyring("status")
    current = pairs(state.stored)
    listed = tuple(listed_id for listed_id, _ in current)
    check_retire(KeyringStatus(listed[0], listed, state.wrapped_by), key_id)
    store.merge({MASTER_KEYS: joined([pair for pair in current if pair[0] != key_id])})


def replace_key(
    store: KeysStore,
    tools: Tools,
    target: Environment,
    name: str,
    make: Callable[[], str] = new_key,
) -> None:
    if name not in REPLACEABLE:
        raise RotationRefusedError(f"{name} is not one of {', '.join(REPLACEABLE)}")
    checked_store(store)
    value = make()
    if name in SHARED_TOKEN_KEYS:
        write_worker_secrets(tools, target.wrangler_env, {name: value})
    store.merge({name: value})


def reset_app_password(
    store: KeysStore,
    tools: Tools,
    target: Environment,
    local: Mapping[str, str],
    make: Callable[[], str] = new_key,
) -> None:
    settings = required(local, NEON_SETTINGS)
    checked_store(store)
    project = settings["NEON_PROJECT_ID"]
    branch = neon.ensure_branch(tools.neon, project, target.neon_branch)
    database = neon.first_database(tools.neon, project, branch)
    direct = neon.owner_uri(tools.neon, project, branch, database, pooled=False)
    pooled = neon.owner_uri(tools.neon, project, branch, database, pooled=True)
    password = make()
    tools.sql(direct, neon.reset_password_statement(password))
    store.merge({DATABASE_URL: neon.app_uri(pooled, password)})


@dataclass(frozen=True)
class ModalKeysStore:
    tools: Tools
    modal_environment: str

    def exists(self) -> bool:
        return KEYS_SECRET in modal_secret_names(self.tools, self.modal_environment)

    def keyring(self, action: str) -> MasterState:
        from parfocal_deploy.rotate_app import app, keyring

        with app.run(environment_name=self.modal_environment):
            stored, wrapped_by = keyring.remote(action)
        return MasterState(stored, wrapped_by)

    def merge(self, values: Mapping[str, str]) -> None:
        import modal

        secret = modal.Secret.from_name(KEYS_SECRET, environment_name=self.modal_environment)
        secret.update(dict(values))


NEXT_STEP = "redeploy the API now with pnpm --filter @parfocal/deploy deploy"


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="parfocal_deploy.rotate",
        description=f"Change one value of the Modal secret {KEYS_SECRET} and keep the rest",
    )
    parser.add_argument("--env", default="production")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("add-master-key")
    commands.add_parser("rewrap")
    retire = commands.add_parser("retire-master-key")
    retire.add_argument("key_id")
    replace = commands.add_parser("replace-key")
    replace.add_argument("name", choices=REPLACEABLE)
    commands.add_parser("reset-app-password")
    arguments = parser.parse_args(argv)
    target = environment(arguments.env)
    api_key = os.environ.get("NEON_API_KEY", "")
    tools = Tools(run=run, read=read, sql=sql, neon=neon.http_transport(api_key), fetch=fetch)
    store = ModalKeysStore(tools, target.modal_environment)
    try:
        message = dispatch(arguments, store, tools, target)
    except RotationRefusedError as error:
        raise SystemExit(f"Nothing changed: {error}") from error
    sys.stdout.write(f"{target.name}: {message}\n")


def dispatch(
    arguments: argparse.Namespace, store: KeysStore, tools: Tools, target: Environment
) -> str:
    match arguments.command:
        case "add-master-key":
            key_id = add_master_key(store)
            return f"{key_id} is the current master key. Next, {NEXT_STEP}, then rewrap"
        case "rewrap":
            counts = ", ".join(f"{key_id}: {count}" for key_id, count in rewrap(store).items())
            return f"tenant keys wrapped by {counts or 'none'}"
        case "retire-master-key":
            retire_master_key(store, arguments.key_id)
            return f"{arguments.key_id} removed from {MASTER_KEYS}. Next, {NEXT_STEP}"
        case "replace-key":
            replace_key(store, tools, target, arguments.name)
            return f"{arguments.name} replaced. Next, {NEXT_STEP}"
        case _:
            reset_app_password(store, tools, target, os.environ)
            return f"the {neon.APP_ROLE} password changed. Next, {NEXT_STEP}"


if __name__ == "__main__":
    main()
