import argparse
import asyncio
import os
import tempfile
from pathlib import Path

import httpx2

from parfocal_common.model_artifacts import (
    ArtifactExistsError,
    ArtifactFile,
    ArtifactKind,
    ModelArtifacts,
    Upload,
    sha256_of_file,
)
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_common.outline_types import TYPER_VERSION, TYPER_WEIGHTS
from parfocal_ml.outline_typer_worker import WEIGHTS_NAME, OnnxTyper

EXPECTED_SHA256 = "fdf65836a8971a989fd34b76ba5698bfa1b6bc91ca921b5a6accaaff91e9593d"
EXPECTED_SIZE = 128_040_280
LOCAL_ENDPOINT = "http://127.0.0.1:9000"


def r2_location(bucket: str) -> StorageLocation:
    return StorageLocation(
        endpoint=f"https://{os.environ['R2_ACCOUNT_ID']}.eu.r2.cloudflarestorage.com",
        region="auto",
        bucket=bucket,
        access_key_id=os.environ["R2_ACCESS_KEY_ID"],
        secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"],
    )


def minio_location(bucket: str) -> StorageLocation:
    return StorageLocation(LOCAL_ENDPOINT, "auto", bucket, "parfocal", "parfocal-local-secret")


def parity_export(weights: Path) -> ArtifactFile:
    sha256 = sha256_of_file(weights)
    size = weights.stat().st_size
    if (sha256, size) != (EXPECTED_SHA256, EXPECTED_SIZE):
        raise SystemExit(f"{weights} is {size} bytes with SHA-256 {sha256}, not the parity export")
    return ArtifactFile(WEIGHTS_NAME, ArtifactKind.ONNX, sha256, size)


async def publish(location: StorageLocation, weights: Path) -> None:
    file = await asyncio.to_thread(parity_export, weights)
    async with httpx2.AsyncClient(timeout=600) as http:
        artifacts = ModelArtifacts(ObjectStore(location, http))
        try:
            await artifacts.publish(TYPER_WEIGHTS, TYPER_VERSION, [Upload(file, weights)])
            print(f"published {TYPER_WEIGHTS} {TYPER_VERSION} to {location.bucket}")
        except ArtifactExistsError as error:
            print(f"already published: {error}")
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / WEIGHTS_NAME
            fetched = await artifacts.fetch(TYPER_WEIGHTS, TYPER_VERSION, WEIGHTS_NAME, target)
            local = sha256_of_file(target)
            OnnxTyper(target)
    print(f"manifest {fetched.sha256} {fetched.size}, fetched bytes {local}")
    if local != EXPECTED_SHA256 or fetched.sha256 != EXPECTED_SHA256:
        raise SystemExit("the published artifact does not match the local export")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("weights", type=Path)
    parser.add_argument("--target", choices=("minio", "r2"), required=True)
    parser.add_argument("--bucket", required=True)
    args = parser.parse_args()
    location = r2_location(args.bucket) if args.target == "r2" else minio_location(args.bucket)
    asyncio.run(publish(location, args.weights))


if __name__ == "__main__":
    main()
