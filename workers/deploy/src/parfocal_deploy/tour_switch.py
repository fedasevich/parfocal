import argparse
import sys
from collections.abc import Collection
from typing import Any

from parfocal_deploy.environments import Environment, environment
from parfocal_deploy.modal_app import TOUR_SECRET
from parfocal_deploy.tools import Tools, fetch, read, run, sql, write_modal_secret

TOUR_ROLE_SWITCH = "TOUR_ROLE_SWITCH"
STATES = {"on": "true", "off": "false"}


class TourSwitchOutsideDevelopmentError(Exception):
    def __init__(self, name: str) -> None:
        super().__init__(
            f"the tour role switch is only for a development deployment, and {name} is not one"
        )


def no_neon(method: str, path: str, body: dict[str, Any] | None) -> dict[str, Any]:
    raise AssertionError(f"the tour switch never calls Neon, but asked {method} {path}")


def set_tour_switch(target: Environment, tools: Tools, state: str) -> dict[str, str]:
    if state == "on" and not target.development:
        raise TourSwitchOutsideDevelopmentError(target.name)
    values = {TOUR_ROLE_SWITCH: STATES[state]}
    write_modal_secret(tools, target.modal_environment, TOUR_SECRET, values, overwrite=True)
    return values


def ensure_tour_secret(target: Environment, tools: Tools, found: Collection[str]) -> bool:
    if TOUR_SECRET in found:
        return False
    write_modal_secret(
        tools,
        target.modal_environment,
        TOUR_SECRET,
        {TOUR_ROLE_SWITCH: STATES["off"]},
        overwrite=False,
    )
    return True


def main() -> None:
    parser = argparse.ArgumentParser(prog="parfocal_deploy.tour_switch")
    parser.add_argument("state", choices=sorted(STATES))
    parser.add_argument("--env", default="production")
    arguments = parser.parse_args()
    target = environment(arguments.env)
    tools = Tools(run=run, read=read, sql=sql, neon=no_neon, fetch=fetch)
    try:
        set_tour_switch(target, tools, arguments.state)
    except TourSwitchOutsideDevelopmentError as error:
        sys.exit(str(error))
    sys.stdout.write(
        f"{TOUR_SECRET} in {target.modal_environment} says {arguments.state}. "
        "Redeploy the API so new containers read it\n"
    )


if __name__ == "__main__":
    main()
