import importlib
import json
import re
import uuid
from collections.abc import Callable, Iterable, Mapping
from typing import Any

from starlette.concurrency import run_in_threadpool

from parfocal_api.study_participants import SeededParticipant
from parfocal_deploy.modal_app import APP_NAME, SEED_FUNCTION
from parfocal_ingest.study_seed import (
    ACTION_VARIABLE,
    MODERATOR_VARIABLE,
    PARTICIPANT_VARIABLE,
    REMOVE,
    SEAT_VARIABLE,
    SEED,
)

REMOVED_LINE = re.compile(r"^study: removed (\d+) project")

type SeedCall = Callable[[dict[str, str]], Iterable[str]]


class StudySeedOutputError(RuntimeError):
    def __init__(self, action: str, code: str) -> None:
        super().__init__(f"the seed function printed no result for study {action} {code}")


def modal_seed_call(environment_name: str | None = None) -> SeedCall:
    def call(settings: dict[str, str]) -> Iterable[str]:
        modal: Any = importlib.import_module("modal")
        function: Any = modal.Function.from_name(
            APP_NAME, SEED_FUNCTION, environment_name=environment_name
        )
        return list(function.remote_gen(settings))

    return call


def seeded_from(lines: Iterable[str], code: str) -> SeededParticipant:
    for line in lines:
        if not line.startswith("{"):
            continue
        try:
            made: Mapping[str, str] = json.loads(line)
        except ValueError:
            continue
        if not isinstance(made, dict) or "project_id" not in made:
            continue
        return SeededParticipant(
            made["code"], uuid.UUID(made["tenant_id"]), uuid.UUID(made["project_id"])
        )
    raise StudySeedOutputError(SEED, code)


def removed_from(lines: Iterable[str], code: str) -> int:
    for line in lines:
        found = REMOVED_LINE.match(line)
        if found is not None:
            return int(found.group(1))
    raise StudySeedOutputError(REMOVE, code)


class ModalStudySeeder:
    def __init__(self, call: SeedCall | None = None) -> None:
        self.call = call or modal_seed_call()

    async def lines(self, settings: dict[str, str]) -> list[str]:
        return await run_in_threadpool(lambda: list(self.call(settings)))

    async def seed(
        self, code: str, seat_email: str | None, moderator_email: str | None = None
    ) -> SeededParticipant:
        settings = {PARTICIPANT_VARIABLE: code, ACTION_VARIABLE: SEED}
        if seat_email:
            settings[SEAT_VARIABLE] = seat_email
        if moderator_email:
            settings[MODERATOR_VARIABLE] = moderator_email
        return seeded_from(await self.lines(settings), code)

    async def remove(self, code: str) -> int:
        settings = {PARTICIPANT_VARIABLE: code, ACTION_VARIABLE: REMOVE}
        return removed_from(await self.lines(settings), code)
