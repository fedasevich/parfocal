import time
from collections.abc import Generator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any

from sqlalchemy import event
from sqlalchemy.engine import Engine

STARTED = "parfocal_query_started"


@dataclass
class DatabaseTiming:
    queries: int = 0
    transactions: int = 0
    query_seconds: float = 0.0
    transaction_seconds: float = 0.0

    def server_timing(self, handler_seconds: float) -> str:
        return ", ".join(
            [
                f"app;dur={handler_seconds * 1000:.1f}",
                f"db;dur={self.transaction_seconds * 1000:.1f}",
                f"sql;dur={self.query_seconds * 1000:.1f}",
                f'queries;desc="{self.queries}"',
                f'transactions;desc="{self.transactions}"',
            ]
        )


current_timing: ContextVar[DatabaseTiming | None] = ContextVar("database_timing", default=None)


@contextmanager
def timed_database() -> Generator[DatabaseTiming]:
    timing = DatabaseTiming()
    token = current_timing.set(timing)
    try:
        yield timing
    finally:
        current_timing.reset(token)


@contextmanager
def timed_transaction() -> Generator[None]:
    timing = current_timing.get()
    started = time.perf_counter()
    try:
        yield
    finally:
        if timing is not None:
            timing.transactions += 1
            timing.transaction_seconds += time.perf_counter() - started


def before_query(connection: Any, *_: Any) -> None:
    connection.info[STARTED] = time.perf_counter()


def after_query(connection: Any, *_: Any) -> None:
    started = connection.info.pop(STARTED, None)
    timing = current_timing.get()
    if timing is None or started is None:
        return
    timing.queries += 1
    timing.query_seconds += time.perf_counter() - started


def failed_query(context: Any) -> None:
    if context.connection is not None:
        after_query(context.connection)


def time_queries(engine: Engine) -> None:
    if event.contains(engine, "before_cursor_execute", before_query):
        return
    event.listen(engine, "before_cursor_execute", before_query)
    event.listen(engine, "after_cursor_execute", after_query)
    event.listen(engine, "handle_error", failed_query)
