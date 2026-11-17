import pytest

from parfocal_common import db
from parfocal_common.db import POOL_OVERFLOW, POOL_SIZE, create_engine


def test_the_engine_keeps_a_pool_large_enough_for_parallel_requests(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    built: list[tuple[str, dict[str, object]]] = []

    def recording(url: str, **options: object) -> object:
        built.append((url, options))
        return object()

    monkeypatch.setattr(db, "create_async_engine", recording)
    create_engine("postgresql://parfocal@localhost:5432/parfocal")
    assert built == [
        (
            "postgresql+asyncpg://parfocal@localhost:5432/parfocal",
            {"pool_pre_ping": True, "pool_size": POOL_SIZE, "max_overflow": POOL_OVERFLOW},
        )
    ]
    assert POOL_SIZE + POOL_OVERFLOW >= 20
