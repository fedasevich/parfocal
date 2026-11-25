import asyncio
import json
import sys
from dataclasses import dataclass

import pytest

from parfocal_ingest import study_seed


@dataclass(frozen=True)
class Made:
    code: str

    def as_json(self) -> dict[str, str]:
        return {"code": self.code}


def test_no_participant_in_the_environment_means_no_study_run() -> None:
    assert study_seed.from_environment({}) is None


def test_the_environment_seeds_by_default_and_names_the_seat() -> None:
    environ = {"STUDY_PARTICIPANT": "P-1", "STUDY_SEAT_EMAIL": "seat@study.invalid"}
    assert study_seed.from_environment(environ) == ("seed", "P-1", "seat@study.invalid", None)
    removing = {"STUDY_PARTICIPANT": "P-1", "STUDY_ACTION": "remove"}
    assert study_seed.from_environment(removing) == ("remove", "P-1", None, None)
    linked = {"STUDY_PARTICIPANT": "P-1", "STUDY_MODERATOR_EMAIL": "mod@study.invalid"}
    assert study_seed.from_environment(linked) == ("seed", "P-1", None, "mod@study.invalid")


def test_an_unknown_action_in_the_environment_stops_the_run() -> None:
    with pytest.raises(SystemExit, match="not wipe"):
        study_seed.from_environment({"STUDY_PARTICIPANT": "P-1", "STUDY_ACTION": "wipe"})


def test_the_command_line_takes_an_action_a_code_and_a_seat(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("STUDY_SEAT_EMAIL", raising=False)
    assert study_seed.arguments(["remove", "P-2"]) == ("remove", "P-2", None)
    seated = study_seed.arguments(["seed", "P-2", "--seat", "seat@study.invalid"])
    assert seated == ("seed", "P-2", "seat@study.invalid")
    with pytest.raises(SystemExit):
        study_seed.arguments(["wipe", "P-2"])


def test_remove_uses_the_seed_database_and_reports_the_count(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    called: list[tuple[str, str]] = []

    async def remove(database_url: str, code: str) -> int:
        called.append((database_url, code))
        return 1

    monkeypatch.setattr(study_seed, "remove_participant", remove)
    environ = {"SEED_DATABASE_URL": "postgresql://owner", "DATABASE_URL": "postgresql://api"}
    asyncio.run(study_seed.run(environ, "remove", "P-3", None))
    assert called == [("postgresql://owner", "P-3")]
    assert "study: removed 1 project of P-3" in capsys.readouterr().out


def test_seed_falls_back_to_the_api_database_and_prints_the_project(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    called: list[tuple[str, str, str | None]] = []

    async def seed(
        database_url: str,
        store: object,
        results: object,
        code: str,
        seat: str | None,
        moderator: str | None = None,
    ):
        called.append((database_url, code, seat))
        return Made(code)

    monkeypatch.setattr(study_seed, "seed_participant", seed)
    environ = {"DATABASE_URL": "postgresql://api", "APP_ENV": "dev"}
    asyncio.run(study_seed.run(environ, "seed", "P-4", "seat@study.invalid"))
    assert called == [("postgresql://api", "P-4", "seat@study.invalid")]
    first, second = capsys.readouterr().out.splitlines()
    assert json.loads(first) == {"code": "P-4"}
    assert second.startswith("study: seeded P-4 in ")


def test_main_runs_the_action_from_the_command_line(monkeypatch: pytest.MonkeyPatch) -> None:
    ran: list[tuple[str, str, str | None]] = []

    async def run(_: object, action: str, code: str, seat: str | None) -> None:
        ran.append((action, code, seat))

    monkeypatch.setattr(study_seed, "run", run)
    monkeypatch.setattr(sys, "argv", ["study_seed", "remove", "P-5", "--seat", "s@study.invalid"])
    study_seed.main()
    assert ran == [("remove", "P-5", "s@study.invalid")]
