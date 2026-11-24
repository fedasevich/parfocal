import asyncio
import json
import uuid
from collections.abc import Iterable

import pytest

from parfocal_deploy.modal_app import FUNCTION_SECRETS, SEED_FUNCTION, SEED_SECRET, WEB_FUNCTION
from parfocal_deploy.study_seeder import ModalStudySeeder, StudySeedOutputError
from parfocal_ingest import study_seed

TENANT = uuid.UUID("00000000-0000-4000-8000-0000000000aa")
PROJECT = uuid.UUID("00000000-0000-4000-8000-0000000000bb")


class FakeSeed:
    def __init__(self, lines: list[str]) -> None:
        self.lines = lines
        self.calls: list[dict[str, str]] = []

    def __call__(self, settings: dict[str, str]) -> Iterable[str]:
        self.calls.append(settings)
        return iter(self.lines)


def test_the_modal_seeder_passes_only_the_participant_and_reads_the_project_back() -> None:
    printed = json.dumps({"code": "P-AB", "tenant_id": str(TENANT), "project_id": str(PROJECT)})
    fake = FakeSeed(
        ['{"level": "info", "message": "seeding"}', "{not json", printed, "study: seeded P-AB"]
    )
    made = asyncio.run(ModalStudySeeder(fake).seed("P-AB", "seat@example.test"))
    assert (made.code, made.tenant_id, made.project_id) == ("P-AB", TENANT, PROJECT)
    assert fake.calls == [
        {
            study_seed.PARTICIPANT_VARIABLE: "P-AB",
            study_seed.ACTION_VARIABLE: study_seed.SEED,
            study_seed.SEAT_VARIABLE: "seat@example.test",
        }
    ]


def test_the_modal_seeder_removes_and_counts_the_removed_projects() -> None:
    fake = FakeSeed(["study: removed 1 project of P-AB in 0.4 s"])
    assert asyncio.run(ModalStudySeeder(fake).remove("P-AB")) == 1
    assert fake.calls == [
        {study_seed.PARTICIPANT_VARIABLE: "P-AB", study_seed.ACTION_VARIABLE: study_seed.REMOVE}
    ]


def test_a_seed_that_prints_no_project_is_an_error() -> None:
    with pytest.raises(StudySeedOutputError):
        asyncio.run(ModalStudySeeder(FakeSeed(["study: nothing"])).seed("P-AB", "s@x.test"))
    with pytest.raises(StudySeedOutputError):
        asyncio.run(ModalStudySeeder(FakeSeed([])).remove("P-AB"))


def test_only_the_seed_function_holds_the_seed_database_secret() -> None:
    assert SEED_SECRET in FUNCTION_SECRETS[SEED_FUNCTION]
    assert [name for name, held in FUNCTION_SECRETS.items() if SEED_SECRET in held] == [
        SEED_FUNCTION
    ]
    assert SEED_SECRET not in FUNCTION_SECRETS[WEB_FUNCTION]


def test_the_study_seed_prefers_the_seed_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[str] = []

    async def removed(url: str, code: str) -> int:
        seen.append(url)
        return 0

    monkeypatch.setattr(study_seed, "remove_participant", removed)
    environ = {
        "DATABASE_URL": "postgres://app",
        study_seed.SEED_DATABASE_VARIABLE: "postgres://owner",
    }
    asyncio.run(study_seed.run(environ, study_seed.REMOVE, "P-AB", None))
    asyncio.run(study_seed.run({"DATABASE_URL": "postgres://app"}, study_seed.REMOVE, "P-AB", None))
    assert seen == ["postgres://owner", "postgres://app"]
