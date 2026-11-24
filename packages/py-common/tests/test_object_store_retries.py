import httpx2
import pytest

from parfocal_common import object_store
from parfocal_common.object_store import ObjectStore, StorageError, StorageLocation

LOCATION = StorageLocation("http://127.0.0.1:9000", "auto", "bucket", "id", "secret")
SLOW_DOWN = b"<Error><Code>ServiceUnavailable</Code></Error>"
DENIED = b"<Error><Code>AccessDenied</Code></Error>"


@pytest.fixture(autouse=True)
def no_backoff(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(object_store, "STORAGE_BACKOFF_SECONDS", 0.0)


def answering(statuses: list[int], body: bytes) -> tuple[httpx2.MockTransport, list[bytes]]:
    sent: list[bytes] = []

    def answer(request: httpx2.Request) -> httpx2.Response:
        sent.append(request.content)
        status = statuses[min(len(sent), len(statuses)) - 1]
        return httpx2.Response(status, content=b"" if status < 300 else body)

    return httpx2.MockTransport(answer), sent


async def test_a_put_survives_a_passing_service_unavailable_answer() -> None:
    transport, sent = answering([503, 503, 200], SLOW_DOWN)
    async with httpx2.AsyncClient(transport=transport) as http:
        await ObjectStore(LOCATION, http).put_object("t/a/tile", b"cells", "text/plain")
    assert sent == [b"cells", b"cells", b"cells"]


async def test_a_storage_outage_still_fails_after_the_last_attempt() -> None:
    transport, sent = answering([503], SLOW_DOWN)
    async with httpx2.AsyncClient(transport=transport) as http:
        with pytest.raises(StorageError) as raised:
            await ObjectStore(LOCATION, http).put_object("t/a/tile", b"cells", "text/plain")
    assert (raised.value.status, raised.value.code) == (503, "ServiceUnavailable")
    assert len(sent) == object_store.STORAGE_ATTEMPTS


async def test_a_refused_request_is_not_sent_again() -> None:
    transport, sent = answering([403], DENIED)
    async with httpx2.AsyncClient(transport=transport) as http:
        with pytest.raises(StorageError):
            await ObjectStore(LOCATION, http).put_object("t/a/tile", b"cells", "text/plain")
    assert len(sent) == 1
