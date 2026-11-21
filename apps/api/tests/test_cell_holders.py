import asyncio
import uuid

from chunk_support import chunk_bytes

from parfocal_api.result_membership import PARALLEL_CHUNK_READS, sets_holding_cell
from parfocal_common.result_store import MissingObjectError


class SlowStore:
    def __init__(self, chunks: dict[str, bytes]) -> None:
        self.chunks = chunks
        self.reading = 0
        self.most = 0

    async def get(self, object_key: str) -> bytes:
        self.reading += 1
        self.most = max(self.most, self.reading)
        await asyncio.sleep(0.01)
        self.reading -= 1
        if object_key not in self.chunks:
            raise MissingObjectError(object_key)
        return self.chunks[object_key]

    async def get_packed(self, object_key: str) -> bytes:
        return await self.get(object_key)

    async def put(self, object_key: str, data: bytes) -> None:
        self.chunks[object_key] = data


def test_a_cell_id_search_reads_the_chunks_of_many_sets_at_once() -> None:
    sets = [uuid.uuid4() for _ in range(40)]
    holding = set(sets[::3])
    chunks = {
        f"{set_id}/0": chunk_bytes([(781 if set_id in holding else 5, 255, 100, 10.0, 10.0)], None)
        for set_id in sets
    }
    store = SlowStore(chunks)
    keys = {set_id: [f"{set_id}/0"] for set_id in sets}
    keys[uuid.uuid4()] = ["gone/0"]
    found = asyncio.run(sets_holding_cell(store, 781, keys))
    assert found == holding
    assert 1 < store.most <= PARALLEL_CHUNK_READS
