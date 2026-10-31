import asyncio
import hashlib
import os
import uuid
from pathlib import Path

import httpx2
import pytest
from storage_support import TEST_PART_BYTES, put

from parfocal_api.uploads import object_key, safe_name
from parfocal_common.ingest import KIND, PLAN, STEP_NAMES
from parfocal_common.object_store import (
    NoSuchUploadError,
    ObjectStore,
    StorageError,
    StorageLocation,
    StoredPart,
)
from parfocal_ingest.workflow import INGEST


@pytest.mark.parametrize(
    ("name", "safe"),
    [
        ("S26-1 slide.svs", "S26-1_slide.svs"),
        ("../../etc/passwd", "passwd"),
        ("C:\\scans\\Smith, J.ndpi", "Smith__J.ndpi"),
        ("..", "upload"),
        ("Ünïcode slide.tiff", "_n_code_slide.tiff"),
        ("a" * 300 + ".ndpi", "a" * 115 + ".ndpi"),
    ],
)
def test_the_key_holds_a_safe_name_under_the_tenant_quarantine(name: str, safe: str) -> None:
    assert safe_name(name) == safe
    tenant, upload = uuid.uuid4(), uuid.uuid4()
    assert object_key(tenant, upload, name) == f"t/{tenant}/quarantine/{upload}/{safe}"


def test_the_api_queues_the_workflow_the_ingest_worker_runs() -> None:
    assert (INGEST.kind, PLAN.kind) == (KIND, KIND)
    assert [step.name for step in INGEST.steps] == [step.name for step in PLAN.steps]
    assert [step.name for step in PLAN.steps] == list(STEP_NAMES)
    assert INGEST.lease_seconds == PLAN.lease_seconds


@pytest.mark.db
def test_list_parts_follows_every_page_against_real_storage(storage: StorageLocation) -> None:
    requests: list[str] = []

    async def count(request: httpx2.Request) -> None:
        if request.method == "GET":
            requests.append(str(request.url))

    async def go() -> tuple[list[StoredPart], int]:
        async with httpx2.AsyncClient(event_hooks={"request": [count]}) as http:
            store = ObjectStore(storage, http)
            key = f"t/{uuid.uuid4()}/quarantine/{uuid.uuid4()}/paging.bin"
            upload_id = await store.create_multipart_upload(key)
            datas = [os.urandom(TEST_PART_BYTES), os.urandom(TEST_PART_BYTES), b"end"]
            for number, data in enumerate(datas, 1):
                url = store.presign_part(key, upload_id, number, 60)
                await asyncio.to_thread(put, url, data)
            parts = await store.list_parts(key, upload_id, page_size=1)
            await store.abort_multipart_upload(key, upload_id)
            with pytest.raises(NoSuchUploadError):
                await store.list_parts(key, upload_id)
            return parts, len(datas)

    parts, count_sent = asyncio.run(go())
    assert [(part.part_number, part.size) for part in parts] == [
        (1, TEST_PART_BYTES),
        (2, TEST_PART_BYTES),
        (3, 3),
    ]
    assert len([url for url in requests if "max-parts=1&" in url]) == count_sent


@pytest.mark.db
def test_a_part_url_refuses_a_changed_signature(storage: StorageLocation) -> None:
    async def go() -> int:
        async with httpx2.AsyncClient() as http:
            store = ObjectStore(storage, http)
            key = f"t/{uuid.uuid4()}/quarantine/{uuid.uuid4()}/tampered.bin"
            upload_id = await store.create_multipart_upload(key)
            url = store.presign_part(key, upload_id, 1, 60).replace("partNumber=1", "partNumber=2")
            status = (await asyncio.to_thread(put, url, b"data")).status_code
            await store.abort_multipart_upload(key, upload_id)
            return status

    assert asyncio.run(go()) == 403


@pytest.mark.db
def test_wrong_credentials_are_a_storage_error(storage: StorageLocation) -> None:
    wrong = StorageLocation(
        storage.endpoint, storage.region, storage.bucket, storage.access_key_id, "not-the-secret"
    )

    async def go() -> None:
        async with httpx2.AsyncClient() as http:
            await ObjectStore(wrong, http).create_multipart_upload("t/x/quarantine/y/z")

    with pytest.raises(StorageError) as raised:
        asyncio.run(go())
    assert raised.value.status == 403


@pytest.mark.db
def test_an_object_is_copied_in_equal_parts_and_listed_by_prefix(storage: StorageLocation) -> None:
    data = os.urandom(2 * TEST_PART_BYTES + 1234)
    prefix = f"t/{uuid.uuid4()}/"
    source = f"{prefix}quarantine/one/slide.svs"
    target = f"{prefix}s/two/original.svs"

    async def go() -> tuple[bytes, int | None, list[str], int | None]:
        async with httpx2.AsyncClient(timeout=30) as http:
            store = ObjectStore(storage, http)
            await store.put_object(source, data, "image/tiff")
            await store.copy_object(source, target, len(data), TEST_PART_BYTES)
            copied = await store.get_object(target)
            await store.delete_object(source)
            await store.delete_object(source)
            gone = await store.head_object(source)
            listed = await store.list_keys(prefix)
            size = await store.head_object(target)
            await store.delete_object(target)
            return copied, gone, listed, size

    copied, gone, listed, size = asyncio.run(go())
    assert copied == data
    assert gone is None
    assert listed == [target]
    assert size == len(data)


@pytest.mark.db
def test_a_download_streams_to_disk_with_its_sha256(
    storage: StorageLocation, tmp_path: Path
) -> None:
    data = os.urandom(3 * 1024 * 1024 + 7)
    key = f"t/{uuid.uuid4()}/s/{uuid.uuid4()}/levels.json"

    async def go() -> tuple[int, str]:
        async with httpx2.AsyncClient(timeout=30) as http:
            store = ObjectStore(storage, http)
            await store.put_object(key, data, "application/json")
            downloaded = await store.download(key, tmp_path / "copy")
            await store.delete_object(key)
            return downloaded.size, downloaded.sha256

    assert asyncio.run(go()) == (len(data), hashlib.sha256(data).hexdigest())
    assert (tmp_path / "copy").read_bytes() == data
