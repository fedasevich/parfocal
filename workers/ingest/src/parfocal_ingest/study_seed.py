import argparse
import asyncio
import json
import os
import time
from collections.abc import Mapping, Sequence

import httpx2

from parfocal_api.study_projects import remove_participant, seed_participant
from parfocal_common.object_store import ObjectStore
from parfocal_common.result_store import ObjectResultStore
from parfocal_common.settings import AppEnv, StorageSettings

PARTICIPANT_VARIABLE = "STUDY_PARTICIPANT"
ACTION_VARIABLE = "STUDY_ACTION"
SEAT_VARIABLE = "STUDY_SEAT_EMAIL"
SEED = "seed"
REMOVE = "remove"
ACTIONS = (SEED, REMOVE)


async def run(environ: Mapping[str, str], action: str, code: str, seat: str | None) -> None:
    started = time.monotonic()
    database_url = environ["DATABASE_URL"]
    if action == REMOVE:
        removed = await remove_participant(database_url, code)
        print(f"study: removed {removed} project of {code} in {time.monotonic() - started:.1f} s")
        return
    settings = StorageSettings(app_env=AppEnv(environ.get("APP_ENV", AppEnv.DEV)))
    async with httpx2.AsyncClient(timeout=60) as http:
        store = ObjectStore(settings.storage(), http)
        made = await seed_participant(database_url, store, ObjectResultStore(store), code, seat)
    print(json.dumps(made.as_json()))
    print(f"study: seeded {made.code} in {time.monotonic() - started:.1f} s")


def from_environment(environ: Mapping[str, str]) -> tuple[str, str, str | None] | None:
    code = environ.get(PARTICIPANT_VARIABLE)
    if not code:
        return None
    action = environ.get(ACTION_VARIABLE) or SEED
    if action not in ACTIONS:
        raise SystemExit(f"{ACTION_VARIABLE} is {SEED} or {REMOVE}, not {action}")
    return action, code, environ.get(SEAT_VARIABLE) or None


def arguments(argv: Sequence[str] | None = None) -> tuple[str, str, str | None]:
    parser = argparse.ArgumentParser(
        prog="parfocal_ingest.study_seed",
        description="Seed or remove one study participant's project in the study workspace",
    )
    parser.add_argument("action", choices=ACTIONS)
    parser.add_argument("code")
    parser.add_argument("--seat", default=os.environ.get(SEAT_VARIABLE) or None)
    parsed = parser.parse_args(argv)
    return parsed.action, parsed.code, parsed.seat


def main() -> None:
    action, code, seat = arguments()
    asyncio.run(run(os.environ, action, code, seat))


if __name__ == "__main__":
    main()
