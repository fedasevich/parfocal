from typing import Protocol

from parfocal_common.cell_chunks import GZIP_MAGIC
from parfocal_common.object_store import ObjectStore, StorageError

CHUNK_CONTENT_TYPE = "application/octet-stream"
NOT_FOUND = 404


class MissingObjectError(LookupError):
    pass


class ResultStore(Protocol):
    async def get(self, object_key: str) -> bytes: ...

    async def get_packed(self, object_key: str) -> bytes: ...

    async def put(self, object_key: str, data: bytes) -> None: ...


class ObjectResultStore:
    def __init__(self, storage: ObjectStore) -> None:
        self.storage = storage

    async def get(self, object_key: str) -> bytes:
        try:
            return await self.storage.get_object(object_key)
        except StorageError as error:
            if error.status == NOT_FOUND:
                raise MissingObjectError(object_key) from error
            raise

    async def get_packed(self, object_key: str) -> bytes:
        try:
            return await self.storage.get_stored_bytes(object_key)
        except StorageError as error:
            if error.status == NOT_FOUND:
                raise MissingObjectError(object_key) from error
            raise

    async def put(self, object_key: str, data: bytes) -> None:
        await self.storage.put_object(
            object_key,
            data,
            CHUNK_CONTENT_TYPE,
            content_encoding="gzip" if data[:2] == GZIP_MAGIC else None,
        )
