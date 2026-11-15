import socket
import time
import uuid
from collections.abc import Mapping
from pathlib import Path
from typing import Any

import pytest

from parfocal_common.ingest import Failure, Refusal, original_key
from parfocal_common.jobs import StepFailedError
from parfocal_ingest.isolation import JobScope, JobTokens, ParseLimits, parse_isolated

PROBES = str(Path(__file__).parent)
TENANT = uuid.UUID("00000000-0000-4000-8000-000000000001")
OTHER_TENANT = uuid.UUID("00000000-0000-4000-8000-000000000002")
SLIDE = uuid.UUID("00000000-0000-4000-8000-00000000000a")
UPLOAD_KEY = f"t/{TENANT}/q/upload-1/original.svs"
OWN_KEY = original_key(TENANT, SLIDE, "slide.svs")
FOREIGN_KEY = original_key(OTHER_TENANT, SLIDE, "slide.svs")
SCOPE = JobScope(TENANT, SLIDE, (UPLOAD_KEY,))


class Store:
    def __init__(self, folder: Path, objects: Mapping[str, str]) -> None:
        self.folder = folder
        self.objects = dict(objects)
        self.fetched: list[str] = []

    async def fetch(self, key: str) -> Path:
        self.fetched.append(key)
        path = self.folder / f"object-{len(self.fetched)}"
        path.write_text(self.objects[key])
        return path


async def probe(
    name: str,
    arguments: Mapping[str, Any],
    tmp_path: Path,
    store: Store | None = None,
    limits: ParseLimits | None = None,
) -> dict[str, Any]:
    chosen = store or Store(tmp_path, {})
    return await parse_isolated(
        f"parse_probes:{name}",
        arguments,
        SCOPE,
        chosen.fetch,
        tmp_path / "work",
        limits,
        paths=[PROBES],
    )


async def test_a_parser_cannot_reach_the_network_or_start_a_program(tmp_path: Path) -> None:
    with socket.create_server(("127.0.0.1", 0)) as listener:
        listener.setblocking(False)
        port = listener.getsockname()[1]
        found = await probe("reach_network", {"port": port}, tmp_path)
        with pytest.raises(BlockingIOError):
            listener.accept()
    assert found == {
        "connect": "SandboxRefusedError",
        "resolve": "SandboxRefusedError",
        "spawn": "SandboxRefusedError",
    }


async def test_a_parser_sees_no_secret_from_the_worker(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql://secret")
    monkeypatch.setenv("STORAGE_SECRET_ACCESS_KEY", "secret")
    found = await probe("environment", {}, tmp_path)
    assert set(found["names"]) <= {"HOME", "LC_CTYPE", "PATH", "TMPDIR", "__CF_USER_TEXT_ENCODING"}


async def test_a_parser_reads_only_the_keys_of_its_own_tenant_and_slide(tmp_path: Path) -> None:
    store = Store(
        tmp_path, {UPLOAD_KEY: "upload", OWN_KEY: "own slide", FOREIGN_KEY: "other tenant"}
    )
    found = await probe("read_keys", {"keys": [UPLOAD_KEY, OWN_KEY, FOREIGN_KEY]}, tmp_path, store)
    assert found == {UPLOAD_KEY: "upload", OWN_KEY: "own slide", FOREIGN_KEY: "refused"}
    assert store.fetched == [UPLOAD_KEY, OWN_KEY]


def test_a_forged_or_widened_token_grants_nothing() -> None:
    tokens = JobTokens()
    token = tokens.issue(SCOPE)
    payload, _, signature = token.partition(".")
    wider = JobTokens().issue(JobScope(OTHER_TENANT, SLIDE, (FOREIGN_KEY,))).partition(".")[0]
    assert tokens.scope_of(token) == SCOPE
    assert tokens.scope_of(f"{wider}.{signature}") is None
    assert tokens.scope_of(f"{payload}.") is None
    assert tokens.scope_of(None) is None


async def test_an_oversized_parse_is_stopped_as_a_failed_check(tmp_path: Path) -> None:
    limits = ParseLimits(memory_mib=192, seconds=30, poll_seconds=0.02)
    with pytest.raises(StepFailedError) as stopped:
        await probe("hog_memory", {"chunks": 40}, tmp_path, limits=limits)
    assert stopped.value.code == Failure.PARSE_TOO_LARGE


async def test_a_slow_parse_is_stopped_as_a_failed_check(tmp_path: Path) -> None:
    started = time.monotonic()
    with pytest.raises(StepFailedError) as stopped:
        await probe("stall", {"seconds": 60}, tmp_path, limits=ParseLimits(seconds=1.5))
    assert stopped.value.code == Failure.PARSE_TOO_SLOW
    assert time.monotonic() - started < 15


async def test_a_parser_refusal_passes_through_and_a_crash_is_unreadable(tmp_path: Path) -> None:
    with pytest.raises(StepFailedError) as refused:
        await probe("refuse", {}, tmp_path)
    with pytest.raises(StepFailedError) as crashed:
        await probe("crash", {}, tmp_path)
    assert refused.value.code == Refusal.DAMAGED_TIFF
    assert crashed.value.code == Refusal.UNREADABLE
