import asyncio
import hashlib
from dataclasses import replace
from pathlib import Path
from typing import cast

import httpx2
import pytest

from parfocal_common.model_artifacts import (
    ArtifactExistsError,
    ArtifactFile,
    ArtifactKind,
    ChecksumMismatchError,
    InvalidArtifactError,
    MissingArtifactError,
    ModelArtifacts,
    Upload,
    artifact_key,
    manifest_key,
)
from parfocal_common.object_store import Downloaded, ObjectStore, StorageError, StorageLocation

FAMILY = "pathosam-ais"
VERSION = "1.0.0"
LOCATION = StorageLocation(
    endpoint="http://storage.test",
    region="auto",
    bucket="parfocal-test",
    access_key_id="key",
    secret_access_key="secret",
)


class FakeStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.puts: list[str] = []

    async def put_new_object(self, key: str, body: bytes, content_type: str) -> None:
        if key in self.objects:
            raise StorageError(412, "PreconditionFailed")
        self.puts.append(key)
        self.objects[key] = body

    async def head_object(self, key: str) -> int | None:
        body = self.objects.get(key)
        return None if body is None else len(body)

    async def get_object(self, key: str) -> bytes:
        if key not in self.objects:
            raise StorageError(404, "NoSuchKey")
        return self.objects[key]

    async def download(self, key: str, target: Path) -> Downloaded:
        body = await self.get_object(key)
        await asyncio.to_thread(target.write_bytes, body)
        return Downloaded(len(body), hashlib.sha256(body).hexdigest())


def artifacts(storage: FakeStorage) -> ModelArtifacts:
    return ModelArtifacts(cast("ObjectStore", storage))


def fake_file(folder: Path, name: str, body: bytes, kind: ArtifactKind) -> Upload:
    path = folder / name
    path.write_bytes(body)
    return Upload(ArtifactFile(name, kind, hashlib.sha256(body).hexdigest(), len(body)), path)


def line_up(folder: Path) -> list[Upload]:
    return [
        fake_file(folder, "decoder.pt", b"fake torch weights", ArtifactKind.PYTORCH),
        fake_file(folder, "decoder.onnx", b"fake onnx graph", ArtifactKind.ONNX),
        fake_file(folder, "decoder_uint8.onnx", b"fake uint8 graph", ArtifactKind.QUANTISED),
        fake_file(folder, "temperature.json", b'{"temperature": 1.42}', ArtifactKind.CALIBRATION),
    ]


async def test_a_published_version_writes_every_file_then_the_manifest(tmp_path: Path) -> None:
    storage = FakeStorage()
    manifest = await artifacts(storage).publish(FAMILY, VERSION, line_up(tmp_path))
    assert storage.puts[-1] == manifest_key(FAMILY, VERSION)
    assert storage.puts[0] == "models/pathosam-ais/1.0.0/decoder.pt"
    assert {f.kind for f in manifest.files} == set(ArtifactKind)
    assert await artifacts(storage).manifest(FAMILY, VERSION) == manifest


async def test_a_file_whose_checksum_does_not_match_is_refused(tmp_path: Path) -> None:
    storage = FakeStorage()
    upload = fake_file(tmp_path, "decoder.pt", b"fake torch weights", ArtifactKind.PYTORCH)
    upload.path.write_bytes(b"fake torch weightz")
    with pytest.raises(ChecksumMismatchError):
        await artifacts(storage).publish(FAMILY, VERSION, [upload])
    assert storage.objects == {}


async def test_a_file_whose_size_does_not_match_is_refused(tmp_path: Path) -> None:
    storage = FakeStorage()
    upload = fake_file(tmp_path, "decoder.pt", b"fake torch weights", ArtifactKind.PYTORCH)
    wrong = Upload(replace(upload.file, size=3), upload.path)
    with pytest.raises(ChecksumMismatchError):
        await artifacts(storage).publish(FAMILY, VERSION, [wrong])
    assert storage.objects == {}


async def test_a_published_version_is_never_overwritten(tmp_path: Path) -> None:
    storage = FakeStorage()
    await artifacts(storage).publish(FAMILY, VERSION, line_up(tmp_path))
    before = dict(storage.objects)
    other = fake_file(tmp_path, "decoder.pt", b"other torch weights", ArtifactKind.PYTORCH)
    with pytest.raises(ArtifactExistsError):
        await artifacts(storage).publish(FAMILY, VERSION, [other])
    assert storage.objects == before


class RacingStorage(FakeStorage):
    async def head_object(self, key: str) -> int | None:
        return None


async def test_a_lost_race_on_the_manifest_is_refused(tmp_path: Path) -> None:
    storage = RacingStorage()
    storage.objects[manifest_key(FAMILY, VERSION)] = b"{}"
    with pytest.raises(ArtifactExistsError):
        await artifacts(storage).publish(FAMILY, VERSION, line_up(tmp_path))
    assert storage.objects[manifest_key(FAMILY, VERSION)] == b"{}"


async def test_different_bytes_left_by_an_earlier_attempt_are_refused(tmp_path: Path) -> None:
    storage = FakeStorage()
    storage.objects[artifact_key(FAMILY, VERSION, "decoder.pt")] = b"stale bytes"
    upload = fake_file(tmp_path, "decoder.pt", b"fake torch weights", ArtifactKind.PYTORCH)
    with pytest.raises(ArtifactExistsError):
        await artifacts(storage).publish(FAMILY, VERSION, [upload])
    assert manifest_key(FAMILY, VERSION) not in storage.objects


async def test_an_interrupted_publish_resumes_with_the_same_bytes(tmp_path: Path) -> None:
    storage = FakeStorage()
    uploads = line_up(tmp_path)
    storage.objects[artifact_key(FAMILY, VERSION, "decoder.pt")] = b"fake torch weights"
    manifest = await artifacts(storage).publish(FAMILY, VERSION, uploads)
    assert len(manifest.files) == len(uploads)


async def test_a_fetched_file_matches_its_manifest(tmp_path: Path) -> None:
    storage = FakeStorage()
    await artifacts(storage).publish(FAMILY, VERSION, line_up(tmp_path))
    target = tmp_path / "out.onnx"
    file = await artifacts(storage).fetch(FAMILY, VERSION, "decoder.onnx", target)
    assert target.read_bytes() == b"fake onnx graph"
    assert file.kind is ArtifactKind.ONNX


async def test_a_swapped_file_in_storage_is_refused_on_fetch(tmp_path: Path) -> None:
    storage = FakeStorage()
    await artifacts(storage).publish(FAMILY, VERSION, line_up(tmp_path))
    storage.objects[artifact_key(FAMILY, VERSION, "decoder.onnx")] = b"swapped onnx gra"
    target = tmp_path / "out.onnx"
    with pytest.raises(ChecksumMismatchError):
        await artifacts(storage).fetch(FAMILY, VERSION, "decoder.onnx", target)
    assert not target.exists()
    assert not (tmp_path / "out.onnx.part").exists()


async def test_a_cached_file_that_matches_is_not_downloaded_again(tmp_path: Path) -> None:
    storage = FakeStorage()
    await artifacts(storage).publish(FAMILY, VERSION, line_up(tmp_path))
    target = tmp_path / "cached.onnx"
    target.write_bytes(b"fake onnx graph")
    del storage.objects[artifact_key(FAMILY, VERSION, "decoder.onnx")]
    await artifacts(storage).fetch(FAMILY, VERSION, "decoder.onnx", target)
    assert target.read_bytes() == b"fake onnx graph"


async def test_a_missing_version_or_file_is_reported(tmp_path: Path) -> None:
    storage = FakeStorage()
    with pytest.raises(MissingArtifactError):
        await artifacts(storage).manifest(FAMILY, VERSION)
    await artifacts(storage).publish(FAMILY, VERSION, line_up(tmp_path))
    with pytest.raises(MissingArtifactError):
        await artifacts(storage).fetch(FAMILY, VERSION, "nope.onnx", tmp_path / "nope.onnx")


@pytest.mark.parametrize(
    ("family", "version", "name"),
    [
        ("../escape", VERSION, "a.pt"),
        (FAMILY, "1.0/../2", "a.pt"),
        (FAMILY, VERSION, "../a.pt"),
        (FAMILY, VERSION, "manifest.json"),
        ("Upper", VERSION, "a.pt"),
    ],
)
async def test_unsafe_names_are_refused(
    tmp_path: Path, family: str, version: str, name: str
) -> None:
    upload = fake_file(tmp_path, "a.pt", b"bytes", ArtifactKind.PYTORCH)
    renamed = Upload(replace(upload.file, name=name), upload.path)
    with pytest.raises(InvalidArtifactError):
        await artifacts(FakeStorage()).publish(family, version, [renamed])


async def test_duplicate_or_missing_files_are_refused(tmp_path: Path) -> None:
    upload = fake_file(tmp_path, "a.pt", b"bytes", ArtifactKind.PYTORCH)
    with pytest.raises(InvalidArtifactError):
        await artifacts(FakeStorage()).publish(FAMILY, VERSION, [upload, upload])
    with pytest.raises(InvalidArtifactError):
        await artifacts(FakeStorage()).publish(FAMILY, VERSION, [])


async def test_a_new_object_put_sends_a_signed_if_none_match_header() -> None:
    seen: list[httpx2.Request] = []

    def handle(request: httpx2.Request) -> httpx2.Response:
        seen.append(request)
        return httpx2.Response(412, content=b"<Error><Code>PreconditionFailed</Code></Error>")

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(handle)) as http:
        with pytest.raises(StorageError) as raised:
            await ObjectStore(LOCATION, http).put_new_object(
                "models/a/1/a.pt", b"x", "application/octet-stream"
            )
    assert raised.value.status == 412
    assert seen[0].headers["if-none-match"] == "*"
    assert "if-none-match" in seen[0].headers["authorization"]
