import asyncio
import hashlib
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from enum import StrEnum
from pathlib import Path
from typing import Any

from parfocal_common.object_store import ObjectStore, StorageError

PREFIX = "models"
MANIFEST_FILE = "manifest.json"
MANIFEST_SCHEMA = 1
ARTIFACT_CONTENT_TYPE = "application/octet-stream"
MANIFEST_CONTENT_TYPE = "application/json"
NOT_FOUND = 404
PRECONDITION_FAILED = 412
HASH_CHUNK_BYTES = 1 << 20
PART_SUFFIX = ".part"
SEGMENT = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
FILE_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


class ArtifactKind(StrEnum):
    PYTORCH = "pytorch"
    ONNX = "onnx"
    QUANTISED = "quantised"
    CALIBRATION = "calibration"


@dataclass(frozen=True)
class ArtifactFile:
    name: str
    kind: ArtifactKind
    sha256: str
    size: int


@dataclass(frozen=True)
class Manifest:
    family: str
    version: str
    files: tuple[ArtifactFile, ...]

    def file(self, name: str) -> ArtifactFile:
        for entry in self.files:
            if entry.name == name:
                return entry
        raise MissingArtifactError(f"{self.family} {self.version} has no file {name}")


@dataclass(frozen=True)
class Upload:
    file: ArtifactFile
    path: Path


class ArtifactError(Exception):
    pass


class InvalidArtifactError(ArtifactError, ValueError):
    pass


class ChecksumMismatchError(ArtifactError):
    pass


class ArtifactExistsError(ArtifactError):
    pass


class MissingArtifactError(ArtifactError, LookupError):
    pass


def checked_segment(value: str, what: str) -> str:
    if not SEGMENT.fullmatch(value):
        raise InvalidArtifactError(f"A model {what} is lowercase letters, digits, dots, dashes")
    return value


def checked_file(file: ArtifactFile) -> ArtifactFile:
    if not FILE_NAME.fullmatch(file.name) or file.name == MANIFEST_FILE:
        raise InvalidArtifactError(f"{file.name!r} is not a valid artifact file name")
    if not SHA256.fullmatch(file.sha256):
        raise InvalidArtifactError(f"{file.name} needs a lowercase hex SHA-256")
    if file.size <= 0:
        raise InvalidArtifactError(f"{file.name} needs a positive size")
    return file


def version_prefix(family: str, version: str) -> str:
    return f"{PREFIX}/{checked_segment(family, 'family')}/{checked_segment(version, 'version')}"


def manifest_key(family: str, version: str) -> str:
    return f"{version_prefix(family, version)}/{MANIFEST_FILE}"


def artifact_key(family: str, version: str, name: str) -> str:
    if not FILE_NAME.fullmatch(name) or name == MANIFEST_FILE:
        raise InvalidArtifactError(f"{name!r} is not a valid artifact file name")
    return f"{version_prefix(family, version)}/{name}"


def sha256_of_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(HASH_CHUNK_BYTES):
            digest.update(chunk)
    return digest.hexdigest()


def refuse_mismatch(file: ArtifactFile, size: int, sha256: str) -> None:
    if size != file.size or sha256 != file.sha256:
        raise ChecksumMismatchError(
            f"{file.name} has {size} bytes and SHA-256 {sha256}, "
            f"not {file.size} bytes and {file.sha256}"
        )


def manifest_bytes(manifest: Manifest) -> bytes:
    document = {
        "schema": MANIFEST_SCHEMA,
        "family": manifest.family,
        "version": manifest.version,
        "files": [
            {"name": f.name, "kind": f.kind.value, "sha256": f.sha256, "size": f.size}
            for f in manifest.files
        ],
    }
    return json.dumps(document, indent=2, sort_keys=True).encode()


def manifest_of(data: bytes) -> Manifest:
    document: dict[str, Any] = json.loads(data)
    if document.get("schema") != MANIFEST_SCHEMA:
        raise InvalidArtifactError("Unknown model manifest schema")
    files = tuple(
        checked_file(
            ArtifactFile(
                name=str(entry["name"]),
                kind=ArtifactKind(entry["kind"]),
                sha256=str(entry["sha256"]),
                size=int(entry["size"]),
            )
        )
        for entry in document["files"]
    )
    return Manifest(str(document["family"]), str(document["version"]), files)


def planned(family: str, version: str, uploads: Sequence[Upload]) -> Manifest:
    version_prefix(family, version)
    if not uploads:
        raise InvalidArtifactError("A model version needs at least one file")
    names = [checked_file(upload.file).name for upload in uploads]
    if len(set(names)) != len(names):
        raise InvalidArtifactError("Each file name appears once in a model version")
    return Manifest(family, version, tuple(upload.file for upload in uploads))


def checked_bodies(uploads: Sequence[Upload]) -> list[bytes]:
    bodies = [upload.path.read_bytes() for upload in uploads]
    for upload, body in zip(uploads, bodies, strict=True):
        refuse_mismatch(upload.file, len(body), hashlib.sha256(body).hexdigest())
    return bodies


def holds(target: Path, file: ArtifactFile) -> bool:
    return (
        target.is_file()
        and target.stat().st_size == file.size
        and sha256_of_file(target) == file.sha256
    )


class ModelArtifacts:
    def __init__(self, storage: ObjectStore) -> None:
        self.storage = storage

    async def publish(self, family: str, version: str, uploads: Sequence[Upload]) -> Manifest:
        manifest = planned(family, version, uploads)
        bodies = await asyncio.to_thread(checked_bodies, uploads)
        key = manifest_key(family, version)
        if await self.storage.head_object(key) is not None:
            raise ArtifactExistsError(f"{family} {version} is already published")
        for upload, body in zip(uploads, bodies, strict=True):
            await self.put_once(artifact_key(family, version, upload.file.name), body, upload.file)
        try:
            await self.storage.put_new_object(key, manifest_bytes(manifest), MANIFEST_CONTENT_TYPE)
        except StorageError as error:
            if error.status == PRECONDITION_FAILED:
                raise ArtifactExistsError(f"{family} {version} is already published") from error
            raise
        return manifest

    async def put_once(self, key: str, body: bytes, file: ArtifactFile) -> None:
        try:
            await self.storage.put_new_object(key, body, ARTIFACT_CONTENT_TYPE)
        except StorageError as error:
            if error.status != PRECONDITION_FAILED:
                raise
            stored = await self.storage.get_object(key)
            if hashlib.sha256(stored).hexdigest() != file.sha256:
                raise ArtifactExistsError(f"{key} already holds different bytes") from error

    async def manifest(self, family: str, version: str) -> Manifest:
        try:
            data = await self.storage.get_object(manifest_key(family, version))
        except StorageError as error:
            if error.status == NOT_FOUND:
                raise MissingArtifactError(f"{family} {version} is not published") from error
            raise
        manifest = manifest_of(data)
        if (manifest.family, manifest.version) != (family, version):
            raise InvalidArtifactError(f"The manifest at {family} {version} names another model")
        return manifest

    async def fetch(self, family: str, version: str, name: str, target: Path) -> ArtifactFile:
        file = (await self.manifest(family, version)).file(name)
        if await asyncio.to_thread(holds, target, file):
            return file
        partial = target.with_name(target.name + PART_SUFFIX)
        try:
            downloaded = await self.storage.download(artifact_key(family, version, name), partial)
            refuse_mismatch(file, downloaded.size, downloaded.sha256)
        except StorageError as error:
            await asyncio.to_thread(partial.unlink, missing_ok=True)
            if error.status == NOT_FOUND:
                raise MissingArtifactError(f"{family} {version} lost {name}") from error
            raise
        except BaseException:
            await asyncio.to_thread(partial.unlink, missing_ok=True)
            raise
        await asyncio.to_thread(partial.replace, target)
        return file
