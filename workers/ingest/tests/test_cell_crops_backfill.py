import asyncio
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from parfocal_ingest import cell_crops_backfill

TENANT = uuid.UUID("00000000-0000-4000-8000-0000000000a1")
CROPPED = uuid.UUID("00000000-0000-4000-8000-0000000000b1")
BROKEN = uuid.UUID("00000000-0000-4000-8000-0000000000b2")


class Rows:
    def __init__(self, rows: list[SimpleNamespace]) -> None:
        self.rows = rows

    def all(self) -> list[SimpleNamespace]:
        return self.rows


class Connection:
    async def scalars(self, _: object) -> list[uuid.UUID]:
        return [TENANT]

    async def execute(self, _: object) -> Rows:
        return Rows(
            [
                SimpleNamespace(id=CROPPED, original_key="a.svs"),
                SimpleNamespace(id=BROKEN, original_key="b.svs"),
            ]
        )


@asynccontextmanager
async def transaction(_: object, __: object) -> AsyncGenerator[Connection]:
    yield Connection()


def test_the_backfill_crops_every_slide_and_counts_failures(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    cropped: list[tuple[uuid.UUID, uuid.UUID, str, object]] = []

    async def picked_on(_: object, __: object, tenant_id: uuid.UUID, slide_id: uuid.UUID) -> str:
        return f"picks of {slide_id}"

    async def crop_slide(
        _: object, tenant_id: uuid.UUID, slide_id: uuid.UUID, key: str, picks: Any, __: Path
    ) -> str:
        if slide_id == BROKEN:
            raise RuntimeError("unreadable")
        cropped.append((tenant_id, slide_id, key, picks))
        return "cropped"

    monkeypatch.setattr(cell_crops_backfill, "scoped_transaction", transaction)
    monkeypatch.setattr(cell_crops_backfill, "picked_on", picked_on)
    monkeypatch.setattr(cell_crops_backfill, "crop_slide", crop_slide)
    outcomes = asyncio.run(cell_crops_backfill.backfill(object(), object(), tmp_path))  # type: ignore[arg-type]
    assert outcomes == {"cropped": 1, cell_crops_backfill.FAILED: 1}
    assert cropped == [(TENANT, CROPPED, "a.svs", f"picks of {CROPPED}")]
