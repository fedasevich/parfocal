import argparse
import asyncio
import tempfile
from pathlib import Path

import httpx2
from publish_tumor_onnx import minio_location, r2_location

from parfocal_common.model_artifacts import (
    ArtifactExistsError,
    ArtifactFile,
    ArtifactKind,
    ModelArtifacts,
    Upload,
    sha256_of_file,
)
from parfocal_common.object_store import ObjectStore, StorageLocation
from parfocal_ml.nuclei_run_worker import WEIGHTS_FAMILY, WEIGHTS_VERSION
from parfocal_ml.sam_contract import GRAPHS, onnx_dir

EXPECTED = {
    GRAPHS.encoder: (
        "d9021d2c89fb9c9aff30febf110060b36593b83355ea22e996d47bd4ea316e10",
        359_210_526,
    ),
    GRAPHS.ais_decoder_full: (
        "025b538e4b556304c5e759c0b35d0dbf5127ea2ef882ad219cb1f684259ad29a",
        44_149_945,
    ),
}


def checked(folder: Path, name: str) -> Upload:
    path = folder / name
    sha256, size = sha256_of_file(path), path.stat().st_size
    if (sha256, size) != EXPECTED[name]:
        raise SystemExit(f"{path} is {size} bytes with SHA-256 {sha256}, not the measured export")
    return Upload(ArtifactFile(name, ArtifactKind.ONNX, sha256, size), path)


async def publish(location: StorageLocation, folder: Path) -> None:
    uploads = [await asyncio.to_thread(checked, folder, name) for name in EXPECTED]
    async with httpx2.AsyncClient(timeout=900) as http:
        artifacts = ModelArtifacts(ObjectStore(location, http))
        try:
            await artifacts.publish(WEIGHTS_FAMILY, WEIGHTS_VERSION, uploads)
            print(f"published {WEIGHTS_FAMILY} {WEIGHTS_VERSION} to {location.bucket}")
        except ArtifactExistsError as error:
            print(f"already published: {error}")
        with tempfile.TemporaryDirectory() as fetched:
            for name, (sha256, _) in EXPECTED.items():
                target = Path(fetched) / name
                await artifacts.fetch(WEIGHTS_FAMILY, WEIGHTS_VERSION, name, target)
                if sha256_of_file(target) != sha256:
                    raise SystemExit(f"the published {name} does not match the local export")
                print(f"{name} matches {sha256}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--folder", type=Path, default=onnx_dir())
    parser.add_argument("--target", choices=("minio", "r2"), required=True)
    parser.add_argument("--bucket", required=True)
    args = parser.parse_args()
    location = r2_location(args.bucket) if args.target == "r2" else minio_location(args.bucket)
    asyncio.run(publish(location, args.folder))


if __name__ == "__main__":
    main()
