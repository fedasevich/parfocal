import argparse
import os
import sys
from collections.abc import Callable, Mapping

from parfocal_deploy import neon
from parfocal_deploy.environments import Environment, environment
from parfocal_deploy.reset import (
    direct_database,
    phase,
    seed_in_eu,
    storage_location,
    storage_settings,
)
from parfocal_deploy.tools import Tools, fetch, read, required, run, sql
from parfocal_ingest.study_seed import (
    ACTION_VARIABLE,
    ACTIONS,
    PARTICIPANT_VARIABLE,
    SEAT_VARIABLE,
)

STUDY_SETTINGS = (
    "NEON_API_KEY",
    "NEON_PROJECT_ID",
    "CLOUDFLARE_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
)


def participant(
    target: Environment,
    tools: Tools,
    local: Mapping[str, str],
    action: str,
    code: str,
    seat_email: str | None,
    seed: Callable[[Environment, Mapping[str, str]], None] = seed_in_eu,
) -> None:
    settings = required(local, STUDY_SETTINGS)
    direct = direct_database(target, tools, settings)
    passed = {
        **storage_settings(target, storage_location(target, settings)),
        "DATABASE_URL": neon.engine_uri(direct),
        PARTICIPANT_VARIABLE: code,
        ACTION_VARIABLE: action,
    }
    if seat_email:
        passed[SEAT_VARIABLE] = seat_email
    with phase(f"study {action} {code}"):
        seed(target, passed)


def main() -> None:
    parser = argparse.ArgumentParser(
        prog="parfocal_deploy.study",
        description="Seed or remove one study participant's project through the EU seed function",
    )
    parser.add_argument("action", choices=ACTIONS)
    parser.add_argument("code")
    parser.add_argument("--env", default="production")
    parser.add_argument("--seat", default=os.environ.get(SEAT_VARIABLE) or None)
    arguments = parser.parse_args()
    target = environment(arguments.env)
    api_key = required(os.environ, ["NEON_API_KEY"])["NEON_API_KEY"]
    tools = Tools(run=run, read=read, sql=sql, neon=neon.http_transport(api_key), fetch=fetch)
    participant(target, tools, os.environ, arguments.action, arguments.code, arguments.seat)
    sys.stdout.write(f"{target.name}: study {arguments.action} {arguments.code} done\n")


if __name__ == "__main__":
    main()
