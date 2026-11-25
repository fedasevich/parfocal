import asyncio
import hashlib
from pathlib import Path

from parfocal_common.object_store import ObjectStore, StoredPart

PART_BYTES = 16 * 1024 * 1024
PART_SECONDS = 15 * 60


def read_part(path: Path, offset: int) -> bytes:
    with path.open("rb") as handle:
        handle.seek(offset)
        return handle.read(PART_BYTES)


async def send_original(store: ObjectStore, path: Path, key: str) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = (await asyncio.to_thread(path.stat)).st_size
    if size <= PART_BYTES:
        body = await asyncio.to_thread(read_part, path, 0)
        digest.update(body)
        await store.put_object(key, body, "image/tiff")
        return size, digest.hexdigest()
    upload_id = await store.create_multipart_upload(key)
    parts: list[StoredPart] = []
    try:
        for offset in range(0, size, PART_BYTES):
            body = await asyncio.to_thread(read_part, path, offset)
            digest.update(body)
            number = len(parts) + 1
            url = store.presign_part(key, upload_id, number, PART_SECONDS)
            answer = await store.http.put(url, content=body)
            answer.raise_for_status()
            parts.append(StoredPart(number, len(body), answer.headers["etag"].strip('"')))
        await store.complete_multipart_upload(key, upload_id, parts)
    except BaseException:
        await store.abort_multipart_upload(key, upload_id)
        raise
    return size, digest.hexdigest()
