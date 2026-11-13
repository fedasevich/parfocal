import asyncio
import json
import os
import subprocess
import tempfile
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from parfocal_deploy.neon import Transport

REPOSITORY = Path(__file__).resolve().parents[4]
MODAL = ("uv", "run", "--package", "parfocal-deploy", "modal")
WRANGLER = ("pnpm", "--filter", "@parfocal/edge", "exec", "wrangler")

Run = Callable[[Sequence[str], str | None, Mapping[str, str] | None], None]
Read = Callable[[Sequence[str]], str]
Sql = Callable[[str, str], list[Any]]
Fetch = Callable[[str], tuple[int, Mapping[str, str]]]


@dataclass(frozen=True)
class Tools:
    run: Run
    read: Read
    sql: Sql
    neon: Transport
    fetch: Fetch


class MissingSettingsError(Exception):
    def __init__(self, names: Sequence[str]) -> None:
        super().__init__(f"set {', '.join(names)} before running this")


def required(local: Mapping[str, str], names: Sequence[str]) -> dict[str, str]:
    missing = [name for name in names if not local.get(name)]
    if missing:
        raise MissingSettingsError(missing)
    return {name: local[name] for name in names}


def run(argv: Sequence[str], stdin: str | None, extra: Mapping[str, str] | None) -> None:
    subprocess.run(
        list(argv),
        input=stdin,
        text=True,
        check=True,
        cwd=REPOSITORY,
        env={**os.environ, **(extra or {})},
    )


def read(argv: Sequence[str]) -> str:
    finished = subprocess.run(
        list(argv), text=True, check=True, cwd=REPOSITORY, stdout=subprocess.PIPE
    )
    return finished.stdout


def sql(uri: str, statement: str) -> list[Any]:
    import asyncpg

    async def query() -> list[Any]:
        connection = await asyncpg.connect(uri)
        try:
            return list(await connection.fetch(statement))
        finally:
            await connection.close()

    return asyncio.run(query())


def fetch(url: str) -> tuple[int, Mapping[str, str]]:
    import urllib.error
    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=60) as response:
            return response.status, {
                name.lower(): value for name, value in response.headers.items()
            }
    except urllib.error.HTTPError as error:
        return error.code, {name.lower(): value for name, value in error.headers.items()}


def modal_secret_names(tools: Tools, modal_environment: str) -> set[str]:
    listed = json.loads(tools.read([*MODAL, "secret", "list", "--json", "-e", modal_environment]))
    return {str(secret.get("Name") or secret.get("name")) for secret in listed}


def write_modal_secret(
    tools: Tools, modal_environment: str, name: str, values: Mapping[str, str], *, overwrite: bool
) -> None:
    with tempfile.NamedTemporaryFile("w", suffix=".json") as file:
        json.dump(dict(values), file)
        file.flush()
        force = ["--force"] if overwrite else []
        tools.run(
            [
                *MODAL,
                "secret",
                "create",
                name,
                "--from-json",
                file.name,
                "-e",
                modal_environment,
                *force,
            ],
            None,
            None,
        )


def write_worker_secrets(tools: Tools, wrangler_env: str, values: Mapping[str, str]) -> None:
    tools.run([*WRANGLER, "secret", "bulk", "--env", wrangler_env], json.dumps(dict(values)), None)
