from sqlalchemy import event
from sqlalchemy.pool import AsyncAdaptedQueuePool

from parfocal_common.db import POOL_OVERFLOW, POOL_SIZE, create_engine
from parfocal_common.db_timing import before_query


def test_the_engine_keeps_a_pool_large_enough_for_parallel_requests() -> None:
    engine = create_engine("postgresql://parfocal@localhost:5432/parfocal")
    assert engine.url.render_as_string() == "postgresql+asyncpg://parfocal@localhost:5432/parfocal"
    pool = engine.pool
    assert isinstance(pool, AsyncAdaptedQueuePool)
    assert pool.size() == POOL_SIZE
    assert POOL_SIZE + POOL_OVERFLOW >= 20


def test_the_engine_times_its_queries_for_server_timing() -> None:
    engine = create_engine("postgresql://parfocal@localhost:5432/parfocal")
    assert event.contains(engine.sync_engine, "before_cursor_execute", before_query)
