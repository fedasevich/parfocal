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
from parfocal_common.tumor_maps import MODEL, MODEL_VERSION
from parfocal_ml.tumor_map_worker import WEIGHTS_NAME

EXPECTED_SHA256 = "9f5e526f6b4f6dd3c9a58df9d40a4ce600a4a97e854ee9b77165a18d6e2400f1"
EXPECTED_SIZE = 44_701_121
LOCAL_ENDPOINT = "http://127.0.0.1:9000"


def r2_location(bucket: str) -> StorageLocation:
    return StorageLocation(
        endpoint=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
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
    async with httpx2.AsyncClient(timeout=300) as http:
        artifacts = ModelArtifacts(ObjectStore(location, http))
        try:
            await artifacts.publish(MODEL, MODEL_VERSION, [Upload(file, weights)])
            print(f"published {MODEL} {MODEL_VERSION} to {location.bucket}")
        except ArtifactExistsError as error:
            print(f"already published: {error}")
        with tempfile.TemporaryDirectory() as folder:
            fetched = await artifacts.fetch(
                MODEL, MODEL_VERSION, WEIGHTS_NAME, Path(folder) / WEIGHTS_NAME
            )
            local = sha256_of_file(Path(folder) / WEIGHTS_NAME)
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
