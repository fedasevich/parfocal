import asyncio
import sys
from collections.abc import Mapping, Sequence
from typing import Any

import pytest

from parfocal_deploy import reset as reset_module
from parfocal_deploy import study
from parfocal_deploy.environments import Environment, environment
from parfocal_deploy.tools import Tools
from parfocal_ingest import showcase_seed, study_seed
from parfocal_ingest.study_seed import from_environment


def test_a_participant_seeds_through_the_eu_function_and_never_truncates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(reset_module.neon, "ensure_branch", lambda *_: "branch")
    monkeypatch.setattr(reset_module.neon, "first_database", lambda *_: "database")
    monkeypatch.setattr(reset_module.neon, "owner_uri", lambda *_, **__: "postgres://direct")
    touched: list[str] = []

    def ran(argv: Sequence[str], *_: Any) -> None:
        touched.append(" ".join(argv))

    def statement(_: str, sql: str) -> list[Any]:
        touched.append(sql)
        return []

    tools = Tools(run=ran, read=lambda _: "", sql=statement, neon=None, fetch=lambda _: (200, {}))  # type: ignore[arg-type]
    seeded: list[tuple[str, Mapping[str, str]]] = []

    def seed(target: Environment, passed: Mapping[str, str]) -> None:
        seeded.append((target.modal_environment, passed))

    settings: dict[str, str] = dict.fromkeys(study.STUDY_SETTINGS, "x")
    study.participant(environment("production"), tools, settings, "seed", "P1", None, seed)
    study.participant(
        environment("production"), tools, settings, "remove", "P1", "seat@example.test", seed
    )
    assert touched == []
    [(where, first), (_, second)] = seeded
    assert where == "main"
    assert first["DATABASE_URL"].endswith("//direct")
    assert first["STORAGE_BUCKET"] == environment("production").slide_bucket
    assert from_environment(first) == ("seed", "P1", None)
    assert from_environment(second) == ("remove", "P1", "seat@example.test")


def test_the_full_seed_runs_when_no_participant_is_named() -> None:
    assert from_environment({"DATABASE_URL": "postgres://direct"}) is None


def test_the_seed_entry_hands_a_named_participant_to_the_study_seed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    handed: list[tuple[str, ...]] = []

    async def study_run(_: Mapping[str, str], *participant: Any) -> None:
        handed.append(participant)

    async def full_seed(*_: Any, **__: Any) -> list[Any]:
        raise AssertionError

    monkeypatch.setattr(study_seed, "run", study_run)
    monkeypatch.setattr(showcase_seed, "seed", full_seed)
    monkeypatch.setattr(sys, "argv", ["showcase_seed"])
    monkeypatch.setenv("STUDY_PARTICIPANT", "P4")
    monkeypatch.setenv("STUDY_ACTION", "remove")
    monkeypatch.delenv("STUDY_SEAT_EMAIL", raising=False)
    asyncio.run(showcase_seed.main())
    assert handed == [("remove", "P4", None)]


def test_an_unknown_study_action_is_refused() -> None:
    with pytest.raises(SystemExit):
        from_environment({"STUDY_PARTICIPANT": "P1", "STUDY_ACTION": "purge"})
