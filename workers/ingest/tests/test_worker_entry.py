import asyncio
import sys
import uuid
from typing import Any

import pytest

from parfocal_ingest import __main__ as entry

WORKSPACE = uuid.UUID("00000000-0000-4000-8000-000000000001")


def test_the_worker_reads_its_flags(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "parfocal_ingest",
            "--database-url",
            "postgresql://worker",
            "--workflow",
            "parfocal_ingest.workflow:INGEST",
            "--idle-exit",
            "2.5",
            "--workspace",
            str(WORKSPACE),
        ],
    )
    parsed = entry.parse()
    assert parsed.database_url == "postgresql://worker"
    assert parsed.workflow == ["parfocal_ingest.workflow:INGEST"]
    assert parsed.idle_exit == 2.5
    assert parsed.poll == 1.0
    assert parsed.workspace == WORKSPACE


def test_the_worker_runs_every_default_workflow_and_closes_what_it_opened(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[Any, ...]] = []

    async def work(
        engine: Any, workflows: list[Any], worker: str, *rest: Any, **named: Any
    ) -> None:
        calls.append((len(workflows), worker, rest[:3], rest[3], named["placement"]))

    monkeypatch.setattr(entry, "work", work)
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "parfocal_ingest",
            "--database-url",
            "postgresql+asyncpg://worker@localhost/none",
            "--worker",
            "test-worker",
            "--idle-exit",
            "0",
        ],
    )
    asyncio.run(entry.main())
    [(count, worker, (idle, poll, workspace), announcer, placement)] = calls
    assert count == len(entry.DEFAULT_WORKFLOWS)
    assert worker == "test-worker"
    assert (idle, poll, workspace) == (0.0, 1.0, None)
    assert announcer is None
    assert placement is not None
