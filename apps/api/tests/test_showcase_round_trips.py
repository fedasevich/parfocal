import asyncio
from collections.abc import Iterator
from typing import Any

import pytest
from db_support import OWNER_URL, migrated_database, with_database
from sqlalchemy import event
from sqlalchemy.engine import Engine
from sqlalchemy.ext.asyncio import AsyncConnection
from sqlalchemy.pool import Pool
from test_showcase import EmptyStore, MemoryResults

from parfocal_api import showcase
from parfocal_api.showcase import WORKSPACES, seed

pytestmark = pytest.mark.db

PROJECTS_STATEMENT_CEILING = 2550
SEED_STATEMENT_CEILING = 14700


class Tally:
    def __init__(self) -> None:
        self.statements = 0
        self.in_projects = 0
        self.project_connections: set[Any] = set()
        self.open = 0
        self.most_open = 0

    def executed(self, connection: Any, *_: Any) -> None:
        self.statements += 1
        if connection in self.project_connections:
            self.in_projects += 1

    def checked_out(self, *_: Any) -> None:
        self.open += 1
        self.most_open = max(self.most_open, self.open)

    def checked_in(self, *_: Any) -> None:
        self.open -= 1


@pytest.fixture(scope="module")
def tally() -> Iterator[Tally]:
    counted = Tally()
    original = showcase.seed_projects

    async def projects(connection: AsyncConnection, *args: Any) -> None:
        counted.project_connections.add(connection.sync_connection)
        try:
            await original(connection, *args)
        finally:
            counted.project_connections.discard(connection.sync_connection)

    hooks = (
        (Engine, "before_cursor_execute", counted.executed),
        (Pool, "checkout", counted.checked_out),
        (Pool, "checkin", counted.checked_in),
    )
    with migrated_database() as name, pytest.MonkeyPatch.context() as patch:
        patch.setattr(showcase, "seed_projects", projects)
        for target, name_of_event, listener in hooks:
            event.listen(target, name_of_event, listener)
        try:
            asyncio.run(
                seed(
                    with_database(OWNER_URL, name),
                    EmptyStore(),  # type: ignore[arg-type]
                    MemoryResults(),
                    "owner@example.test",
                )
            )
        finally:
            for target, name_of_event, listener in hooks:
                event.remove(target, name_of_event, listener)
        yield counted


def test_the_seed_stays_under_its_statement_ceiling(tally: Tally) -> None:
    assert 0 < tally.statements <= SEED_STATEMENT_CEILING


def test_the_project_phase_of_one_workspace_stays_under_its_statement_ceiling(
    tally: Tally,
) -> None:
    assert 0 < tally.in_projects / len(WORKSPACES) <= PROJECTS_STATEMENT_CEILING


def test_the_workspaces_seed_side_by_side(tally: Tally) -> None:
    assert tally.most_open >= len(WORKSPACES)
